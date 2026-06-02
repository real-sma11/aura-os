mod error;
pub use error::AuthError;

use std::collections::HashSet;
use std::time::Duration;

use base64::Engine;
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use tracing::{debug, error, info, warn};

use aura_os_core::ZeroAuthSession;

const ZOS_API_URL: &str = "https://zosapi.zero.tech";

#[derive(Debug, Deserialize)]
struct ZosErrorBody {
    code: Option<String>,
    message: Option<String>,
}

fn parse_zos_error(status: u16, body: &str) -> AuthError {
    let (code, message) = match serde_json::from_str::<ZosErrorBody>(body) {
        Ok(parsed) => (
            parsed.code.unwrap_or_default(),
            parsed.message.unwrap_or_else(|| body.to_string()),
        ),
        Err(_) => (String::new(), body.to_string()),
    };
    error!(status, %code, %message, "zOS API error");
    AuthError::ZosApi {
        status,
        code,
        message,
    }
}

#[derive(Debug, Deserialize)]
struct ZosLoginResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    // Stored for future token refresh support
    #[allow(dead_code)]
    #[serde(rename = "identityToken")]
    identity_token: String,
}

#[derive(Debug, Deserialize)]
struct ZosProfileSummary {
    #[serde(rename = "firstName")]
    first_name: Option<String>,
    #[serde(rename = "lastName")]
    last_name: Option<String>,
    #[serde(default, rename = "profileImage")]
    profile_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ZosWallet {
    #[serde(rename = "publicAddress")]
    public_address: String,
}

#[derive(Debug, Deserialize)]
struct ZosUserResponse {
    id: String,
    #[serde(default, alias = "primaryEmail", alias = "emailAddress")]
    email: Option<String>,
    #[serde(rename = "profileSummary")]
    profile_summary: Option<ZosProfileSummary>,
    #[serde(rename = "primaryZID")]
    primary_zid: Option<String>,
    #[serde(rename = "primaryWalletAddress")]
    primary_wallet_address: Option<String>,
    wallets: Option<Vec<ZosWallet>>,
}

#[derive(Debug, Deserialize)]
struct ZosProfileResponse {
    #[serde(rename = "isZeroProSubscriber", default)]
    is_zero_pro: bool,
    /// The richer v2 `/api/v2/users/me` payload usually carries an email
    /// even when `/api/users/current` and the JWT claims omit it. This is
    /// the most reliable source for the `SYS_ADMIN_EMAILS` allowlist match
    /// on the token-validation path (where no login email is available).
    #[serde(default, alias = "primaryEmail", alias = "emailAddress")]
    email: Option<String>,
}

pub struct AuthSessionResult {
    pub session: ZeroAuthSession,
    pub zero_pro_refresh_error: Option<String>,
    /// The user ID of the inviter, if the user registered via an invite code.
    /// Populated from the zos-api finalize response.
    pub inviter_user_id: Option<String>,
}

fn zero_pro_refresh_error_message() -> String {
    "Unable to verify ZERO Pro status right now.".to_string()
}

fn normalize_login_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Mask an email for logging so we never write a full address to logs:
/// `n3o@zero.tech` -> `n***@zero.tech`. Non-email-ish strings are reduced
/// to a leading char plus `***`.
fn mask_email_for_log(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let head = local.chars().next().map(String::from).unwrap_or_default();
            format!("{head}***@{domain}")
        }
        None => {
            let head = email.chars().next().map(String::from).unwrap_or_default();
            format!("{head}***")
        }
    }
}

/// Claims we attempt to read out of the zOS access token (a JWT) when the
/// `/api/users/current` response does not carry an email. The token has
/// already been validated by zOS at this point, so we only read claims
/// (no signature verification).
#[derive(Debug, Deserialize)]
struct JwtEmailClaims {
    email: Option<String>,
    #[serde(rename = "preferred_username")]
    preferred_username: Option<String>,
    #[serde(rename = "primaryEmail")]
    primary_email: Option<String>,
    /// zOS access tokens are auth0-issued and carry the email under this
    /// namespaced custom claim rather than a bare `email` claim. This is
    /// the only email source available on the token-validation path
    /// (app restart / stored token), so the `SYS_ADMIN_EMAILS` allowlist
    /// match depends on reading it.
    #[serde(rename = "http://fact0ry.com/email")]
    fact0ry_email: Option<String>,
}

/// Best-effort extraction of an email from a JWT payload. Returns `None`
/// if the token is malformed or carries no email-like claim. The value
/// returned is whatever the claim holds (not yet normalized).
fn email_from_jwt_claims(token: &str) -> Option<String> {
    let payload_b64 = token.split('.').nth(1)?;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .ok()?;
    let claims: JwtEmailClaims = serde_json::from_slice(&payload_bytes).ok()?;
    claims
        .email
        .or(claims.fact0ry_email)
        .or(claims.primary_email)
        .or(claims.preferred_username)
        .map(|e| e.trim().to_string())
        .filter(|e| e.contains('@'))
}

pub struct AuthService {
    http: Client,
    /// Emails (normalized lowercase/trimmed) that are always granted
    /// `is_sys_admin` regardless of what aura-network reports. Sourced
    /// from the `SYS_ADMIN_EMAILS` env var at construction.
    sys_admin_emails: HashSet<String>,
}

impl AuthService {
    pub fn new() -> Self {
        Self::with_sys_admin_emails(HashSet::new())
    }

    /// Construct an `AuthService` with a set of always-admin emails.
    /// Each entry is normalized (trimmed + lowercased) for matching.
    pub fn with_sys_admin_emails(emails: HashSet<String>) -> Self {
        let sys_admin_emails = emails
            .into_iter()
            .map(|e| normalize_login_email(&e))
            .filter(|e| !e.is_empty())
            .collect();
        Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build auth http client"),
            sys_admin_emails,
        }
    }

    /// Returns true if the given (optional) email is in the configured
    /// system-admin allowlist.
    fn is_allowlisted_admin(&self, email: Option<&str>) -> bool {
        match email {
            Some(e) => self.sys_admin_emails.contains(&normalize_login_email(e)),
            None => false,
        }
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<AuthSessionResult, AuthError> {
        debug!("Logging in via zOS-api");
        let normalized_email = normalize_login_email(email);
        let res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/login"))
            .json(&serde_json::json!({ "email": normalized_email, "password": password }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        let login_data: ZosLoginResponse = res.json().await.map_err(AuthError::Http)?;
        self.build_session_from_token(&login_data.access_token, Some(&normalized_email))
            .await
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
        name: &str,
        invite_code: &str,
    ) -> Result<AuthSessionResult, AuthError> {
        debug!("Registering via zOS-api");

        // Step 1: Create account with invite code
        let res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/createAndAuthorize"))
            .json(&serde_json::json!({
                "user": {
                    "email": email.to_lowercase(),
                    "password": password,
                    "handle": email.to_lowercase(),
                },
                "inviteSlug": invite_code,
            }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        let login_data: ZosLoginResponse = res.json().await.map_err(AuthError::Http)?;
        let token = &login_data.access_token;

        // Step 2: Fetch user to get userId for finalize
        let user = self.fetch_user_info(token).await?;

        // Step 3: Finalize profile with name
        let finalize_res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/finalize"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "userId": user.id,
                "name": name,
                "inviteCode": invite_code,
            }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        // Capture inviter from finalize response (if invite code was used)
        let mut inviter_user_id = None;
        if finalize_res.status().is_success() {
            if let Ok(body) = finalize_res.json::<serde_json::Value>().await {
                inviter_user_id = body
                    .get("inviter")
                    .and_then(|v| v.get("id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        } else {
            let status = finalize_res.status().as_u16();
            let body = finalize_res.text().await.unwrap_or_default();
            warn!(status, body = %body, "Failed to finalize account, continuing with session");
        }

        // Step 4: Build session from the token (re-fetches user with completed profile)
        let mut result = self
            .build_session_from_token(token, Some(&normalize_login_email(email)))
            .await?;
        result.inviter_user_id = inviter_user_id;
        Ok(result)
    }

    pub async fn import_access_token(
        &self,
        access_token: &str,
    ) -> Result<AuthSessionResult, AuthError> {
        debug!("Importing existing zOS access token");
        self.build_session_from_token(access_token, None).await
    }

    pub async fn request_password_reset(&self, email: &str) -> Result<(), AuthError> {
        debug!("Requesting password reset via zOS-api");
        let res = self
            .http
            .post(format!(
                "{ZOS_API_URL}/api/v2/accounts/request-password-reset"
            ))
            .json(&serde_json::json!({ "email": email.to_lowercase() }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        Ok(())
    }

    pub async fn logout(&self, token: Option<&str>) -> Result<(), AuthError> {
        if let Some(jwt) = token {
            debug!("Logging out via zOS-api");
            let _ = self
                .http
                .delete(format!("{ZOS_API_URL}/authentication/session"))
                .bearer_auth(jwt)
                .send()
                .await;
        }
        Ok(())
    }

    /// Delete the caller's ZERO account via zOS-api. zOS performs a soft
    /// delete (`is_deleted = true`) that permanently blocks the account from
    /// authenticating again. Unlike `logout`, this is not best-effort: a
    /// non-2xx response is surfaced as an error so callers do not tear down
    /// the local session — or tell the user their account is gone — when the
    /// upstream delete did not actually happen.
    pub async fn delete_account(&self, token: &str) -> Result<(), AuthError> {
        debug!("Deleting account via zOS-api");
        let res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/delete"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        Ok(())
    }

    async fn fetch_user_info(&self, token: &str) -> Result<ZosUserResponse, AuthError> {
        let res = self
            .http
            .get(format!("{ZOS_API_URL}/api/users/current"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        res.json().await.map_err(AuthError::Http)
    }

    /// Fetch the v2 `/api/v2/users/me` profile. Carries ZERO Pro status and,
    /// crucially, an email used to back-fill the `SYS_ADMIN_EMAILS` allowlist
    /// match when no login email is in hand (the token-validation path).
    async fn fetch_zero_pro_profile(&self, token: &str) -> Result<ZosProfileResponse, AuthError> {
        let res = self
            .http
            .get(format!("{ZOS_API_URL}/api/v2/users/me"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        res.json::<ZosProfileResponse>()
            .await
            .map_err(AuthError::Http)
    }

    /// Validate a JWT token against zOS without relying on local disk persistence.
    /// Returns a fresh session built from the zOS user info and Pro status.
    /// `network_user_id` and `profile_id` will be `None` — populated later
    /// by `sync_user_to_network` on the server side.
    pub async fn validate_token(&self, token: &str) -> Result<AuthSessionResult, AuthError> {
        debug!("Validating token against zOS-api");
        self.build_session_from_token(token, None).await
    }

    /// Build a `ZeroAuthSession` from a token by fetching user info and Pro status from zOS.
    ///
    /// `known_email`, when provided (e.g. the address the user typed at
    /// login/register), is the most reliable source for the
    /// `SYS_ADMIN_EMAILS` allowlist match. We fall back to the email
    /// embedded in the JWT claims and then to whatever
    /// `/api/users/current` returns, because that endpoint does not
    /// reliably carry an email field across all zOS account shapes.
    async fn build_session_from_token(
        &self,
        access_token: &str,
        known_email: Option<&str>,
    ) -> Result<AuthSessionResult, AuthError> {
        let user = self.fetch_user_info(access_token).await?;
        let now = Utc::now();

        // Fetch the v2 profile up-front: it carries ZERO Pro status and an
        // email that `/api/users/current` and the JWT often omit. We need
        // that email *before* resolving the sys-admin allowlist so the grant
        // survives the token-validation path (app restart / stored token),
        // where no login email is available.
        let (is_zero_pro, zos_me_email, zero_pro_refresh_error) =
            match self.fetch_zero_pro_profile(access_token).await {
                Ok(profile) => (profile.is_zero_pro, profile.email, None),
                Err(err) => {
                    warn!(
                        error = %err,
                        user_id = %user.id,
                        "authenticated session but could not verify ZERO Pro entitlement"
                    );
                    (false, None, Some(zero_pro_refresh_error_message()))
                }
            };

        let (admin_email, email_source) = known_email
            .map(|e| (e.to_string(), "login"))
            .or_else(|| email_from_jwt_claims(access_token).map(|e| (e, "jwt")))
            .or_else(|| user.email.clone().map(|e| (e, "zos_user")))
            .or_else(|| {
                zos_me_email
                    .clone()
                    .map(|e| e.trim().to_string())
                    .filter(|e| e.contains('@'))
                    .map(|e| (e, "zos_me"))
            })
            .map(|(email, source)| (Some(email), source))
            .unwrap_or((None, "none"));

        let is_allowlisted_admin = self.is_allowlisted_admin(admin_email.as_deref());
        info!(
            user_id = %user.id,
            email_source,
            email = admin_email.as_deref().map(mask_email_for_log).as_deref().unwrap_or("<none>"),
            is_sys_admin = is_allowlisted_admin,
            allowlist_size = self.sys_admin_emails.len(),
            "Resolved sys-admin allowlist grant for session"
        );

        let session = ZeroAuthSession {
            user_id: user.id,
            network_user_id: None,
            profile_id: None,
            display_name: build_display_name(&user.profile_summary, &user.primary_zid),
            profile_image: user
                .profile_summary
                .as_ref()
                .and_then(|ps| ps.profile_image.clone())
                .unwrap_or_default(),
            primary_zid: user.primary_zid.unwrap_or_default(),
            zero_wallet: user.primary_wallet_address.unwrap_or_default(),
            wallets: user
                .wallets
                .unwrap_or_default()
                .into_iter()
                .map(|w| w.public_address)
                .collect(),
            access_token: access_token.to_string(),
            is_zero_pro,
            is_access_granted: false,
            is_sys_admin: is_allowlisted_admin,
            created_at: now,
            validated_at: now,
        };

        Ok(AuthSessionResult {
            session,
            zero_pro_refresh_error,
            inviter_user_id: None,
        })
    }
}

impl Default for AuthService {
    fn default() -> Self {
        Self::new()
    }
}

fn build_display_name(profile: &Option<ZosProfileSummary>, primary_zid: &Option<String>) -> String {
    if let Some(p) = profile {
        let first = p.first_name.as_deref().unwrap_or("");
        let last = p.last_name.as_deref().unwrap_or("");
        let full = format!("{first} {last}").trim().to_string();
        if !full.is_empty() {
            return full;
        }
    }
    if let Some(zid) = primary_zid {
        if !zid.is_empty() {
            return zid.clone();
        }
    }
    "User".to_string()
}

#[cfg(test)]
mod tests {
    use super::{email_from_jwt_claims, mask_email_for_log, normalize_login_email, AuthService};
    use base64::Engine;
    use std::collections::HashSet;

    /// Build a fake (unsigned) JWT with the given JSON payload so we can
    /// exercise the claims extractor without a real zOS token.
    fn fake_jwt(payload: &serde_json::Value) -> String {
        let b64 = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        let header = b64(br#"{"alg":"HS256","typ":"JWT"}"#);
        let body = b64(payload.to_string().as_bytes());
        format!("{header}.{body}.sig")
    }

    #[test]
    fn mask_email_keeps_domain_and_hides_local() {
        assert_eq!(mask_email_for_log("n3o@zero.tech"), "n***@zero.tech");
        assert_eq!(mask_email_for_log("weird-no-at"), "w***");
        assert_eq!(mask_email_for_log(""), "***");
    }

    #[test]
    fn jwt_email_extraction_prefers_email_then_primary_then_username() {
        let token = fake_jwt(&serde_json::json!({ "email": "a@zero.tech" }));
        assert_eq!(
            email_from_jwt_claims(&token).as_deref(),
            Some("a@zero.tech")
        );

        let token = fake_jwt(&serde_json::json!({ "primaryEmail": "b@zero.tech" }));
        assert_eq!(
            email_from_jwt_claims(&token).as_deref(),
            Some("b@zero.tech")
        );

        let token = fake_jwt(&serde_json::json!({ "preferred_username": "c@zero.tech" }));
        assert_eq!(
            email_from_jwt_claims(&token).as_deref(),
            Some("c@zero.tech")
        );

        // zOS auth0 tokens carry the email only under this namespaced claim.
        let token = fake_jwt(&serde_json::json!({ "http://fact0ry.com/email": "d@zero.tech" }));
        assert_eq!(
            email_from_jwt_claims(&token).as_deref(),
            Some("d@zero.tech")
        );
    }

    #[test]
    fn jwt_email_extraction_rejects_non_email_and_malformed() {
        // Non-email username claim is dropped (no '@').
        let token = fake_jwt(&serde_json::json!({ "preferred_username": "just-a-handle" }));
        assert_eq!(email_from_jwt_claims(&token), None);
        // Garbage token with no payload segment.
        assert_eq!(email_from_jwt_claims("not-a-jwt"), None);
    }

    #[test]
    fn normalize_login_email_trims_and_lowercases() {
        assert_eq!(
            normalize_login_email("  ShahRozAli@Gmail.Com "),
            "shahrozali@gmail.com"
        );
    }

    #[test]
    fn allowlist_matches_case_and_whitespace_insensitively() {
        let svc =
            AuthService::with_sys_admin_emails(HashSet::from(["  N3O@Zero.Tech ".to_string()]));
        assert!(svc.is_allowlisted_admin(Some("n3o@zero.tech")));
        assert!(svc.is_allowlisted_admin(Some("  N3O@ZERO.TECH ")));
    }

    #[test]
    fn allowlist_rejects_unknown_or_missing_email() {
        let svc = AuthService::with_sys_admin_emails(HashSet::from(["n3o@zero.tech".to_string()]));
        assert!(!svc.is_allowlisted_admin(Some("someone@else.com")));
        assert!(!svc.is_allowlisted_admin(None));
    }

    #[test]
    fn empty_allowlist_grants_nobody() {
        let svc = AuthService::new();
        assert!(!svc.is_allowlisted_admin(Some("n3o@zero.tech")));
    }
}
