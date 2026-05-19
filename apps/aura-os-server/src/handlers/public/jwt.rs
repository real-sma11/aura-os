//! Guest-token decoding.
//!
//! Phase 2's `POST /api/public/setup` handler signs short-lived guest
//! JWTs whose payload is [`super::types::GuestClaims`]. Phase 1 lays
//! the verifier so [`crate::state::AuthGuestJwt`] can deserialize and
//! validate those tokens, and the [`crate::auth_guard::require_verified_session`]
//! middleware can cheaply detect "this is a guest token" before
//! handing the request to zOS for full validation (where it would be
//! rejected for a different reason).
//!
//! Signing key resolution:
//!
//! - Production must set `GUEST_JWT_SECRET` to a 32+ byte random
//!   string. The deployment scripts populate it from the same
//!   secret-store that backs the rest of the service.
//! - Local/dev builds fall back to [`DEV_FALLBACK_SECRET`] so
//!   `cargo run -p aura-os-server` works without extra env wiring.
//!
//! Both encode and decode go through [`guest_jwt_secret`] so the
//! setup handler and the verifier share one source of truth.

use axum::http::HeaderMap;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use std::time::{SystemTime, SystemTimeError, UNIX_EPOCH};

use super::types::{GuestClaims, GuestId};

/// Env var the deploy scripts populate with the guest JWT signing
/// secret. A missing or blank value falls back to
/// [`DEV_FALLBACK_SECRET`] so local development works without extra
/// configuration.
pub(crate) const GUEST_JWT_SECRET_ENV: &str = "GUEST_JWT_SECRET";

/// Fixed development fallback used when [`GUEST_JWT_SECRET_ENV`] is
/// unset. Long-form (>32 bytes) so HS256 is happy and the signing
/// secret never accidentally degenerates into something brute-forceable.
/// NEVER ship this to production — the env var must be set.
pub(crate) const DEV_FALLBACK_SECRET: &str =
    "aura-public-mode-dev-only-guest-jwt-secret-do-not-use-in-prod";

/// Single algorithm both ends of the guest-token boundary agree on.
/// HS256 keeps the secret-handling story symmetric (one secret to
/// rotate; no asymmetric keypair management).
pub(crate) const GUEST_JWT_ALGORITHM: Algorithm = Algorithm::HS256;

/// Effective signing secret for the current process. Reads the env
/// var on every call so tests can override it via `std::env::set_var`
/// without restarting; the call is cheap (a single `env::var`) and
/// the verifier path is already off the request hot loop.
pub(crate) fn guest_jwt_secret() -> Vec<u8> {
    match std::env::var(GUEST_JWT_SECRET_ENV) {
        Ok(value) if !value.trim().is_empty() => value.into_bytes(),
        _ => DEV_FALLBACK_SECRET.as_bytes().to_vec(),
    }
}

/// Decode and validate a bearer token as a guest JWT.
///
/// Returns `Ok(claims)` only when the token verifies under the
/// current signing secret AND [`GuestClaims::is_guest`] holds. Any
/// other outcome (signature failure, expired, role mismatch) returns
/// `Err(())`. The opaque error type is intentional — the caller
/// translates it into the right HTTP status; this layer never logs
/// the raw token.
pub(crate) fn decode_guest_token(token: &str) -> Result<GuestClaims, ()> {
    let secret = guest_jwt_secret();
    let key = DecodingKey::from_secret(&secret);
    let mut validation = Validation::new(GUEST_JWT_ALGORITHM);
    validation.set_required_spec_claims(&["exp", "sub"]);
    validation.validate_exp = true;
    validation.leeway = 5;
    let data = decode::<GuestClaims>(token, &key, &validation).map_err(|_| ())?;
    if !data.claims.is_guest() {
        return Err(());
    }
    Ok(data.claims)
}

/// Pull the bearer token out of a standard `Authorization` header.
/// Returns `None` for missing / non-`Bearer` values; never panics on
/// non-ASCII headers (the underlying header is `to_str`-checked).
pub(crate) fn extract_bearer_from_headers(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?;
    let raw = value.to_str().ok()?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))?;
    let trimmed = token.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Cheap check: does `token` *look like* a successfully-decodable
/// guest token? Used by the authenticated-route middleware to reject
/// guest tokens before forwarding to zOS (which would reject them
/// for the wrong reason and pollute the auth metrics).
pub(crate) fn is_guest_token(token: &str) -> bool {
    decode_guest_token(token).is_ok()
}

/// Lifetime of issued guest tokens, mirroring the rate-limiter's 24h
/// bucket TTL so the JWT and the per-guest state expire in lock-step.
pub(crate) const GUEST_TOKEN_TTL_SECS: u64 = 24 * 60 * 60;

/// Failure modes for [`encode_guest_token`]. Decoupled from a
/// generic `anyhow::Error` so the setup handler can map each
/// variant onto the right HTTP shape without parsing a string.
#[derive(Debug)]
pub(crate) enum GuestTokenEncodeError {
    /// `SystemTime::now()` was before the unix epoch — only happens on
    /// a profoundly misconfigured system clock.
    Clock(SystemTimeError),
    /// `jsonwebtoken::encode` failed (shouldn't happen with HS256 +
    /// a static-length secret, but we surface it rather than panic).
    Sign(jsonwebtoken::errors::Error),
}

impl std::fmt::Display for GuestTokenEncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Clock(e) => write!(f, "system clock before unix epoch: {e}"),
            Self::Sign(e) => write!(f, "guest jwt signing failed: {e}"),
        }
    }
}

impl std::error::Error for GuestTokenEncodeError {}

/// Sign a guest JWT for `guest_id`. Stamps `role = "guest"` and
/// `exp = now + GUEST_TOKEN_TTL_SECS` so [`decode_guest_token`]
/// accepts the token until its rate-limiter bucket evicts.
pub(crate) fn encode_guest_token(
    guest_id: &GuestId,
) -> Result<(String, GuestClaims), GuestTokenEncodeError> {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(GuestTokenEncodeError::Clock)?
        .as_secs();
    let claims = GuestClaims {
        sub: guest_id.as_str().to_string(),
        role: GuestClaims::ROLE.to_string(),
        exp: now_secs + GUEST_TOKEN_TTL_SECS,
    };
    let secret = guest_jwt_secret();
    let key = EncodingKey::from_secret(&secret);
    let header = Header::new(GUEST_JWT_ALGORITHM);
    let token = encode(&header, &claims, &key).map_err(GuestTokenEncodeError::Sign)?;
    Ok((token, claims))
}

// ── Router service key for public mode ──────────────────────────────
//
// aura-router accepts a dedicated service key (`AURA_PUBLIC_GUEST_KEY`)
// that short-circuits JWT validation and assigns user_id "public-guest".
// This avoids sharing AUTH_COOKIE_SECRET with aura-os-server — the
// service key can only make guest LLM calls, never impersonate a real
// user.

/// Env var holding the service key shared with aura-router.
const PUBLIC_GUEST_KEY_ENV: &str = "AURA_PUBLIC_GUEST_KEY";

/// Read the public-guest service key from the environment. Returns
/// `None` if `AURA_PUBLIC_GUEST_KEY` is not set (public mode is
/// disabled without it).
pub(crate) fn public_guest_service_key() -> Option<String> {
    std::env::var(PUBLIC_GUEST_KEY_ENV)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn sign(claims: &GuestClaims) -> String {
        let secret = guest_jwt_secret();
        let key = EncodingKey::from_secret(&secret);
        let header = Header::new(GUEST_JWT_ALGORITHM);
        encode(&header, claims, &key).expect("encode test guest token")
    }

    #[test]
    fn round_trip_guest_token_decodes_back_to_claims() {
        let claims = GuestClaims {
            sub: "g-test".to_string(),
            role: GuestClaims::ROLE.to_string(),
            exp: now_secs() + 3600,
        };
        let token = sign(&claims);
        let decoded = decode_guest_token(&token).expect("guest token must decode");
        assert_eq!(decoded.sub, "g-test");
        assert!(decoded.is_guest());
    }

    #[test]
    fn token_with_wrong_role_is_rejected() {
        let claims = GuestClaims {
            sub: "u-real".to_string(),
            role: "user".to_string(),
            exp: now_secs() + 3600,
        };
        let token = sign(&claims);
        assert!(decode_guest_token(&token).is_err());
    }

    #[test]
    fn expired_token_is_rejected() {
        let claims = GuestClaims {
            sub: "g-old".to_string(),
            role: GuestClaims::ROLE.to_string(),
            exp: now_secs().saturating_sub(3600),
        };
        let token = sign(&claims);
        assert!(decode_guest_token(&token).is_err());
    }

    #[test]
    fn extract_bearer_handles_missing_and_blank() {
        let mut headers = HeaderMap::new();
        assert!(extract_bearer_from_headers(&headers).is_none());
        headers.insert(
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("Bearer "),
        );
        assert!(extract_bearer_from_headers(&headers).is_none());
        headers.insert(
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("Bearer abc.def.ghi"),
        );
        assert_eq!(
            extract_bearer_from_headers(&headers).as_deref(),
            Some("abc.def.ghi")
        );
    }

    #[test]
    fn is_guest_token_returns_false_for_garbage() {
        assert!(!is_guest_token("not-a-jwt"));
        assert!(!is_guest_token(""));
    }
}
