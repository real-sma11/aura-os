use super::*;

use crate::state::{WsTicketStore, WS_TICKET_TTL};

/// Extract a bearer JWT from the `Authorization: Bearer` header.
///
/// This is the only header-based path. URL-based clients (native
/// `WebSocket`, `<img>`) that cannot set headers no longer pass the raw
/// JWT as `?token=` — they mint a short-lived ticket via
/// `POST /api/auth/ws-ticket` and present it as `?ticket=`, which the
/// guard redeems via [`redeem_ws_ticket`]. Keeping long-lived tokens out
/// of URLs keeps them out of proxy/platform access logs.
pub(super) fn extract_request_token(req: &Request) -> Option<String> {
    req.headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|val| val.strip_prefix("Bearer "))
        .map(|token| token.to_string())
}

/// Extract a `?ticket=` connect ticket from the request query string.
/// Used by WebSocket / `<img>` connections that can't send a header.
pub(super) fn extract_ws_ticket(req: &Request) -> Option<String> {
    req.uri()
        .query()
        .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("ticket=")))
        .map(|t| t.to_string())
}

/// Redeem a connect ticket for the JWT it was minted against.
///
/// Single-use: the entry is removed (burned) on lookup regardless of
/// outcome, so a leaked ticket can never be replayed even within its TTL
/// window. Returns `None` if the ticket is unknown or expired.
pub(super) fn redeem_ws_ticket(store: &WsTicketStore, ticket: &str) -> Option<String> {
    let (_, entry) = store.remove(ticket)?;
    if entry.created_at.elapsed() >= WS_TICKET_TTL {
        return None;
    }
    Some(entry.jwt)
}
