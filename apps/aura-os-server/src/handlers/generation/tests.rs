use super::*;
use serde_json::json;

fn sse_frame(event: &str, data: &serde_json::Value) -> String {
    format!("event: {event}\ndata: {}\n\n", data)
}

async fn start_mock_router(body: String, status: u16) -> (String, tokio::task::JoinHandle<()>) {
    use std::convert::Infallible;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        let (mut socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => return,
        };
        let mut req_buf = vec![0u8; 4096];
        let _ = socket.read(&mut req_buf).await;
        let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}"
            );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
        let _: Result<(), Infallible> = Ok(());
    });

    (url, handle)
}

#[tokio::test]
async fn run_generate_image_to_completion_returns_completed_payload() {
    let body = sse_frame(
        "progress",
        &json!({ "percent": 25, "message": "rendering" }),
    ) + &sse_frame(
        "completed",
        &json!({
            "imageUrl": "https://cdn.example.com/img.png",
            "originalUrl": "https://cdn.example.com/img-orig.png",
            "artifactId": "art-1",
        }),
    );

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let result = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "a cat", "model": "gpt-image-2" }),
        "a cat",
        "gpt-image-2",
    )
    .await
    .expect("should complete");

    assert_eq!(result["imageUrl"], "https://cdn.example.com/img.png");
    assert_eq!(
        result["originalUrl"],
        "https://cdn.example.com/img-orig.png"
    );
    assert_eq!(result["artifactId"], "art-1");
    assert_eq!(result["model"], "gpt-image-2");
    assert_eq!(result["prompt"], "a cat");
    assert_eq!(result["meta"]["model"], "gpt-image-2");
    assert_eq!(result["meta"]["prompt"], "a cat");

    handle.abort();
}

#[tokio::test]
async fn run_generate_image_to_completion_propagates_error_event() {
    let body = sse_frame(
        "error",
        &json!({ "code": "GENERATION_FAILED", "message": "model unavailable" }),
    );

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let err = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "x", "model": "gpt-image-2" }),
        "x",
        "gpt-image-2",
    )
    .await
    .expect_err("should error");

    let payload = serde_json::to_value(&err.1 .0).unwrap();
    assert_eq!(payload["code"], "bad_gateway");
    assert!(payload["error"]
        .as_str()
        .unwrap()
        .contains("model unavailable"));

    handle.abort();
}

#[tokio::test]
async fn run_generate_image_to_completion_errors_when_no_completed_event() {
    let body = sse_frame("progress", &json!({ "percent": 50 }));

    let (base_url, handle) = start_mock_router(body, 200).await;
    let url = format!("{base_url}/v1/generate-image/stream");

    let err = run_generate_image_to_completion(
        &url,
        "jwt",
        json!({ "prompt": "x", "model": "gpt-image-2" }),
        "x",
        "gpt-image-2",
    )
    .await
    .expect_err("should error without completed event");

    let payload = serde_json::to_value(&err.1 .0).unwrap();
    assert_eq!(payload["code"], "bad_gateway");

    handle.abort();
}

/// Pin down the new wire fields the chat-input "+" affordance forwards
/// for image / 3D / video modes. Without them, `resolve_persist_ctx`
/// always called `setup_*_chat_persistence` with `force_new=false /
/// pinned_session_id=None`, so generation turns silently appended to
/// the latest existing session even when the user explicitly asked
/// for a fresh chat. The rest of the regression coverage lives in the
/// `resolve_force_new_overrides_pin` test in
/// `handlers/agents/chat/persist.rs::pin_tests`, which already proves
/// that downstream `pick_candidate_session` honours `force_new=true`
/// over a pin — so threading `body.new_session` through is enough to
/// fix the user-visible symptom.
mod request_wire_shape {
    use crate::dto::{Generate3dRequest, GenerateImageRequest};
    use crate::handlers::generation::video::GenerateVideoRequest;

    #[test]
    fn image_request_round_trips_new_session_and_session_id() {
        let req: GenerateImageRequest = serde_json::from_str(
            r#"{
                "prompt": "a cat",
                "new_session": true,
                "session_id": "abc-123"
            }"#,
        )
        .expect("should deserialize");
        assert_eq!(req.prompt, "a cat");
        assert_eq!(req.new_session, Some(true));
        assert_eq!(req.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn image_request_omits_fields_default_to_none() {
        let req: GenerateImageRequest =
            serde_json::from_str(r#"{ "prompt": "a cat" }"#).expect("should deserialize");
        assert_eq!(req.new_session, None);
        assert_eq!(req.session_id, None);
    }

    #[test]
    fn three_d_request_round_trips_new_session_and_session_id() {
        let req: Generate3dRequest = serde_json::from_str(
            r#"{
                "imageUrl": "https://cdn.example.com/cat.png",
                "new_session": true,
                "session_id": "abc-123"
            }"#,
        )
        .expect("should deserialize");
        assert_eq!(req.new_session, Some(true));
        assert_eq!(req.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn video_request_round_trips_new_session_in_snake_case() {
        // `GenerateVideoRequest` uses `rename_all = "camelCase"` at the
        // struct level, so `new_session` and `session_id` carry an
        // explicit `rename` to keep the snake_case wire shape — the
        // chat hook posts `new_session: true`, not `newSession: true`,
        // matching `SendChatRequest` so the same client-side
        // serialiser can be reused.
        let req: GenerateVideoRequest = serde_json::from_str(
            r#"{
                "prompt": "a bird",
                "new_session": true,
                "session_id": "abc-123"
            }"#,
        )
        .expect("should deserialize");
        assert_eq!(req.prompt, "a bird");
        assert_eq!(req.new_session, Some(true));
        assert_eq!(req.session_id.as_deref(), Some("abc-123"));
    }
}
