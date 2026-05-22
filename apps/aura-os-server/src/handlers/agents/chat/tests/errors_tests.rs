//! Tests for the harness/session error → API error mapper.

use axum::http::StatusCode;

use super::super::errors::map_harness_session_startup_error;

#[test]
fn maps_swarm_configuration_errors_to_service_unavailable() {
    let (status, body) =
        map_harness_session_startup_error("swarm gateway is not configured (SWARM_BASE_URL)");

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
}

#[test]
fn maps_swarm_readiness_errors_to_service_unavailable() {
    let (status, body) = map_harness_session_startup_error(
        "swarm agent readiness check failed: agent abc did not become ready within 90s",
    );

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
    assert!(body.0.error.contains("still provisioning"));
}

#[test]
fn maps_swarm_session_start_errors_to_bad_gateway() {
    let (status, body) = map_harness_session_startup_error(
        "swarm create session failed with 502 Bad Gateway: upstream unavailable",
    );

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body.0.code, "bad_gateway");
}

#[test]
fn maps_local_harness_connect_errors_to_service_unavailable() {
    let (status, body) =
        map_harness_session_startup_error("local harness websocket connect failed");

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body.0.code, "service_unavailable");
    // The body must keep the upstream wording so external log
    // scrapers / dashboards keyed on the original substring still
    // match. Asserting both ends of the format keeps the upstream
    // contract pinned alongside the new operator hint.
    assert!(
        body.0.error.contains("local harness is unavailable"),
        "must keep the upstream-friendly prefix, got: {}",
        body.0.error
    );
    assert!(
        body.0.error.contains("LOCAL_HARNESS_URL"),
        "must point on-call at the env var that fixes this 503 on Render, got: {}",
        body.0.error
    );
    assert!(
        body.0.error.contains("aura-node"),
        "must name the deployed service the env var should target, got: {}",
        body.0.error
    );
}
