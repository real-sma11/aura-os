//! Windows Graphics Capture (WGC) backend for the demo recorder's framed
//! window mode.
//!
//! Unlike the gdigrab fixed-screen-region capture ([`super::capture`]), WGC
//! captures the demo window's own composited surface by handle. That means:
//! - GPU-rendered WebView2 content is recorded (gdigrab `title=` window
//!   capture is all-black for hardware-composited surfaces);
//! - the recording follows the window as it moves / resizes;
//! - other windows stacked on top do not bleed into the capture.
//!
//! The capture runs on its own thread (`start_free_threaded`) feeding frames
//! into the crate's Media-Foundation H.264 [`VideoEncoder`], which writes the
//! intermediate `window.mp4` the stage-2 composite then frames. The encoder
//! runs its own worker (`send_frame` returns immediately), so we stop the
//! capture thread first and finalize the encoder afterwards.

use std::path::{Path, PathBuf};

use tracing::info;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
    VideoSettingsSubType,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window as WgcWindow;

type WgcError = Box<dyn std::error::Error + Send + Sync>;

/// `Send` configuration handed to [`WgcCapture::new`] via the WGC settings.
#[derive(Clone)]
struct WgcFlags {
    output: PathBuf,
    fps: u32,
}

/// WGC frame handler: lazily builds the encoder from the first frame's
/// dimensions (so it always matches the captured window size exactly), then
/// streams every frame into it.
struct WgcCapture {
    encoder: Option<VideoEncoder>,
    output: PathBuf,
    fps: u32,
}

impl GraphicsCaptureApiHandler for WgcCapture {
    type Flags = WgcFlags;
    type Error = WgcError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            encoder: None,
            output: ctx.flags.output,
            fps: ctx.flags.fps,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame<'_>,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.encoder.is_none() {
            let width = frame.width();
            let height = frame.height();
            let encoder = VideoEncoder::new(
                VideoSettingsBuilder::new(width, height)
                    // H.264 (the builder defaults to HEVC) for the broadest
                    // playback/upload compatibility; the stage-2 composite
                    // re-encodes for the X target anyway.
                    .sub_type(VideoSettingsSubType::H264)
                    .frame_rate(self.fps),
                AudioSettingsBuilder::default().disabled(true),
                ContainerSettingsBuilder::default(),
                &self.output,
            )?;
            self.encoder = Some(encoder);
        }
        if let Some(encoder) = self.encoder.as_mut() {
            encoder.send_frame(frame)?;
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// A running WGC window capture. Mirrors `super::capture::ActiveRecording`'s
/// `request_quit` / `wait` lifecycle so the finalize pipeline can treat both
/// backends uniformly.
pub(crate) struct WgcRecording {
    control: Option<CaptureControl<WgcCapture, WgcError>>,
}

/// Start capturing the window identified by `hwnd` into `output` (an `.mp4`)
/// at `fps` via Windows Graphics Capture.
pub(crate) fn start_window_recording(
    hwnd: *mut std::ffi::c_void,
    output: &Path,
    fps: u32,
) -> Result<WgcRecording, String> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create recordings dir {}: {error}",
                parent.display()
            )
        })?;
    }

    let window = WgcWindow::from_raw_hwnd(hwnd);
    let settings = Settings::new(
        window,
        CursorCaptureSettings::Default,
        // Suppress the WGC capture highlight so the yellow "being captured"
        // border is never recorded.
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        WgcFlags {
            output: output.to_path_buf(),
            fps,
        },
    );

    let control = WgcCapture::start_free_threaded(settings)
        .map_err(|error| format!("failed to start Windows Graphics Capture: {error:?}"))?;

    info!(output = %output.display(), fps, "started WGC window recording");
    Ok(WgcRecording {
        control: Some(control),
    })
}

impl WgcRecording {
    /// No-op for WGC: there's nothing fast to do on the event-loop thread.
    /// The capture stops cleanly when the demo window is destroyed right
    /// after this returns, and [`Self::wait`] (on the finalize thread) does
    /// the blocking stop + encoder finalize.
    pub(crate) fn request_quit(&mut self) {}

    /// Stop the capture thread (posts `WM_QUIT` + joins) and finalize the
    /// encoder (flush its worker queue + write the MP4 trailer) so the file
    /// is playable. Runs on the finalize background thread.
    pub(crate) fn wait(mut self) -> Result<(), String> {
        let Some(control) = self.control.take() else {
            return Err("WGC capture was already finalized".to_string());
        };
        // Grab the handler handle before `stop()` consumes the control, so we
        // can finalize the encoder once the capture thread has joined.
        let callback = control.callback();
        let _ = control.stop();
        let mut guard = callback.lock();
        match guard.encoder.take() {
            Some(encoder) => {
                encoder
                    .finish()
                    .map_err(|error| format!("failed to finalize WGC encoding: {error:?}"))?;
                info!("WGC recording finalized");
                Ok(())
            }
            None => Err("WGC capture produced no frames".to_string()),
        }
    }
}
