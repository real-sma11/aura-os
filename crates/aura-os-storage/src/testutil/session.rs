use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;

use crate::types::*;

use super::db::{new_id, SharedDb};

#[derive(Debug, Deserialize, Default)]
pub(super) struct SessionListQuery {
    #[serde(default)]
    include_empty: bool,
}

/// Mock parity with aura-storage migration 0014: a session is
/// "non-empty" iff it has at least one row in `session_events`. Real
/// aura-storage maintains `event_count` via an AFTER INSERT trigger;
/// the mock recomputes from `db.events` so tests can seed events in
/// any order without bookkeeping.
fn session_event_count(db: &super::db::MockStorageDb, session_id: &str) -> usize {
    db.events
        .iter()
        .filter(|e| e.session_id.as_deref() == Some(session_id))
        .count()
}

fn session_last_event_at(db: &super::db::MockStorageDb, session_id: &str) -> Option<String> {
    db.events
        .iter()
        .filter(|e| e.session_id.as_deref() == Some(session_id))
        .filter_map(|e| e.created_at.clone())
        .max()
}

/// Stamp `event_count` and `last_event_at` on a clone for the response.
/// Real aura-storage exposes these as columns; here we project them on
/// the way out so the mock matches the wire shape.
fn project_event_stats(
    session: &StorageSession,
    db: &super::db::MockStorageDb,
) -> StorageSession {
    let mut s = session.clone();
    s.event_count = Some(session_event_count(db, &session.id) as u32);
    s.last_event_at = session_last_event_at(db, &session.id);
    s
}

pub(super) async fn create_session(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSessionRequest>,
) -> Json<StorageSession> {
    let session = StorageSession {
        id: new_id(),
        project_agent_id: Some(project_agent_id),
        project_id: Some(req.project_id),
        org_id: req.org_id,
        model: req.model,
        status: req.status.or(Some("active".to_string())),
        context_usage_estimate: req.context_usage_estimate,
        total_input_tokens: Some(0),
        total_output_tokens: Some(0),
        summary_of_previous_context: req.summary_of_previous_context,
        tasks_worked_count: Some(0),
        ended_at: None,
        started_at: Some(Utc::now().to_rfc3339()),
        created_at: Some(Utc::now().to_rfc3339()),
        updated_at: Some(Utc::now().to_rfc3339()),
        event_count: Some(0),
        last_event_at: None,
    };
    let mut db = db.lock().await;
    db.sessions.push(session.clone());
    Json(session)
}

pub(super) async fn get_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageSession>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.sessions
        .iter()
        .find(|s| s.id == session_id)
        .map(|s| project_event_stats(s, &db))
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn update_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateSessionRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(session) = db.sessions.iter_mut().find(|s| s.id == session_id) {
        if let Some(status) = req.status {
            session.status = Some(status);
        }
        if let Some(total_input_tokens) = req.total_input_tokens {
            session.total_input_tokens = Some(total_input_tokens);
        }
        if let Some(total_output_tokens) = req.total_output_tokens {
            session.total_output_tokens = Some(total_output_tokens);
        }
        if let Some(usage) = req.context_usage_estimate {
            session.context_usage_estimate = Some(usage);
        }
        if let Some(summary) = req.summary_of_previous_context {
            session.summary_of_previous_context = Some(summary);
        }
        if let Some(count) = req.tasks_worked_count {
            session.tasks_worked_count = Some(count);
        }
        if let Some(ended) = req.ended_at {
            session.ended_at = Some(ended);
        }
        session.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn list_sessions(
    Path(project_agent_id): Path<String>,
    Query(query): Query<SessionListQuery>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSession>> {
    let db = db.lock().await;
    let mut out: Vec<StorageSession> = db
        .sessions
        .iter()
        .filter(|s| s.project_agent_id.as_deref() == Some(project_agent_id.as_str()))
        .map(|s| project_event_stats(s, &db))
        .filter(|s| query.include_empty || s.event_count.unwrap_or(0) > 0)
        .collect();
    out.sort_by(|a, b| {
        b.last_event_at
            .clone()
            .unwrap_or_default()
            .cmp(&a.last_event_at.clone().unwrap_or_default())
            .then_with(|| {
                b.started_at
                    .clone()
                    .unwrap_or_default()
                    .cmp(&a.started_at.clone().unwrap_or_default())
            })
    });
    Json(out)
}

pub(super) async fn list_project_sessions(
    Path(project_id): Path<String>,
    Query(query): Query<SessionListQuery>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSession>> {
    let db = db.lock().await;
    let mut out: Vec<StorageSession> = db
        .sessions
        .iter()
        .filter(|s| s.project_id.as_deref() == Some(project_id.as_str()))
        .map(|s| project_event_stats(s, &db))
        .filter(|s| query.include_empty || s.event_count.unwrap_or(0) > 0)
        .collect();
    out.sort_by(|a, b| {
        b.last_event_at
            .clone()
            .unwrap_or_default()
            .cmp(&a.last_event_at.clone().unwrap_or_default())
            .then_with(|| {
                b.started_at
                    .clone()
                    .unwrap_or_default()
                    .cmp(&a.started_at.clone().unwrap_or_default())
            })
    });
    Json(out)
}

pub(super) async fn delete_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.sessions.len();
    db.sessions.retain(|s| s.id != session_id);
    if db.sessions.len() < len_before {
        db.events
            .retain(|e| e.session_id.as_deref() != Some(session_id.as_str()));
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}
