//! Demo recorder feature.
//!
//! Orchestrates: open a dedicated AURA window, drive it to run a
//! user-supplied instruction through the normal chat UI (so the agent
//! uses its real tools, including the in-app browser), screen-record the
//! window with ffmpeg, and finalize an `.mp4` the user gets back.
//!
//! This module owns the shared recording registry (status reads for the
//! HTTP API), the ffmpeg binary resolver ([`tools`]), and the capture
//! process wrapper ([`recorder`]). The window lifecycle / driving lives
//! in [`crate::ui::runtime`] because it needs the `tao` event loop and
//! the per-window `wry::WebView` handles.

pub(crate) mod recorder;
pub(crate) mod tools;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Native window title for the demo window. Deliberately distinct from
/// the channel window title ("AURA" / "AURA Dev") so the ffmpeg
/// `gdigrab` `title=` selector targets only this window even when other
/// AURA windows are open.
pub(crate) const DEMO_WINDOW_TITLE: &str = "AURA Demo Recording";

/// JS global injected (per-window) into the demo window's init script so
/// the frontend demo bridge knows it is the recording window and which
/// recording id it belongs to.
pub(crate) const DEMO_MARKER_GLOBAL: &str = "__AURA_DEMO_RECORDING__";

/// Default / bounds for the maximum recording duration guard.
pub(crate) const DEFAULT_MAX_SECONDS: u64 = 300;
pub(crate) const MIN_MAX_SECONDS: u64 = 10;
pub(crate) const MAX_MAX_SECONDS: u64 = 1800;

/// Capture framerate.
pub(crate) const RECORDING_FPS: u32 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DemoPhase {
    /// Window requested; waiting for the frontend bridge to be ready.
    Starting,
    /// ffmpeg is capturing and the instruction is running.
    Recording,
    /// Instruction finished; ffmpeg is writing the final file.
    Finalizing,
    /// Done; `output_path` points at the playable `.mp4`.
    Completed,
    /// Something went wrong; see `error`.
    Failed,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct DemoRecordingState {
    pub phase: DemoPhase,
    pub instruction: String,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

impl DemoRecordingState {
    pub(crate) fn new(instruction: String) -> Self {
        Self {
            phase: DemoPhase::Starting,
            instruction,
            output_path: None,
            error: None,
        }
    }
}

/// Shared map of recording id -> state. Mutated by both the HTTP handler
/// (insert on start, read on status) and the event loop (phase
/// transitions as the recording progresses).
pub(crate) type DemoRegistry = Arc<Mutex<HashMap<String, DemoRecordingState>>>;

pub(crate) fn new_registry() -> DemoRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

fn with_entry<F: FnOnce(&mut DemoRecordingState)>(registry: &DemoRegistry, id: &str, edit: F) {
    if let Ok(mut map) = registry.lock() {
        if let Some(entry) = map.get_mut(id) {
            edit(entry);
        }
    }
}

pub(crate) fn insert_starting(registry: &DemoRegistry, id: &str, instruction: String) {
    if let Ok(mut map) = registry.lock() {
        map.insert(id.to_string(), DemoRecordingState::new(instruction));
    }
}

pub(crate) fn set_phase(registry: &DemoRegistry, id: &str, phase: DemoPhase) {
    with_entry(registry, id, |entry| entry.phase = phase);
}

pub(crate) fn set_recording(registry: &DemoRegistry, id: &str, output_path: &Path) {
    with_entry(registry, id, |entry| {
        entry.phase = DemoPhase::Recording;
        entry.output_path = Some(output_path.to_string_lossy().into_owned());
    });
}

pub(crate) fn set_completed(registry: &DemoRegistry, id: &str, output_path: &Path) {
    with_entry(registry, id, |entry| {
        entry.phase = DemoPhase::Completed;
        entry.output_path = Some(output_path.to_string_lossy().into_owned());
    });
}

pub(crate) fn set_failed(registry: &DemoRegistry, id: &str, error: impl Into<String>) {
    let error = error.into();
    with_entry(registry, id, |entry| {
        entry.phase = DemoPhase::Failed;
        entry.error = Some(error);
    });
}

pub(crate) fn snapshot(registry: &DemoRegistry, id: &str) -> Option<DemoRecordingState> {
    registry.lock().ok().and_then(|map| map.get(id).cloned())
}

/// Generate a unique recording id (timestamp-based; single desktop
/// process so collisions are not a concern).
pub(crate) fn new_recording_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("demo-{nanos}")
}

/// Absolute path the recording for `id` is written to under the data
/// directory's `recordings/` folder.
pub(crate) fn recording_output_path(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("recordings").join(format!("{id}.mp4"))
}

/// Clamp a caller-supplied max-duration into the supported range.
pub(crate) fn clamp_max_seconds(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(DEFAULT_MAX_SECONDS)
        .clamp(MIN_MAX_SECONDS, MAX_MAX_SECONDS)
}
