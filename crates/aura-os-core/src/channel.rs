//! Build-time channel selector.
//!
//! AURA ships in two flavors that must coexist on a developer's machine:
//!
//! - **Stable** — the published, installer-built artifact. Owns the canonical
//!   data dir, ports, mutex name, window title, and skills tree.
//! - **Dev** — what `cargo run` (and the `scripts/dev/*` runners) produce.
//!   Uses parallel-but-distinct identifiers so a developer can run a dev build
//!   while the installed stable build is also running, and neither steps on
//!   the other's files, ports, single-instance lock, or skills.
//!
//! Selection is driven by cargo features on this crate (`stable-channel`
//! and `dev-channel`). This crate has **no default channel** so that
//! library crates depending on `aura-os-core` (with
//! `default-features = false`, which they must do) cannot accidentally
//! pin the workspace to a channel via Cargo feature unification — a
//! regression that previously caused the published "stable" installer
//! to run as Dev at runtime (same mutex, same `~/AppData/Local/aura-dev`
//! data dir, "AURA Dev" window title) because transitive library deps
//! pulled in `aura-os-core`'s old `default = ["dev-channel"]`.
//!
//! The two binary crates (`aura-os-desktop`, `aura-os-server`) own
//! channel selection: plain `cargo run` activates their
//! `default = ["dev-channel"]` (which forwards
//! `aura-os-core/dev-channel`); the release pipeline builds Stable via
//! `--no-default-features --features stable-channel` (which forwards
//! `aura-os-core/stable-channel`). `stable-channel` takes precedence
//! when both happen to be set, so any future re-pollution can never
//! silently downgrade a stable build to Dev. When neither feature is
//! set (e.g. `cargo test -p aura-os-events` exercising only library
//! crates), the fallback is Dev so plain library-level tinkering keeps
//! pointing at the Dev data dir.
//!
//! Because the answer is `cfg!(...)`-based, it is a `const fn` and is
//! baked into the binary at compile time — there is no env-var override
//! and no risk of "stable build acting like dev" at runtime.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Dev,
}

impl Channel {
    pub const fn current() -> Self {
        // `stable-channel` wins explicitly so that even if a future
        // refactor reintroduces a transitive `dev-channel` activation
        // through feature unification, a release build configured with
        // `--features stable-channel` still resolves to Stable rather
        // than silently degrading. Plain `cargo build` / `cargo test`
        // for a library crate (no channel feature on) falls back to
        // Dev so day-to-day development keeps writing to the
        // `aura-dev` data dir.
        if cfg!(feature = "stable-channel") {
            Self::Stable
        } else {
            Self::Dev
        }
    }

    pub const fn is_dev(self) -> bool {
        matches!(self, Self::Dev)
    }

    /// Subdirectory name under `dirs::data_local_dir()` (and equivalent) for
    /// the per-user AURA data root.
    pub const fn data_dir_name(self) -> &'static str {
        match self {
            Self::Stable => "aura",
            Self::Dev => "aura-dev",
        }
    }

    /// Directory name under the user's home for the global skills tree
    /// (`~/<this>/skills`). Kept distinct from `data_dir_name` because the
    /// historical layout puts skills under `~/.aura/skills`, not under the
    /// data dir.
    pub const fn skills_home_name(self) -> &'static str {
        match self {
            Self::Stable => ".aura",
            Self::Dev => ".aura-dev",
        }
    }

    /// Windows named-mutex string used to enforce single-instance behavior of
    /// the desktop shell. Must be unique per channel so dev + stable can run
    /// concurrently on Windows.
    pub const fn single_instance_mutex(self) -> &'static str {
        match self {
            Self::Stable => "Local\\com.aura.desktop.single-instance",
            Self::Dev => "Local\\com.aura.desktop-dev.single-instance",
        }
    }

    /// Native window title and macOS About/menu label.
    pub const fn window_title(self) -> &'static str {
        match self {
            Self::Stable => "AURA",
            Self::Dev => "AURA Dev",
        }
    }

    /// Preferred port for the embedded Axum server inside the desktop shell.
    /// Falls back to an OS-assigned ephemeral port if this is taken.
    pub const fn preferred_desktop_port(self) -> u16 {
        match self {
            Self::Stable => 19847,
            Self::Dev => 19848,
        }
    }

    /// Default port for the standalone `aura-os-server` binary when
    /// `AURA_SERVER_PORT` is unset.
    pub const fn default_standalone_port(self) -> u16 {
        match self {
            Self::Stable => 3100,
            Self::Dev => 3101,
        }
    }

    /// Preferred port for the bundled local harness sidecar that the desktop
    /// shell auto-spawns.
    pub const fn preferred_sidecar_port(self) -> u16 {
        match self {
            Self::Stable => 19080,
            Self::Dev => 19081,
        }
    }

    /// Default port the `aura-os-harness` library assumes for
    /// `LOCAL_HARNESS_URL` when the env var is unset.
    pub const fn default_harness_port(self) -> u16 {
        match self {
            Self::Stable => 8080,
            Self::Dev => 8081,
        }
    }

    /// Default port for the Vite dev server when the dev scripts launch it.
    pub const fn default_vite_port(self) -> u16 {
        match self {
            Self::Stable => 5173,
            Self::Dev => 5174,
        }
    }

    /// Whether the in-app auto-updater should run. Dev builds are produced
    /// from local source via `cargo run`, so they must never silently replace
    /// themselves with the published stable installer.
    pub const fn updater_enabled(self) -> bool {
        matches!(self, Self::Stable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_matches_feature_flag() {
        // `stable-channel` is the only feature that can produce Stable —
        // not "anything other than dev-channel", because both features
        // can be active simultaneously under feature unification and
        // Stable must win in that case (the actual bug that motivated
        // this module: the published stable installer was silently
        // running as Dev because a transitive library dep pulled in
        // `dev-channel`).
        let c = Channel::current();
        if cfg!(feature = "stable-channel") {
            assert_eq!(c, Channel::Stable);
            assert_eq!(c.data_dir_name(), "aura");
            assert_eq!(c.skills_home_name(), ".aura");
            assert!(c.updater_enabled());
        } else {
            // Both `dev-channel` and "neither feature" land here. The
            // neither-feature branch is the cargo-test-on-a-library
            // case that used to be impossible because aura-os-core had
            // `default = ["dev-channel"]`; it's now reachable and must
            // still produce sensible Dev identifiers.
            assert_eq!(c, Channel::Dev);
            assert_eq!(c.data_dir_name(), "aura-dev");
            assert_eq!(c.skills_home_name(), ".aura-dev");
            assert!(!c.updater_enabled());
        }
    }

    #[test]
    fn channels_disagree_on_every_identifier() {
        let s = Channel::Stable;
        let d = Channel::Dev;
        assert_ne!(s.data_dir_name(), d.data_dir_name());
        assert_ne!(s.skills_home_name(), d.skills_home_name());
        assert_ne!(s.single_instance_mutex(), d.single_instance_mutex());
        assert_ne!(s.window_title(), d.window_title());
        assert_ne!(s.preferred_desktop_port(), d.preferred_desktop_port());
        assert_ne!(s.default_standalone_port(), d.default_standalone_port());
        assert_ne!(s.preferred_sidecar_port(), d.preferred_sidecar_port());
        assert_ne!(s.default_harness_port(), d.default_harness_port());
        assert_ne!(s.default_vite_port(), d.default_vite_port());
        assert_ne!(s.updater_enabled(), d.updater_enabled());
    }
}
