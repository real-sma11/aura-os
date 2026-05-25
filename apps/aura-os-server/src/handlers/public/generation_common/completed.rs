//! Payload normalization helpers shared by the public generation
//! relay. Promotes the various upstream alias fields onto the
//! canonical `imageUrl` / `originalUrl` / `artifactId` keys the
//! chat-ui already renders for the auth'd surface.

use serde_json::{json, Map, Value};

use super::super::types::PublicModality;

/// Wrap a completed-payload normalization so the public surface
/// emits the same `{ imageUrl, originalUrl, artifactId, mode }`
/// shape the auth'd handlers do. The frontend chat-ui keys off the
/// `imageUrl` field for image / video / model3d alike (the same
/// alias the auth'd `normalize_generation_completed_payload` lands
/// on); duplicating the logic here avoids reaching into the
/// `pub(super)` auth'd helper.
pub(crate) fn normalize_completed_payload(modality: PublicModality, payload: Value) -> Value {
    let mut payload = match payload {
        Value::Object(_) => payload,
        other => {
            return json!({
                "mode": modality.as_str(),
                "payload": other,
            });
        }
    };
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("mode".to_string(), json!(modality.as_str()));
        let nested = obj
            .get("payload")
            .and_then(|value| value.as_object())
            .cloned();
        if !obj.contains_key("imageUrl") {
            if let Some(value) = first_string_field(
                obj,
                nested.as_ref(),
                &[
                    "imageUrl",
                    "image_url",
                    "assetUrl",
                    "asset_url",
                    "videoUrl",
                    "video_url",
                    "modelUrl",
                    "model_url",
                    "glbUrl",
                    "glb_url",
                    "url",
                ],
            ) {
                obj.insert("imageUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("originalUrl") {
            if let Some(value) =
                first_string_field(obj, nested.as_ref(), &["originalUrl", "original_url"])
            {
                obj.insert("originalUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("artifactId") {
            if let Some(value) =
                first_string_field(obj, nested.as_ref(), &["artifactId", "artifact_id", "id"])
            {
                obj.insert("artifactId".to_string(), json!(value));
            }
        }
    }
    payload
}

/// Coerce an upstream error frame into the `{ code, message }`
/// shape the chat-ui renders. Falls back to a generic message if
/// the upstream omitted both fields.
pub(crate) fn normalize_error_payload(payload: Value) -> Value {
    let message = payload
        .get("message")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("error").and_then(|value| value.as_str()))
        .unwrap_or("public generation failed upstream.");
    let code = payload
        .get("code")
        .and_then(|value| value.as_str())
        .unwrap_or("GENERATION_FAILED");
    json!({
        "code": code,
        "message": message,
    })
}

/// Look up the first present `keys` entry on the object or its
/// nested `payload` sibling, returning the owned string value.
fn first_string_field(
    obj: &Map<String, Value>,
    nested: Option<&Map<String, Value>>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|value| value.as_str()))
        .or_else(|| {
            nested.and_then(|nested| {
                keys.iter()
                    .find_map(|key| nested.get(*key).and_then(|value| value.as_str()))
            })
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_completed_payload_promotes_alias_fields() {
        let payload = normalize_completed_payload(
            PublicModality::Image,
            json!({ "assetUrl": "https://cdn.example.com/a.png" }),
        );
        assert_eq!(payload["mode"], "image");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/a.png");
    }

    #[test]
    fn normalize_completed_payload_preserves_existing_image_url() {
        let payload = normalize_completed_payload(
            PublicModality::Video,
            json!({
                "imageUrl": "https://cdn.example.com/v.mp4",
                "videoUrl": "https://cdn.example.com/v-other.mp4",
            }),
        );
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/v.mp4");
    }

    #[test]
    fn normalize_completed_payload_lifts_nested_payload_fields() {
        let payload = normalize_completed_payload(
            PublicModality::Model3d,
            json!({ "payload": { "model_url": "https://cdn.example.com/m.glb" } }),
        );
        assert_eq!(payload["mode"], "model3d");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/m.glb");
    }

    #[test]
    fn normalize_completed_payload_promotes_glb_url() {
        let payload = normalize_completed_payload(
            PublicModality::Model3d,
            json!({ "glbUrl": "https://cdn.example.com/m.glb" }),
        );
        assert_eq!(payload["mode"], "model3d");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/m.glb");
    }

    #[test]
    fn normalize_completed_payload_wraps_non_object_input() {
        let payload = normalize_completed_payload(PublicModality::Image, json!("just-a-string"));
        assert_eq!(payload["mode"], "image");
        assert_eq!(payload["payload"], "just-a-string");
    }

    #[test]
    fn normalize_error_payload_falls_back_to_generic_text() {
        let payload = normalize_error_payload(json!({}));
        assert_eq!(payload["code"], "GENERATION_FAILED");
        assert!(payload["message"].as_str().unwrap_or("").contains("failed"));
    }

    #[test]
    fn normalize_error_payload_carries_explicit_fields() {
        let payload = normalize_error_payload(json!({
            "code": "RATE_LIMITED",
            "message": "slow down",
        }));
        assert_eq!(payload["code"], "RATE_LIMITED");
        assert_eq!(payload["message"], "slow down");
    }
}
