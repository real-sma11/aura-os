//! Platform-specific tweaks to the native window chrome — squared
//! corners on Windows / macOS, the `BLACK_BRUSH` background fill that
//! hides the OS-default white sliver during a Windows drag-resize, and
//! a Win32 `WM_NCHITTEST` subclass that widens the top resize hit area
//! so users can grab the borderless top edge without pixel-perfect aim.

pub(crate) fn set_square_corners(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE,
        };

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        let preference = DWM_WINDOW_CORNER_PREFERENCE(1); // DWMWCP_DONOTROUND
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const _,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            )
        };
    }

    #[cfg(target_os = "macos")]
    {
        use objc::{sel, sel_impl};
        use tao::platform::macos::WindowExtMacOS;

        unsafe {
            let ns_window = _window.ns_window() as *mut objc::runtime::Object;
            let content_view: *mut objc::runtime::Object = objc::msg_send![ns_window, contentView];
            let _: () = objc::msg_send![content_view, setWantsLayer: true];
            let layer: *mut objc::runtime::Object = objc::msg_send![content_view, layer];
            let _: () = objc::msg_send![layer, setCornerRadius: 0.0_f64];
            let _: () = objc::msg_send![layer, setMasksToBounds: true];
        }
    }

    // Linux: frameless windows don't have app-controllable corner rounding.
    // Any rounding from the compositor (e.g. Mutter, KWin) cannot be overridden.
}

/// Sets the main window class background brush to `BLACK_BRUSH` so that
/// growing the window (right / bottom drag-resize) paints a black bar at
/// the newly-exposed edge before the WebView2 swap chain catches up with
/// the new size, rather than the OS-default white.
///
/// Trade-off vs. `NULL_BRUSH` (hollow brush, "don't erase"):
/// - `NULL_BRUSH` assumes the WebView2 child HWND already covers the whole
///   client area and its previous frame can stay on screen. In practice,
///   during a live drag-resize the WebView2 child lags the OS-level resize
///   by a few frames, and the uncovered strip is filled by DWM composition
///   — which renders as bright white. That flash is very jarring against
///   the app's dark theme.
/// - `BLACK_BRUSH` makes the OS fill the same uncovered strip with black
///   during `WM_ERASEBKGND`. A thin black sliver can briefly "chase" the
///   cursor on the leading edge of a drag-resize, but it blends into the
///   dark theme and into the WebView's own background color
///   (`with_background_color((0, 0, 0, 255))` in `create_main_webview`).
///
/// Between a visible white flash and a visible black flash we explicitly
/// choose black.
///
/// Startup behavior is preserved: the main window is created with
/// `with_visible(false)` and stays hidden until the frontend posts `ready`,
/// so users never see the pre-webview erase color anyway.
pub(crate) fn disable_window_background_erase(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
        use windows::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GCL_HBRBACKGROUND};

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        unsafe {
            let black = GetStockObject(BLACK_BRUSH);
            SetClassLongPtrW(hwnd, GCL_HBRBACKGROUND, black.0 as isize);
        }
    }
}

/// Logical-pixel thickness of the top resize hit zone installed by
/// [`expand_top_resize_border`].
///
/// IMPORTANT — this subclass has a much narrower effective reach than
/// the constant suggests. The wry WebView2 container HWND is created
/// as a `WS_CHILD | WS_CLIPCHILDREN` child that fills the entire
/// parent client area, with the default windowproc returning
/// `HTCLIENT` for `WM_NCHITTEST`. Windows therefore routes
/// `WM_NCHITTEST` to the WebView2 child for any cursor position
/// inside the visible window — never to the parent HWND where this
/// subclass lives.
///
/// In practice the only place this subclass actually fires is the
/// 1-logical-pixel non-client strip tao reserves at the very top of
/// the parent on Windows 11 (see `calculate_insets_for_dpi` in tao —
/// `top_inset = 1` on build >= 22000, and `0` on Windows 10). Within
/// that single-row strip the subclass remaps `WM_NCHITTEST` to
/// `HTTOP` / `HTTOPLEFT` / `HTTOPRIGHT`, which is a tiny but free
/// resize edge for the corners of the window where the cursor can sit
/// outside the WebView2 child.
///
/// The user-perceptible top resize band — covering the floating
/// titlebar pill area where the cursor is over the WebView2 child —
/// is implemented in JS in
/// [interface/src/lib/native-titlebar-resize.ts]. That bridge listens
/// for pointer events at the document level (which the WebView2 child
/// does receive), changes the cursor to `n-resize`, and IPCs
/// `resize-n` to the Rust side, which calls
/// `tao::Window::drag_resize_window(ResizeDirection::North)` to hand
/// off to the OS resize loop.
///
/// 14 logical px is the value the JS bridge also uses; keeping the
/// two in sync means that on the Win11 1-px non-client strip the
/// subclass's HTTOP_LEFT / HTTOPRIGHT corners agree with the JS
/// band's geometry along the top edge.
pub(crate) const TOP_RESIZE_BORDER_LOGICAL_PX: u32 = 14;

/// Computes the resize hit code for a cursor at `(x, y)` inside a
/// client rect of width `client_width`, given an expanded top hit
/// zone of `top_px` and a corner width of `border_x`. Returns
/// `Some(HTTOPLEFT | HTTOP | HTTOPRIGHT)` when the cursor falls in the
/// expanded zone, `None` otherwise so the caller falls back to the OS
/// / `tao` default hit-test.
///
/// Pure function so the test suite can exercise the corner geometry
/// without standing up a real `HWND`.
#[cfg(target_os = "windows")]
pub(crate) fn classify_top_resize_hit(
    x: i32,
    y: i32,
    client_width: i32,
    top_px: i32,
    border_x: i32,
) -> Option<u32> {
    use windows::Win32::UI::WindowsAndMessaging::{HTTOP, HTTOPLEFT, HTTOPRIGHT};

    if top_px <= 0 || client_width <= 0 {
        return None;
    }
    if y < 0 || y >= top_px {
        return None;
    }
    if x < 0 || x > client_width {
        return None;
    }

    if x < border_x {
        Some(HTTOPLEFT)
    } else if x >= client_width - border_x {
        Some(HTTOPRIGHT)
    } else {
        Some(HTTOP)
    }
}

/// Subclasses `window`'s HWND so cursor positions within the top
/// `TOP_RESIZE_BORDER_LOGICAL_PX` of the client area report
/// `HTTOP`/`HTTOPLEFT`/`HTTOPRIGHT` from `WM_NCHITTEST`. The
/// installation order matters: comctl32 dispatches subclasses in
/// reverse install order, so this proc runs *before* `tao`'s built-in
/// 4-px hit-test and wins for cursor positions in the expanded band.
/// For positions outside the band we forward to `DefSubclassProc`,
/// preserving every other piece of `tao`/Chromium hit-test behavior
/// (titlebar drag region, side/bottom resize edges, etc.).
///
/// The subclass is skipped while the window is maximized to avoid
/// snagging the OS-supplied edge gestures at the top of the screen.
pub(crate) fn expand_top_resize_border(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
        use windows::Win32::Graphics::Gdi::ScreenToClient;
        use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
        use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetClientRect, IsZoomed, SM_CXFRAME, WM_NCDESTROY, WM_NCHITTEST,
        };

        // Magic number to namespace this subclass on the window so we
        // don't collide with `tao`'s subclass id or any future ones.
        const SUBCLASS_ID: usize = 0xA07A_7E51;

        unsafe extern "system" fn subclass_proc(
            hwnd: HWND,
            msg: u32,
            wparam: WPARAM,
            lparam: LPARAM,
            _id: usize,
            ref_data: usize,
        ) -> LRESULT {
            if msg == WM_NCDESTROY {
                drop(Box::from_raw(ref_data as *mut u32));
                return DefSubclassProc(hwnd, msg, wparam, lparam);
            }

            if msg == WM_NCHITTEST && !IsZoomed(hwnd).as_bool() {
                let top_logical = *(ref_data as *const u32) as f64;
                let dpi = GetDpiForWindow(hwnd);
                if dpi != 0 {
                    let scale = dpi as f64 / 96.0;
                    let top_physical = (top_logical * scale).round() as i32;
                    let border_x = GetSystemMetricsForDpi(SM_CXFRAME, dpi);

                    let raw = lparam.0 as u32;
                    let sx = (raw & 0xffff) as i16 as i32;
                    let sy = ((raw >> 16) & 0xffff) as i16 as i32;
                    let mut pt = POINT { x: sx, y: sy };
                    let mut client = RECT::default();
                    if ScreenToClient(hwnd, &mut pt).as_bool()
                        && GetClientRect(hwnd, &mut client).is_ok()
                    {
                        if let Some(code) = classify_top_resize_hit(
                            pt.x,
                            pt.y,
                            client.right,
                            top_physical,
                            border_x,
                        ) {
                            return LRESULT(code as isize);
                        }
                    }
                }
            }

            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        let ref_data = Box::into_raw(Box::new(TOP_RESIZE_BORDER_LOGICAL_PX)) as usize;
        unsafe {
            // SAFETY: `subclass_proc` has the required `extern "system"`
            // signature and `ref_data` points at a `Box<u32>` we
            // allocated above; ownership is transferred into the
            // subclass and reclaimed in the WM_NCDESTROY branch.
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, ref_data);
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "windows")]
    fn square_corners_uses_donotround_preference() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        let pref = DWM_WINDOW_CORNER_PREFERENCE(1);
        assert_eq!(pref.0, 1, "DWMWCP_DONOTROUND must be 1");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn dwm_corner_preference_size_is_four_bytes() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        assert_eq!(
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>(),
            4,
            "DWM_WINDOW_CORNER_PREFERENCE must be 4 bytes for DwmSetWindowAttribute"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn top_resize_band_classifies_corners_and_middle() {
        use super::classify_top_resize_hit;
        use windows::Win32::UI::WindowsAndMessaging::{HTTOP, HTTOPLEFT, HTTOPRIGHT};

        // 1280×800 client area at 100% DPI: 4 px corner kiss zones and a
        // 10 px tall expanded top band — matching the real production
        // numbers.
        let width = 1280;
        let top = 10;
        let border_x = 4;

        assert_eq!(
            classify_top_resize_hit(0, 0, width, top, border_x),
            Some(HTTOPLEFT),
            "the very top-left pixel must report HTTOPLEFT"
        );
        assert_eq!(
            classify_top_resize_hit(2, 9, width, top, border_x),
            Some(HTTOPLEFT),
            "left corner band extends to top_px-1 vertically and border_x-1 horizontally"
        );
        assert_eq!(
            classify_top_resize_hit(width - 1, 5, width, top, border_x),
            Some(HTTOPRIGHT),
            "the right corner kiss zone must report HTTOPRIGHT"
        );
        assert_eq!(
            classify_top_resize_hit(width / 2, 0, width, top, border_x),
            Some(HTTOP),
            "middle of the top band must report HTTOP"
        );
        assert_eq!(
            classify_top_resize_hit(width / 2, 9, width, top, border_x),
            Some(HTTOP),
            "the bottom row of the expanded band still reports HTTOP"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn cursor_below_or_outside_top_band_passes_through() {
        use super::classify_top_resize_hit;

        let width = 1280;
        let top = 10;
        let border_x = 4;

        // Just below the band: the titlebar drag region / standard
        // client area must take over (returning `None` so the caller
        // forwards to DefSubclassProc).
        assert_eq!(
            classify_top_resize_hit(640, 10, width, top, border_x),
            None
        );
        assert_eq!(
            classify_top_resize_hit(640, 200, width, top, border_x),
            None
        );
        // Negative client coordinates can occur for windows partially
        // off-screen; never claim them.
        assert_eq!(
            classify_top_resize_hit(-1, 5, width, top, border_x),
            None
        );
        assert_eq!(
            classify_top_resize_hit(640, -1, width, top, border_x),
            None
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn top_resize_band_disabled_when_top_px_is_zero() {
        use super::classify_top_resize_hit;

        // Defensive: a misconfigured zero band must not silently turn
        // the entire window edge into a resize handle.
        assert_eq!(classify_top_resize_hit(0, 0, 1280, 0, 4), None);
    }
}
