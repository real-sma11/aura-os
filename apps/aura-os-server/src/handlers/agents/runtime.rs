use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use tokio::time::timeout;

use aura_os_core::{Agent, AgentId};
use aura_os_harness::{
    HarnessInbound, HarnessOutbound, SessionConfig, SessionModelOverrides, SessionUsage,
    UserMessage,
};

use crate::dto::AgentRuntimeTestResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::{AppState, AuthJwt};

struct RuntimeOutcome {
    text: String,
    usage: SessionUsage,
}

pub(crate) async fn test_agent_runtime(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentRuntimeTestResponse>> {
    let agent = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&agent_id))
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))?;

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be tested",
            agent.adapter_type
        )));
    }

    let model = effective_model(&agent, None);

    let outcome = run_harness_test(&state, &agent, &jwt, model.clone()).await?;

    Ok(Json(AgentRuntimeTestResponse {
        ok: true,
        adapter_type: agent.adapter_type.clone(),
        environment: agent.environment.clone(),
        auth_source: agent.auth_source.clone(),
        provider: non_empty_string(&outcome.usage.provider),
        model: non_empty_string(&outcome.usage.model),
        integration_id: None,
        integration_name: None,
        message: outcome.text.trim().to_string(),
    }))
}

pub(crate) fn effective_model(agent: &Agent, override_model: Option<String>) -> Option<String> {
    override_model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            agent
                .default_model
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Build the per-session model overrides Aura OS sends to the harness.
///
/// LLM traffic always flows through aura-router with a per-request JWT;
/// there is no provider/routing toggle on the wire. Returns `None` when
/// no model is set, which tells the harness to use its env defaults
/// verbatim.
///
/// Stable cache key strategy: pass `Some(cache_key)` derived from the
/// agent / instance / session identity so OpenAI-family routing can pin
/// the prefix on the upstream provider. `retention` defaults to the
/// shorter in-memory TTL when `None`; pass `Some("24h")` for long-lived
/// project agents whose context survives idle gaps.
/// OpenAI rejects `prompt_cache_key` strings longer than 64 chars.
const MAX_PROMPT_CACHE_KEY_LEN: usize = 64;

/// Clamp a prompt cache key to OpenAI's 64-char limit.
///
/// Short keys pass through untouched. Long keys keep their namespace
/// prefix (the segment before the first `:`) and gain a stable blake3
/// digest, so caching stays deterministic per identity while never
/// exceeding the provider limit. Hashing (rather than truncating)
/// avoids collisions between distinct long identities.
fn clamp_prompt_cache_key(key: String) -> String {
    if key.len() <= MAX_PROMPT_CACHE_KEY_LEN {
        return key;
    }
    let hash = blake3::hash(key.as_bytes()).to_hex();
    let digest = &hash[..32];
    let prefix = key.split(':').next().unwrap_or("");
    let max_prefix = MAX_PROMPT_CACHE_KEY_LEN - digest.len() - 1;
    let prefix: String = prefix.chars().take(max_prefix).collect();
    format!("{prefix}:{digest}")
}

pub(crate) fn session_model_overrides_with_cache(
    model: Option<&str>,
    cache_key: Option<String>,
    retention: Option<&str>,
) -> Option<SessionModelOverrides> {
    let default_model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let cache_key = cache_key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(clamp_prompt_cache_key);
    let retention = retention
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if default_model.is_none() && cache_key.is_none() && retention.is_none() {
        return None;
    }
    Some(SessionModelOverrides {
        default_model,
        fallback_model: None,
        prompt_caching_enabled: Some(true),
        prompt_cache_key: cache_key,
        prompt_cache_retention: retention,
    })
}

/// Backwards-compatible shorthand used by call sites that don't yet
/// derive a stable cache key (test harness runtime, dev-loop bootstrap).
/// New chat surfaces should prefer `session_model_overrides_with_cache`.
pub(crate) fn session_model_overrides(model: Option<&str>) -> Option<SessionModelOverrides> {
    session_model_overrides_with_cache(model, None, None)
}

async fn run_harness_test(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
    model: Option<String>,
) -> ApiResult<RuntimeOutcome> {
    let installed_tools = if let Some(org_id) = agent.org_id.as_ref() {
        let tools = installed_workspace_app_tools(state, org_id, jwt).await;
        (!tools.is_empty()).then_some(tools)
    } else {
        None
    };
    let installed_integrations = if let Some(org_id) = agent.org_id.as_ref() {
        let integrations =
            installed_workspace_integrations_for_org_with_token(state, org_id, jwt).await;
        (!integrations.is_empty()).then_some(integrations)
    } else {
        None
    };
    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(aura_os_core::harness_agent_id(&agent.agent_id, None, None)),
        template_agent_id: Some(agent.agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.to_string()),
        provider_overrides: session_model_overrides(model.as_deref()),
        installed_tools,
        installed_integrations,
        ..Default::default()
    };

    let session = state
        .harness_for(agent.harness_mode())
        .open_session(config)
        .await
        .map_err(|e| {
            // Phase 6: route through the shared `map_harness_error_to_api`
            // so upstream WS-slot exhaustion surfaces as the structured
            // 503 instead of a raw `bad_gateway`. Non-capacity transport
            // failures keep the original 502 mapping via the fallback.
            map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
                ApiError::bad_gateway(format!("opening harness session failed: {err}"))
            })
        })?;
    let mut rx = session.events_tx.subscribe();
    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: "Reply with exactly `hello from aura` and stop.".to_string(),
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ApiError::bad_gateway(format!("sending harness message failed: {e}")))?;

    let turn = timeout(Duration::from_secs(45), async {
        let mut text = String::new();
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::TextDelta(delta)) => text.push_str(&delta.text),
                Ok(HarnessOutbound::AssistantMessageEnd(end)) => {
                    break Ok(RuntimeOutcome {
                        text,
                        usage: end.usage,
                    });
                }
                Ok(HarnessOutbound::Error(err)) => {
                    break Err(ApiError::bad_gateway(format!(
                        "harness runtime test failed ({}): {}",
                        err.code, err.message
                    )));
                }
                Ok(_) => {}
                Err(e) => break Err(ApiError::bad_gateway(format!("harness stream closed: {e}"))),
            }
        }
    })
    .await
    .map_err(|_| ApiError::bad_gateway("harness runtime test timed out"))??;

    let _ = state
        .harness_for(agent.harness_mode())
        .close_session(&session.session_id)
        .await;

    Ok(turn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_model_overrides_populates_default_model() {
        let overrides = session_model_overrides(Some("claude-sonnet-4"))
            .expect("model present should produce overrides");
        assert_eq!(overrides.default_model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(overrides.prompt_caching_enabled, Some(true));
        assert!(overrides.prompt_cache_key.is_none());
        assert!(overrides.prompt_cache_retention.is_none());
    }

    #[test]
    fn session_model_overrides_returns_none_for_blank_model() {
        assert!(session_model_overrides(None).is_none());
        assert!(session_model_overrides(Some("")).is_none());
        assert!(session_model_overrides(Some("   ")).is_none());
    }

    #[test]
    fn session_model_overrides_with_cache_populates_key_and_retention() {
        let overrides = session_model_overrides_with_cache(
            Some("aura-gpt-4.1"),
            Some("agent:abc-123".into()),
            Some("24h"),
        )
        .expect("model + key should produce overrides");
        assert_eq!(overrides.prompt_cache_key.as_deref(), Some("agent:abc-123"));
        assert_eq!(overrides.prompt_cache_retention.as_deref(), Some("24h"));
    }

    #[test]
    fn session_model_overrides_with_cache_returns_none_when_all_blank() {
        assert!(session_model_overrides_with_cache(None, None, None).is_none());
        assert!(
            session_model_overrides_with_cache(Some(""), Some("  ".into()), Some("")).is_none()
        );
    }

    #[test]
    fn clamp_prompt_cache_key_passes_short_keys_through() {
        let key = "agent:abc-123".to_string();
        assert_eq!(clamp_prompt_cache_key(key.clone()), key);
    }

    #[test]
    fn clamp_prompt_cache_key_shortens_long_keys_to_limit() {
        let long = format!("agent:{}", "a".repeat(200));
        assert!(long.len() > MAX_PROMPT_CACHE_KEY_LEN);
        let clamped = clamp_prompt_cache_key(long);
        assert!(
            clamped.len() <= MAX_PROMPT_CACHE_KEY_LEN,
            "clamped key must fit OpenAI's limit, got {}",
            clamped.len()
        );
        assert!(clamped.starts_with("agent:"));
    }

    #[test]
    fn clamp_prompt_cache_key_is_deterministic() {
        let long = format!("instance:{}", "x".repeat(150));
        assert_eq!(
            clamp_prompt_cache_key(long.clone()),
            clamp_prompt_cache_key(long)
        );
    }

    #[test]
    fn clamp_prompt_cache_key_distinguishes_distinct_long_keys() {
        let a = clamp_prompt_cache_key(format!("agent:{}", "a".repeat(150)));
        let b = clamp_prompt_cache_key(format!("agent:{}", "b".repeat(150)));
        assert_ne!(a, b);
    }

    #[test]
    fn session_model_overrides_with_cache_clamps_oversized_key() {
        let long = format!("agent:{}", "z".repeat(200));
        let overrides =
            session_model_overrides_with_cache(Some("aura-gpt-5-5"), Some(long), Some("24h"))
                .expect("model + key should produce overrides");
        let key = overrides.prompt_cache_key.expect("cache key present");
        assert!(key.len() <= MAX_PROMPT_CACHE_KEY_LEN);
        assert!(key.starts_with("agent:"));
    }
}
