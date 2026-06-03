use aura_os_core::{effective_auth_source, AgentRuntimeConfig, LATEST_FRONTIER_MODEL};

use crate::error::{ApiError, ApiResult};

pub(super) const REMOTE_ONLY_LOCAL_AGENT_MESSAGE: &str =
    "local agents are not supported on this deployment; use a remote agent";

pub(super) fn agent_name_has_supported_format(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

pub(super) fn ensure_supported_agent_name(name: &str) -> ApiResult<()> {
    if agent_name_has_supported_format(name) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "agent name must use only letters, numbers, hyphens, or underscores",
        ))
    }
}

/// Inputs to [`build_runtime_config`]. Keeps the function under the 5-param
/// rule while preserving the original semantics — every field is optional and
/// resolved via the same fallbacks the legacy positional API used.
pub(super) struct RuntimeConfigInputs {
    pub adapter_type: Option<String>,
    pub environment: Option<String>,
    pub auth_source: Option<String>,
    pub integration_id: Option<String>,
    pub default_model: Option<String>,
    pub machine_type: Option<String>,
}

fn normalize_environment(
    environment: Option<String>,
    machine_type: Option<String>,
) -> ApiResult<String> {
    let resolved = environment.unwrap_or_else(|| match machine_type.as_deref() {
        Some("remote") => "swarm_microvm".to_string(),
        _ => "local_host".to_string(),
    });

    match resolved.as_str() {
        "local_host" | "swarm_microvm" => Ok(resolved),
        _ => Err(ApiError::bad_request(format!(
            "unsupported environment `{resolved}`"
        ))),
    }
}

pub(super) fn build_runtime_config(inputs: RuntimeConfigInputs) -> ApiResult<AgentRuntimeConfig> {
    let adapter_type = ensure_supported_adapter(inputs.adapter_type)?;
    let environment = normalize_environment(inputs.environment, inputs.machine_type)?;
    let auth_source = effective_auth_source(
        &adapter_type,
        inputs.auth_source.as_deref(),
        inputs.integration_id.as_deref(),
    );
    ensure_supported_auth_source(&adapter_type, &auth_source)?;
    let integration_id = resolve_integration_id(&auth_source, inputs.integration_id)?;

    Ok(AgentRuntimeConfig {
        adapter_type,
        environment,
        auth_source,
        integration_id,
        // Newly created agents run on the latest frontier model unless the
        // creator picked one explicitly. This carries through to chat
        // (`effective_model`) and the dev loop / task runner
        // (`pick_model`), so a headless / remote agent with no human at a
        // model picker still has a concrete model to run on.
        default_model: resolve_default_model(inputs.default_model),
    })
}

/// Resolve the agent's default model at creation: a non-blank explicit
/// value wins; otherwise fall back to [`LATEST_FRONTIER_MODEL`].
fn resolve_default_model(requested: Option<String>) -> Option<String> {
    requested
        .filter(|value| !value.trim().is_empty())
        .or_else(|| Some(LATEST_FRONTIER_MODEL.to_string()))
}

pub(super) fn ensure_remote_runtime_create_allowed(
    remote_only: bool,
    runtime_config: &AgentRuntimeConfig,
) -> ApiResult<()> {
    if remote_only && runtime_config.environment == "local_host" {
        return Err(ApiError::bad_request(REMOTE_ONLY_LOCAL_AGENT_MESSAGE));
    }
    Ok(())
}

pub(super) fn ensure_remote_runtime_update_allowed(
    remote_only: bool,
    requested_machine_type: Option<&str>,
    requested_environment: Option<&str>,
    existing_machine_type: &str,
    existing_environment: &str,
) -> ApiResult<()> {
    if !remote_only {
        return Ok(());
    }
    let existing_is_local =
        existing_machine_type == "local" || existing_environment == "local_host";
    let requested_local =
        requested_machine_type == Some("local") || requested_environment == Some("local_host");
    if requested_local && !existing_is_local {
        return Err(ApiError::bad_request(REMOTE_ONLY_LOCAL_AGENT_MESSAGE));
    }
    Ok(())
}

fn ensure_supported_adapter(adapter_type: Option<String>) -> ApiResult<String> {
    let adapter_type = adapter_type.unwrap_or_else(|| "aura_harness".to_string());
    if adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "unsupported adapter `{adapter_type}`; only `aura_harness` is supported"
        )));
    }
    Ok(adapter_type)
}

fn ensure_supported_auth_source(adapter_type: &str, auth_source: &str) -> ApiResult<()> {
    match auth_source {
        "aura_managed" => Ok(()),
        other => Err(ApiError::bad_request(format!(
            "adapter `{adapter_type}` does not support auth source `{other}`"
        ))),
    }
}

fn resolve_integration_id(
    auth_source: &str,
    integration_id: Option<String>,
) -> ApiResult<Option<String>> {
    if auth_source != "org_integration" {
        return Ok(None);
    }
    let _ = integration_id;
    Err(ApiError::bad_request(
        "auth source `org_integration` is no longer supported; model requests route through Aura",
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        agent_name_has_supported_format, build_runtime_config,
        ensure_remote_runtime_create_allowed, ensure_remote_runtime_update_allowed,
        RuntimeConfigInputs,
    };

    fn aura_harness_inputs() -> RuntimeConfigInputs {
        RuntimeConfigInputs {
            adapter_type: Some("aura_harness".to_string()),
            environment: Some("local_host".to_string()),
            auth_source: None,
            integration_id: None,
            default_model: None,
            machine_type: Some("local".to_string()),
        }
    }

    #[test]
    fn aura_defaults_to_aura_managed() {
        let config = build_runtime_config(aura_harness_inputs()).expect("runtime config");

        assert_eq!(config.auth_source, "aura_managed");
        assert_eq!(config.integration_id, None);
    }

    #[test]
    fn unset_model_defaults_to_latest_frontier() {
        let config = build_runtime_config(aura_harness_inputs()).expect("runtime config");
        assert_eq!(
            config.default_model.as_deref(),
            Some(aura_os_core::LATEST_FRONTIER_MODEL),
            "a new agent without an explicit model must default to the frontier model"
        );
    }

    #[test]
    fn blank_model_defaults_to_latest_frontier() {
        let config = build_runtime_config(RuntimeConfigInputs {
            default_model: Some("   ".to_string()),
            ..aura_harness_inputs()
        })
        .expect("runtime config");
        assert_eq!(
            config.default_model.as_deref(),
            Some(aura_os_core::LATEST_FRONTIER_MODEL)
        );
    }

    #[test]
    fn explicit_model_is_preserved() {
        let config = build_runtime_config(RuntimeConfigInputs {
            default_model: Some("aura-gpt-5-5".to_string()),
            ..aura_harness_inputs()
        })
        .expect("runtime config");
        assert_eq!(config.default_model.as_deref(), Some("aura-gpt-5-5"));
    }

    #[test]
    fn aura_harness_rejects_org_integration_auth() {
        let error = build_runtime_config(RuntimeConfigInputs {
            auth_source: Some("org_integration".to_string()),
            integration_id: Some("int-anthropic".to_string()),
            default_model: Some("claude-opus-4-6".to_string()),
            ..aura_harness_inputs()
        })
        .expect_err("aura_harness org integration should be rejected");

        assert!(format!("{error:?}").contains("does not support auth source `org_integration`"));
    }

    #[test]
    fn external_adapters_are_rejected() {
        let error = build_runtime_config(RuntimeConfigInputs {
            adapter_type: Some("claude_code".to_string()),
            ..aura_harness_inputs()
        })
        .expect_err("external adapters should be rejected");

        assert!(format!("{error:?}").contains("only `aura_harness` is supported"));
    }

    #[test]
    fn org_integration_is_rejected() {
        let error = build_runtime_config(RuntimeConfigInputs {
            auth_source: Some("org_integration".to_string()),
            ..aura_harness_inputs()
        })
        .expect_err("org integration auth should fail");

        assert!(format!("{error:?}").contains("does not support auth source `org_integration`"));
    }

    #[test]
    fn agent_name_rule_accepts_ascii_slug_names() {
        assert!(agent_name_has_supported_format("Aura_Local"));
        assert!(agent_name_has_supported_format("aura-swarm-01"));
    }

    #[test]
    fn agent_name_rule_rejects_spaces_and_symbols() {
        assert!(!agent_name_has_supported_format("Aura Local"));
        assert!(!agent_name_has_supported_format("Aura!"));
        assert!(!agent_name_has_supported_format(""));
    }

    #[test]
    fn remote_only_create_rejects_local_runtime() {
        let config = build_runtime_config(aura_harness_inputs()).expect("runtime config");

        let error = ensure_remote_runtime_create_allowed(true, &config)
            .expect_err("remote-only create should reject local runtime");

        assert!(format!("{error:?}").contains("local agents are not supported"));
    }

    #[test]
    fn remote_only_update_allows_metadata_only_existing_local_agent() {
        ensure_remote_runtime_update_allowed(true, None, None, "local", "local_host")
            .expect("metadata-only update should stay allowed");
    }

    #[test]
    fn remote_only_update_rejects_explicit_local_runtime() {
        let error = ensure_remote_runtime_update_allowed(
            true,
            Some("local"),
            None,
            "remote",
            "swarm_microvm",
        )
        .expect_err("explicit local conversion should be rejected");

        assert!(format!("{error:?}").contains("local agents are not supported"));
    }
}
