use futures_util::StreamExt;
use tokio::sync::broadcast;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::info;

/// Per-call timeout for `POST /automaton/start`. Overrides the
/// client-wide `timeout(12s)` default because the harness's
/// `bridge.start_dev_loop_with_capabilities` / `run_task_with_capabilities`
/// does identity / tool / skill / system-prompt resolution and
/// optional cold-start work BEFORE it returns the automaton id —
/// which on a freshly-launched harness or a project with a large
/// tool catalog can comfortably exceed 12 seconds. The previous
/// default was timing out the request while the harness happily
/// continued building the automaton in the background, producing
/// orphan automatons + a misleading 503 in the AutomationBar even
/// though the harness's own logs showed the run firing turns.
///
/// 60 seconds is deliberately generous — connection / DNS failures
/// still surface fast via `connect_timeout(3s)`, so the only thing
/// this extra budget changes is "harness is alive and busy setting
/// up" vs "harness is unreachable". An operator who has genuinely
/// lost the harness still gets a clear error within
/// `connect_timeout`.
const AUTOMATON_START_TIMEOUT: Duration = Duration::from_secs(60);

use super::identity::validate_automaton_start_identity;
use super::start_params::{AutomatonStartError, AutomatonStartParams, AutomatonStartResult};
use super::ws_reader::{probe_initial_event, spawn_automaton_reader};
use super::ws_reader_handle::WsReaderHandle;

/// Client for the harness automaton REST + WebSocket API.
#[derive(Debug, Clone)]
pub struct AutomatonClient {
    http_base: String,
    http: reqwest::Client,
    auth_token: Option<String>,
}

impl AutomatonClient {
    pub fn new(harness_base_url: &str) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http_base: harness_base_url.trim_end_matches('/').to_string(),
            http,
            auth_token: None,
        }
    }

    pub fn with_auth(mut self, token: Option<String>) -> Self {
        self.auth_token = token;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.http_base
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth_token {
            Some(token) => req.bearer_auth(token),
            None => req,
        }
    }

    /// Start a dev-loop or single-task automaton.
    pub async fn start(
        &self,
        params: AutomatonStartParams,
    ) -> Result<AutomatonStartResult, AutomatonStartError> {
        // Tier 2 fail-fast: refuse to POST /automaton/start with a
        // payload missing one of the required identity fields. The
        // server's `start_or_adopt` / `run_single_task` already
        // preflight in Tier 1, but this guard catches direct
        // callers / outdated server builds and preserves the
        // structured error shape via `HarnessError::SessionIdentityMissing`.
        if let Err(err) = validate_automaton_start_identity(&params) {
            return Err(AutomatonStartError::Other(anyhow::Error::new(err).context(
                "automaton client rejected /automaton/start: identity preflight",
            )));
        }
        let url = format!("{}/automaton/start", self.http_base);
        // Override the client-wide 12s budget for this single call —
        // see the doc comment on `AUTOMATON_START_TIMEOUT` above for
        // why the harness needs more headroom on the start path.
        let req = self
            .apply_auth(self.http.post(&url).json(&params))
            .timeout(AUTOMATON_START_TIMEOUT);
        let resp = req.send().await.map_err(|e| AutomatonStartError::Request {
            message: format!("harness start request failed: {e}"),
            is_connect: e.is_connect(),
            is_timeout: e.is_timeout(),
        })?;
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| AutomatonStartError::Other(e.into()))?;
        if status == reqwest::StatusCode::CONFLICT {
            let automaton_id = extract_conflict_automaton_id(&body);
            return Err(AutomatonStartError::Conflict(automaton_id));
        }
        if !status.is_success() {
            return Err(AutomatonStartError::Response {
                status: status.as_u16(),
                body,
            });
        }
        serde_json::from_str(&body).map_err(|e| AutomatonStartError::Other(e.into()))
    }

    /// Pause a running automaton.
    pub async fn pause(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/pause", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST pause returned {status}: {body}");
        }
        Ok(())
    }

    /// Stop a running automaton.
    pub async fn stop(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/stop", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST stop returned {status}: {body}");
        }
        Ok(())
    }

    /// Resume a paused automaton.
    pub async fn resume(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/resume", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST resume returned {status}: {body}");
        }
        Ok(())
    }

    /// Get the status of an automaton.
    pub async fn status(&self, automaton_id: &str) -> anyhow::Result<serde_json::Value> {
        let url = format!("{}/automaton/{automaton_id}/status", self.http_base);
        let resp = self.apply_auth(self.http.get(&url)).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET status returned {status}: {body}");
        }
        Ok(serde_json::from_str(&body)?)
    }

    /// Ask the harness for the canonical workspace path for a project.
    ///
    /// Calls `GET {base}/workspace/resolve?project_name={name}` and returns
    /// the `path` field from the JSON response.
    pub async fn resolve_workspace(&self, project_name: &str) -> anyhow::Result<String> {
        let url = format!("{}/workspace/resolve", self.http_base);
        let resp = self
            .apply_auth(self.http.get(&url).query(&[("project_name", project_name)]))
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET workspace/resolve returned {status}: {body}");
        }
        let json: serde_json::Value = serde_json::from_str(&body)?;
        json.get("path")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("workspace resolve response missing 'path' field"))
    }

    /// Derive the WebSocket base URL from `http_base`.
    fn ws_base(&self) -> String {
        self.http_base
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    }

    /// Resolve the WebSocket URL for the automaton event stream.
    ///
    /// When `event_stream_url` is provided (from the harness start response),
    /// it is used -- either directly if already absolute, or prefixed with the
    /// gateway WS base when relative.  This mirrors how `SwarmHarness` handles
    /// the `ws_url` returned by session creation and is required because the
    /// swarm gateway only routes WebSocket upgrades on paths it knows about.
    ///
    /// Falls back to `{ws_base}/stream/automaton/{automaton_id}` (the local-
    /// harness convention) when no URL is supplied.
    fn resolve_event_stream_url(
        &self,
        automaton_id: &str,
        event_stream_url: Option<&str>,
    ) -> String {
        match event_stream_url {
            Some(u) if u.starts_with("ws://") || u.starts_with("wss://") => u.to_string(),
            Some(u) => format!("{}/{}", self.ws_base(), u.trim_start_matches('/')),
            None => format!("{}/stream/automaton/{automaton_id}", self.ws_base()),
        }
    }

    /// Connect to the automaton event WebSocket and forward events to a broadcast channel.
    /// Returns the broadcast sender plus a [`WsReaderHandle`]; keep the
    /// handle alive for as long as you want events to flow, and drop /
    /// [`cancel`](WsReaderHandle::cancel) it to close the underlying
    /// WebSocket (which releases the harness's WS slot).
    ///
    /// Spawns a background task that reads from the WebSocket and
    /// forwards parsed events to the returned `broadcast::Sender`.
    ///
    /// After a successful WS handshake a brief liveness probe waits for the first
    /// message or error.  If the connection is reset immediately (e.g. the harness
    /// already finished the automaton) the method returns `Err` so the caller can
    /// retry instead of silently spawning a dead reader task.
    ///
    /// Pass the `event_stream_url` returned by [`Self::start`] when available so
    /// the connection uses the gateway-routable path instead of a hardcoded one.
    pub async fn connect_event_stream(
        &self,
        automaton_id: &str,
        event_stream_url: Option<&str>,
    ) -> anyhow::Result<(broadcast::Sender<serde_json::Value>, WsReaderHandle)> {
        let url = self.resolve_event_stream_url(automaton_id, event_stream_url);
        info!(automaton_id, %url, "Connecting to automaton event stream");

        let mut request = url
            .clone()
            .into_client_request()
            .map_err(|e| anyhow::anyhow!("failed to build WS request: {e}"))?;
        if let Some(ref token) = self.auth_token {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {token}")
                    .parse()
                    .map_err(|e| anyhow::anyhow!("bad auth header value: {e}"))?,
            );
        }
        let connect_result = tokio::time::timeout(
            Duration::from_secs(8),
            tokio_tungstenite::connect_async(request),
        )
        .await
        .map_err(|_| anyhow::anyhow!("timed out connecting to automaton event stream: {url}"))?;
        let (ws_stream, _) = match connect_result {
            Ok(ok) => ok,
            Err(err) => {
                // Phase 4: surface upstream WS-slot exhaustion as the
                // typed `HarnessError::CapacityExhausted` so the
                // server's `map_harness_error_to_api` can funnel it
                // into the structured 503 envelope instead of letting
                // it inherit the generic `bad_gateway` mapping the
                // dev-loop adapter previously applied. Mirrors the
                // same detection used in `LocalHarness::open_session`.
                if crate::local_harness::is_capacity_exhausted_ws_error(&err) {
                    return Err(
                        anyhow::Error::new(crate::error::HarnessError::CapacityExhausted)
                            .context(format!("automaton event stream connect rejected: {err}")),
                    );
                }
                return Err(
                    anyhow::Error::new(err).context("automaton event stream connect failed")
                );
            }
        };
        info!(automaton_id, "Connected to automaton event stream");

        let (_write, mut read) = ws_stream.split();
        let buffered_event = probe_initial_event(&mut read).await?;
        let (broadcast_tx, _) = broadcast::channel(4096);
        let reader = spawn_automaton_reader(
            automaton_id.to_string(),
            _write,
            read,
            broadcast_tx.clone(),
            buffered_event,
        );

        let handle = WsReaderHandle::new(reader.abort_handle());
        Ok((broadcast_tx, handle))
    }
}

/// Extract an `automaton_id` from a harness 409 response body.
///
/// The harness has historically returned the conflict in two shapes,
/// and a small wedge in the wild surfaces when the parser only handles
/// one of them: starting a fresh dev loop while a stale automaton still
/// occupies the harness's per-`agent_id` slot returns
/// `Conflict(None)` from this client, which then bypasses the
/// adopt-or-stop-and-restart path in `start_or_adopt` and leaves the
/// user with a silent 409 they cannot recover from without restarting
/// the harness process.
///
/// The two shapes we now accept:
///
/// 1. Structured: `{"automaton_id": "..."}` or
///    `{"data": {"automaton_id": "..."}}` — the modern wire shape, used
///    by harness builds that round-trip a typed conflict payload.
/// 2. Legacy substring: an `error` field whose free text contains
///    `automaton_id: <id>` — the original `Display` impl of the
///    harness's own `Conflict(Some(_))` Debug-formats the id into the
///    error string, which is what the previous parser keyed on.
///
/// Returning `Some(id)` here is what lets the server's
/// `start_or_adopt` either adopt the live automaton or `client.stop`
/// the stale one and retry — both of which are required for the
/// AutomationBar Play button to recover on a wedge instead of
/// surfacing the wedge as "Play does nothing".
fn extract_conflict_automaton_id(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;

    if let Some(id) = read_automaton_id_field(&value) {
        return Some(id);
    }
    if let Some(data) = value.get("data") {
        if let Some(id) = read_automaton_id_field(data) {
            return Some(id);
        }
    }
    if let Some(error) = value.get("error") {
        if let Some(id) = read_automaton_id_field(error) {
            return Some(id);
        }
        if let Some(msg) = error.as_str() {
            if let Some(id) = extract_automaton_id_substring(msg) {
                return Some(id);
            }
        }
    }
    if let Some(msg) = value.get("message").and_then(|v| v.as_str()) {
        if let Some(id) = extract_automaton_id_substring(msg) {
            return Some(id);
        }
    }
    None
}

/// Pull an `automaton_id` field off a JSON object, accepting either
/// `automaton_id` (preferred) or the older `id` alias the harness
/// uses for the start-response success body. Blank strings are
/// treated as missing so we don't synthesise an empty id.
fn read_automaton_id_field(value: &serde_json::Value) -> Option<String> {
    let obj = value.as_object()?;
    for key in ["automaton_id", "id"] {
        if let Some(s) = obj.get(key).and_then(|v| v.as_str()) {
            let trimmed = s.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Parse the `automaton_id: <id>` fragment out of a free-text error
/// message. Matches the legacy harness Display format
/// `"a dev loop is already running (automaton_id: \"abc\")"`, the
/// `Some("abc")` Debug shape from `Conflict(Some(_))`, and the
/// bare `automaton_id: abc` variant some harness builds emit.
fn extract_automaton_id_substring(msg: &str) -> Option<String> {
    let needle = "automaton_id:";
    let pos = msg.find(needle)?;
    let tail = msg[pos + needle.len()..].trim_start();
    let mut trimmed: &str = tail;
    if let Some(rest) = trimmed.strip_prefix("Some(") {
        trimmed = rest.trim_end_matches(')');
    }
    let trimmed = trimmed.trim_matches('"').trim();
    let end = trimmed
        .find(|c: char| c == ')' || c == ',' || c == '}' || c == '"' || c.is_whitespace())
        .unwrap_or(trimmed.len());
    let candidate = &trimmed[..end];
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

#[cfg(test)]
mod parser_tests {
    use super::{extract_automaton_id_substring, extract_conflict_automaton_id};

    #[test]
    fn structured_top_level_automaton_id_is_extracted() {
        let body = r#"{"automaton_id":"auto-abc","error":"conflict"}"#;
        assert_eq!(extract_conflict_automaton_id(body).as_deref(), Some("auto-abc"));
    }

    #[test]
    fn structured_nested_data_automaton_id_is_extracted() {
        let body = r#"{"error":"conflict","data":{"automaton_id":"auto-nested"}}"#;
        assert_eq!(extract_conflict_automaton_id(body).as_deref(), Some("auto-nested"));
    }

    #[test]
    fn legacy_substring_in_error_string_is_extracted() {
        // The harness's original `Display` impl serialises
        // `Conflict(Some("auto-legacy"))` as the substring below.
        let body = r#"{"error":"a dev loop is already running (automaton_id: \"auto-legacy\")"}"#;
        assert_eq!(extract_conflict_automaton_id(body).as_deref(), Some("auto-legacy"));
    }

    #[test]
    fn legacy_some_debug_format_is_extracted() {
        let body = r#"{"error":"conflict at automaton_id: Some(\"auto-some\")"}"#;
        assert_eq!(extract_conflict_automaton_id(body).as_deref(), Some("auto-some"));
    }

    #[test]
    fn bare_unquoted_substring_is_extracted() {
        let body = r#"{"message":"automaton_id: auto-bare blocked by upstream"}"#;
        assert_eq!(extract_conflict_automaton_id(body).as_deref(), Some("auto-bare"));
    }

    #[test]
    fn missing_id_returns_none() {
        let body = r#"{"error":"a dev loop is already running"}"#;
        assert_eq!(extract_conflict_automaton_id(body), None);
    }

    #[test]
    fn non_json_body_returns_none() {
        assert_eq!(extract_conflict_automaton_id("not json at all"), None);
    }

    #[test]
    fn substring_helper_handles_trailing_punctuation() {
        assert_eq!(
            extract_automaton_id_substring("blah automaton_id: abc, more").as_deref(),
            Some("abc"),
        );
    }
}
