use super::cache::{get_cached_session, get_stale_cached_session};
use super::error_map::map_auth_error;
use super::*;

/// Load the on-disk persisted `zero_auth_session` if it belongs to
/// `user_id`. Used to recover the `is_sys_admin` grant on the
/// token-validation path, where the login email needed to re-evaluate the
/// `SYS_ADMIN_EMAILS` allowlist is no longer available.
fn persisted_session_for(state: &AppState, user_id: &str) -> Option<ZeroAuthSession> {
    let bytes = state.store.get_setting("zero_auth_session").ok()?;
    let prev: ZeroAuthSession = serde_json::from_slice(&bytes).ok()?;
    (prev.user_id == user_id).then_some(prev)
}

/// Validate a JWT against zOS and update the cache.
pub(super) async fn validate_and_cache(
    state: &AppState,
    jwt: &str,
) -> Result<(ZeroAuthSession, Option<String>), (StatusCode, Json<ApiError>)> {
    let result = state
        .auth_service
        .validate_token(jwt)
        .await
        .map_err(map_auth_error)?;

    let zero_pro_refresh_error = result.zero_pro_refresh_error.clone();
    let mut session = result.session.clone();

    // The token-validation path (app restart / stored token) can't recover
    // the login email, so the `SYS_ADMIN_EMAILS` allowlist match recomputes
    // to `false` and the grant from login would silently evaporate. Re-apply
    // the `is_sys_admin` flag from the session we persisted at login, guarded
    // by a matching `user_id` so a stale record can't grant a different user.
    if !session.is_sys_admin {
        if let Some(prev) = persisted_session_for(state, &session.user_id) {
            session.is_sys_admin = prev.is_sys_admin;
        }
    }

    state.validation_cache.insert(
        jwt.to_string(),
        CachedSession {
            session: session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: zero_pro_refresh_error.clone(),
        },
    );

    Ok((session, zero_pro_refresh_error))
}

/// Resolve a session from a JWT: check cache first (unless `allow_validation_cache` is false),
/// then validate with zOS. On zOS network failure, falls back to a stale cached entry if available.
pub(super) async fn resolve_session_from_jwt(
    state: &AppState,
    jwt: &str,
    allow_validation_cache: bool,
    allow_stale_fallback: bool,
) -> Result<AuthResolution, (StatusCode, Json<ApiError>)> {
    if is_capture_access_token(jwt) {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
        if let Some(session) = capture_session_from_access_token(jwt) {
            state.validation_cache.insert(
                jwt.to_string(),
                CachedSession {
                    session: session.clone(),
                    validated_at: Instant::now(),
                    zero_pro_refresh_error: None,
                },
            );
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: None,
                degraded: false,
            });
        }
        return Err(ApiError::unauthorized("capture session expired"));
    }

    if allow_validation_cache {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
    }

    match validate_and_cache(state, jwt).await {
        Ok((session, zero_pro_refresh_error)) => Ok(AuthResolution {
            session,
            zero_pro_refresh_error,
            degraded: false,
        }),
        Err(err) if err.0 == StatusCode::UNAUTHORIZED => Err(err),
        Err(err) => {
            if !allow_stale_fallback {
                return Err(err);
            }

            // zOS unreachable -- try stale cache entry as fallback
            if let Some((session, zero_pro_refresh_error)) = get_stale_cached_session(state, jwt) {
                warn!(
                    user_id = %session.user_id,
                    "zOS unreachable, using stale cached session"
                );
                Ok(AuthResolution {
                    session,
                    zero_pro_refresh_error,
                    degraded: true,
                })
            } else {
                Err(err)
            }
        }
    }
}
