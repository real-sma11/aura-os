use super::*;

// ---------------------------------------------------------------------------
// Per-request auth extractors (set by `require_verified_session` middleware)
// ---------------------------------------------------------------------------

/// JWT access token extracted from the `Authorization: Bearer <token>` header.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthJwt(pub String);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthJwt {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthJwt>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth token"))
    }
}

/// Full authenticated session, available after middleware validation.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthSession(pub ZeroAuthSession);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthSession {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthSession>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth session"))
    }
}

/// Metadata from the last zOS validation (Pro entitlement fetch), carried alongside [`AuthSession`].
#[derive(Clone, Debug)]
pub(crate) struct AuthZeroProMeta {
    pub zero_pro_refresh_error: Option<String>,
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthZeroProMeta {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthZeroProMeta>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth metadata"))
    }
}

// ---------------------------------------------------------------------------
// Guest-JWT extractor (public anonymous endpoints)
// ---------------------------------------------------------------------------

/// Decoded guest claims for the `/api/public/*` endpoint family.
///
/// Distinct from [`AuthJwt`] / [`AuthSession`] because guest tokens are
/// signed locally with `GUEST_JWT_SECRET` rather than validated through
/// zOS. The phase-2 setup handler signs them; the phase-2 chat / image
/// / video / model3d handlers consume them through this extractor.
///
/// The extractor decodes the bearer token directly (no Axum
/// middleware in front of the public routes) and rejects any token
/// that does not deserialize into the canonical
/// [`crate::handlers::public::GuestClaims`] shape with `role == "guest"`.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct AuthGuestJwt(pub crate::handlers::public::GuestClaims);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthGuestJwt {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let token = crate::handlers::public::extract_bearer_from_headers(&parts.headers)
            .ok_or_else(|| ApiError::unauthorized("missing guest token"))?;
        let claims = crate::handlers::public::decode_guest_token(&token)
            .map_err(|_| ApiError::unauthorized("invalid guest token"))?;
        Ok(Self(claims))
    }
}
