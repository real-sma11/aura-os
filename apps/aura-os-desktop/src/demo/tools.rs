//! Locate the `ffmpeg` binary used by the demo recorder.
//!
//! Mirrors the resolution strategy of the bundled `aura-node` sidecar in
//! [`crate::harness::binary`]: an explicit `AURA_FFMPEG_BIN` override
//! wins, then a binary bundled next to the desktop app (shipped under
//! `resources/bin/`), and finally a bare-name fallback so a developer
//! with `ffmpeg` on `PATH` works out of the box. Packaging the binary
//! into installs is deferred (Phase 2); the bundled-resource candidates
//! are already wired so dropping `resources/bin/ffmpeg.exe` in is enough.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tracing::warn;

pub(crate) fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn ffmpeg_resource_candidates() -> Vec<PathBuf> {
    let name = ffmpeg_binary_name();
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/bin")
            .join(name),
        PathBuf::from("apps/aura-os-desktop/resources/bin").join(name),
        PathBuf::from("resources/bin").join(name),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(name));
            candidates.push(exe_dir.join("bin").join(name));
            candidates.push(exe_dir.join("resources/bin").join(name));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources/bin").join(name));
                candidates.push(contents_dir.join("Resources/resources/bin").join(name));
            }
        }
    }

    candidates
}

/// Resolve the `ffmpeg` executable to launch.
///
/// Returns the first match of: `AURA_FFMPEG_BIN` (if it exists on disk),
/// a bundled `resources/bin` binary, or — as a development convenience —
/// the bare binary name so `std::process::Command` resolves it via
/// `PATH`. The bare-name fallback can still fail to spawn; the recorder
/// surfaces that as a recording error with the resolved path.
pub(crate) fn resolve_ffmpeg_binary() -> PathBuf {
    if let Ok(explicit) = std::env::var("AURA_FFMPEG_BIN") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.exists() {
                return path;
            }
            warn!(
                path = %path.display(),
                "configured AURA_FFMPEG_BIN does not exist; falling back to bundled/PATH ffmpeg"
            );
        }
    }

    if let Some(bundled) = ffmpeg_resource_candidates()
        .into_iter()
        .find(|path| path.is_file())
    {
        return bundled;
    }

    PathBuf::from(ffmpeg_binary_name())
}

/// Verify that `ffmpeg` can actually be launched by running
/// `ffmpeg -version`. Used as a preflight so a missing/broken ffmpeg
/// fails the recording with an actionable error *before* a demo window
/// is ever shown (otherwise the window would flash open then vanish when
/// the capture spawn fails). Blocking; call from `spawn_blocking`.
pub(crate) fn probe_ffmpeg(ffmpeg: &Path) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("`ffmpeg -version` exited with {status}")),
        Err(error) => Err(format!(
            "could not run ffmpeg at `{}`: {error}",
            ffmpeg.display()
        )),
    }
}
