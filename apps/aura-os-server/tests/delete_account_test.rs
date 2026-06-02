mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use common::build_test_app;

/// `POST /api/auth/delete-account` is a protected route. Without a bearer
/// token the auth middleware must reject it before the handler runs, so the
/// destructive upstream zOS delete is never reached. A 401 (rather than 404)
/// also proves the route is actually registered and guarded.
#[tokio::test]
async fn delete_account_requires_authentication() {
    let (app, _state, _db) = build_test_app();

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/delete-account")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
