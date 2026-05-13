use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_harness::{local_harness_base_url, HarnessLink, LocalHarness, SwarmHarness};
use aura_os_integrations::IntegrationsClient;

use crate::agent_events::AgentEventListener;
use crate::harness_gateway::HarnessHttpGateway;
use crate::loop_log::LoopLogWriter;
use crate::stability_metrics::StabilityMetrics;
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::{SettingsStore, StoreError};
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::state::AppState;

mod browser;
mod executor_janitor;
mod harness_autospawn;
mod health;
mod http;
mod services;

use browser::build_browser_manager;
use executor_janitor::spawn_executor_janitor;
pub(crate) use harness_autospawn::ensure_local_harness_running;
use health::spawn_health_checks;
use http::{build_local_http_client, resolve_local_server_base_url};
use services::{init_core_services, init_domain_services};

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}

/// Default upstream WS-slot cap, mirroring the doc-comment on
/// `crates/aura-os-harness/src/automaton_client.rs` lines 33-34.
/// `aura-node` caps concurrent WS sessions per harness process at
/// 128 by default; Phase 6 of the robust-concurrent-agent-infra plan
/// makes this configurable end-to-end via `AURA_HARNESS_WS_SLOTS`.
pub(crate) const DEFAULT_HARNESS_WS_SLOTS: usize = 128;

/// Env var the server reads (and the autospawned harness child
/// inherits) to size the upstream WS-slot semaphore. Held in one
/// place so the autospawn forwarder, the AppState wiring, and the
/// `ApiError::harness_capacity_exhausted` operator message stay in
/// agreement.
pub(crate) const HARNESS_WS_SLOTS_ENV: &str = "AURA_HARNESS_WS_SLOTS";

/// Parse `AURA_HARNESS_WS_SLOTS` from the environment, falling back
/// to [`DEFAULT_HARNESS_WS_SLOTS`] (and warning at `info` level)
/// when the value is missing, empty, or non-numeric. Zero is treated
/// as a parse failure because it would mean "every session-open
/// rejects" — that has no operationally useful meaning and almost
/// certainly indicates a misconfiguration.
///
/// FOLLOW-UP: the upstream `aura-node` harness binary is expected
/// to read this same env var. If the harness build in use does not
/// yet honour `AURA_HARNESS_WS_SLOTS`, the server's view stays in
/// sync with the configured value but the actual upstream cap
/// remains the harness default; the operator-visible error message
/// will still reflect the server's `harness_ws_slots`.
pub(crate) fn parse_harness_ws_slots(raw: Option<&str>) -> usize {
    let Some(raw) = raw else {
        return DEFAULT_HARNESS_WS_SLOTS;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_HARNESS_WS_SLOTS;
    }
    match trimmed.parse::<usize>() {
        Ok(0) => {
            warn!(
                value = trimmed,
                default = DEFAULT_HARNESS_WS_SLOTS,
                "AURA_HARNESS_WS_SLOTS=0 has no operational meaning; falling back to default"
            );
            DEFAULT_HARNESS_WS_SLOTS
        }
        Ok(n) => n,
        Err(error) => {
            warn!(
                value = trimmed,
                %error,
                default = DEFAULT_HARNESS_WS_SLOTS,
                "AURA_HARNESS_WS_SLOTS is not a valid usize; falling back to default"
            );
            DEFAULT_HARNESS_WS_SLOTS
        }
    }
}

pub(crate) fn read_harness_ws_slots_from_env() -> usize {
    parse_harness_ws_slots(env_opt(HARNESS_WS_SLOTS_ENV).as_deref())
}

/// Env var that overrides the chat-turn watchdog first-event
/// window (`stream_stalled` synth fires only if the harness emits
/// zero events inside this window).
pub(crate) const TURN_FIRST_EVENT_TIMEOUT_ENV: &str = "AURA_TURN_FIRST_EVENT_TIMEOUT_SECS";

/// Env var that overrides the chat-turn sliding idle ceiling
/// (`turn_timeout` synth fires only if the broadcast goes idle for
/// this long with no terminal event).
pub(crate) const TURN_MAX_TIMEOUT_ENV: &str = "AURA_TURN_MAX_TIMEOUT_SECS";

/// Mirrors `parse_harness_ws_slots`: parse a positive whole number of
/// seconds, falling back to `default_secs` on missing / blank /
/// non-numeric / zero. Zero is treated as a parse failure because a
/// zero-second watchdog would synthesize timeouts immediately on
/// every turn, which has no operationally useful meaning.
pub(crate) fn parse_turn_timeout_secs(raw: Option<&str>, default_secs: u64, env_var: &str) -> u64 {
    let Some(raw) = raw else {
        return default_secs;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return default_secs;
    }
    match trimmed.parse::<u64>() {
        Ok(0) => {
            warn!(
                env_var,
                value = trimmed,
                default = default_secs,
                "turn timeout env var set to 0 has no operational meaning; falling back to default"
            );
            default_secs
        }
        Ok(n) => n,
        Err(error) => {
            warn!(
                env_var,
                value = trimmed,
                %error,
                default = default_secs,
                "turn timeout env var is not a valid u64 second count; falling back to default"
            );
            default_secs
        }
    }
}

pub(crate) fn read_turn_first_event_timeout_from_env() -> Duration {
    Duration::from_secs(parse_turn_timeout_secs(
        env_opt(TURN_FIRST_EVENT_TIMEOUT_ENV).as_deref(),
        crate::handlers::agents::chat::turn_slot::DEFAULT_FIRST_EVENT_TIMEOUT_SECS,
        TURN_FIRST_EVENT_TIMEOUT_ENV,
    ))
}

pub(crate) fn read_turn_max_idle_timeout_from_env() -> Duration {
    Duration::from_secs(parse_turn_timeout_secs(
        env_opt(TURN_MAX_TIMEOUT_ENV).as_deref(),
        crate::handlers::agents::chat::turn_slot::DEFAULT_MAX_IDLE_TIMEOUT_SECS,
        TURN_MAX_TIMEOUT_ENV,
    ))
}

/// Env var that overrides the chat auto-fork threshold (mirrors
/// `SessionService::should_rollover` for the chat path). When the
/// most recent assistant turn's `context_utilization` crosses this
/// value, the persist task flags the storage session `rolled_over`
/// and the next user send transparently lands in a fresh session.
pub(crate) const CHAT_AUTO_FORK_THRESHOLD_ENV: &str = "AURA_CHAT_AUTO_FORK_THRESHOLD";

/// Default chat auto-fork threshold matching Phase 3 of the
/// agent-stream reliability plan. Picked to fire well before the
/// upstream emergency body cap, so the next turn is always served
/// from a fresh, summary-seeded session instead of hitting a 403
/// Cloudflare WAF response.
pub(crate) const DEFAULT_CHAT_AUTO_FORK_THRESHOLD: f64 = 0.80;

/// Parse `AURA_CHAT_AUTO_FORK_THRESHOLD` into the half-open interval
/// `(0.0, 1.0]`. Values outside that range, blank inputs, or
/// non-numeric strings fall back to [`DEFAULT_CHAT_AUTO_FORK_THRESHOLD`]
/// with a `warn!` so the operator-visible signal matches the
/// `parse_turn_timeout_secs` / `parse_harness_ws_slots` style. A
/// threshold of `0.0` would auto-fork every session on its first
/// turn (no operational meaning); a threshold above `1.0` would
/// never trip (defeats the point of the env var).
pub(crate) fn parse_chat_auto_fork_threshold(raw: Option<&str>) -> f64 {
    let Some(raw) = raw else {
        return DEFAULT_CHAT_AUTO_FORK_THRESHOLD;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_CHAT_AUTO_FORK_THRESHOLD;
    }
    match trimmed.parse::<f64>() {
        Ok(value) if value > 0.0 && value <= 1.0 && value.is_finite() => value,
        Ok(value) => {
            warn!(
                env_var = CHAT_AUTO_FORK_THRESHOLD_ENV,
                value,
                default = DEFAULT_CHAT_AUTO_FORK_THRESHOLD,
                "AURA_CHAT_AUTO_FORK_THRESHOLD must be in (0.0, 1.0]; falling back to default"
            );
            DEFAULT_CHAT_AUTO_FORK_THRESHOLD
        }
        Err(error) => {
            warn!(
                env_var = CHAT_AUTO_FORK_THRESHOLD_ENV,
                value = trimmed,
                %error,
                default = DEFAULT_CHAT_AUTO_FORK_THRESHOLD,
                "AURA_CHAT_AUTO_FORK_THRESHOLD is not a valid f64; falling back to default"
            );
            DEFAULT_CHAT_AUTO_FORK_THRESHOLD
        }
    }
}

pub(crate) fn read_chat_auto_fork_threshold_from_env() -> f64 {
    parse_chat_auto_fork_threshold(env_opt(CHAT_AUTO_FORK_THRESHOLD_ENV).as_deref())
}

pub fn build_app_state(store_path: &Path) -> Result<AppState, StoreError> {
    let data_dir = store_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let browser_settings_root = data_dir.join("browser");
    let store = Arc::new(SettingsStore::open(store_path)?);
    let network_client = NetworkClient::from_env().map(Arc::new);
    let feedback_network_client = NetworkClient::from_env_key("AURA_NETWORK_FEEDBACK_URL")
        .map(Arc::new)
        .or_else(|| network_client.clone());
    match (&feedback_network_client, &network_client) {
        (Some(fb), Some(main)) if Arc::ptr_eq(fb, main) => {
            info!("feedback routes share the main aura-network client (AURA_NETWORK_FEEDBACK_URL not set)");
        }
        (Some(fb), _) => {
            info!(base_url = %fb.base_url(), "feedback routes using dedicated aura-network client");
        }
        _ => {}
    }
    let storage_client = StorageClient::from_env().map(Arc::new);
    let integrations_client = IntegrationsClient::from_env().map(Arc::new);
    let orbit_client = OrbitClient::from_env().map(Arc::new);
    if orbit_client.is_none() {
        info!("Orbit integration disabled (ORBIT_BASE_URL not set)");
    }
    let orbit_capacity_guard = Arc::new(crate::orbit_guard::OrbitCapacityGuard::from_env());
    info!(
        cooldown_secs = orbit_capacity_guard.cooldown().as_secs(),
        "Orbit capacity guard armed (trips on remote_storage_exhausted; tunable via AURA_ORBIT_ENOSPC_COOLDOWN_SECS)"
    );

    let harness_ws_slots = read_harness_ws_slots_from_env();
    info!(
        harness_ws_slots,
        env_var = HARNESS_WS_SLOTS_ENV,
        "Configured upstream harness WS-slot cap (used for harness_capacity_exhausted operator message and forwarded to autospawned child)"
    );

    let turn_first_event_timeout = read_turn_first_event_timeout_from_env();
    let turn_max_idle_timeout = read_turn_max_idle_timeout_from_env();
    info!(
        first_event_secs = turn_first_event_timeout.as_secs(),
        max_idle_secs = turn_max_idle_timeout.as_secs(),
        first_event_env = TURN_FIRST_EVENT_TIMEOUT_ENV,
        max_idle_env = TURN_MAX_TIMEOUT_ENV,
        "Configured chat-turn watchdog timings (first-event window for stream_stalled; sliding idle ceiling for turn_timeout)"
    );

    let chat_auto_fork_threshold = read_chat_auto_fork_threshold_from_env();
    info!(
        chat_auto_fork_threshold,
        env_var = CHAT_AUTO_FORK_THRESHOLD_ENV,
        "Configured chat auto-fork threshold (next user send rolls into a fresh storage session above this context_utilization)"
    );

    // Phase 5 observability bag. Captured BEFORE the long startup chain
    // below so `started_at` reflects "moment of process bootstrap"
    // rather than "moment we finished probing storage / network / orgs",
    // which can take several seconds on a slow box.
    let stability_metrics = Arc::new(StabilityMetrics::new());
    let started_at = std::time::Instant::now();
    let harness_broadcast_capacity =
        aura_os_harness::ws_bridge_config::read_broadcast_capacity_from_env();
    info!(
        harness_broadcast_capacity,
        env_var = aura_os_harness::ws_bridge_config::BROADCAST_CAPACITY_ENV,
        "Captured harness broadcast capacity for /api/admin/health snapshot"
    );

    ensure_local_harness_running();

    let core = init_core_services(&store);
    let domain = init_domain_services(&store, &network_client, &storage_client);

    let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(4096);
    let event_hub = aura_os_events::EventHub::new();
    let loop_registry = aura_os_loops::LoopRegistry::new(event_hub.clone());
    // Forward typed loop lifecycle + activity events from the hub into
    // the legacy websocket broadcast as JSON, so the existing frontend
    // can consume `loop_opened` / `loop_activity_changed` / `loop_ended`
    // frames without a protocol change.
    crate::loop_events_bridge::spawn_loop_events_bridge(event_hub.clone(), event_broadcast.clone());

    let validation_cache = {
        let cache = Arc::new(dashmap::DashMap::new());
        crate::state::spawn_cache_eviction(cache.clone());
        cache
    };

    let harness_base = local_harness_base_url();
    let automaton_client = Arc::new(aura_os_harness::AutomatonClient::new(&harness_base));
    let harness_http = Arc::new(HarnessHttpGateway::new(harness_base));

    // Dev-loop debug bundles are always captured so the Debug app and
    // `aura-run-analyze` CLI can inspect any past run without an
    // opt-in toggle. Override the base dir with `AURA_LOOP_LOGS_DIR`
    // for tooling that wants to point elsewhere.
    let loop_log_base = env_opt("AURA_LOOP_LOGS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("loop_logs"));
    if let Err(error) = std::fs::create_dir_all(&loop_log_base) {
        warn!(path = %loop_log_base.display(), %error, "failed to create loop_logs dir (will be created lazily)");
    }
    let loop_log = Arc::new(LoopLogWriter::new(loop_log_base));
    // Flip any bundles still stuck at `status: Running` from a
    // previously-crashed server process to `Interrupted`. Must run
    // before `loop_log` is cloned into AppState so no live run can
    // race with the sweep.
    loop_log.reconcile_orphan_runs();

    let router_url = std::env::var("AURA_ROUTER_URL")
        .unwrap_or_else(|_| "https://aura-router.onrender.com".to_string());
    let local_server_base_url = resolve_local_server_base_url();
    let http_client = build_local_http_client();
    let _local_server_base_url = local_server_base_url;

    let agent_event_listener = Arc::new(AgentEventListener::new(100));
    agent_event_listener.spawn(event_broadcast.subscribe());

    spawn_health_checks(&storage_client, &network_client, &integrations_client);
    spawn_executor_janitor(
        domain.project_service.clone(),
        domain.agent_instance_service.clone(),
    );
    if let Some(ref client) = network_client {
        super::network_bridge::spawn_network_ws_bridge(
            client.clone(),
            validation_cache.clone(),
            event_broadcast.clone(),
        );
    }

    let billing_base_url = std::env::var("Z_BILLING_URL")
        .unwrap_or_else(|_| "https://z-billing.onrender.com".to_string());
    super::billing_bridge::spawn_billing_ws_bridge(
        billing_base_url,
        validation_cache.clone(),
        event_broadcast.clone(),
    );

    Ok(AppState {
        data_dir,
        store,
        org_service: core.org_service,
        auth_service: core.auth_service,
        billing_client: core.billing_client,
        project_service: domain.project_service,
        task_service: domain.task_service,
        agent_service: domain.agent_service,
        agent_instance_service: domain.agent_instance_service,
        session_service: domain.session_service,
        local_harness: domain.local_harness,
        swarm_harness: domain.swarm_harness,
        chat_sessions: Arc::new(dashmap::DashMap::new()),
        credit_cache: Arc::new(Mutex::new(HashMap::new())),
        terminal_manager: Arc::new(TerminalManager::new()),
        browser_manager: build_browser_manager(browser_settings_root.clone()),
        network_client,
        feedback_network_client,
        storage_client,
        integrations_client,
        event_broadcast,
        event_hub,
        loop_registry,
        require_zero_pro: std::env::var("REQUIRE_ZERO_PRO")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false),
        automaton_client,
        harness_http,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url: env_opt("SWARM_BASE_URL"),
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client,
        orbit_capacity_guard,
        validation_cache,
        agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
        router_url,
        http_client,
        agent_event_listener,
        loop_log,
        harness_ws_slots,
        turn_first_event_timeout,
        turn_max_idle_timeout,
        chat_auto_fork_threshold,
        stability_metrics,
        started_at,
        harness_broadcast_capacity,
    })
}

#[cfg(test)]
mod tests;
