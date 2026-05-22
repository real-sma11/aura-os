use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::types::*;

#[derive(Debug, Clone, Default)]
pub struct MockStorageDb {
    pub sessions: Vec<StorageSession>,
    pub tasks: Vec<StorageTask>,
    pub specs: Vec<StorageSpec>,
    pub project_agents: Vec<StorageProjectAgent>,
    pub events: Vec<StorageSessionEvent>,
    /// session_id -> user_id ownership map. Real aura-storage stores
    /// `created_by` directly on the `sessions` row and derives the
    /// user_id from the JWT on `/api/me/sessions`. The mock has no
    /// auth, so tests stamp ownership here directly after creating
    /// sessions and the mock's `list_my_sessions` handler reads
    /// it via the `?user=<id>` query param the StorageClient
    /// appends when `AURA_STORAGE_TEST_USER_ID` is set.
    pub session_users: HashMap<String, String>,
}

pub type SharedDb = Arc<Mutex<MockStorageDb>>;

pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
