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
mod composite;

pub(crate) use capture::{start_region_recording, ActiveRecording, CaptureRegion};
pub(crate) use composite::{composite_and_encode, CompositeArgs};

use std::path::Path;
use tracing::{info, warn};

use super::tools::{resolve_background_image, resolve_ffmpeg_binary};
use super::{set_completed, set_failed, DemoRegistry};

/// Off-thread finalize: wait for the stage-1 capture to flush its
/// trailer, run the stage-2 composite into the final clip (falling back
/// to the raw capture if compositing fails), open the result, and drive
/// the registry phase to `Completed`/`Failed`.
///
/// Blocking; spawn this on a background thread.
pub(crate) fn finalize_recording(
    registry: &DemoRegistry,
    recording_id: &str,
    recording: ActiveRecording,
    intermediate_path: &Path,
    output_path: &Path,
) {
    if let Err(error) = recording.wait() {
        set_failed(registry, recording_id, error);
        return;
    }
    if !intermediate_path.exists() {
        set_failed(
            registry,
            recording_id,
            "recording finished but no output file was produced",
        );
        return;
    }

    produce_final_clip(intermediate_path, output_path);

    if output_path.exists() {
        info!(path = %output_path.display(), "demo recording completed");
        set_completed(registry, recording_id, output_path);
        // Surface the result immediately by opening it.
        let _ = open::that(output_path);
    } else {
        set_failed(registry, recording_id, "failed to produce final demo clip");
    }
}

/// Run the stage-2 composite; on success drop the now-redundant
/// intermediate, on failure fall back to the raw capture so the user
/// still gets a playable file.
fn produce_final_clip(intermediate_path: &Path, output_path: &Path) {
    let ffmpeg = resolve_ffmpeg_binary();
    let background = resolve_background_image();
    let args = CompositeArgs {
        ffmpeg: &ffmpeg,
        window_mp4: intermediate_path,
        background: background.as_deref(),
        output: output_path,
    };

    match composite_and_encode(&args) {
        Ok(()) => {
            let _ = std::fs::remove_file(intermediate_path);
        }
        Err(error) => {
            warn!(%error, "composite failed; falling back to raw window capture");
            fallback_copy_intermediate(intermediate_path, output_path);
        }
    }
}

/// Move (or copy, if a cross-device rename fails) the intermediate
/// capture to the final path so the user still receives a clip when the
/// composite stage fails.
fn fallback_copy_intermediate(intermediate_path: &Path, output_path: &Path) {
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
