//! Bug-report creation mirrors the report into the Feedback app and returns
//! immediately. The Opus triage summary now runs off the request path (in a
//! spawned task), so the response no longer blocks on an LLM round-trip.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{build_test_app_with_feedback_network, response_status};

#[tokio::test]
async fn create_bug_report_mirrors_into_feedback_and_returns_post_id() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "POST",
        "/api/bug-reports",
        Some(json!({
            "description": "Send button hangs forever",
            "category": "bug",
            "severity": "high",
            "diagnostics": { "foo": "bar" },
            "consent": true,
            "consentVersion": "1",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);

    let body = response_json(resp).await;
    assert!(body["id"].as_str().is_some(), "report id present");
    let post_id = body["feedbackPostId"]
        .as_str()
        .expect("feedbackPostId present");
    assert!(!post_id.is_empty());

    // The mirrored report surfaces in the Feedback list as a bug post titled
    // from the description.
    let list = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let arr = items.as_array().expect("feedback list array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["category"], "bug");
    assert_eq!(arr[0]["title"], "Send button hangs forever");
}

#[tokio::test]
async fn create_bug_report_requires_consent() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/bug-reports",
        Some(json!({
            "description": "no consent given",
            "diagnostics": {},
            "consent": false,
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_bug_report_rejects_empty_description() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/bug-reports",
        Some(json!({
            "description": "   ",
            "diagnostics": {},
            "consent": true,
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}
