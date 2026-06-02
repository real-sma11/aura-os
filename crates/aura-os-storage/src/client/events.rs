use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

/// How a session-events page request authenticates to aura-storage.
/// The authed and internal-token read paths differ only in this
/// credential (and the corresponding URL prefix), so it is threaded
/// through the shared pagination body rather than duplicating the loop.
enum EventsAuth<'a> {
    /// Caller JWT forwarded as `Authorization: Bearer <jwt>` against
    /// the public `/api/sessions/...` surface.
    Jwt(&'a str),
    /// Server `X-Internal-Token` credential against the
    /// `/internal/sessions/...` surface (unauthenticated public-share
    /// read path).
    Internal,
}

impl StorageClient {
    /// Fetch a single page of session events using the given auth mode.
    /// Shared by both [`StorageClient::list_events`] and
    /// [`StorageClient::list_events_internal`] via [`Self::list_all_events`].
    async fn list_events_page(
        &self,
        session_id: &str,
        auth: &EventsAuth<'_>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        validate_url_id(session_id, "session_id")?;
        let path_prefix = match auth {
            EventsAuth::Jwt(_) => "api/sessions",
            EventsAuth::Internal => "internal/sessions",
        };
        let url = format!(
            "{}/{path_prefix}/{}/events?limit={limit}&offset={offset}",
            self.base_url, session_id
        );
        match auth {
            EventsAuth::Jwt(jwt) => self.get_authed(&url, jwt).await,
            EventsAuth::Internal => self.get_internal(&url).await,
        }
    }

    /// Shared pagination body for the authed and internal event-listing
    /// variants. When `limit` is `Some`, a single page is returned;
    /// when `None`, it pages through aura-storage until a short page
    /// signals exhaustion so callers loading the full history never
    /// silently truncate at the server-side default page size. The only
    /// difference between the two public entry points is the
    /// [`EventsAuth`] mode — this loop is never duplicated.
    async fn list_all_events(
        &self,
        session_id: &str,
        auth: EventsAuth<'_>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        if let Some(limit_val) = limit {
            return self
                .list_events_page(session_id, &auth, limit_val, offset.unwrap_or(0))
                .await;
        }

        const PAGE_SIZE: u32 = 500;
        let mut all_events = Vec::new();
        let mut next_offset = offset.unwrap_or(0);

        loop {
            let page = self
                .list_events_page(session_id, &auth, PAGE_SIZE, next_offset)
                .await?;
            let page_len = page.len() as u32;
            all_events.extend(page);
            if page_len < PAGE_SIZE {
                break;
            }
            next_offset += page_len;
        }

        Ok(all_events)
    }

    pub async fn create_event(
        &self,
        session_id: &str,
        jwt: &str,
        req: &CreateSessionEventRequest,
    ) -> Result<StorageSessionEvent, StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.post_authed(
            &format!("{}/api/sessions/{}/events", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    /// List session events with the caller's JWT. When `limit` is
    /// `None`, the full history is loaded by paging until exhaustion
    /// (aura-storage would otherwise cap an omitted `limit` at 100
    /// server-side, silently truncating long sessions).
    pub async fn list_events(
        &self,
        session_id: &str,
        jwt: &str,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        self.list_all_events(session_id, EventsAuth::Jwt(jwt), limit, offset)
            .await
    }

    /// Internal-token variant of [`Self::list_events`] that loads a
    /// session's full event history without a caller JWT. Used by the
    /// unauthenticated public-share read path, where aura-os-server
    /// reads the shared session with its own `X-Internal-Token`. Shares
    /// the exact pagination body ([`Self::list_all_events`]) with the
    /// authed variant, so the page-fetch loop lives in one place.
    pub async fn list_events_internal(
        &self,
        session_id: &str,
    ) -> Result<Vec<StorageSessionEvent>, StorageError> {
        self.list_all_events(session_id, EventsAuth::Internal, None, None)
            .await
    }
}
