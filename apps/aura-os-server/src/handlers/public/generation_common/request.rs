//! Upstream-request shape + header helpers shared by every public
//! generation handler. Split out of the prior monolithic
//! `generation_common.rs` so the orchestration layer ([`super`])
//! and the SSE relay ([`super::relay`]) can each stay under the
//! 500-line cap.

use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr};
use std::pin::Pin;
use std::time::Duration;

use axum::http::HeaderMap;
use axum::response::sse::Event;
use futures_core::Stream;
use reqwest::StatusCode as ReqwestStatus;
use serde_json::Value;
use tracing::error;

use crate::error::ApiError;

use super::super::types::PublicModality;

/// Hard ceiling on the upstream POST connection. The auth'd image,
/// video, and model3d siblings rely on the harness
/// `event_idle_timeout` and `max_runtime` envs; for the direct-HTTP
/// public proxy we apply a single watchdog on the open call and let
/// the SSE relay drain on its own afterwards. Upstream emits a
/// terminal frame within its own max-runtime budget; otherwise the
/// dropped TCP connection terminates the stream.
pub(crate) const PUBLIC_GENERATION_OPEN_TIMEOUT: Duration = Duration::from_secs(120);

/// SSE response stream shape mirroring the auth'd `SseStream` (kept
/// inline so the public module does not depend on the auth'd
/// `generation/sse.rs` private alias). Re-exported as
/// `PublicGenerationSse` for handlers that need to spell the type
/// in their own return signature.
pub(crate) type PublicGenerationSse =
    Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send + 'static>>;

/// Bundle of fixed inputs for one public-mode generation call.
///
/// Caller-provided fields land in `payload` only after the handler
/// has stripped any client-overridable knob (`model`, `size`,
/// `duration`, `quality`) and substituted server-fixed defaults.
pub(crate) struct PublicGenerationCall {
    /// Upstream router path appended to `state.router_url`. Always a
    /// `/v1/generate-*/stream` SSE endpoint.
    pub(crate) upstream_path: &'static str,
    /// Hardcoded JSON body forwarded to the upstream proxy. Built
    /// fresh by the per-modality handler — never derived from the
    /// raw request body, so clients cannot override expensive
    /// parameters.
    pub(crate) payload: Value,
    /// Modality this call targets. Used purely for tracing fields.
    pub(crate) modality: PublicModality,
}

/// Best-effort caller-IP extraction for the rate-limiter's per-IP
/// bucket. Reads `X-Forwarded-For` (first hop) and `X-Real-IP` in
/// that order; falls back to `127.0.0.1` when the server is reached
/// directly. The result is hashed via
/// `super::super::types::IpHash::from_ip` before it ever touches
/// the limiter map, so a "wrong" fallback can only undercount,
/// never leak the raw header.
pub(crate) fn caller_ip_from_headers(headers: &HeaderMap) -> IpAddr {
    if let Some(forwarded) = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(ip) = forwarded.parse::<IpAddr>() {
            return ip;
        }
    }
    if let Some(real) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(ip) = real.parse::<IpAddr>() {
            return ip;
        }
    }
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}

/// Best-effort bearer-token extraction from the request headers.
/// The guest JWT was already decoded by `AuthGuestJwt`; we re-read
/// the raw `Authorization` header here so the upstream router proxy
/// receives the same opaque string the caller sent. Returns `None`
/// when the header is absent or not `Bearer <token>`.
pub(crate) fn bearer_token_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.strip_prefix("Bearer "))
        .map(str::to_string)
}

/// Translate a non-2xx upstream response into the typed [`ApiError`]
/// shape the rest of the server uses.
pub(crate) async fn map_upstream_status_failure(
    response: reqwest::Response,
) -> (axum::http::StatusCode, axum::Json<crate::error::ApiError>) {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    error!(
        %status,
        body = %body,
        "public_generation: upstream returned error status"
    );
    match status {
        ReqwestStatus::UNAUTHORIZED => ApiError::unauthorized("router rejected token"),
        ReqwestStatus::PAYMENT_REQUIRED => ApiError::payment_required("insufficient credits"),
        ReqwestStatus::TOO_MANY_REQUESTS => ApiError::service_unavailable("rate limited"),
        _ => ApiError::bad_gateway(format!("upstream returned {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn caller_ip_falls_back_to_localhost_when_no_proxy_headers() {
        let headers = HeaderMap::new();
        assert_eq!(
            caller_ip_from_headers(&headers),
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        );
    }

    #[test]
    fn caller_ip_prefers_first_x_forwarded_for_hop() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.7, 198.51.100.1"),
        );
        let ip = caller_ip_from_headers(&headers);
        assert_eq!(ip.to_string(), "203.0.113.7");
    }

    #[test]
    fn caller_ip_falls_back_to_x_real_ip_when_forwarded_blank() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static(""));
        headers.insert("x-real-ip", HeaderValue::from_static("198.51.100.42"));
        let ip = caller_ip_from_headers(&headers);
        assert_eq!(ip.to_string(), "198.51.100.42");
    }

    #[test]
    fn bearer_token_round_trips_authorization_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer opaque.guest.jwt"),
        );
        assert_eq!(
            bearer_token_from_headers(&headers).as_deref(),
            Some("opaque.guest.jwt"),
        );
    }

    #[test]
    fn bearer_token_returns_none_for_missing_or_non_bearer_header() {
        let headers = HeaderMap::new();
        assert!(bearer_token_from_headers(&headers).is_none());
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Basic abc:def"),
        );
        assert!(bearer_token_from_headers(&headers).is_none());
    }
}
