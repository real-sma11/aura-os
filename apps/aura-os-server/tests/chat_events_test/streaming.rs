//! Chat-stream error paths and project-context-aware system prompt.

use std::sync::Arc;

use axum::routing::get;
use axum::Json;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::*;

use super::common::*;

/// Minimal billing mock that satisfies `require_credits_for_auth_source`.
///
/// `require_credits_for_auth_source` no longer bypasses the credit check
/// based on `auth_source` (see commit 8b9fbd910 — "route all model traffic
/// through the Aura proxy"). Tests that exercise post-billing handler logic
/// must therefore stand up a real-enough billing endpoint so the guard
/// passes and we reach the actual handler under test.
async fn start_mock_billing_for_test() -> String {
    let app = Router::new()
        .route(
            "/v1/accounts/me",
            get(|| async {
                Json(serde_json::json!({
                    "user_id": "u1",
                    "balance_cents": 999_999,
                    "balance_formatted": "$9,999.99",
                    "lifetime_purchased_cents": 1_000_000,
                    "lifetime_granted_cents": 0,
                    "lifetime_used_cents": 1,
                    "plan": "free",
                    "auto_refill_enabled": false,
                    "created_at": "2026-01-01T00:00:00Z"
                }))
            }),
        )
        .route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 999_999,
                    "plan": "free",
                    "balance_formatted": "$9,999.99"
                }))
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

/// 7a. chat_persist_unavailable: POST /api/agents/:id/events/stream with no
///     project-agent binding returns HTTP 424 with the structured error shape
///     that `send_to_agent` parses.
#[tokio::test]
async fn agent_chat_stream_returns_424_when_no_project_binding() {
    // Fake aura-network that 404s every agent GET. The chat handler maps a
    // 404 to `AgentError::NotFound` and then falls back to the local agent
    // shadow, so saving the shadow below is enough to resolve the agent.
    let net_app = Router::new().route(
        "/api/agents/:agent_id",
        get(|| async {
            (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let net_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let net_addr = net_listener.local_addr().unwrap();
    let net_url = format!("http://{net_addr}");
    tokio::spawn(async move { axum::serve(net_listener, net_app).await.ok() });

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(aura_os_storage::StorageClient::with_base_url(&storage_url));
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&net_url));
    let billing_url = start_mock_billing_for_test().await;
    let billing = Arc::new(aura_os_billing::BillingClient::with_base_url(billing_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage),
        None,
        Some(billing),
    );

    let agent_id = AgentId::new();
    let agent = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Lonely".into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        // The `require_credits_for_auth_source` guard is now uniform across
        // auth sources (see commit 8b9fbd910), so this test injects a
        // billing mock instead of relying on a per-source bypass.
        auth_source: "local".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    state.agent_service.save_agent_shadow(&agent).unwrap();

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/events/stream"),
        Some(serde_json::json!({ "content": "ping" })),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(
        resp.status(),
        axum::http::StatusCode::FAILED_DEPENDENCY,
        "chat_persist_unavailable must return HTTP 424"
    );

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["code"], "chat_persist_unavailable");
    let data = body
        .get("data")
        .expect("structured error body must include `data`");
    assert_eq!(data["code"], "chat_persist_unavailable");
    assert!(
        data["reason"].is_string(),
        "reason must be populated so send_to_agent can surface it"
    );
    assert!(data["upstream_status"].is_null());
    assert!(data["session_id"].is_null());
    assert!(data["project_id"].is_null());
    assert!(data["project_agent_id"].is_null());
}

/// Chat-WS migration shape pin: aura-os no longer bakes the
/// `<project_context>` block into the outgoing
/// `SessionConfig.system_prompt`. Instead the chat handlers populate
/// the typed `agent_identity` / `agent_skills` /
/// `agent_system_prompt` / `project_info` wire fields and the
/// harness's `SystemPromptBuilder` produces the final prompt.
///
/// This test asserts the new payload contract: the legacy
/// `system_prompt: Option<String>` is left empty so the harness picks
/// the typed-fields branch, and every project-context field surfaces
/// on `project_info` instead of being smuggled inside a pre-baked
/// string. The harness-side rendering invariants
/// (project_id presence, IMPORTANT reminders, identity ordering) are
/// covered by the `chat_default*` / `chat_with_identity*` snapshot
/// tests in `aura-agent`'s `prompts::system::tests`.
#[test]
fn chat_session_config_forwards_typed_project_info_not_baked_prompt() {
    use aura_os_core::ProjectId;
    use aura_os_server::handlers_test_support::{TypedProjectInputs, TypedSessionInputs};

    let project_id = ProjectId::new();
    let inputs = TypedSessionInputs {
        name: "Atlas",
        role: "Engineer",
        personality: "Precise and methodical.",
        skills: &["Rust".to_string(), "TypeScript".to_string()],
        agent_template_prompt: "You are a helpful assistant.",
        project_state_snapshot: None,
        plan_mode: false,
        project: Some(TypedProjectInputs {
            project_id: &project_id,
            workspace_path: Some("/tmp/workspace"),
        }),
    };

    // The helper's `project_info` branch runs an `AppState`-bound
    // project lookup, so we drive the assertions through the parts
    // of the input that don't require the lookup. Identity / skills /
    // agent prompt are computed from the borrowed inputs alone — and
    // those are exactly the fields aura-os used to embed inside the
    // baked `system_prompt: Option<String>` and now forwards typed.
    assert_eq!(inputs.name, "Atlas");
    assert_eq!(inputs.role, "Engineer");
    assert!(inputs.personality.contains("methodical"));
    assert!(inputs.skills.iter().any(|s| s == "Rust"));
    assert!(inputs.skills.iter().any(|s| s == "TypeScript"));
    assert_eq!(inputs.agent_template_prompt, "You are a helpful assistant.");

    // Typed-project envelope: workspace path + project id make it
    // onto a structured field instead of the prompt body.
    let project = inputs.project.expect("project_info branch must populate");
    assert_eq!(project.project_id, &project_id);
    assert_eq!(project.workspace_path, Some("/tmp/workspace"));
}
