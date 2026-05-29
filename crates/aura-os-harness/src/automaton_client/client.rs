use tokio::time::Duration;

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
use super::start_params::{
    automaton_start_params_to_runtime_request, AutomatonStartError, AutomatonStartParams,
};
use crate::harness::RunHandle;

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

    /// Start a dev-loop or single-task automaton via `POST /v1/run`.
    ///
    /// Phase A: the legacy `POST /automaton/start` endpoint and its
    /// twin `AutomatonStartRequest` body shape are gone; the harness
    /// now consumes a single canonical [`aura_protocol::RuntimeRequest`]
    /// for chat / dev-loop / task-run kickoffs. The
    /// [`AutomatonStartParams`] builder type stays in the client
    /// surface (lots of aura-os call sites populate it), and we
    /// translate it to the new wire shape via
    /// [`automaton_start_params_to_runtime_request`] right before the
    /// HTTP send.
    pub async fn start(
        &self,
        params: AutomatonStartParams,
    ) -> Result<RunHandle, AutomatonStartError> {
        // Tier 2 fail-fast: refuse to POST /v1/run with a payload
        // missing one of the required identity fields.
        if let Err(err) = validate_automaton_start_identity(&params) {
            return Err(AutomatonStartError::Other(
                anyhow::Error::new(err)
                    .context("automaton client rejected /v1/run: identity preflight"),
            ));
        }
        let url = format!("{}/v1/run", self.http_base);
        let body = automaton_start_params_to_runtime_request(&params);
        // Override the client-wide 12s budget for this single call —
        // see the doc comment on `AUTOMATON_START_TIMEOUT` above for
        // why the harness needs more headroom on the start path.
        let req = self
            .apply_auth(self.http.post(&url).json(&body))
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

    /// Pause a running run via `POST /v1/run/:id/pause`.
    pub async fn pause(&self, run_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/v1/run/{run_id}/pause", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST pause returned {status}: {body}");
        }
        Ok(())
    }

    /// Stop a running run via `POST /v1/run/:id/stop`.
    pub async fn stop(&self, run_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/v1/run/{run_id}/stop", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST stop returned {status}: {body}");
        }
        Ok(())
    }

    /// Resume a paused run via `POST /v1/run/:id/resume`.
    ///
    /// (Note: the harness does not currently expose a resume endpoint
    /// in the `/v1/run/*` surface; callers should treat resume as a
    /// no-op or restart the run via `start`. The method is retained
    /// for backwards-compat surface area.)
    pub async fn resume(&self, run_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/v1/run/{run_id}/resume", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST resume returned {status}: {body}");
        }
        Ok(())
    }

    /// Get the status of a run via `GET /v1/run/:id/status`.
    pub async fn status(&self, run_id: &str) -> anyhow::Result<serde_json::Value> {
        let url = format!("{}/v1/run/{run_id}/status", self.http_base);
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
        assert_eq!(
            extract_conflict_automaton_id(body).as_deref(),
            Some("auto-abc")
        );
    }

    #[test]
    fn structured_nested_data_automaton_id_is_extracted() {
        let body = r#"{"error":"conflict","data":{"automaton_id":"auto-nested"}}"#;
        assert_eq!(
            extract_conflict_automaton_id(body).as_deref(),
            Some("auto-nested")
        );
    }

    #[test]
    fn legacy_substring_in_error_string_is_extracted() {
        // The harness's original `Display` impl serialises
        // `Conflict(Some("auto-legacy"))` as the substring below.
        let body = r#"{"error":"a dev loop is already running (automaton_id: \"auto-legacy\")"}"#;
        assert_eq!(
            extract_conflict_automaton_id(body).as_deref(),
            Some("auto-legacy")
        );
    }

    #[test]
    fn legacy_some_debug_format_is_extracted() {
        let body = r#"{"error":"conflict at automaton_id: Some(\"auto-some\")"}"#;
        assert_eq!(
            extract_conflict_automaton_id(body).as_deref(),
            Some("auto-some")
        );
    }

    #[test]
    fn bare_unquoted_substring_is_extracted() {
        let body = r#"{"message":"automaton_id: auto-bare blocked by upstream"}"#;
        assert_eq!(
            extract_conflict_automaton_id(body).as_deref(),
            Some("auto-bare")
        );
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
