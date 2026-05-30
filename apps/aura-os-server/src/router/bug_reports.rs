use axum::routing::{get, post};
use axum::Router;

use crate::handlers::bug_reports;
use crate::state::AppState;

pub(super) fn bug_reports_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/bug-reports",
            get(bug_reports::list_bug_reports).post(bug_reports::create_bug_report),
        )
        .route(
            "/api/bug-reports/mine",
            get(bug_reports::list_my_bug_reports),
        )
        .route("/api/bug-reports/:id", get(bug_reports::get_bug_report))
        .route(
            "/api/bug-reports/:id/fix-task",
            post(bug_reports::create_fix_task),
        )
}
