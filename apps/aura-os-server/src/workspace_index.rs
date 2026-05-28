//! Workspace manifest digest seeded into the chat system prompt.
//!
//! Phase 4 of the reread-efficiency plan: the agent burns turns at task
//! start by reading every `Cargo.toml` to figure out what crates exist
//! in the workspace. This module pre-computes a compact digest once per
//! session — root manifest + every member manifest — and renders a
//! `<workspace_index>` block that the chat handler appends to the
//! server-baked `agent_system_prompt` addenda. The next time the model
//! starts a turn it sees the answer to "what crates / features / deps
//! exist?" inline, no tool calls required.
//!
//! The digest is cached at `<repo_root>/.aura/workspace-index.json`
//! keyed by SHA-256 of `Cargo.lock`; a stale lockfile invalidates the
//! cache so a fresh `cargo update` automatically reseeds. Parse
//! failures are swallowed silently — the chat path must never fail
//! because a workspace manifest is malformed.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Env knob: any non-empty / non-`0` value disables the
/// `<workspace_index>` block. Lets operators bypass the digest for
/// debugging or fall back to the pre-Phase-4 prompt shape without a
/// rebuild.
const DISABLE_ENV: &str = "AURA_DISABLE_WORKSPACE_INDEX";

/// Cap on the total number of dependency names rendered across every
/// member row. Beyond this we truncate with a trailing `...` so the
/// prompt body stays bounded on workspaces with hundreds of crates.
const MAX_DEP_NAMES: usize = 200;

/// Cap on the workspace-level dependency list rendered in the trailing
/// `Workspace dependencies:` line. Same truncation contract.
const MAX_WORKSPACE_DEPS: usize = 80;

/// One member crate's row in the workspace digest. Field semantics:
///
/// * `relative_path`: path relative to `repo_root`, exactly as it
///   appeared in `[workspace].members` (no glob expansion artefacts).
/// * `package_name`: `[package].name` from the member manifest.
/// * `features`: top-level `[features]` keys.
/// * `dependencies`: union of `[dependencies]`, `[dev-dependencies]`,
///   and `[build-dependencies]` keys, deduped + sorted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceMember {
    pub relative_path: String,
    pub package_name: String,
    pub features: Vec<String>,
    pub dependencies: Vec<String>,
}

/// Compact workspace digest serialised into the
/// `.aura/workspace-index.json` cache and rendered into the chat
/// system prompt by [`render_workspace_index_block`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceIndex {
    pub members: Vec<WorkspaceMember>,
    pub workspace_dependencies: Vec<String>,
    pub root_features: Vec<String>,
    /// Hex-encoded SHA-256 of `Cargo.lock`. Used as the cache key.
    /// Empty string when the lockfile is missing — we still cache the
    /// parse but a future load with a real lockfile will repopulate.
    pub cargo_lock_hash: String,
}

/// Load the workspace digest, preferring the on-disk cache when its
/// `cargo_lock_hash` matches the current `Cargo.lock`. Otherwise
/// re-parse the workspace and rewrite the cache file.
///
/// Errors only on the fresh-parse path when the root manifest is
/// missing or unreadable — cache I/O failures are best-effort and do
/// not propagate.
pub fn load_workspace_index(repo_root: &Path) -> anyhow::Result<WorkspaceIndex> {
    let cargo_lock_hash = hash_cargo_lock(repo_root);
    let cache_path = cache_path(repo_root);

    if let Some(cached) = read_cache(&cache_path) {
        if cached.cargo_lock_hash == cargo_lock_hash && !cargo_lock_hash.is_empty() {
            return Ok(cached);
        }
    }

    let mut index = parse_workspace(repo_root)?;
    index.cargo_lock_hash = cargo_lock_hash;
    write_cache(&cache_path, &index);
    Ok(index)
}

/// High-level entrypoint for the chat handler: returns the rendered
/// `<workspace_index>` block, or `None` when the env knob disables the
/// feature, the workspace can't be parsed, or rendering produces an
/// empty body. Never panics — callers can safely chain this into the
/// system-prompt assembly.
pub fn build_workspace_index_block(repo_root: &Path) -> Option<String> {
    if is_disabled() {
        return None;
    }
    let index = load_workspace_index(repo_root).ok()?;
    let block = render_workspace_index_block(&index);
    if block.trim().is_empty() {
        None
    } else {
        Some(block)
    }
}

/// Render the digest as the `<workspace_index source="cached:<hash>">`
/// block embedded in the chat system prompt. Public so the integration
/// test can exercise the exact body the chat handler appends.
pub fn render_workspace_index_block(index: &WorkspaceIndex) -> String {
    let short_hash = short_hash(&index.cargo_lock_hash);
    let mut out = String::new();
    out.push_str(&format!(
        "<workspace_index source=\"cached:{short_hash}\">\n"
    ));
    out.push_str(&format!("  Workspace members ({}):\n", index.members.len()));

    let mut budget_left = MAX_DEP_NAMES;
    for member in &index.members {
        let features = if member.features.is_empty() {
            String::new()
        } else {
            format!(" [features: {}]", member.features.join(", "))
        };
        let deps = render_member_deps(&member.dependencies, &mut budget_left);
        out.push_str(&format!(
            "    - {} :: {}{}{}\n",
            member.relative_path, member.package_name, features, deps
        ));
    }

    out.push_str(&format!(
        "  Workspace dependencies: {}\n",
        comma_list_capped(&index.workspace_dependencies, MAX_WORKSPACE_DEPS)
    ));
    out.push_str(&format!(
        "  Root features: {}\n",
        if index.root_features.is_empty() {
            "(none)".to_string()
        } else {
            index.root_features.join(", ")
        }
    ));
    out.push_str("</workspace_index>");
    out
}

fn render_member_deps(deps: &[String], budget_left: &mut usize) -> String {
    if deps.is_empty() {
        return String::new();
    }
    if *budget_left == 0 {
        return " (deps: ...)".to_string();
    }
    let take = deps.len().min(*budget_left);
    let truncated = take < deps.len();
    *budget_left -= take;
    let suffix = if truncated { ", ..." } else { "" };
    format!(" (deps: {}{})", deps[..take].join(", "), suffix)
}

fn comma_list_capped(items: &[String], cap: usize) -> String {
    if items.is_empty() {
        return "(none)".to_string();
    }
    if items.len() <= cap {
        return items.join(", ");
    }
    let mut out = items[..cap].join(", ");
    out.push_str(", ...");
    out
}

fn short_hash(hash: &str) -> String {
    if hash.is_empty() {
        return "none".to_string();
    }
    let len = hash.len().min(12);
    hash[..len].to_string()
}

fn is_disabled() -> bool {
    std::env::var(DISABLE_ENV)
        .map(|v| !v.is_empty() && v != "0")
        .unwrap_or(false)
}

fn cache_path(repo_root: &Path) -> std::path::PathBuf {
    repo_root.join(".aura").join("workspace-index.json")
}

fn hash_cargo_lock(repo_root: &Path) -> String {
    let lock_path = repo_root.join("Cargo.lock");
    match fs::read(&lock_path) {
        Ok(bytes) => {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            hex::encode(hasher.finalize())
        }
        Err(_) => String::new(),
    }
}

fn read_cache(path: &Path) -> Option<WorkspaceIndex> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(path: &Path, idx: &WorkspaceIndex) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(idx) {
        let _ = fs::write(path, json);
    }
}

fn parse_workspace(repo_root: &Path) -> anyhow::Result<WorkspaceIndex> {
    let root_toml_path = repo_root.join("Cargo.toml");
    let raw = fs::read_to_string(&root_toml_path)?;
    let parsed: toml::Value = toml::from_str(&raw)?;

    let mut members_paths: Vec<String> = Vec::new();
    let mut workspace_dependencies: Vec<String> = Vec::new();
    if let Some(ws) = parsed.get("workspace") {
        if let Some(arr) = ws.get("members").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    members_paths.push(s.to_string());
                }
            }
        }
        if let Some(deps) = ws.get("dependencies").and_then(|v| v.as_table()) {
            workspace_dependencies = deps.keys().cloned().collect();
        }
    }
    workspace_dependencies.sort();
    workspace_dependencies.dedup();

    let root_features = parsed
        .get("features")
        .and_then(|v| v.as_table())
        .map(|t| t.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let mut members = Vec::new();
    for rel in expand_member_paths(repo_root, &members_paths) {
        let abs = repo_root.join(&rel);
        if let Some(member) = parse_member(&rel, &abs) {
            members.push(member);
        }
    }
    members.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(WorkspaceIndex {
        members,
        workspace_dependencies,
        root_features,
        cargo_lock_hash: String::new(),
    })
}

/// Expand `members` entries: literal paths pass through; trailing-`*`
/// patterns like `crates/*` enumerate immediate subdirectories that
/// contain a `Cargo.toml`. Cargo's full glob grammar is broader, but
/// the workspaces we ship use either literal paths (current state) or
/// the `prefix/*` shape, so we keep this minimal and predictable.
fn expand_member_paths(repo_root: &Path, raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for entry in raw {
        if let Some(prefix) = entry.strip_suffix("/*") {
            let dir = repo_root.join(prefix);
            if let Ok(rd) = fs::read_dir(&dir) {
                for de in rd.flatten() {
                    let path = de.path();
                    if !path.join("Cargo.toml").is_file() {
                        continue;
                    }
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        out.push(format!("{prefix}/{name}"));
                    }
                }
            }
        } else if !entry.contains('*') {
            out.push(entry.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}

fn parse_member(rel: &str, abs: &Path) -> Option<WorkspaceMember> {
    let toml_path = abs.join("Cargo.toml");
    let raw = fs::read_to_string(&toml_path).ok()?;
    let parsed: toml::Value = toml::from_str(&raw).ok()?;

    let package_name = parsed
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let mut features: Vec<String> = parsed
        .get("features")
        .and_then(|v| v.as_table())
        .map(|t| t.keys().cloned().collect())
        .unwrap_or_default();
    features.sort();

    let mut dependencies: Vec<String> = Vec::new();
    for section in ["dependencies", "dev-dependencies", "build-dependencies"] {
        if let Some(t) = parsed.get(section).and_then(|v| v.as_table()) {
            dependencies.extend(t.keys().cloned());
        }
    }
    dependencies.sort();
    dependencies.dedup();

    Some(WorkspaceMember {
        relative_path: rel.to_string(),
        package_name,
        features,
        dependencies,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;
    use tempfile::tempdir;

    /// Cargo runs in-crate tests in parallel by default, but
    /// [`DISABLE_ENV`] is process-global. Any test that reads or
    /// writes the env var must hold this lock so it doesn't race the
    /// render test (which checks `build_workspace_index_block`'s
    /// happy-path output and would see `None` if another thread had
    /// just set the disable flag).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn write(p: &Path, body: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, body).unwrap();
    }

    /// Build a tiny but realistic workspace under `root`:
    ///   crates/alpha   (features `a`, `b`; deps serde + tokio)
    ///   crates/beta    (no features; dev-dep tempfile)
    /// plus a Cargo.lock with deterministic contents.
    fn seed_workspace(root: &Path) {
        write(
            &root.join("Cargo.toml"),
            r#"
[workspace]
members = ["crates/alpha", "crates/beta"]
resolver = "2"

[workspace.dependencies]
serde = "1"
tokio = "1"

[features]
ws-feat = []
"#,
        );
        write(
            &root.join("Cargo.lock"),
            "# initial lockfile contents\n[[package]]\nname = \"alpha\"\n",
        );
        write(
            &root.join("crates/alpha/Cargo.toml"),
            r#"
[package]
name = "alpha"
version = "0.1.0"

[features]
a = []
b = []

[dependencies]
serde = "1"
tokio = "1"
"#,
        );
        write(
            &root.join("crates/beta/Cargo.toml"),
            r#"
[package]
name = "beta"
version = "0.1.0"

[dependencies]
serde = "1"

[dev-dependencies]
tempfile = "3"
"#,
        );
    }

    #[test]
    fn load_workspace_index_round_trips_through_cache() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        seed_workspace(root);

        let first = load_workspace_index(root).expect("first load parses workspace");
        assert_eq!(first.members.len(), 2);
        assert_eq!(first.members[0].package_name, "alpha");
        assert!(!first.cargo_lock_hash.is_empty());

        // Mutate alpha's Cargo.toml *without* touching Cargo.lock — a
        // real cache hit must return the original parse and ignore the
        // tampered manifest. The "package_name = old" assertion below
        // is the cache-hit signal.
        write(
            &root.join("crates/alpha/Cargo.toml"),
            r#"
[package]
name = "alpha-renamed"
version = "0.1.0"

[dependencies]
serde = "1"
"#,
        );

        let second = load_workspace_index(root).expect("second load returns cached struct");
        assert_eq!(
            second, first,
            "second load must hit the .aura cache and return the original digest verbatim"
        );

        // Cache file actually exists on disk where we expect it.
        let cache = root.join(".aura").join("workspace-index.json");
        assert!(cache.is_file(), "cache file should be persisted");
    }

    #[test]
    fn cache_invalidates_when_cargo_lock_hash_changes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        seed_workspace(root);

        let first = load_workspace_index(root).expect("first load");
        let first_hash = first.cargo_lock_hash.clone();

        // Bump the lockfile so its sha changes; also rename alpha so
        // we can prove the second load really re-parsed the workspace.
        fs::write(
            root.join("Cargo.lock"),
            "# updated lockfile\n[[package]]\nname = \"alpha-bumped\"\n",
        )
        .unwrap();
        write(
            &root.join("crates/alpha/Cargo.toml"),
            r#"
[package]
name = "alpha-bumped"
version = "0.2.0"

[dependencies]
serde = "1"
"#,
        );

        let second = load_workspace_index(root).expect("second load reparses");
        assert_ne!(
            second.cargo_lock_hash, first_hash,
            "cargo_lock_hash must change when Cargo.lock contents change"
        );
        let alpha = second
            .members
            .iter()
            .find(|m| m.relative_path == "crates/alpha")
            .expect("alpha member present");
        assert_eq!(alpha.package_name, "alpha-bumped");
    }

    #[test]
    fn workspace_index_renders_into_project_context_block() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        seed_workspace(root);

        let block =
            build_workspace_index_block(root).expect("block renders for a well-formed workspace");

        assert!(
            block.starts_with("<workspace_index source=\"cached:"),
            "block opens with the expected tag, got: {block}"
        );
        assert!(block.ends_with("</workspace_index>"));
        assert!(block.contains("Workspace members (2):"));
        assert!(block.contains("- crates/alpha :: alpha [features: a, b]"));
        assert!(block.contains("(deps: serde, tokio)"));
        assert!(block.contains("- crates/beta :: beta"));
        assert!(block.contains("Workspace dependencies: serde, tokio"));
        assert!(block.contains("Root features: ws-feat"));
    }

    #[test]
    fn missing_root_manifest_is_silent() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempdir().unwrap();
        // No Cargo.toml at all.
        assert!(build_workspace_index_block(tmp.path()).is_none());
    }

    #[test]
    fn disable_env_suppresses_block() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempdir().unwrap();
        seed_workspace(tmp.path());

        let key = DISABLE_ENV;
        let prev = std::env::var(key).ok();
        std::env::set_var(key, "1");
        let block = build_workspace_index_block(tmp.path());
        match prev {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
        assert!(
            block.is_none(),
            "AURA_DISABLE_WORKSPACE_INDEX must suppress the block"
        );
    }
}
