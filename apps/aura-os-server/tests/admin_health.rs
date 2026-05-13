//! Integration test for `GET /api/admin/health` (Phase 5 of the
//! agent-stream reliability plan). Builds a real `AppState` via the
//! shared `build_test_app` harness, hits the route through the
//! `protected_api_router` middleware (which is what supplies the
//! `Authorization: Bearer <jwt>` enforcement), and asserts the
//! end-to-end JSON shape every operator-facing dashboard now relies
//! on.
//!
//! The body shape is pinned here on purpose: the Debug UI graphs
//! every counter directly out of this JSON, and the
//! `aura-os-harness` static counters are joined into the same
//! response so a single GET returns server-owned + harness-owned
//! observability in one envelope.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;

use common::{build_test_app, response_json, TEST_JWT};

/// Smoke + shape test: drives a verified-session GET, asserts a
/// 200, and walks every documented field the
/// `AdminHealthResponse` struct declares. We intentionally do NOT
/// exercise the actual counters (the unit tests in
/// `stability_metrics::tests` cover those) — this test pins the
/// route is reachable, the auth middleware gates correctly, and
/// the JSON keys haven't drifted out from under the dashboard.
#[tokio::test]
async fn admin_health_returns_full_snapshot_shape() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/admin/health")
                .header("authorization", format!("Bearer {}", TEST_JWT))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("admin health request must complete");

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "/api/admin/health must respond 200 to an authenticated request"
    );

    let body: Value = response_json(response).await;

    // Top-level fields. `uptime_seconds` is u64; we don't check the
    // exact value (it depends on test scheduling) but we do check
    // it's a non-negative integer.
    assert!(
        body.get("uptime_seconds")
            .and_then(Value::as_u64)
            .is_some(),
        "uptime_seconds must be a non-negative integer, got: {body:?}"
    );
    assert!(
        body.get("version").and_then(Value::as_str).is_some(),
        "version must be a string carrying CARGO_PKG_VERSION, got: {body:?}"
    );

    // Live aggregate counts. Brand-new test app must have no live
    // chat sessions or automatons; pinning zero here would catch a
    // regression where the test fixture leaked state across
    // process boundaries.
    assert_eq!(
        body.get("active_chat_sessions").and_then(Value::as_u64),
        Some(0),
        "fresh test app must report 0 chat sessions"
    );
    assert_eq!(
        body.get("active_automatons").and_then(Value::as_u64),
        Some(0),
        "fresh test app must report 0 automatons"
    );
    assert_eq!(
        body.get("harness_ws_slots_cap").and_then(Value::as_u64),
        Some(128),
        "test app fixture pins the slot cap at 128"
    );

    // Metrics snapshot — every server-owned counter starts at zero,
    // and the four harness-owned counters live in the same JSON.
    // We assert the *keys* exist; the harness counters are static
    // globals that may have been bumped by a parallel test, so we
    // only check `is_u64` on those.
    let metrics = body.get("metrics").expect("metrics block must be present");
    for key in [
        "chat_turns_started",
        "chat_turns_completed_ok",
        "stream_stalled",
        "turn_timeout",
        "stream_lagged",
        "agent_busy_queue_full",
        "auto_fork_triggered",
        "auto_fork_applied",
        "client_auto_retry_streamdropped",
    ] {
        assert_eq!(
            metrics.get(key).and_then(Value::as_u64),
            Some(0),
            "server-owned counter `{key}` must start at 0 in a fresh test app"
        );
    }
    for key in [
        "harness_ws_closed",
        "harness_ws_read_error",
        "harness_protocol_mismatch",
        "harness_initial_connect_retries",
    ] {
        assert!(
            metrics.get(key).and_then(Value::as_u64).is_some(),
            "harness-owned counter `{key}` must serialize as a u64 (current value may be \
             non-zero if other tests ran first; we only pin the key + type here)"
        );
    }
    assert!(
        metrics.get("snapshot_at").and_then(Value::as_str).is_some(),
        "metrics.snapshot_at must be an ISO-8601 timestamp string"
    );

    // Resolved env config. Every field comes from `AppState` so the
    // values match the test fixture defaults (`turn_first_event=120`,
    // `turn_max_idle=1800`, `auto_fork=0.80`, `broadcast=16384`,
    // and the partition queue defaults to the 4-slot
    // `DEFAULT_MAX_PENDING_TURNS`).
    let config = body.get("config").expect("config block must be present");
    assert_eq!(
        config
            .get("turn_first_event_timeout_secs")
            .and_then(Value::as_u64),
        Some(120),
    );
    assert_eq!(
        config
            .get("turn_max_idle_timeout_secs")
            .and_then(Value::as_u64),
        Some(1800),
    );
    let auto_fork = config
        .get("auto_fork_threshold")
        .and_then(Value::as_f64)
        .expect("auto_fork_threshold must be a float");
    assert!(
        (auto_fork - 0.80).abs() < 1e-9,
        "auto_fork_threshold must default to 0.80, got: {auto_fork}"
    );
    assert!(
        config
            .get("partition_turn_queue")
            .and_then(Value::as_u64)
            .is_some(),
        "partition_turn_queue must serialize as a u64"
    );
    assert_eq!(
        config
            .get("harness_broadcast_capacity")
            .and_then(Value::as_u64),
        Some(16384),
    );
}

/// Auth gating regression guard: an unauthenticated request must
/// NOT see the snapshot. The `protected_api_router` middleware
/// returns 401 long before the handler runs, so the JSON envelope
/// is irrelevant — we only assert the status code.
#[tokio::test]
async fn admin_health_requires_authenticated_session() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/admin/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("anonymous admin health request must complete");

    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "missing Authorization header must reject with 401 from the auth middleware"
    );
}
