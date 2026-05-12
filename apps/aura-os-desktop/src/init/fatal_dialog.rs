//! User-visible "AURA could not start" dialog for fatal startup
//! failures.
//!
//! Background: the desktop binary is built with
//! `windows_subsystem = "windows"` on release Windows targets so it
//! never spawns a console window. That choice is correct for the happy
//! path, but it means any `panic!` or `eprintln!` during early startup
//! is invisible to the user — the process simply vanishes. We hit
//! exactly that with a corrupt `<data>/store/settings.json`: the
//! embedded server thread panicked on `serde_json::from_str`, the
//! ready-channel sender was dropped, and the main thread `RecvError`'d
//! out of `main()` with no UI and no notification. Only `crash.log`
//! showed evidence after the fact.
//!
//! This module pops a native message box on Windows (and falls back to
//! `eprintln!` on macOS / Linux, where developer launches usually have
//! a console attached) so a similar failure in the future is at worst
//! a clearly-labelled "AURA could not start" dialog that points the
//! user at the on-disk crash log.

use std::path::Path;
use tracing::error;

/// Show a fatal-startup dialog and then return. Caller is expected to
/// `std::process::exit(1)` immediately afterwards.
///
/// `data_dir` is the per-user AURA data directory (i.e. the parent of
/// `store/`). The dialog mentions the crash log under that directory
/// so users have somewhere concrete to look.
pub(crate) fn show_fatal_startup_failure(data_dir: &Path, body: &str) {
    let crash_log = data_dir.join("crash.log");
    let full_body = format!(
        "AURA could not start.\n\n\
         {body}\n\n\
         A diagnostic log was written to:\n{}\n\n\
         If this keeps happening, try renaming or deleting:\n{}\n\
         (your project, spec, and task data is safe — only the local \
         settings cache lives there).",
        crash_log.display(),
        data_dir.join("store").join("settings.json").display(),
    );
    error!(
        body = body,
        crash_log = %crash_log.display(),
        "fatal startup failure: showing user dialog"
    );
    show_message_box("AURA could not start", &full_body);
}

#[cfg(target_os = "windows")]
fn show_message_box(title: &str, body: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
    };

    let title_wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let body_wide: Vec<u16> = body.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        // No parent HWND: this is called before the main window
        // exists (and often the reason we never got that far is what
        // we're reporting). MB_TOPMOST + MB_SETFOREGROUND ensures the
        // dialog is the active window even when launched via a
        // double-click that doesn't own the focus.
        MessageBoxW(
            None,
            PCWSTR(body_wide.as_ptr()),
            PCWSTR(title_wide.as_ptr()),
            MB_OK | MB_ICONERROR | MB_TOPMOST | MB_SETFOREGROUND,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_message_box(title: &str, body: &str) {
    eprintln!("[{title}]\n{body}");
}
