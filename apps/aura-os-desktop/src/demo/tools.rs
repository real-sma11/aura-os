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

/// Bundled-resource candidates for the default demo background image,
/// mirroring [`ffmpeg_resource_candidates`]'s directory patterns.
fn background_resource_candidates() -> Vec<PathBuf> {
    const ASSET: &str = "demo-bg.png";
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(ASSET),
        PathBuf::from("apps/aura-os-desktop/resources").join(ASSET),
        PathBuf::from("resources").join(ASSET),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(ASSET));
            candidates.push(exe_dir.join("resources").join(ASSET));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources").join(ASSET));
                candidates.push(contents_dir.join("Resources/resources").join(ASSET));
            }
        }
    }

    candidates
}

/// Resolve the bundled demo background image, if present.
///
/// Returns the first existing `resources/demo-bg.png` candidate, or
/// `None` when no asset is bundled — in which case the stage-2
/// compositor falls back to a generated gradient. No binary asset ships
/// yet (Phase 1), so this returns `None` in dev unless one is dropped in.
pub(crate) fn resolve_background_image() -> Option<PathBuf> {
    background_resource_candidates()
        .into_iter()
        .find(|path| path.is_file())
}

/// Resolve the `ffmpeg` executable to launch.
///
/// Returns the first match of: `AURA_FFMPEG_BIN` (if it exists on disk),
/// a bundled `resources/bin` binary, or — as a development convenience —
/// the bare binary name so `std::process::Command` resolves it via
/// `PATH`. The bare-name fallback can still fail to spawn; the recorder
/// surfaces that as a recording error with the resolved path.
///
/// macOS packaging note: this already searches `Contents/Resources/bin`,
/// so a bundled mac binary should be a **universal** (`lipo`-merged
/// arm64 + x86_64) `ffmpeg` so a single app bundle runs natively on both
/// Apple Silicon and Intel. Binary packaging is deferred like the Windows
/// MVP; for dev, `AURA_FFMPEG_BIN` / `PATH` cover both architectures.
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

/// Detect the avfoundation screen-capture device index on macOS.
///
/// Runs `ffmpeg -f avfoundation -list_devices true -i ""`, which prints
/// the device list to stderr and exits non-zero (expected — we ignore the
/// exit status). The bracketed index of the `Capture screen` entry is
/// returned, or `None` on any exec/parse failure so the caller can fall
/// back to a sensible default index. Blocking; call off the async
/// executor.
#[cfg(target_os = "macos")]
pub(crate) fn detect_macos_screen_device(ffmpeg: &Path) -> Option<u32> {
    let output = Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-f")
        .arg("avfoundation")
        .arg("-list_devices")
        .arg("true")
        .arg("-i")
        .arg("")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_screen_device_index(&stderr)
}

/// Pure parser for the `ffmpeg -list_devices` stderr output: find the
/// `AVFoundation video devices` section and return the bracketed index of
/// the first entry whose label contains `Capture screen`
/// (e.g. `[3] Capture screen 0` -> `3`). Returns `None` when no screen
/// device is listed. Kept platform-independent so it is unit-testable on
/// any host.
///
/// Compiled on macOS (where [`detect_macos_screen_device`] calls it) and
/// under `test` (so the parser test runs on every host); on other
/// non-test builds it has no caller, hence the `cfg`.
#[cfg(any(test, target_os = "macos"))]
fn parse_screen_device_index(stderr: &str) -> Option<u32> {
    let mut in_video_section = false;
    for line in stderr.lines() {
        if line.contains("AVFoundation video devices") {
            in_video_section = true;
            continue;
        }
        if line.contains("AVFoundation audio devices") {
            in_video_section = false;
            continue;
        }
        if !in_video_section || !line.contains("Capture screen") {
            continue;
        }
        if let Some(index) = bracketed_index_before(line, "Capture screen") {
            return Some(index);
        }
    }
    None
}

/// Parse the last `[N]` bracket group that appears before `label` in
/// `line`. ffmpeg prefixes each line with `[AVFoundation indev @ 0x..]`,
/// so the *last* bracket before the label is the device index.
#[cfg(any(test, target_os = "macos"))]
fn bracketed_index_before(line: &str, label: &str) -> Option<u32> {
    let label_pos = line.find(label)?;
    let prefix = &line[..label_pos];
    let close = prefix.rfind(']')?;
    let open = prefix[..close].rfind('[')?;
    prefix[open + 1..close].trim().parse::<u32>().ok()
}

#[cfg(test)]
mod tests {
    use super::parse_screen_device_index;

    #[test]
    fn parse_screen_device_finds_capture_screen_index() {
        let stderr = "\
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8] [1] External Camera
[AVFoundation indev @ 0x7f8] [3] Capture screen 0
[AVFoundation indev @ 0x7f8] [4] Capture screen 1
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] MacBook Pro Microphone";
        assert_eq!(parse_screen_device_index(stderr), Some(3));
    }

    #[test]
    fn parse_screen_device_ignores_audio_section_matches() {
        let stderr = "\
[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] FaceTime HD Camera
[AVFoundation indev @ 0x1] AVFoundation audio devices:
[AVFoundation indev @ 0x1] [2] Capture screen audio";
        assert_eq!(parse_screen_device_index(stderr), None);
    }

    #[test]
    fn parse_screen_device_without_indev_prefix() {
        let stderr = "\
AVFoundation video devices:
[0] FaceTime HD Camera
[2] Capture screen 0";
        assert_eq!(parse_screen_device_index(stderr), Some(2));
    }

    #[test]
    fn parse_screen_device_returns_none_when_absent() {
        let stderr = "\
[AVFoundation indev @ 0x1] AVFoundation video devices:
[AVFoundation indev @ 0x1] [0] FaceTime HD Camera";
        assert_eq!(parse_screen_device_index(stderr), None);
    }
}
