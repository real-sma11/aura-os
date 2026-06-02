//! Pre-recording preflight checks for the demo recorder.
//!
//! Run before any demo window is opened so missing prerequisites surface
//! as an actionable native dialog instead of a window that flashes open
//! and immediately produces an empty file. Currently:
//! - ffmpeg must be launchable (all platforms);
//! - macOS Screen Recording (TCC) permission must be granted.
//!
//! The start route is fire-and-forget from the chat input, so a native
//! dialog is the clearest way to explain why nothing happened; each check
//! both shows the dialog and returns the reason string to the caller.

use tracing::warn;

use super::tools;

// CoreGraphics screen-recording (TCC) preflight. `CGPreflightScreenCaptureAccess`
// is a side-effect-free query that reports whether this process already has
// Screen Recording permission, without prompting. macOS-only; on other
// platforms screen capture needs no such permission.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Run all demo-recording preflight checks. Returns `Err(message)` with a
/// user-facing reason (a native error dialog is also shown) when a check
/// fails, so the caller aborts before opening the demo window.
pub(crate) async fn run_demo_preflight() -> Result<(), String> {
    ensure_ffmpeg_available().await?;
    ensure_screen_recording_permission().await?;
    Ok(())
}

/// Verify ffmpeg can be launched (probe runs off the async executor via
/// `spawn_blocking`). On failure, show the install / `AURA_FFMPEG_BIN`
/// guidance dialog and return the reason.
async fn ensure_ffmpeg_available() -> Result<(), String> {
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
         Install it (e.g. `winget install Gyan.FFmpeg`) or set the \
         AURA_FFMPEG_BIN environment variable to an ffmpeg executable, \
         then try again."
    );
    warn!(ffmpeg = %ffmpeg.display(), "demo recording preflight failed: ffmpeg unavailable");
    show_error_dialog(message.clone());
    Err(message)
}

/// macOS Screen Recording (TCC) permission check. avfoundation silently
/// records an empty/black file without it, so fail early with a dialog
/// pointing at System Settings. No-op on other platforms.
async fn ensure_screen_recording_permission() -> Result<(), String> {
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
            show_error_dialog(message.clone());
            return Err(message);
        }
    }
    Ok(())
}

/// Show a native, fire-and-forget error dialog explaining a failed
/// preflight check.
fn show_error_dialog(message: String) {
    tokio::spawn(async move {
        rfd::AsyncMessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("AURA — Record Demo")
            .set_description(message)
            .show()
            .await;
    });
}

/// Best-effort macOS Screen Recording permission query (does not prompt).
#[cfg(target_os = "macos")]
fn screen_recording_permission_granted() -> bool {
    // SAFETY: `CGPreflightScreenCaptureAccess` takes no arguments, returns a
    // plain `bool`, and only reads the current TCC authorization state. The
    // symbol is provided by the linked CoreGraphics framework.
    unsafe { CGPreflightScreenCaptureAccess() }
}
