use axum::routing::get;
use axum::Router;

use crate::handlers::preferences;
use crate::state::AppState;

pub(super) fn preferences_routes() -> Router<AppState> {
    Router::new().route(
        "/api/preferences/agent-order",
        get(preferences::get_agent_order).put(preferences::put_agent_order),
    )
}
