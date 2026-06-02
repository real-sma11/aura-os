//! Global OS-level abort hotkey for computer-use.
//!
//! Registers a system-wide hotkey (Ctrl+Alt+Q) so a user can immediately
//! latch the [`ComputerUseState`] abort flag and stop all synthetic input,
//! even when AURA's window is not focused. This complements the
//! `POST /api/computer/abort` HTTP route with a physical, always-available
//! kill switch.
//!
//! Best-effort: a registration failure (for example, another app already
//! owns the combo) is logged and the thread exits — it never panics and
//! never blocks startup.
//!
//! Windows-only: implemented with `RegisterHotKey` plus a dedicated
//! message-pump thread. Other platforms get a no-op stub.
//! TODO(cross-platform): add a macOS (`RegisterEventHotKey` / `CGEventTap`)
//! and Linux (X11/Wayland global grab) implementation; until then the HTTP
//! abort route is the cross-platform fallback.

use crate::computer_use::ComputerUseState;

/// Spawn the global abort-hotkey listener for `state`. Non-blocking: returns
/// immediately while a background thread owns the registration + pump.
pub(crate) fn spawn_abort_hotkey_listener(state: ComputerUseState) {
    #[cfg(target_os = "windows")]
    windows_impl::spawn(state);

    #[cfg(not(target_os = "windows"))]
    {
        // No global hotkey on this platform yet (see module TODO). The HTTP
        // `/api/computer/abort` route remains available as the abort path.
        let _ = state;
        tracing::debug!("global abort hotkey not implemented on this platform");
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::ComputerUseState;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

    /// Per-process hotkey id; any value unique within the thread is fine.
    const HOTKEY_ID: i32 = 0xA17A;
    /// Virtual-key code for `Q` (VK letter codes equal the ASCII uppercase).
    const VK_Q: u32 = b'Q' as u32;

    pub(super) fn spawn(state: ComputerUseState) {
        let builder = std::thread::Builder::new().name("computer-use-abort-hotkey".to_string());
        if let Err(error) = builder.spawn(move || run(state)) {
            tracing::warn!(%error, "failed to spawn abort-hotkey thread");
        }
    }

    fn run(state: ComputerUseState) {
        let null_hwnd = HWND(std::ptr::null_mut());
        // SAFETY: standard Win32 hotkey registration. A null hwnd associates
        // the hotkey with this thread's message queue, which `pump_messages`
        // drains below. MOD_NOREPEAT avoids repeated fires while held.
        let registered = unsafe {
            RegisterHotKey(
                null_hwnd,
                HOTKEY_ID,
                MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
                VK_Q,
            )
        };
        if let Err(error) = registered {
            tracing::warn!(%error, "failed to register Ctrl+Alt+Q abort hotkey");
            return;
        }
        tracing::info!("registered global computer-use abort hotkey: Ctrl+Alt+Q");

        pump_messages(&state);

        // SAFETY: unregister the same id/thread we registered above.
        unsafe {
            let _ = UnregisterHotKey(null_hwnd, HOTKEY_ID);
        }
    }

    /// Block on the thread message queue, latching abort on every WM_HOTKEY.
    fn pump_messages(state: &ComputerUseState) {
        let mut msg = MSG::default();
        loop {
            // SAFETY: `msg` is a valid owned buffer; a null hwnd retrieves this
            // thread's queued messages (including WM_HOTKEY).
            let result = unsafe { GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0) };
            match result.0 {
                -1 => {
                    tracing::warn!("abort-hotkey message pump error; stopping listener");
                    return;
                }
                0 => return, // WM_QUIT
                _ => {
                    if msg.message == WM_HOTKEY {
                        state.set_aborted();
                        tracing::warn!(
                            "computer-use abort hotkey pressed; synthetic input suppressed"
                        );
                    }
                }
            }
        }
    }
}
