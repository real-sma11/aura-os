use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use aura_os_store::SettingsStore;

const CF_NAME: &str = "bug_reports";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BugReport {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub user_id: String,
    pub network_user_id: Option<String>,
    pub display_name: String,
    pub description: String,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub diagnostics: serde_json::Value,
    pub llm_summary: Option<String>,
    pub status: String,
    pub consent: bool,
    pub consent_version: Option<String>,
    pub consented_at: Option<DateTime<Utc>>,
    /// Public feedback post this report is associated with, if the user
    /// also filed a public Feedback item. Drives the feedback status
    /// reflection on fix-task create / completion.
    #[serde(default)]
    pub feedback_post_id: Option<String>,
    /// Fix task created from this report (Phase 4), resolvable from both
    /// sides: the task carries a `bug_report_id` marker in its
    /// description and the report carries the task id here.
    #[serde(default)]
    pub linked_task_id: Option<String>,
    #[serde(default)]
    pub linked_project_id: Option<String>,
}

pub(crate) struct BugReportStore {
    store: Arc<SettingsStore>,
}

impl BugReportStore {
    pub(crate) fn new(store: Arc<SettingsStore>) -> Self {
        Self { store }
    }

    pub(crate) fn get(&self, id: &Uuid) -> Result<Option<BugReport>, String> {
        let key = id.to_string();
        match self.store.get_cf_bytes(CF_NAME, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let report = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                Ok(Some(report))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<BugReport>, String> {
        let mut results: Vec<BugReport> =
            self.store.scan_cf_all(CF_NAME).map_err(|e| e.to_string())?;
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(results)
    }

    pub(crate) fn put(&self, record: &BugReport) -> Result<(), String> {
        let key = record.id.to_string();
        let bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_NAME, key.as_bytes(), &bytes)
            .map_err(|e| e.to_string())
    }
}
