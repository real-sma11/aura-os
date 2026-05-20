//! Resolve and classify the running app bundle on macOS.
//!
//! `cargo_packager_updater::Update::install` on macOS fails with
//! `Read-only file system (os error 30)` (EROFS) when the running
//! `Aura.app` sits on a read-only mount — most commonly because the user
//! launched the app from an internet-quarantined location and macOS
//! redirected execution through Gatekeeper Path Randomization
//! ("App Translocation"), which serves the bundle from a randomised
//! read-only firmlink under `/private/var/folders/.../AppTranslocation/`.
//! Other variants (running directly from a mounted DMG, MDM-managed
//! read-only `/Applications`) hit the same failure.
//!
//! The upstream crate only retries with `osascript … with administrator
//! privileges` when the rename returns `ErrorKind::PermissionDenied`;
//! EROFS is a different `ErrorKind` and falls straight through, so the
//! user sees an opaque error mid-install. This module exists so the
//! installer can recognise the condition *before* downloading and bail
//! with an actionable message instead.
//!
//! On non-macOS platforms the inspector is a no-op that always reports
//! "writable, not translocated" — Linux and Windows have entirely
//! different update flows that do not share this failure mode.

#[cfg(any(target_os = "macos", test))]
use std::path::Path;
use std::path::PathBuf;

/// Classification of the running app bundle. Cheap to compute and safe
/// to re-run on every install attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BundleLocation {
    /// Absolute path to the running `.app` bundle (or, on Linux/Windows,
    /// the executable itself — the field is platform-best-effort).
    pub path: PathBuf,
    /// `true` when the bundle path contains an `AppTranslocation`
    /// component, i.e. macOS Gatekeeper Path Randomization is active.
    /// Always `false` off macOS.
    pub translocated: bool,
    /// `true` when the filesystem hosting the bundle has the read-only
    /// mount flag set (`MNT_RDONLY` on macOS). Always `false` off macOS.
    pub read_only: bool,
    /// `true` when the bundle is under `/Volumes/` AND the host volume
    /// is read-only — i.e. running from a mounted DMG image. Always
    /// `false` off macOS.
    pub on_dmg: bool,
}

impl BundleLocation {
    /// True when an in-place update *cannot* succeed from this location
    /// regardless of admin privileges (read-only mount can't be written
    /// to even by `root`). The translocation case is included because
    /// the App Translocation mount is also read-only — checking both
    /// flags makes the diagnostics line in `updater.log` self-contained.
    pub fn blocks_in_place_update(&self) -> bool {
        self.translocated || self.read_only
    }

    /// Human-readable reason suitable for the in-app error message.
    /// Mutually exclusive with `blocks_in_place_update() == false`.
    pub fn reason(&self) -> &'static str {
        if self.translocated {
            "App Translocation"
        } else if self.on_dmg {
            "mounted disk image"
        } else if self.read_only {
            "read-only volume"
        } else {
            "writable"
        }
    }

    /// Compact `key=value` summary for `updater.log`. Keeps the existing
    /// log shape (`detail=<one-line>`) intact so existing log tooling
    /// (`rg`, plain text scrubbing) still works.
    pub fn detail(&self) -> String {
        format!(
            "path={} translocated={} read_only={} on_dmg={}",
            self.path.display(),
            self.translocated,
            self.read_only,
            self.on_dmg
        )
    }
}

/// Resolve the running `.app` bundle path. Mirrors the logic that
/// `cargo_packager_updater` uses in `extract_path_from_executable`: walk
/// three parents up from the executable (`Foo.app/Contents/MacOS/foo`
/// -> `Foo.app`). Off macOS this just returns `current_exe()` because
/// the `.app` concept doesn't apply.
pub(crate) fn resolve_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("failed to resolve current executable path: {e}"))?;
    #[cfg(target_os = "macos")]
    {
        // <app>.app/Contents/MacOS/<exe>  ->  <app>.app
        let bundle = exe
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf);
        if let Some(bundle) = bundle {
            if bundle.extension().and_then(|s| s.to_str()) == Some("app") {
                return Ok(bundle);
            }
        }
        // Dev / unbundled builds (e.g. `cargo run`) — fall back to the
        // executable itself so callers can still log a sensible path.
        Ok(exe)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(exe)
    }
}

/// Classify a candidate path. Pure function, exposed for unit testing
/// without needing a real `.app` on disk. The `read_only` flag is left
/// to the caller because the on-disk probe (`statfs`) cannot be
/// expressed as a path classification.
///
/// Compiled out of non-macOS / non-test builds because the result has
/// no meaning on Linux / Windows — `inspect_bundle` reports
/// `translocated == false, on_dmg == false` unconditionally there.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn classify_path(path: &Path) -> (bool, bool) {
    let translocated = path
        .components()
        .any(|c| c.as_os_str() == "AppTranslocation");
    let on_dmg = path
        .components()
        .nth(1)
        .map(|c| c.as_os_str() == "Volumes")
        .unwrap_or(false);
    (translocated, on_dmg)
}

#[cfg(target_os = "macos")]
fn is_read_only(path: &Path) -> Result<bool, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|e| format!("failed to convert {} to C string: {e}", path.display()))?;

    // `libc::statfs` is the macOS / BSD equivalent of `statvfs`; it
    // returns a `MNT_RDONLY` bit in `f_flags` for read-only mounts. We
    // call it directly rather than going through `nix` to avoid a
    // dependency for one syscall.
    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c_path` is a valid NUL-terminated C string for the
    // lifetime of the call; `stat` is a writable `statfs` allocation.
    let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        return Err(format!("statfs({}) failed: {err}", path.display()));
    }
    Ok((stat.f_flags & libc::MNT_RDONLY as u32) != 0)
}

/// Inspect the running bundle. Errors only when `current_exe()` itself
/// fails — every other failure (`statfs`, missing `.app` extension on a
/// dev build, …) degrades to "writable, not translocated" so the
/// updater can still attempt the install. This bias is intentional: a
/// false positive here would block legitimate updates, while a false
/// negative just lets the existing failure path surface as before.
pub(crate) fn inspect_bundle() -> Result<BundleLocation, String> {
    let path = resolve_bundle_path()?;

    #[cfg(target_os = "macos")]
    {
        let (translocated, on_dmg_path) = classify_path(&path);
        let read_only = is_read_only(&path).unwrap_or(false);
        let on_dmg = on_dmg_path && read_only;
        Ok(BundleLocation {
            path,
            translocated,
            read_only,
            on_dmg,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(BundleLocation {
            path,
            translocated: false,
            read_only: false,
            on_dmg: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn translocation_path_is_flagged() {
        let path = PathBuf::from("/private/var/folders/abc/T/AppTranslocation/UUID/d/Aura.app");
        let (translocated, on_dmg) = classify_path(&path);
        assert!(translocated);
        assert!(!on_dmg);
    }

    #[test]
    fn volumes_path_is_flagged_as_dmg() {
        let path = PathBuf::from("/Volumes/Aura/Aura.app");
        let (translocated, on_dmg) = classify_path(&path);
        assert!(!translocated);
        assert!(on_dmg);
    }

    #[test]
    fn applications_path_is_clean() {
        let path = PathBuf::from("/Applications/Aura.app");
        let (translocated, on_dmg) = classify_path(&path);
        assert!(!translocated);
        assert!(!on_dmg);
    }

    #[test]
    fn user_applications_path_is_clean() {
        let path = PathBuf::from("/Users/test/Applications/Aura.app");
        let (translocated, on_dmg) = classify_path(&path);
        assert!(!translocated);
        assert!(!on_dmg);
    }

    #[test]
    fn detail_string_contains_all_flags() {
        let loc = BundleLocation {
            path: PathBuf::from("/Applications/Aura.app"),
            translocated: false,
            read_only: false,
            on_dmg: false,
        };
        let detail = loc.detail();
        assert!(detail.contains("path=/Applications/Aura.app"));
        assert!(detail.contains("translocated=false"));
        assert!(detail.contains("read_only=false"));
        assert!(detail.contains("on_dmg=false"));
    }

    #[test]
    fn blocks_in_place_update_combines_translocation_and_read_only() {
        let translocated = BundleLocation {
            path: PathBuf::from("/x"),
            translocated: true,
            read_only: false,
            on_dmg: false,
        };
        assert!(translocated.blocks_in_place_update());
        assert_eq!(translocated.reason(), "App Translocation");

        let read_only = BundleLocation {
            path: PathBuf::from("/x"),
            translocated: false,
            read_only: true,
            on_dmg: false,
        };
        assert!(read_only.blocks_in_place_update());
        assert_eq!(read_only.reason(), "read-only volume");

        let on_dmg = BundleLocation {
            path: PathBuf::from("/x"),
            translocated: false,
            read_only: true,
            on_dmg: true,
        };
        assert!(on_dmg.blocks_in_place_update());
        assert_eq!(on_dmg.reason(), "mounted disk image");

        let writable = BundleLocation {
            path: PathBuf::from("/x"),
            translocated: false,
            read_only: false,
            on_dmg: false,
        };
        assert!(!writable.blocks_in_place_update());
        assert_eq!(writable.reason(), "writable");
    }
}
