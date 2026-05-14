# Project Appearance — Persistence Through Reinstall

Use this skill when implementing per-project settings that must survive an app reinstall, a machine migration, or the user moving their project to a different machine. The approach works because the data is stored **inside the project's workspace directory** alongside the user's own files — not in the app's installation directory or a volatile app-data cache.

## Where the data lives

Every project in aura-os has a workspace directory. Appearance data is stored under a `.aura/` subdirectory of that workspace:

```
<workspace>/
  .aura/
    appearance.json   ← all scalar appearance settings
    banner.png        ← optional uploaded banner image
    background.png    ← optional uploaded background image
  <user's project files>
```

The `.aura/` directory is co-located with the project's content, so it travels with the project on every medium: a git commit, a zip, a cloud sync, a drive clone.

### Path resolution (`paths.rs`)

The server prefers the project's `local_workspace_path` when set:

```rust
pub(super) fn appearance_dir(state: &AppState, project_id: &ProjectId) -> PathBuf {
    let local = state
        .project_service
        .get_project(project_id)
        .ok()
        .and_then(|p| p.local_workspace_path.clone())
        // ...
        .map(PathBuf::from);

    let base = local.unwrap_or_else(|| canonical_workspace_path(&state.data_dir, project_id));
    base.join(".aura")
}
```

When `local_workspace_path` is set (the project maps to a real directory on disk), the file is written into the user's actual project directory. When it is not set, the server falls back to `<data_dir>/workspaces/<project_id>/`, which is the app's managed storage. Both paths survive a reinstall — the first because it is the user's own directory, the second because `data_dir` is outside the app installation.

## Rust backend — appearance API

`apps/aura-os-server/src/handlers/appearance/` follows the module-directory pattern from `docs/rust-module-conventions.md`: `mod.rs` holds only re-exports and router wiring; business logic lives in named child files.

**`metadata.rs`** — `GET` and `PUT` for `appearance.json`.
- `GET` returns the stored JSON or an empty object `{}` when no file exists yet. The frontend treats `{}` as "all defaults" — no separate "not configured" sentinel is needed.
- `PUT` validates that the body is a JSON object (not an array or scalar), then writes via atomic `write tmp → rename` to prevent partial reads during concurrent requests.

```rust
tokio::fs::write(&tmp, &bytes).await?;
tokio::fs::rename(&tmp, &path).await?;   // atomic on POSIX and NTFS
```

**`image_asset.rs`** — Shared helper used by both `banner.rs` and `background_image.rs`. Handles multipart upload parsing, MIME validation (PNG/JPEG only), and the same `write tmp → rename` atomic pattern for binary assets.

**`banner.rs` / `background_image.rs`** — Thin wrappers over `image_asset.rs`. Each exposes `GET` (serve the file) and `PUT` (upload). Background additionally has `DELETE` (which also removes the file so no orphaned bytes accumulate on disk).

**`paths.rs`** — Single source of truth for all `.aura/` path resolution. Keeps path logic out of the handler files so neither needs to duplicate the `local_workspace_path` vs. canonical fallback logic.

All route functions are `pub(crate)`, re-exported through `mod.rs`, consistent with the repo's re-export discipline. All endpoints require a valid JWT (`AuthJwt` extractor) and return `401` if the token is missing or invalid.

## Frontend — Zustand store (`project-appearance-store.ts`)

The store is a fetch-and-cache layer over the server. It does **not** use `persist` middleware — there is no `localStorage` or IndexedDB copy. The server file _is_ the persistence layer.

### Fetch-and-cache with deduplication

```ts
load: async (projectId) => {
  const cached = get().entries.get(projectId);
  if (cached?.loaded) return cached.appearance;  // already in memory
  const inflight = get().inflight.get(projectId);
  if (inflight) return inflight;                 // request in flight — return same promise
  // … fetch from server, store result
}
```

Many components can call `load(projectId)` concurrently during sidebar boot without issuing duplicate requests. The `inflight` Map collapses concurrent callers onto a single `Promise`.

### Optimistic updates with rollback

```ts
update: async (projectId, next) => {
  const previous = get().getEntry(projectId).appearance;
  // Apply optimistically so the UI previews instantly:
  set(/* next in store */);
  try {
    const saved = await appearanceApi.update(projectId, next);
    // Server echoes the persisted shape — take it as authoritative:
    set(/* saved in store */);
  } catch (err) {
    // Roll back so the UI doesn't lie about what's persisted:
    set(/* previous in store */);
    throw err;
  }
}
```

The user sees the change in the sidebar immediately while the write completes in the background. If the write fails, the store reverts and the UI reflects the last successfully saved state.

### Binary assets and cache-busting

Banner and background images are not stored in the Zustand state — they are served at predictable URLs (`/api/projects/:id/appearance/banner` and `/api/projects/:id/appearance/background`). The store keeps a monotonic `bannerVersion` / `backgroundImageVersion` counter per project. After upload or delete, the counter increments:

```ts
uploadBanner: async (projectId, blob) => {
  await appearanceApi.uploadBanner(projectId, blob);
  set(/* bannerVersion + 1 */);
}
```

Consumers append `?v=${bannerVersion}` to the image URL. Because the version changes, the browser treats it as a new URL and re-fetches, bypassing the HTTP cache — no stale image after upload or delete.

### JWT on image requests

Browsers do not include the `Authorization` header on `<img>` requests. The server's `extract_request_token` accepts a `?token=` query parameter as a fallback (the same mechanism used by WebSockets and artifact thumbnails). The `withToken()` helper in `use-project-appearance.ts` appends the stored JWT to the image URL before passing it to `<img src>`.

## What "survives reinstall" means concretely

| Scenario | Outcome |
|---|---|
| App reinstalled, same machine | `.aura/` in the user's workspace is untouched; appearances load on first project open |
| Project moved to a new machine | Copy the workspace directory; `.aura/` travels with it |
| Project synced via git | Commit `.aura/appearance.json` (images are typically gitignored) |
| App data directory wiped | If `local_workspace_path` is set, no data loss — the canonical fallback path is only used for projects without a local workspace |

## Extending the pattern

To add a new persisted appearance field:
1. Add the field to `ProjectAppearance` in `interface/src/shared/api/appearance.ts` (TypeScript).
2. The server writes the JSON blob verbatim — no Rust struct change is required for scalar fields. The server validates only that the body is a JSON object; it does not validate individual keys.
3. Wire the new field into the UI (Appearance tab) and `buildProjectRowAppearance` (sidebar display).

To add a new binary asset (a second image type, an audio file, etc.):
1. Add a handler in `apps/aura-os-server/src/handlers/appearance/` following the `image_asset.rs` pattern.
2. Add the route in `router/appearance.rs`.
3. Add a `<name>Version` counter to `AppearanceEntry` in the store and bump it after upload/delete.
4. Expose a cache-busted URL from `use-project-appearance.ts`.
