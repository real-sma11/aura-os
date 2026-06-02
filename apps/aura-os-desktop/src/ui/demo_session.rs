//! Demo-recording window lifecycle: the per-window [`DemoSession`] state
//! and the [`LoopState`] handlers that open the window, start the ffmpeg
//! capture once the frontend bridge is ready, drive the instruction, and
//! finalize the clip.
//!
//! Split out of [`crate::ui::runtime`] (which is at the file-size limit)
//! so the demo handlers live together; they are inherent methods on
//! [`LoopState`] so the event-loop match arms call them directly.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tao::event_loop::EventLoopWindowTarget;
use tao::window::{Window, WindowId};
use tracing::warn;

use crate::demo::{self, recorder::ActiveRecording, DemoOptions};
use crate::events::UserEvent;
use crate::init::init_script::build_initialization_script;
use crate::ui::main_window::{ipc_handler, open_demo_window};
use crate::ui::runtime::{spawn_fallback_show_timer, LoopState};

/// A live demo-recording window: the window/webview handles plus the
/// instruction to run, the validated [`DemoOptions`], where the recording
/// is written, and the ffmpeg capture process once it has started.
pub(crate) struct DemoSession {
    pub(crate) recording_id: String,
    pub(crate) instruction: String,
    pub(crate) options: DemoOptions,
    /// Final clip the user receives.
    pub(crate) output_path: PathBuf,
    /// Stage-1 capture the composite reads from (or is promoted directly
    /// to `output_path` when compositing is disabled).
    pub(crate) intermediate_path: PathBuf,
    pub(crate) window: Window,
    pub(crate) webview: wry::WebView,
    pub(crate) recording: Option<ActiveRecording>,
}

impl LoopState {
    /// Open the dedicated demo window and register a [`DemoSession`].
    /// Recording + driving do not start until the frontend bridge in the
    /// window posts `demo-ready` ([`UserEvent::DemoWindowReady`]).
    pub(crate) fn handle_start_demo_recording(
        &mut self,
        elwt: &EventLoopWindowTarget<UserEvent>,
        recording_id: String,
        instruction: String,
        options: DemoOptions,
    ) {
        // Per-window init script: inherit the shared host-origin seed,
        // then stamp the demo marker the frontend bridge reads to know
        // it is the recording window.
        let mut init_script = build_initialization_script(self.ctx.host_origin.as_deref(), None);
        init_script.push_str(&format!(
            "\ntry{{window.{}={};}}catch(e){{}}",
            demo::DEMO_MARKER_GLOBAL,
            json_string(&recording_id)
        ));

        let url = self.frontend_base_url.clone();
        let icon = self.ctx.icon_data.to_icon();
        let proxy_clone = self.ctx.proxy.clone();
        let data_dir = self.data_dir();
        let output_path = demo::recording_output_path(&data_dir, &recording_id);
        let intermediate_path = demo::intermediate_output_path(&data_dir, &recording_id);
        let window_size = (options.window_width as f64, options.window_height as f64);

        match open_demo_window(
            elwt,
            &mut self.web_context,
            &url,
            &init_script,
            Some(icon),
            demo::DEMO_WINDOW_TITLE,
            window_size,
            move |wid| Box::new(ipc_handler(proxy_clone.clone(), wid)),
        ) {
            Ok((window, webview)) => {
                let wid = window.id();
                self.demo_windows.insert(
                    wid,
                    DemoSession {
                        recording_id,
                        instruction,
                        options,
                        output_path,
                        intermediate_path,
                        window,
                        webview,
                        recording: None,
                    },
                );
                spawn_fallback_show_timer(self.ctx.proxy.clone(), wid);
            }
            Err(error) => {
                warn!(%error, "failed to spawn demo recording window");
                demo::set_failed(
                    &self.demo_registry,
                    &recording_id,
                    format!("failed to open demo window: {error}"),
                );
            }
        }
    }

    /// The demo bridge is ready: reveal the window, position it for the
    /// configured capture mode, start ffmpeg, drive the instruction, and
    /// arm the max-duration guard.
    pub(crate) fn handle_demo_window_ready(&mut self, window_id: WindowId) {
        let Some(session) = self.demo_windows.get(&window_id) else {
            return;
        };
        if session.recording.is_some() {
            return;
        }
        let recording_id = session.recording_id.clone();
        let output_path = session.output_path.clone();
        let intermediate_path = session.intermediate_path.clone();
        let instruction = session.instruction.clone();
        let options = session.options.clone();

        let region = self.prepare_demo_window(window_id, &options);

        let ffmpeg = demo::tools::resolve_ffmpeg_binary();
        match demo::recorder::start_region_recording(
            &ffmpeg,
            region,
            &intermediate_path,
            demo::RECORDING_FPS,
        ) {
            Ok(recording) => {
                if let Some(session) = self.demo_windows.get_mut(&window_id) {
                    session.recording = Some(recording);
                }
                demo::set_recording(&self.demo_registry, &recording_id, &output_path);
            }
            Err(error) => {
                warn!(%error, "failed to start demo recording");
                demo::set_failed(
                    &self.demo_registry,
                    &recording_id,
                    format!("failed to start recording: {error}"),
                );
                self.demo_windows.remove(&window_id);
                return;
            }
        }

        self.drive_demo_instruction(window_id, &instruction);
        self.arm_max_duration_guard(window_id, options.max_seconds);
    }

    /// Position the demo window for capture and return the screen rect to
    /// record. Framed mode (`window_on_background`) sizes + centers the
    /// window and captures its outer rect; full-screen mode maximizes and
    /// captures the whole monitor.
    fn prepare_demo_window(
        &self,
        window_id: WindowId,
        options: &DemoOptions,
    ) -> demo::recorder::CaptureRegion {
        // Default to a 1080p canvas; overwritten with the real rect below.
        let mut region = demo::recorder::CaptureRegion {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let Some(session) = self.demo_windows.get(&window_id) else {
            return region;
        };
        session.window.set_visible(true);
        session.window.set_focus();

        if options.window_on_background {
            center_demo_window(&session.window, options.window_width, options.window_height);
            if let Some(rect) = window_capture_region(&session.window) {
                region = rect;
            }
        } else {
            // Full-screen capture: the maximized window fills the monitor
            // and we grab the whole monitor region (no stage-2 framing).
            session.window.set_maximized(true);
            if let Some(rect) = monitor_capture_region(&session.window) {
                region = rect;
            }
        }
        region
    }

    /// Drive the instruction through the real chat UI. The bridge posts
    /// `demo-complete` when the agent turn finishes.
    fn drive_demo_instruction(&self, window_id: WindowId, instruction: &str) {
        if let Some(session) = self.demo_windows.get(&window_id) {
            let js = format!(
                "try{{window.__AURA_DEMO_BRIDGE__&&window.__AURA_DEMO_BRIDGE__.run({});}}catch(e){{}}",
                json_string(instruction)
            );
            if let Err(error) = session.webview.evaluate_script(&js) {
                warn!(%error, "failed to drive demo instruction");
            }
        }
    }

    /// Spawn the max-duration guard so a stuck/long turn still finalizes a
    /// file by posting [`UserEvent::DemoWindowComplete`] after `max_seconds`.
    fn arm_max_duration_guard(&self, window_id: WindowId, max_seconds: u64) {
        let proxy = self.ctx.proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(max_seconds));
            let _ = proxy.send_event(UserEvent::DemoWindowComplete { window_id });
        });
    }

    /// Finalize a demo recording: tell ffmpeg to quit, close the window,
    /// then wait for the file off-thread and mark the recording complete.
    pub(crate) fn handle_demo_window_complete(&mut self, window_id: WindowId) {
        let Some(mut session) = self.demo_windows.remove(&window_id) else {
            return;
        };
        let registry = self.demo_registry.clone();
        let recording_id = session.recording_id.clone();
        let output_path = session.output_path.clone();
        let intermediate_path = session.intermediate_path.clone();
        let options = session.options.clone();

        // Ask ffmpeg to stop BEFORE we drop the window so it isn't
        // grabbing a window that is about to be destroyed.
        let recording = session.recording.take().map(|mut rec| {
            rec.request_quit();
            rec
        });

        // Dropping the session here closes the demo window. ffmpeg has
        // already been told to quit, so the file is being finalized from
        // buffered frames, not from the live window.
        drop(session);

        match recording {
            Some(rec) => {
                demo::set_phase(&registry, &recording_id, demo::DemoPhase::Finalizing);
                // Stage-2 framing only applies to the windowed X target;
                // full-screen capture and the Raw target keep the stage-1
                // file as the deliverable.
                let composite =
                    options.window_on_background && matches!(options.target, demo::DemoTarget::X);
                let background = options.background.resolve();
                std::thread::spawn(move || {
                    let args = demo::recorder::FinalizeArgs {
                        registry: &registry,
                        recording_id: &recording_id,
                        intermediate_path: &intermediate_path,
                        output_path: &output_path,
                        composite,
                        background,
                    };
                    demo::recorder::finalize_recording(rec, &args);
                });
            }
            None => {
                demo::set_failed(&registry, &recording_id, "recording never started");
            }
        }
    }

    /// The data directory (parent of the store path) under which the
    /// `recordings/` folder lives.
    fn data_dir(&self) -> PathBuf {
        self.ctx
            .store_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.ctx.store_path.clone())
    }
}

/// Serialize a string as a JSON/JS string literal (quoted + escaped) for
/// safe interpolation into an `evaluate_script` payload.
fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Size the demo window to the requested logical size and center it on
/// its current monitor so its whole outer rect is on-screen (window-only
/// capture requires the window fully visible).
fn center_demo_window(window: &Window, width: u32, height: u32) {
    use tao::dpi::{LogicalSize, PhysicalPosition};

    window.set_inner_size(LogicalSize::new(width as f64, height as f64));

    let Some(monitor) = window
        .current_monitor()
        .or_else(|| window.primary_monitor())
    else {
        return;
    };
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size();

    let offset_x = (monitor_size.width as i32 - window_size.width as i32).max(0) / 2;
    let offset_y = (monitor_size.height as i32 - window_size.height as i32).max(0) / 2;
    window.set_outer_position(PhysicalPosition::new(
        monitor_pos.x + offset_x,
        monitor_pos.y + offset_y,
    ));
}

/// The demo window's outer rect as a capture region. On Windows/Linux the
/// tao geometry is already in physical desktop pixels and is used as-is
/// (gdigrab/x11grab grab that rectangle directly). On macOS the rect is
/// remapped into the display's backing-store pixel space for the
/// avfoundation `-vf crop` (see [`macos_backing_capture_region`]). `None`
/// if the position cannot be read.
fn window_capture_region(window: &Window) -> Option<demo::recorder::CaptureRegion> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size();
    #[cfg(target_os = "macos")]
    {
        macos_backing_capture_region(window, position, size)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(demo::recorder::CaptureRegion {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    }
}

/// macOS crop rect for the avfoundation capture, in **backing-store
/// (physical) pixels** relative to the display origin.
///
/// COORDINATE-SPACE ASSUMPTION (needs on-device verification on a Retina
/// Mac): we treat tao's `outer_position()`/`outer_size()` on macOS as
/// *logical points* and multiply by `window.scale_factor()` to reach the
/// backing-store pixel grid that avfoundation records at. This follows
/// the plan ("multiply the window geometry by `scale_factor()` to get the
/// crop rect in backing pixels"). If tao 0.34 already reports physical
/// pixels here, this would double-count the scale factor and must be
/// changed to use the raw values. The crop origin is made relative to the
/// monitor (avfoundation captures one display, origin at its top-left).
#[cfg(target_os = "macos")]
fn macos_backing_capture_region(
    window: &Window,
    position: tao::dpi::PhysicalPosition<i32>,
    size: tao::dpi::PhysicalSize<u32>,
) -> Option<demo::recorder::CaptureRegion> {
    let monitor = window
        .current_monitor()
        .or_else(|| window.primary_monitor())?;
    let monitor_pos = monitor.position();
    let scale = window.scale_factor();

    let x = (((position.x - monitor_pos.x) as f64) * scale)
        .round()
        .max(0.0) as i32;
    let y = (((position.y - monitor_pos.y) as f64) * scale)
        .round()
        .max(0.0) as i32;
    let width = even_dim(size.width as f64 * scale);
    let height = even_dim(size.height as f64 * scale);

    Some(demo::recorder::CaptureRegion {
        x,
        y,
        width,
        height,
    })
}

/// Round a scaled dimension to an even `u32` (>= 2) for libx264/yuv420p.
#[cfg(target_os = "macos")]
fn even_dim(value: f64) -> u32 {
    let rounded = value.round().max(0.0) as u32;
    rounded.max(2) & !1
}

/// The current monitor's full rect as a capture region, in physical
/// pixels. Used for the full-screen (`window_on_background == false`)
/// path. `None` if no monitor can be resolved.
fn monitor_capture_region(window: &Window) -> Option<demo::recorder::CaptureRegion> {
    let monitor = window
        .current_monitor()
        .or_else(|| window.primary_monitor())?;
    let position = monitor.position();
    let size = monitor.size();
    Some(demo::recorder::CaptureRegion {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}
