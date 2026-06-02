//! Screen-capture the demo window with `ffmpeg`.
//!
//! We capture a fixed screen rectangle (the monitor the maximized demo
//! window lives on) rather than capturing the window by title. Window
//! capture via GDI `BitBlt` returns black frames for GPU-composited
//! Chromium/WebView2 surfaces; capturing the desktop reads the
//! DWM-composited screen output, so hardware-accelerated content is
//! recorded correctly.
//!
//! The recording is finalized gracefully by writing `q` to ffmpeg's
//! stdin so the MP4 trailer (moov atom) is written and the file is
//! playable; if ffmpeg ignores the quit request we fall back to killing
//! it after a short grace period.

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tracing::{info, warn};

/// The screen rectangle (in physical pixels, desktop coordinates) to
/// capture. Typically the geometry of the monitor the maximized demo
/// window is shown on.
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
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create recordings dir {}: {error}", parent.display()))?;
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

    // Input: capture the desktop region. gdigrab (Windows) reads the
    // composited screen; x11grab (Linux) crops via the display+offset
    // syntax. macOS avfoundation can't crop by rectangle, so it captures
    // the whole main display (best-effort; the demo recorder is
    // Windows-first for the MVP).
    #[cfg(target_os = "windows")]
    {
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
    {
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
    #[cfg(target_os = "macos")]
    {
        command
            .arg("-f")
            .arg("avfoundation")
            .arg("-framerate")
            .arg(fps.to_string())
            .arg("-i")
            .arg("1:none");
    }

    command
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW so ffmpeg does not flash a console window
        // during a recording the user is watching.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

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
