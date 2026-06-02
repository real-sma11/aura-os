//! Stage-1 screen capture with `ffmpeg`.
//!
//! We capture a fixed screen rectangle (the demo window's outer rect)
//! rather than capturing the window by title. Window capture via GDI
//! `BitBlt` returns black frames for GPU-composited Chromium/WebView2
//! surfaces; capturing the desktop reads the DWM-composited screen
//! output, so hardware-accelerated content is recorded correctly.
//!
//! The output is a high-quality intermediate `window.mp4`; the stage-2
//! [`super::composite`] pass frames it onto a background. The recording
//! is finalized gracefully by writing `q` to ffmpeg's stdin so the MP4
//! trailer (moov atom) is written and the file is playable; if ffmpeg
//! ignores the quit request we fall back to killing it after a short
//! grace period.

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tracing::{info, warn};

/// The screen rectangle (in physical pixels, desktop coordinates) to
/// capture. Typically the outer rect of the centered demo window.
#[derive(Debug, Clone, Copy)]
pub(crate) struct CaptureRegion {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// A running ffmpeg capture process.
pub(crate) struct ActiveRecording {
    child: Child,
}

/// Start capturing the screen `region` into `output` (an `.mp4`).
/// `fps` is the capture framerate.
pub(crate) fn start_region_recording(
    ffmpeg: &Path,
    region: CaptureRegion,
    output: &Path,
    fps: u32,
) -> Result<ActiveRecording, String> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create recordings dir {}: {error}",
                parent.display()
            )
        })?;
    }

    // libx264 + yuv420p require even dimensions.
    let width = region.width.max(2) & !1;
    let height = region.height.max(2) & !1;

    let mut command = Command::new(ffmpeg);
    command
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning");

    let capture_input = CaptureInput {
        region,
        width,
        height,
        fps,
        ffmpeg,
    };
    append_capture_input(&mut command, &capture_input);
    append_encode_output(&mut command, output);

    #[cfg(target_os = "windows")]
    super::apply_no_window_flag(&mut command);

    let child = command
        .spawn()
        .map_err(|error| format!("failed to spawn ffmpeg ({}): {error}", ffmpeg.display()))?;

    info!(
        x = region.x,
        y = region.y,
        width,
        height,
        output = %output.display(),
        fps,
        "started ffmpeg screen recording"
    );
    Ok(ActiveRecording { child })
}

/// Borrowed parameters for [`append_capture_input`] (bundled to respect
/// the 5-parameter limit and to thread the `ffmpeg` path through for the
/// macOS device-detection step). `width`/`height` are the even-adjusted
/// capture dimensions; `region` carries the desktop/crop offset.
struct CaptureInput<'a> {
    region: CaptureRegion,
    width: u32,
    height: u32,
    fps: u32,
    /// Resolved ffmpeg path (used only on macOS to detect the screen
    /// capture device index; ignored on other platforms).
    ffmpeg: &'a Path,
}

/// Append the per-OS capture-input arguments.
///
/// gdigrab (Windows) reads the composited screen; x11grab (Linux) crops
/// via the display+offset syntax. macOS avfoundation cannot crop by
/// rectangle on input, so it captures the detected screen-capture device
/// and applies a `-vf crop` to the window rect (in backing-store pixels).
fn append_capture_input(command: &mut Command, input: &CaptureInput) {
    #[cfg(target_os = "windows")]
    {
        let _ = input.ffmpeg;
        append_gdigrab_input(command, input.region, input.width, input.height, input.fps);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = input.ffmpeg;
        append_x11grab_input(command, input.region, input.width, input.height, input.fps);
    }
    #[cfg(target_os = "macos")]
    {
        // Detect the avfoundation screen device just-in-time. This runs on
        // the event-loop thread (not the async executor), so the brief
        // `ffmpeg -list_devices` probe does not block tokio. Fall back to
        // index `1`, the historical default, when detection fails.
        let device_index =
            crate::demo::tools::detect_macos_screen_device(input.ffmpeg).unwrap_or(1);
        // Crop to the even-adjusted window rect in backing pixels.
        let crop = CaptureRegion {
            x: input.region.x,
            y: input.region.y,
            width: input.width,
            height: input.height,
        };
        append_avfoundation_input(command, crop, input.fps, device_index);
    }
}

#[cfg(target_os = "windows")]
fn append_gdigrab_input(
    command: &mut Command,
    region: CaptureRegion,
    width: u32,
    height: u32,
    fps: u32,
) {
    command
        .arg("-f")
        .arg("gdigrab")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-offset_x")
        .arg(region.x.to_string())
        .arg("-offset_y")
        .arg(region.y.to_string())
        .arg("-video_size")
        .arg(format!("{width}x{height}"))
        .arg("-i")
        .arg("desktop");
}

#[cfg(target_os = "linux")]
fn append_x11grab_input(
    command: &mut Command,
    region: CaptureRegion,
    width: u32,
    height: u32,
    fps: u32,
) {
    command
        .arg("-f")
        .arg("x11grab")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-video_size")
        .arg(format!("{width}x{height}"))
        .arg("-i")
        .arg(format!(":0.0+{},{}", region.x, region.y));
}

/// avfoundation has no input-side cropping, so capture the detected
/// screen device (`device_index`) at full display resolution and crop to
/// the window `region` with a `-vf crop=W:H:X:Y` filter. The crop rect is
/// in backing-store (physical) pixels; `width`/`height` are pre-evened for
/// libx264. Negative offsets are clamped to `0`.
#[cfg(target_os = "macos")]
fn append_avfoundation_input(
    command: &mut Command,
    region: CaptureRegion,
    fps: u32,
    device_index: u32,
) {
    command
        .arg("-f")
        .arg("avfoundation")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-capture_cursor")
        .arg("1")
        .arg("-i")
        .arg(format!("{device_index}:none"))
        .arg("-vf")
        .arg(format!(
            "crop={}:{}:{}:{}",
            region.width,
            region.height,
            region.x.max(0),
            region.y.max(0)
        ));
}

/// Append the intermediate-encode arguments. Uses a high-quality
/// (`-crf 16`) H.264 stream so the stage-2 composite stays sharp; the
/// stage-2 pass produces the final X-ready encode.
fn append_encode_output(command: &mut Command, output: &Path) {
    command
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-crf")
        .arg("16")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

impl ActiveRecording {
    /// Ask ffmpeg to quit by writing `q` to its stdin. Fast and
    /// non-blocking; call this on the event-loop thread *before*
    /// destroying the captured window so ffmpeg has stopped grabbing it
    /// by the time the window goes away. Finalize with [`Self::wait`].
    pub(crate) fn request_quit(&mut self) {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.write_all(b"q");
            let _ = stdin.flush();
        }
    }

    /// Block until ffmpeg exits (force-killing after a grace period so a
    /// stuck capture can never leak a process). Run on a background
    /// thread after [`Self::request_quit`].
    pub(crate) fn wait(mut self) -> Result<(), String> {
        for _ in 0..60 {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    info!(?status, "ffmpeg recording finalized");
                    return Ok(());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => return Err(format!("failed to wait on ffmpeg: {error}")),
            }
        }

        warn!("ffmpeg did not exit after quit request; killing the process");
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}
