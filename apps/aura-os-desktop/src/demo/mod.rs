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

pub(crate) mod preflight;
pub(crate) mod recorder;
pub(crate) mod tools;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::warn;

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

/// Default logical size of the demo window. The window is centered on the
/// current monitor and its outer rect is captured (rather than the whole
/// monitor) so stage-2 can frame just the app on a background. Kept below
/// the composite canvas size to avoid upscaling the capture.
pub(crate) const DEFAULT_WINDOW_WIDTH: u32 = 1600;
pub(crate) const DEFAULT_WINDOW_HEIGHT: u32 = 1000;

/// Sane bounds for a caller-supplied window size, in logical px. Dims are
/// clamped into this range and forced even (libx264 + yuv420p require even
/// dimensions for the downstream capture/encode).
const MIN_WINDOW_WIDTH: u32 = 320;
const MAX_WINDOW_WIDTH: u32 = 3840;
const MIN_WINDOW_HEIGHT: u32 = 240;
const MAX_WINDOW_HEIGHT: u32 = 2160;

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

/// Absolute path the final (framed, X-ready) recording for `id` is
/// written to under the data directory's `recordings/` folder.
pub(crate) fn recording_output_path(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("recordings").join(format!("{id}.mp4"))
}

/// Absolute path of the stage-1 window-only capture: the intermediate
/// `recordings/{id}.window.mp4` that the stage-2 composite reads to
/// produce [`recording_output_path`]. Kept distinct so the registry's
/// advertised `output_path` (the final clip) is unchanged.
pub(crate) fn intermediate_output_path(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("recordings").join(format!("{id}.window.mp4"))
}

/// Clamp a caller-supplied max-duration into the supported range.
pub(crate) fn clamp_max_seconds(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(DEFAULT_MAX_SECONDS)
        .clamp(MIN_MAX_SECONDS, MAX_MAX_SECONDS)
}

/// Final output format for a recording.
#[derive(Clone, Debug)]
pub(crate) enum DemoTarget {
    /// Framed, X-ready composite (the default): stage-1 capture is
    /// composited onto a background and re-encoded for upload.
    X,
    /// Raw deliverable: keep the stage-1 capture and skip the stage-2
    /// composite. Phase 2 treats this as "minimal re-encode" by simply
    /// promoting the intermediate capture to the final file.
    Raw,
}

/// Background source for the stage-2 composite.
#[derive(Clone, Debug)]
pub(crate) enum DemoBackground {
    /// Bundled default image, falling back to a generated gradient when
    /// no asset is present (see [`tools::resolve_background_image`]).
    Default,
    /// An explicit, already-validated on-disk image path.
    Path(PathBuf),
}

impl DemoBackground {
    /// Resolve the background to a concrete image path for the compositor,
    /// or `None` to signal the generated-gradient fallback.
    pub(crate) fn resolve(&self) -> Option<PathBuf> {
        match self {
            DemoBackground::Default => tools::resolve_background_image(),
            DemoBackground::Path(path) => Some(path.clone()),
        }
    }
}

/// Validated, ready-to-use configuration for a single demo recording.
/// Constructed at the HTTP boundary via [`DemoOptions::from_input`] so the
/// event loop never sees unvalidated caller input.
#[derive(Clone, Debug)]
pub(crate) struct DemoOptions {
    /// Logical width of the demo window (clamped + forced even).
    pub(crate) window_width: u32,
    /// Logical height of the demo window (clamped + forced even).
    pub(crate) window_height: u32,
    pub(crate) target: DemoTarget,
    pub(crate) background: DemoBackground,
    /// When `true`, capture the window's outer rect and frame it on a
    /// background (stage-2 composite). When `false`, capture the whole
    /// monitor full-screen and skip compositing.
    pub(crate) window_on_background: bool,
    pub(crate) max_seconds: u64,
}

impl Default for DemoOptions {
    fn default() -> Self {
        Self {
            window_width: DEFAULT_WINDOW_WIDTH,
            window_height: DEFAULT_WINDOW_HEIGHT,
            target: DemoTarget::X,
            background: DemoBackground::Default,
            window_on_background: true,
            max_seconds: DEFAULT_MAX_SECONDS,
        }
    }
}

/// Raw, unvalidated option fields as they arrive from the HTTP boundary.
/// Every field is optional so omitted fields fall back to the X-ready
/// defaults in [`DemoOptions::default`].
#[derive(Default)]
pub(crate) struct DemoOptionsInput {
    pub(crate) window_width: Option<u32>,
    pub(crate) window_height: Option<u32>,
    /// `"x"` (default) or `"raw"`; anything else falls back to `X`.
    pub(crate) target: Option<String>,
    /// A custom background image path; absent/empty/missing => Default.
    pub(crate) background: Option<String>,
    pub(crate) window_on_background: Option<bool>,
    pub(crate) max_seconds: Option<u64>,
}

impl DemoOptions {
    /// Validate and clamp raw caller input into ready-to-use options.
    pub(crate) fn from_input(input: DemoOptionsInput) -> Self {
        let defaults = DemoOptions::default();
        DemoOptions {
            window_width: input
                .window_width
                .map(clamp_window_width)
                .unwrap_or(defaults.window_width),
            window_height: input
                .window_height
                .map(clamp_window_height)
                .unwrap_or(defaults.window_height),
            target: parse_target(input.target.as_deref()),
            background: resolve_background_option(input.background.as_deref()),
            window_on_background: input.window_on_background.unwrap_or(true),
            max_seconds: clamp_max_seconds(input.max_seconds),
        }
    }
}

/// Clamp `value` into `[min, max]` and force it even.
fn clamp_even(value: u32, min: u32, max: u32) -> u32 {
    value.clamp(min, max) & !1
}

fn clamp_window_width(value: u32) -> u32 {
    clamp_even(value, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH)
}

fn clamp_window_height(value: u32) -> u32 {
    clamp_even(value, MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT)
}

/// Parse the target string into a [`DemoTarget`], defaulting to `X` for
/// absent or unrecognized values.
fn parse_target(raw: Option<&str>) -> DemoTarget {
    match raw
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("raw") => DemoTarget::Raw,
        _ => DemoTarget::X,
    }
}

/// Map a custom background path into a [`DemoBackground`], validating that
/// the file exists. A missing/empty/non-existent path falls back to the
/// bundled default rather than failing the recording.
fn resolve_background_option(raw: Option<&str>) -> DemoBackground {
    let Some(trimmed) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return DemoBackground::Default;
    };
    let path = PathBuf::from(trimmed);
    if path.is_file() {
        DemoBackground::Path(path)
    } else {
        warn!(path = %path.display(), "demo background path not found; using default");
        DemoBackground::Default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_x_ready() {
        let options = DemoOptions::default();
        assert_eq!(options.window_width, DEFAULT_WINDOW_WIDTH);
        assert_eq!(options.window_height, DEFAULT_WINDOW_HEIGHT);
        assert!(options.window_on_background);
        assert!(matches!(options.target, DemoTarget::X));
        assert!(matches!(options.background, DemoBackground::Default));
        assert_eq!(options.max_seconds, DEFAULT_MAX_SECONDS);
    }

    #[test]
    fn window_dims_are_clamped_and_even() {
        let tiny = DemoOptions::from_input(DemoOptionsInput {
            window_width: Some(10),
            window_height: Some(11),
            ..Default::default()
        });
        assert_eq!(tiny.window_width, MIN_WINDOW_WIDTH);
        assert_eq!(tiny.window_height, MIN_WINDOW_HEIGHT);

        let odd = DemoOptions::from_input(DemoOptionsInput {
            window_width: Some(1281),
            window_height: Some(721),
            ..Default::default()
        });
        assert_eq!(odd.window_width % 2, 0);
        assert_eq!(odd.window_height % 2, 0);

        let huge = DemoOptions::from_input(DemoOptionsInput {
            window_width: Some(99_999),
            window_height: Some(99_999),
            ..Default::default()
        });
        assert_eq!(huge.window_width, MAX_WINDOW_WIDTH);
        assert_eq!(huge.window_height, MAX_WINDOW_HEIGHT);
    }

    #[test]
    fn target_parsing_defaults_to_x() {
        assert!(matches!(parse_target(Some("raw")), DemoTarget::Raw));
        assert!(matches!(parse_target(Some("RAW")), DemoTarget::Raw));
        assert!(matches!(parse_target(Some("x")), DemoTarget::X));
        assert!(matches!(parse_target(Some("nonsense")), DemoTarget::X));
        assert!(matches!(parse_target(None), DemoTarget::X));
    }

    #[test]
    fn missing_background_path_falls_back_to_default() {
        let background = resolve_background_option(Some("   "));
        assert!(matches!(background, DemoBackground::Default));
        let missing = resolve_background_option(Some("/no/such/file/xyz.png"));
        assert!(matches!(missing, DemoBackground::Default));
    }
}
