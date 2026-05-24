//! Integration tests for the `/api/public/*` anonymous endpoint
//! family (Phase 4 of the logged-out slim shell plan). Drives the
//! real router through `tower::ServiceExt::oneshot`, exercising:
//!
//! - `POST /api/public/setup` happy path (token + canonical
//!   `turn_count` / `limit` fields).
//! - `POST /api/public/chat/stream` cross-role rejection (a
//!   non-guest token must be rejected with 401, never accepted on a
//!   public endpoint).
//! - `POST /api/public/chat/stream` missing-bearer rejection.
//! - `POST /api/public/generation/image` missing-bearer rejection
//!   (gate-level smoke; the upstream proxy is not mocked — the user
//!   instructions say to skip the upstream-mock variant).
//! - End-to-end 4th-call 429: 3 sequential chat calls with the
//!   same guest token consume slots through
//!   [`enforce_public_turn`]; the 4th call short-circuits to a
//!   429 before any upstream work happens.
//!
//! The 4th-call 429 test sets the harness connect timeout to 1
//! second and the attempt count to 1 so the first three (slot-
//! consuming but harness-failing) calls fail-fast on TCP refused
//! rather than burning the default 8s × 3 attempts each.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;

use common::{build_test_app, response_json, TEST_JWT};

/// Build a minimal `POST /api/public/chat/stream` request with the
/// provided bearer token (or no `Authorization` header when `None`).
fn build_chat_request(token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/api/public/chat/stream")
        .header("content-type", "application/json");
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    builder
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "message": "hello",
                "mode": "code",
            }))
            .expect("chat body"),
        ))
        .expect("chat request")
}

/// Build a minimal `POST /api/public/generation/image` request.
fn build_image_request(token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/api/public/generation/image")
        .header("content-type", "application/json");
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    builder
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "prompt": "a hot air balloon over a beach",
            }))
            .expect("image body"),
        ))
        .expect("image request")
}

/// Setup happy path: returns a non-empty token, `turn_count == 0`,
/// and `limit == 3` for a freshly-minted guest id.
#[tokio::test]
async fn setup_returns_token_with_default_limits() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/public/setup")
                .header("content-type", "application/json")
                .body(Body::empty())
                .expect("setup request"),
        )
        .await
        .expect("setup must complete");

    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = response_json(response).await;
    assert!(
        body.get("token")
            .and_then(Value::as_str)
            .map(|s| !s.is_empty())
            .unwrap_or(false),
        "setup must return a non-empty `token`, got: {body:?}"
    );
    assert_eq!(
        body.get("turn_count").and_then(Value::as_u64),
        Some(0),
        "fresh guest id must report turn_count = 0"
    );
    assert_eq!(
        body.get("limit").and_then(Value::as_u64),
        Some(3),
        "limit field must surface the canonical 3-turn cap"
    );
}

/// Public chat must reject calls that omit the `Authorization`
/// header — the gate's first stop is the `AuthGuestJwt` extractor.
#[tokio::test]
async fn chat_requires_guest_token() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(build_chat_request(None))
        .await
        .expect("chat must complete");

    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "missing bearer must reject with 401"
    );
}

/// Cross-role rejection: a logged-in JWT (`TEST_JWT`) is NOT a
/// guest JWT — the extractor's `decode_guest_token` returns Err
/// because `TEST_JWT` is opaque text, not a signed guest token.
#[tokio::test]
async fn chat_rejects_authjwt_cross_role_token() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(build_chat_request(Some(TEST_JWT)))
        .await
        .expect("chat must complete");

    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "non-guest bearer must reject with 401 (cross-role guard)"
    );
}

/// Same gate, second modality: the image endpoint must reject a
/// missing bearer the exact same way the chat endpoint does. This
/// is the gate-level smoke test the user instructions allow in lieu
/// of mocking the upstream router proxy.
#[tokio::test]
async fn image_route_requires_guest_token() {
    let (app, _state, _store_dir) = build_test_app();

    let response = app
        .oneshot(build_image_request(None))
        .await
        .expect("image must complete");

    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "missing bearer must reject with 401 on /api/public/generation/image"
    );
}

/// End-to-end 4th-call rejection. The first three chat calls
/// consume their slot in [`enforce_public_turn`] *before* the
/// upstream harness call runs (slot-then-await ordering); the
/// upstream call then fails because no harness is bound in the
/// test fixture, but the slot stays consumed (the gate is
/// intentionally non-refundable). On the 4th call the gate trips
/// with `ApiError::public_limit_reached`, which serialises as
/// `429 { error: "limit_reached", limit: 3 }`.
///
/// `AURA_HARNESS_CONNECT_ATTEMPTS=1` and `_TIMEOUT_SECS=1` keep
/// the first-three slot-consuming calls under 1s each (TCP refused
/// is sub-millisecond; the timeout never trips). These vars are
/// only read from the harness path, so the parallel tests in this
/// binary are unaffected.
#[tokio::test]
async fn chat_returns_429_after_third_turn() {
    std::env::set_var("AURA_HARNESS_CONNECT_ATTEMPTS", "1");
    std::env::set_var("AURA_HARNESS_CONNECT_TIMEOUT_SECS", "1");

    let (app, _state, _store_dir) = build_test_app();

    let setup_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/public/setup")
                .header("content-type", "application/json")
                .body(Body::empty())
                .expect("setup request"),
        )
        .await
        .expect("setup must complete");
    assert_eq!(setup_response.status(), StatusCode::OK);
    let setup_body: Value = response_json(setup_response).await;
    let token = setup_body
        .get("token")
        .and_then(Value::as_str)
        .expect("setup token must be a string")
        .to_string();

    for turn_idx in 1..=3 {
        let response = app
            .clone()
            .oneshot(build_chat_request(Some(&token)))
            .await
            .expect("chat call must complete");
        assert_ne!(
            response.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "turn {turn_idx} should pass the gate (cap is at 3)"
        );
        assert_ne!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "turn {turn_idx} must not be rejected as unauthenticated when the bearer is valid"
        );
    }

    let response = app
        .oneshot(build_chat_request(Some(&token)))
        .await
        .expect("4th chat must complete");
    assert_eq!(
        response.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "4th turn must hit the per-guest cap and 429"
    );
    let body: Value = response_json(response).await;
    let nested_limit = body
        .get("data")
        .and_then(|d| d.get("limit"))
        .and_then(Value::as_u64)
        .or_else(|| body.get("limit").and_then(Value::as_u64));
    assert_eq!(
        nested_limit,
        Some(3),
        "429 body must surface the canonical 3-turn cap, got: {body:?}"
    );
    let code = body.get("code").and_then(Value::as_str).unwrap_or("");
    let error = body.get("error").and_then(Value::as_str).unwrap_or("");
    assert!(
        code == "public_limit_reached" || error == "limit_reached",
        "429 body must carry the typed limit-reached marker, got: {body:?}"
    );
}
