//! Local computer-use executor: the side-effect boundary that performs real OS
//! mouse/keyboard input and full-desktop screenshots on behalf of a
//! (separately wired) computer-use agent.
//!
//! Routes (registered in `net/server.rs`):
//! - `POST /api/computer/action` — perform one action, return a screenshot
//!   taken *after* the action so the caller/model sees the result.
//! - `POST /api/computer/screenshot` — capture the desktop without input.
//! - `POST /api/computer/abort` — latch the abort flag; suppresses all further
//!   input until the process restarts.
//!
//! Safety: all blocking input/capture runs on `spawn_blocking`; coordinates are
//! validated/clamped at this boundary; the abort flag is checked before any
//! input; on macOS an Accessibility grant is required. Screenshot payloads are
//! never logged — only their dimensions.

mod abort_hotkey;
#[cfg(target_os = "macos")]
mod accessibility;
mod input;
mod screenshot;

pub(crate) use abort_hotkey::spawn_abort_hotkey_listener;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::Json;
use tracing::{info, warn};

use input::InputScale;
use screenshot::CapturedScreenshot;

/// Advertised display width handed to the model (Anthropic recommends a bounded
/// ~WXGA target for accurate clicks). Screenshots are scaled into this box and
/// model coordinates are scaled back out of it.
pub(crate) const ADVERTISED_W: u32 = 1280;
/// Advertised display height; see [`ADVERTISED_W`].
pub(crate) const ADVERTISED_H: u32 = 800;

/// Shared computer-use executor state: an abort latch plus the advertised
/// display size. Cheaply cloneable (`Arc`); all clones share the abort flag.
#[derive(Clone)]
pub(crate) struct ComputerUseState {
    inner: Arc<ComputerUseInner>,
}

struct ComputerUseInner {
    abort: AtomicBool,
    /// Latches `true` the first time computer-use synthesizes input, so the
    /// "now controlling" indicator is announced exactly once per process.
    controlling_announced: AtomicBool,
    advertised_width: u32,
    advertised_height: u32,
}

impl ComputerUseState {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(ComputerUseInner {
                abort: AtomicBool::new(false),
                controlling_announced: AtomicBool::new(false),
                advertised_width: ADVERTISED_W,
                advertised_height: ADVERTISED_H,
            }),
        }
    }

    fn advertised_width(&self) -> u32 {
        self.inner.advertised_width
    }

    fn advertised_height(&self) -> u32 {
        self.inner.advertised_height
    }

    fn is_aborted(&self) -> bool {
        self.inner.abort.load(Ordering::SeqCst)
    }

    fn set_aborted(&self) {
        self.inner.abort.store(true, Ordering::SeqCst);
    }

    /// Minimal on-screen-indicator stand-in: emit a single prominent warning
    /// the first time computer-use actively controls the desktop, so the
    /// session is never hijacked silently.
    ///
    /// A full always-on-top borderless indicator window is a deliberate
    /// follow-up: `tao` windows must be created on the event-loop thread, but
    /// this executor runs on `spawn_blocking` worker threads with no access
    /// to the loop. Cross-thread window creation there is impractical, so the
    /// real visual indicator is deferred to an event-loop-side change.
    fn announce_controlling_once(&self) {
        if !self
            .inner
            .controlling_announced
            .swap(true, Ordering::SeqCst)
        {
            warn!(
                "AURA is now controlling your computer (computer-use active). \
                 Press Ctrl+Alt+Q to abort."
            );
        }
    }
}

/// One computer action, deserialized from the request body. Coordinates are in
/// advertised space and validated/clamped at this boundary before any input.
#[derive(serde::Deserialize)]
pub(crate) struct ComputerActionRequest {
    action: String,
    x: Option<i32>,
    y: Option<i32>,
    dx: Option<i32>,
    dy: Option<i32>,
    text: Option<String>,
    key: Option<String>,
    button: Option<String>,
    click_count: Option<u32>,
    duration_ms: Option<u64>,
}

/// Perform one action then return a screenshot of the result.
pub(crate) async fn post_computer_action(
    AxumState(state): AxumState<ComputerUseState>,
    Json(req): Json<ComputerActionRequest>,
) -> Json<serde_json::Value> {
    #[cfg(target_os = "macos")]
    if !accessibility::accessibility_granted() {
        warn!("computer action blocked: macOS Accessibility permission missing");
        return Json(serde_json::json!({
            "ok": false,
            "error": "Accessibility permission required. Grant AURA access in \
                      System Settings > Privacy & Security > Accessibility, then retry.",
        }));
    }

    let adv_w = state.advertised_width();
    let adv_h = state.advertised_height();
    let action_label = req.action.clone();
    let blocking_state = state.clone();
    let outcome =
        tokio::task::spawn_blocking(move || perform_action(&blocking_state, &req, adv_w, adv_h))
            .await;
    match outcome {
        Ok(Ok(shot)) => {
            info!(
                action = %action_label,
                width = shot.width,
                height = shot.height,
                "computer action performed"
            );
            screenshot_response(&shot)
        }
        Ok(Err(error)) => {
            warn!(action = %action_label, %error, "computer action failed");
            Json(serde_json::json!({ "ok": false, "error": error }))
        }
        Err(join_error) => {
            warn!(action = %action_label, %join_error, "computer action task panicked");
            Json(serde_json::json!({ "ok": false, "error": join_error.to_string() }))
        }
    }
}

/// Capture a full-desktop screenshot without performing any input.
pub(crate) async fn post_computer_screenshot(
    AxumState(state): AxumState<ComputerUseState>,
) -> Json<serde_json::Value> {
    let adv_w = state.advertised_width();
    let adv_h = state.advertised_height();
    let outcome =
        tokio::task::spawn_blocking(move || screenshot::capture_primary(adv_w, adv_h)).await;
    match outcome {
        Ok(Ok(shot)) => {
            info!(
                width = shot.width,
                height = shot.height,
                "computer screenshot captured"
            );
            screenshot_response(&shot)
        }
        Ok(Err(error)) => {
            warn!(%error, "computer screenshot failed");
            Json(serde_json::json!({ "ok": false, "error": error }))
        }
        Err(join_error) => {
            warn!(%join_error, "computer screenshot task panicked");
            Json(serde_json::json!({ "ok": false, "error": join_error.to_string() }))
        }
    }
}

/// Latch the abort flag, suppressing all further input until restart.
pub(crate) async fn post_computer_abort(
    AxumState(state): AxumState<ComputerUseState>,
) -> Json<serde_json::Value> {
    state.set_aborted();
    warn!("computer-use abort requested; input is now suppressed");
    Json(serde_json::json!({ "ok": true }))
}

/// Blocking body of [`post_computer_action`]: scale, dispatch, then capture.
fn perform_action(
    state: &ComputerUseState,
    req: &ComputerActionRequest,
    adv_w: u32,
    adv_h: u32,
) -> Result<CapturedScreenshot, String> {
    let (phys_w, phys_h) = screenshot::primary_physical_size()?;
    let scale = InputScale {
        adv_w,
        adv_h,
        phys_w,
        phys_h,
    };
    dispatch_action(state, req, scale)?;
    screenshot::capture_primary(adv_w, adv_h)
}

/// Map an action string onto an input operation, gating real input on the abort
/// flag. `screenshot`/`wait` synthesize no input and are always allowed.
fn dispatch_action(
    state: &ComputerUseState,
    req: &ComputerActionRequest,
    scale: InputScale,
) -> Result<(), String> {
    let action = req.action.as_str();
    let synthesizes_input = !matches!(action, "screenshot" | "wait");
    if synthesizes_input && state.is_aborted() {
        return Err("computer-use is aborted; input is suppressed".to_string());
    }
    if synthesizes_input {
        state.announce_controlling_once();
    }
    match action {
        "screenshot" => Ok(()),
        "wait" => {
            wait_action(req.duration_ms);
            Ok(())
        }
        "mouse_move" => {
            let (x, y) = require_point(req)?;
            input::mouse_move(scale, x, y)
        }
        "left_click" => {
            let button = req.button.as_deref().unwrap_or("left");
            input::click_button(scale, button, point_opt(req), req.click_count.unwrap_or(1))
        }
        "right_click" => input::click_button(scale, "right", point_opt(req), 1),
        "middle_click" => input::click_button(scale, "middle", point_opt(req), 1),
        "double_click" => input::click_button(scale, "left", point_opt(req), 2),
        "left_click_drag" => {
            let (x, y) = require_point(req)?;
            input::left_click_drag(scale, x, y)
        }
        "type" => {
            let text = req
                .text
                .as_deref()
                .ok_or_else(|| "type action requires text".to_string())?;
            input::type_text(text)
        }
        "key" => {
            let key = req
                .key
                .as_deref()
                .ok_or_else(|| "key action requires key".to_string())?;
            input::press_key(key)
        }
        "scroll" => input::scroll(req.dx.unwrap_or(0), req.dy.unwrap_or(0)),
        other => Err(format!("unknown computer action: {other}")),
    }
}

/// Sleep for a clamped duration (default 500ms, capped at 10s) on the blocking
/// thread — never on the async runtime.
fn wait_action(duration_ms: Option<u64>) {
    let millis = duration_ms.unwrap_or(500).min(10_000);
    std::thread::sleep(Duration::from_millis(millis));
}

/// Extract `(x, y)` if both are present.
fn point_opt(req: &ComputerActionRequest) -> Option<(i32, i32)> {
    match (req.x, req.y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    }
}

/// Require `(x, y)`, erroring with the action name otherwise.
fn require_point(req: &ComputerActionRequest) -> Result<(i32, i32), String> {
    point_opt(req).ok_or_else(|| format!("action '{}' requires x and y", req.action))
}

/// Build the shared success response. Never logs or echoes the payload size
/// beyond its dimensions.
fn screenshot_response(shot: &CapturedScreenshot) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "image_base64": shot.base64,
        "width": shot.width,
        "height": shot.height,
    }))
}
