use super::{
    normalize_automaton_event, validate_automaton_start_identity, AutomatonStartParams, RunHandle,
    WsReaderHandle,
};
use crate::error::HarnessError;
use aura_protocol::{AgentPermissionsWire, AgentScopeWire, CapabilityWire};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Spawns a task that never completes on its own, returns a
/// [`WsReaderHandle`] wired to its `AbortHandle`, and an
/// [`Arc<AtomicBool>`] that flips to `true` if the task runs its
/// `Drop` guard (i.e. was aborted). Lets the tests assert
/// aborted-vs-still-running without racing a time-based sleep.
async fn spawn_cancel_probe() -> (WsReaderHandle, Arc<AtomicBool>) {
    struct AbortFlag(Arc<AtomicBool>);
    impl Drop for AbortFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    let flag = Arc::new(AtomicBool::new(false));
    let task_flag = flag.clone();
    let task = tokio::spawn(async move {
        let _guard = AbortFlag(task_flag);
        // Hold until aborted.
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
    // Yield so the task is actually scheduled before we return.
    tokio::task::yield_now().await;
    (WsReaderHandle::new(task.abort_handle()), flag)
}

#[tokio::test]
async fn ws_reader_handle_cancel_aborts_spawned_task() {
    let (handle, flag) = spawn_cancel_probe().await;
    assert!(!flag.load(Ordering::SeqCst));
    handle.cancel();
    // Give tokio a chance to run the abort.
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "cancel() should have aborted the spawned reader task"
    );
}

#[tokio::test]
async fn ws_reader_handle_drop_aborts_spawned_task() {
    let (handle, flag) = spawn_cancel_probe().await;
    assert!(!flag.load(Ordering::SeqCst));
    drop(handle);
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "dropping the last WsReaderHandle should abort the spawned reader task"
    );
}

#[tokio::test]
async fn ws_reader_handle_clone_keeps_task_alive_until_last_drop() {
    let (handle, flag) = spawn_cancel_probe().await;
    let clone = handle.clone();
    drop(handle);
    // The clone still holds the Arc -- the inner `AbortHandle`
    // must not have been dropped yet, so the task keeps running.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert!(
        !flag.load(Ordering::SeqCst),
        "cloned WsReaderHandle must keep the reader alive when other clones drop"
    );
    drop(clone);
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "dropping the last clone should abort the spawned reader task"
    );
}

#[test]
fn run_handle_accepts_ws_url_alias() {
    let result: RunHandle = serde_json::from_value(serde_json::json!({
        "run_id": "auto-123",
        "ws_url": "/stream/auto-123",
    }))
    .expect("run handle should deserialize");

    assert_eq!(result.run_id, "auto-123");
    assert_eq!(result.event_stream_url, "/stream/auto-123");
}

#[test]
fn run_handle_accepts_legacy_automaton_id_alias() {
    let result: RunHandle = serde_json::from_value(serde_json::json!({
        "automaton_id": "auto-456",
        "event_stream_url": "/stream/auto-456",
    }))
    .expect("legacy automaton_id alias should still deserialize");

    assert_eq!(result.run_id, "auto-456");
    assert_eq!(result.event_stream_url, "/stream/auto-456");
}

#[test]
fn automaton_start_params_serializes_agent_permissions() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire {
            scope: AgentScopeWire::default(),
            capabilities: vec![CapabilityWire::InvokeProcess],
        },
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: None,
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(
        value["agent_permissions"]["capabilities"][0]["type"],
        "invokeProcess"
    );
}

#[test]
fn automaton_start_params_skips_pr_b_identity_fields_when_empty() {
    // PR B contract: aura-os does not populate `agent_identity` /
    // `agent_skills` / `agent_system_prompt` yet, so they must serialise
    // as ABSENT (not as `null` or `[]`) so older harnesses see the same
    // wire shape they did pre-PR-B.
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: None,
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
    };

    let value = serde_json::to_value(&params).expect("serialize params");
    let object = value.as_object().expect("top-level object");
    assert!(
        !object.contains_key("agent_identity"),
        "agent_identity must be skipped when None: {value}",
    );
    assert!(
        !object.contains_key("agent_skills"),
        "agent_skills must be skipped when empty: {value}",
    );
    assert!(
        !object.contains_key("agent_system_prompt"),
        "agent_system_prompt must be skipped when None: {value}",
    );
}

#[test]
fn automaton_start_params_serializes_pr_b_identity_fields_when_populated() {
    // Forward-compat for PR C: confirm the wire shape matches what the
    // harness's `AutomatonStartRequest` expects once `aura-os` flips
    // the populator on.
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: None,
        agent_identity: Some(aura_protocol::AgentPersona {
            name: "Aura".into(),
            role: "engineer".into(),
            personality: "concise".into(),
        }),
        agent_skills: vec!["rust".into(), "frontend".into()],
        agent_system_prompt: Some("Be terse.".into()),
    };

    let value = serde_json::to_value(&params).expect("serialize params");

    assert_eq!(value["agent_identity"]["name"], "Aura");
    assert_eq!(value["agent_identity"]["role"], "engineer");
    assert_eq!(value["agent_identity"]["personality"], "concise");
    assert_eq!(value["agent_skills"][0], "rust");
    assert_eq!(value["agent_skills"][1], "frontend");
    assert_eq!(value["agent_system_prompt"], "Be terse.");
}

#[test]
fn automaton_start_params_serializes_proxy_identity_context() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: Some("template-1::instance-1".into()),
        aura_agent_id: Some("template-1".into()),
        template_agent_id: Some("template-1".into()),
        auth_token: Some("jwt".into()),
        model: Some("aura-claude-opus-4-7".into()),
        provider_overrides: Some(aura_protocol::SessionModelOverrides {
            default_model: Some("aura-claude-opus-4-7".into()),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
            prompt_cache_key: None,
            prompt_cache_retention: None,
        }),
        user_id: Some("user-1".into()),
        intent_classifier: None,
        max_turns: Some(40),
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: Some("org-1".into()),
        aura_session_id: Some("session-1".into()),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(value["project_id"], "project-1");
    assert_eq!(value["agent_id"], "template-1::instance-1");
    assert_eq!(value["aura_agent_id"], "template-1");
    assert_eq!(value["template_agent_id"], "template-1");
    assert_eq!(value["aura_org_id"], "org-1");
    assert_eq!(value["aura_session_id"], "session-1");
    assert_eq!(value["auth_token"], "jwt");
    assert_eq!(value["model"], "aura-claude-opus-4-7");
    assert_eq!(
        value["provider_overrides"]["default_model"],
        "aura-claude-opus-4-7"
    );
    assert_eq!(value["provider_overrides"]["prompt_caching_enabled"], true);
    assert_eq!(value["user_id"], "user-1");
    assert_eq!(value["max_turns"], 40);
}

fn full_valid_params() -> AutomatonStartParams {
    AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: Some("template-1::instance-1".into()),
        aura_agent_id: Some("template-1".into()),
        template_agent_id: Some("template-1".into()),
        auth_token: Some("jwt".into()),
        model: None,
        provider_overrides: None,
        user_id: Some("user-1".into()),
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: Some("org-1".into()),
        aura_session_id: Some("session-1".into()),
        agent_identity: None,
        agent_skills: Vec::new(),
        agent_system_prompt: None,
    }
}

#[test]
fn validate_automaton_start_identity_accepts_full_params() {
    assert!(validate_automaton_start_identity(&full_valid_params()).is_ok());
}

#[test]
fn validate_automaton_start_identity_rejects_missing_org_id() {
    let mut params = full_valid_params();
    params.aura_org_id = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "automaton_start",
        }
    ));
}

#[test]
fn validate_automaton_start_identity_rejects_blank_session_id() {
    let mut params = full_valid_params();
    params.aura_session_id = Some("   ".into());
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            ..
        }
    ));
}

#[test]
fn validate_automaton_start_identity_accepts_when_only_partition_agent_id_present() {
    // The harness only needs *some* agent identity for X-Aura-Agent-Id;
    // the partition `agent_id` alone is enough.
    let mut params = full_valid_params();
    params.template_agent_id = None;
    params.aura_agent_id = None;
    assert!(validate_automaton_start_identity(&params).is_ok());
}

#[test]
fn validate_automaton_start_identity_rejects_when_no_agent_identity_at_all() {
    let mut params = full_valid_params();
    params.template_agent_id = None;
    params.aura_agent_id = None;
    params.agent_id = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "agent_id",
            ..
        }
    ));
}

#[test]
fn validate_automaton_start_identity_rejects_missing_auth_token() {
    let mut params = full_valid_params();
    params.auth_token = None;
    let err = validate_automaton_start_identity(&params).unwrap_err();
    assert!(matches!(
        err,
        HarnessError::SessionIdentityMissing {
            field: "auth_token",
            ..
        }
    ));
}

#[test]
fn validate_automaton_start_identity_does_not_require_user_id() {
    // Scheduled-process / runner flows may genuinely have no
    // signed-in user; the harness must still accept those.
    let mut params = full_valid_params();
    params.user_id = None;
    assert!(validate_automaton_start_identity(&params).is_ok());
}

#[test]
fn normalize_automaton_event_promotes_git_sync_milestones() {
    let event = normalize_automaton_event(serde_json::json!({
        "type": "sync_milestone",
        "summary": "Committed and pushed",
        "milestone": {
            "kind": "git_pushed",
            "commit_sha": "abc12345",
            "branch": "main",
            "remote": "origin",
            "push_id": "push-1",
            "commits": ["abc12345"],
        }
    }));

    assert_eq!(event["type"], "git_pushed");
    assert_eq!(event["commit_sha"], "abc12345");
    assert_eq!(event["branch"], "main");
    assert_eq!(event["remote"], "origin");
    assert_eq!(event["push_id"], "push-1");
    assert_eq!(event["summary"], "Committed and pushed");
}
