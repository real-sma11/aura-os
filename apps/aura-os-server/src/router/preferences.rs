use axum::routing::get;
use axum::Router;

use crate::handlers::preferences;
use crate::state::AppState;

pub(super) fn preferences_routes() -> Router<AppState> {
    Router::new().route(
        "/api/preferences/theme-overrides",
        get(preferences::get_theme_overrides).put(preferences::put_theme_overrides),
    )
}
