//! macOS Accessibility (synthetic-input) permission preflight.
//!
//! Synthetic mouse/keyboard input via CGEvent requires the app to be trusted
//! under System Settings > Privacy & Security > Accessibility. This entire
//! module is `cfg(target_os = "macos")`; callers gate on the same cfg and treat
//! non-macOS platforms as always-granted.

// Links the parameterless `AXIsProcessTrusted` predicate from the
// ApplicationServices framework.
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Whether this process is trusted to synthesize input on macOS.
pub(crate) fn accessibility_granted() -> bool {
    // SAFETY: `AXIsProcessTrusted` is a side-effect-free C predicate that takes
    // no arguments and returns a bool; there is nothing to misuse.
    unsafe { AXIsProcessTrusted() }
}
