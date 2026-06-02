//! Pre-recording preflight checks for the demo recorder.
//!
//! Run before any demo window is opened so missing prerequisites surface
//! as an actionable in-app setup prompt instead of a window that flashes
//! open and immediately produces an empty file. Currently:
//! - ffmpeg must be launchable (all platforms);
//! - macOS Screen Recording (TCC) permission must be granted.
//!
//! Each check returns a structured [`PreflightFailure`] (machine-readable
//! `kind` + human message) that the start route serializes to the chat UI,
//! which renders a self-service setup modal (locate ffmpeg / open System
//! Settings + retry).

use tracing::warn;

use super::tools;

/// Machine-readable cause of a failed preflight check. Mirrored by the
/// frontend (`StartDemoRecordingResponse.kind`) so the setup modal can show
/// the right remediation flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreflightKind {
    /// ffmpeg could not be launched (missing binary / bad `AURA_FFMPEG_BIN`).
    FfmpegMissing,
    /// macOS Screen Recording (TCC) permission has not been granted.
    /// Only constructed on macOS; benign dead code on other platforms.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    ScreenRecordingPermission,
}

impl PreflightKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            PreflightKind::FfmpegMissing => "ffmpeg_missing",
            PreflightKind::ScreenRecordingPermission => "screen_recording_permission",
        }
    }
}

/// A failed preflight check: a machine-readable `kind` plus a user-facing
/// `message`. Returned to the caller so the chat UI can render an in-app
/// setup prompt instead of silently doing nothing.
#[derive(Debug, Clone)]
pub(crate) struct PreflightFailure {
    pub(crate) kind: PreflightKind,
    pub(crate) message: String,
}

// CoreGraphics screen-recording (TCC) preflight. `CGPreflightScreenCaptureAccess`
// is a side-effect-free query that reports whether this process already has
// Screen Recording permission, without prompting. macOS-only; on other
// platforms screen capture needs no such permission.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Run all demo-recording preflight checks. Returns `Err(PreflightFailure)`
/// (machine-readable `kind` + user-facing message) when a check fails, so
/// the caller aborts before opening the demo window and the chat UI can
/// render a self-service setup prompt.
pub(crate) async fn run_demo_preflight() -> Result<(), PreflightFailure> {
    ensure_ffmpeg_available().await?;
    ensure_screen_recording_permission().await?;
    Ok(())
}

/// Verify ffmpeg can be launched (probe runs off the async executor via
/// `spawn_blocking`). On failure, return the install / `AURA_FFMPEG_BIN`
/// guidance so the in-app setup modal can offer to locate ffmpeg.
async fn ensure_ffmpeg_available() -> Result<(), PreflightFailure> {
    let ffmpeg = tools::resolve_ffmpeg_binary();
    let probe = {
        let ffmpeg = ffmpeg.clone();
        tokio::task::spawn_blocking(move || tools::probe_ffmpeg(&ffmpeg)).await
    };
    let Err(reason) = probe.unwrap_or_else(|join_error| Err(join_error.to_string())) else {
        return Ok(());
    };
    let message = format!(
        "Demo recording needs ffmpeg, which isn't available ({reason}). \
         Install it (e.g. `winget install Gyan.FFmpeg`) or point AURA at an \
         existing ffmpeg executable, then try again."
    );
    warn!(ffmpeg = %ffmpeg.display(), "demo recording preflight failed: ffmpeg unavailable");
    Err(PreflightFailure {
        kind: PreflightKind::FfmpegMissing,
        message,
    })
}

/// macOS Screen Recording (TCC) permission check. avfoundation silently
/// records an empty/black file without it, so fail early with guidance
/// pointing at System Settings. No-op on other platforms.
async fn ensure_screen_recording_permission() -> Result<(), PreflightFailure> {
    #[cfg(target_os = "macos")]
    {
        let granted = tokio::task::spawn_blocking(screen_recording_permission_granted)
            .await
            .unwrap_or(false);
        if !granted {
            let message = "Demo recording needs Screen Recording permission. \
                 Open System Settings > Privacy & Security > Screen Recording, \
                 enable AURA, then try again."
                .to_string();
            warn!("demo recording preflight failed: screen recording permission not granted");
            return Err(PreflightFailure {
                kind: PreflightKind::ScreenRecordingPermission,
                message,
            });
        }
    }
    Ok(())
}

/// Best-effort macOS Screen Recording permission query (does not prompt).
#[cfg(target_os = "macos")]
fn screen_recording_permission_granted() -> bool {
    // SAFETY: `CGPreflightScreenCaptureAccess` takes no arguments, returns a
    // plain `bool`, and only reads the current TCC authorization state. The
    // symbol is provided by the linked CoreGraphics framework.
    unsafe { CGPreflightScreenCaptureAccess() }
}
