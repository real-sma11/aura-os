//! Public marketing endpoint: `GET /api/public/feedback`.
//!
//! Verifies that the aura-os-server pass-through:
//!   - does not require auth (no Authorization header on the request),
//!   - forwards sort/category/status/limit to the upstream aura-network,
//!   - returns the upstream JSON array verbatim (same wire shape the SPA
//!     at `interface/src/api/marketing/feedback.ts` consumes),
//!   - degrades to `[]` (not 503) when no aura-network client is wired up.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tempfile::TempDir;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mock::{
    build_test_app_with_feedback_network, response_status, seed_feed_event, FEEDBACK_EVENT_TYPE,
};

fn anon_get(uri: &str) -> Request<Body> {
    // Intentionally omit the Authorization header — the marketing page is
    // hit by logged-out browsers.
    Request::builder()
        .method("GET")
        .uri(uri)
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn public_list_returns_empty_array_when_no_network_client() {
    let store_dir = TempDir::new().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        None,
        None,
        None,
    );

    let resp = app
        .clone()
        .oneshot(anon_get("/api/public/feedback"))
        .await
        .unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body, serde_json::json!([]));
}

#[tokio::test]
async fn public_list_forwards_upstream_items_unauthenticated() {
    let seed = vec![
        seed_feed_event(
            "00000000-0000-0000-0000-00000000bbbb",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T01:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000dddd",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T03:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000aaaa",
            "post",
            "2026-04-17T00:00:00Z",
        ),
    ];
    let (app, _db) = build_test_app_with_feedback_network(seed).await;

    let resp = app
        .clone()
        .oneshot(anon_get("/api/public/feedback"))
        .await
        .unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);

    let body = response_json(resp).await;
    let items = body.as_array().expect("public list is an array");
    assert_eq!(items.len(), 2, "non-feedback events filtered out upstream");
    for item in items {
        // Verify the wire shape the marketing SPA expects.
        assert!(item.get("id").and_then(|v| v.as_str()).is_some());
        assert!(item.get("title").is_some());
        assert!(item.get("body").is_some());
        assert!(item.get("category").is_some());
        assert!(item.get("status").is_some());
        assert!(item.get("voteScore").is_some());
        assert!(item.get("commentCount").is_some());
        assert!(item.get("createdAt").is_some());
        assert!(item.get("authorName").is_some());
        assert!(item.get("authorAvatar").is_some());
    }
    // Default sort=latest -> newest first.
    assert_eq!(items[0]["createdAt"], "2026-04-17T03:00:00Z");
}

#[tokio::test]
async fn public_list_forwards_category_filter_to_upstream() {
    // Two feedback events with different categories; ask for `bug` only.
    let mut bug = seed_feed_event(
        "00000000-0000-0000-0000-00000000bbbb",
        FEEDBACK_EVENT_TYPE,
        "2026-04-17T01:00:00Z",
    );
    bug["metadata"]["feedbackCategory"] = serde_json::Value::String("bug".into());
    let mut feature = seed_feed_event(
        "00000000-0000-0000-0000-00000000dddd",
        FEEDBACK_EVENT_TYPE,
        "2026-04-17T03:00:00Z",
    );
    feature["metadata"]["feedbackCategory"] = serde_json::Value::String("feature_request".into());

    let (app, _db) = build_test_app_with_feedback_network(vec![bug, feature]).await;

    let resp = app
        .clone()
        .oneshot(anon_get("/api/public/feedback?category=bug"))
        .await
        .unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let arr = items.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["category"], "bug");
}

#[tokio::test]
async fn public_list_drops_unknown_sort_instead_of_400() {
    // aura-web's `normalizeSort` falls back to `latest` on unknown values;
    // the public pass-through should match that, not 400.
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let resp = app
        .clone()
        .oneshot(anon_get("/api/public/feedback?sort=spaghetti"))
        .await
        .unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body.is_array());
}
