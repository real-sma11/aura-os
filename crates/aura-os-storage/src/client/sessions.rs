use crate::error::StorageError;
use crate::types::*;

use super::{validate_url_id, StorageClient};

impl StorageClient {
    pub async fn create_session(
        &self,
        project_agent_id: &str,
        jwt: &str,
        req: &CreateSessionRequest,
    ) -> Result<StorageSession, StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.post_authed(
            &format!(
                "{}/api/project-agents/{}/sessions",
                self.base_url, project_agent_id
            ),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_sessions(
        &self,
        project_agent_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSession>, StorageError> {
        validate_url_id(project_agent_id, "project_agent_id")?;
        self.get_authed(
            &format!(
                "{}/api/project-agents/{}/sessions",
                self.base_url, project_agent_id
            ),
            jwt,
        )
        .await
    }

    /// Project-scoped session list. Backed by the indexed
    /// `idx_sessions_project_recent` partial index in aura-storage
    /// (migration 0014). Replaces aura-os-server's old per-agent
    /// fan-out: it used to call `list_project_agents` and then
    /// `list_sessions(agent)` once per project-agent in a sequential
    /// loop, then drop empty rows via N `list_events?limit=1` probes —
    /// now it's a single indexed `WHERE project_id = $1 AND event_count > 0`.
    pub async fn list_project_sessions(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<Vec<StorageSession>, StorageError> {
        validate_url_id(project_id, "project_id")?;
        self.get_authed(
            &format!("{}/api/projects/{}/sessions", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn get_session(
        &self,
        session_id: &str,
        jwt: &str,
    ) -> Result<StorageSession, StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.get_authed(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
        )
        .await
    }

    pub async fn update_session(
        &self,
        session_id: &str,
        jwt: &str,
        req: &UpdateSessionRequest,
    ) -> Result<(), StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.put_authed_no_response(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_session(&self, session_id: &str, jwt: &str) -> Result<(), StorageError> {
        validate_url_id(session_id, "session_id")?;
        self.delete_authed(
            &format!("{}/api/sessions/{}", self.base_url, session_id),
            jwt,
        )
        .await
    }
}
