//! Demo recorder: a two-stage `ffmpeg` pipeline.
//!
//! - Stage 1 ([`capture`]): screen-capture the demo window's outer rect
//!   into a high-quality intermediate `window.mp4`.
//! - Stage 2 ([`composite`]): frame that capture onto a background with
//!   rounded corners + a drop shadow and encode an X-ready MP4.
//!
//! [`mod.rs`](self) re-exports the public API and holds the off-thread
//! finalize orchestration that ties the two stages together.

mod capture;
#[cfg(target_os = "windows")]
mod capture_wgc;
mod composite;

pub(crate) use capture::{start_region_recording, ActiveRecording, CaptureRegion};
#[cfg(target_os = "windows")]
pub(crate) use capture_wgc::start_window_recording;
pub(crate) use composite::{composite_and_encode, CompositeArgs};

use std::path::{Path, PathBuf};
use tracing::{info, warn};

use super::tools::resolve_ffmpeg_binary;
use super::{set_completed, set_failed, DemoRegistry};

/// Borrowed configuration for [`finalize_recording`] (kept to a single
/// struct to respect the 5-parameter limit). Carries the registry/ids
/// plus the per-recording decisions derived from `DemoOptions`.
pub(crate) struct FinalizeArgs<'a> {
    pub(crate) registry: &'a DemoRegistry,
    pub(crate) recording_id: &'a str,
    /// Stage-1 window/full-screen capture.
    pub(crate) intermediate_path: &'a Path,
    /// Final clip the user receives.
    pub(crate) output_path: &'a Path,
    /// When `true`, run the stage-2 composite; when `false` (full-screen
    /// capture or `DemoTarget::Raw`), promote the stage-1 capture directly
    /// to the final file.
    pub(crate) composite: bool,
    /// Background source for the composite (ignored when `composite` is
    /// `false`). `None` => generated-gradient fallback.
    pub(crate) background: Option<PathBuf>,
}

/// Off-thread finalize: wait for the stage-1 capture to flush its
/// trailer, run the stage-2 composite into the final clip (falling back
/// to the raw capture if compositing fails) — or, when compositing is
/// disabled, promote the capture directly — then open the result and
/// drive the registry phase to `Completed`/`Failed`.
///
/// Blocking; spawn this on a background thread.
pub(crate) fn finalize_recording(recording: ActiveRecording, args: &FinalizeArgs) {
    if let Err(error) = recording.wait() {
        set_failed(args.registry, args.recording_id, error);
        return;
    }
    if !args.intermediate_path.exists() {
        set_failed(
            args.registry,
            args.recording_id,
            "recording finished but no output file was produced",
        );
        return;
    }

    produce_final_clip(args);

    if args.output_path.exists() {
        info!(path = %args.output_path.display(), "demo recording completed");
        set_completed(args.registry, args.recording_id, args.output_path);
        // Surface the result immediately by opening it.
        let _ = open::that(args.output_path);
    } else {
        set_failed(
            args.registry,
            args.recording_id,
            "failed to produce final demo clip",
        );
    }
}

/// Produce the final clip: run the stage-2 composite when requested
/// (dropping the now-redundant intermediate on success, falling back to
/// the raw capture on failure), otherwise promote the stage-1 capture
/// directly to the final path.
fn produce_final_clip(args: &FinalizeArgs) {
    if !args.composite {
        promote_intermediate(args.intermediate_path, args.output_path);
        return;
    }

    let ffmpeg = resolve_ffmpeg_binary();
    let composite_args = CompositeArgs {
        ffmpeg: &ffmpeg,
        window_mp4: args.intermediate_path,
        background: args.background.as_deref(),
        output: args.output_path,
    };

    match composite_and_encode(&composite_args) {
        Ok(()) => {
            let _ = std::fs::remove_file(args.intermediate_path);
        }
        Err(error) => {
            warn!(%error, "composite failed; falling back to raw window capture");
            promote_intermediate(args.intermediate_path, args.output_path);
        }
    }
}

/// Move (or copy, if a cross-device rename fails) the intermediate
/// capture to the final path. Used both as the composite-failure fallback
/// and as the deliberate path when compositing is disabled.
fn promote_intermediate(intermediate_path: &Path, output_path: &Path) {
    if std::fs::rename(intermediate_path, output_path).is_ok() {
        return;
    }
    if let Err(error) = std::fs::copy(intermediate_path, output_path) {
        warn!(%error, "failed to copy intermediate recording to final path");
    }
}

/// Apply `CREATE_NO_WINDOW` so ffmpeg does not flash a console window
/// during a recording the user is watching. Shared by both stages.
#[cfg(target_os = "windows")]
pub(super) fn apply_no_window_flag(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}
