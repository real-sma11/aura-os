# Persistence — Project Workspace + App-Wide Server-Backed Patterns

Use this skill any time you add a user-facing setting that needs to survive an app reinstall, a machine migration, or both. The repo has two distinct persistence patterns; pick by **scope**, not by "ease":

| Setting scope | Pattern | Reinstall-safe? | Survives moving to a new machine? |
|---|---|---|---|
| **Per-project** (data conceptually belongs to one project) | Project workspace — `<workspace>/.aura/*` | ✅ | ✅ (travels with the workspace) |
| **App-wide / per-user** (data conceptually belongs to the user, not any project) | Server preferences endpoint — `/api/preferences/*` with write-through + post-login hydrate | ✅ | ❌ (per-machine local cache, plus per-machine server install) |
| **Ephemeral / cosmetic only** (you genuinely don't care if it survives a reinstall) | `localStorage` / IndexedDB only | ❌ | ❌ |

The first two patterns are the defaults. Don't reach for the third unless the user explicitly says "I don't care if this is lost on reinstall."

---

## Pattern A — Per-Project (`.aura/` in the workspace)

Use when the setting is conceptually part of the project: it should travel with the project on every medium (zip, git, cloud sync, drive clone) and load the moment any device opens that project.

### Where the data lives

```
<workspace>/
  .aura/
    appearance.json   ← all scalar appearance settings
    banner.png        ← optional uploaded banner image
    background.png    ← optional uploaded background image
  <user's project files>
```

The `.aura/` directory is co-located with the project's content. It is the user's data, not the app's — that's what makes it reinstall-proof and machine-portable.

### Path resolution (`apps/aura-os-server/src/handlers/appearance/paths.rs`)

```rust
pub(super) fn appearance_dir(state: &AppState, project_id: &ProjectId) -> PathBuf {
    let local = state
        .project_service
        .get_project(project_id)
        .ok()
        .and_then(|p| p.local_workspace_path.clone())
        .map(PathBuf::from);

    let base = local.unwrap_or_else(|| canonical_workspace_path(&state.data_dir, project_id));
    base.join(".aura")
}
```

If `local_workspace_path` is set (the project maps to a real directory on disk), the file is written into the user's actual project directory. If not, the server falls back to `<data_dir>/workspaces/<project_id>/` — still outside the app installation, so still reinstall-safe.

### Rust backend (`apps/aura-os-server/src/handlers/appearance/`)

`mod.rs` holds only re-exports and router wiring; business logic lives in named child files (`metadata.rs`, `banner.rs`, `background_image.rs`, `image_asset.rs`, `paths.rs`).

- `metadata.rs` — `GET` returns the stored JSON or `{}` for "all defaults" (no separate "not configured" sentinel). `PUT` validates that the body is a JSON object, then writes via atomic `write tmp → rename`.
- `image_asset.rs` — Shared helper for both image handlers: multipart upload parsing, MIME validation (PNG/JPEG only), atomic `write tmp → rename` for binary assets.
- `banner.rs` / `background_image.rs` — Thin wrappers over `image_asset.rs`. Each exposes `GET` (serve) and `PUT` (upload). Background adds `DELETE` (also removes the file).

All endpoints require a valid JWT (`AuthJwt` extractor) and return `401` if missing.

### Frontend Zustand store (`interface/src/stores/project-appearance-store.ts`)

Fetch-and-cache layer over the server. **No `persist` middleware** — the server file _is_ the persistence layer.

- **Deduplicated loads**: an `inflight` Map collapses concurrent `load(projectId)` calls onto a single promise.
- **Optimistic updates with rollback**: apply locally, await the server, replace with the server's echoed shape (authoritative), revert on failure.
- **Binary assets**: not in Zustand state — served at predictable URLs (`/api/projects/:id/appearance/banner`) with a monotonic `bannerVersion` counter the store bumps after upload/delete. Consumers append `?v=${bannerVersion}` to bypass the HTTP cache after writes.
- **JWT on `<img>` requests**: browsers don't send `Authorization` on image requests, so the server's `extract_request_token` accepts `?token=` as a fallback (same mechanism used by WebSockets and artifact thumbnails). `withToken()` in `use-project-appearance.ts` appends the JWT before passing to `<img src>`.

### Extending Pattern A

To add a new persisted scalar field:
1. Add the field to `ProjectAppearance` in `interface/src/shared/api/appearance.ts`.
2. The server writes the JSON blob verbatim — no Rust struct change is required.
3. Wire the new field into the UI (Appearance tab) and `buildProjectRowAppearance` (sidebar display).

To add a new binary asset (a second image type, audio, etc.):
1. New handler in `apps/aura-os-server/src/handlers/appearance/` following `image_asset.rs`.
2. Add the route in `router/appearance.rs`.
3. Add a `<name>Version` counter in the store and bump after upload/delete.
4. Expose a cache-busted URL from `use-project-appearance.ts`.

---

## Pattern B — App-Wide / Per-User (`/api/preferences/*` with write-through)

Use when the setting belongs to the user, not any project — theme accent, sidebar order, icon-select accent, keybindings, default model, etc. The data isn't tied to a workspace folder, so the `.aura/` approach doesn't apply. Instead, the server's key-value setting store is the authoritative copy, with a local cache for instant reads.

### Where the data lives

- **Authoritative**: server-side key-value store, keyed by `preferences:<feature>` (e.g. `preferences:agent_order`, `preferences:theme_overrides`). The store is backed by the app's per-user data directory, resolved by `dirs::data_local_dir()` in `apps/aura-os-desktop/src/init/paths.rs` — so the path is platform-appropriate but the semantics are identical on Windows / macOS / Linux:
  - Windows: `%LOCALAPPDATA%\aura-dev` (e.g. `C:\Users\<user>\AppData\Local\aura-dev`)
  - macOS: `~/Library/Application Support/aura-dev`
  - Linux: `$XDG_DATA_HOME/aura-dev`, fallback `~/.local/share/aura-dev`

  All three are outside the app installation directory, so the store survives a clean app reinstall on every desktop platform. File I/O uses atomic `write tmp → rename` which is atomic on POSIX (macOS/Linux) and NTFS (Windows) alike.
- **Local cache**: `localStorage` (or IndexedDB) for instant first-paint. Lives in the desktop platform's embedded WebView user-data dir (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). Always re-validated against the server post-login.

The local cache means a logged-out user still sees the right styling on the very first frame, and a logged-in user on a fresh install still gets their saved data once the post-login hydrate completes.

### Rust backend (`apps/aura-os-server/src/handlers/preferences/`)

Same module-directory shape as `appearance/`: `mod.rs` only re-exports; one child file per feature.

```rust
// apps/aura-os-server/src/handlers/preferences/theme_overrides.rs
const SETTING_KEY: &str = "preferences:theme_overrides";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ThemeOverridesPrefs {
    #[serde(default)]
    pub dark: HashMap<String, String>,
    #[serde(default)]
    pub light: HashMap<String, String>,
    #[serde(default)]
    pub global: HashMap<String, String>,
}

pub(crate) async fn get_theme_overrides(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
) -> ApiResult<Json<ThemeOverridesPrefs>> {
    let prefs = state.store.get_setting(SETTING_KEY)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Ok(Json(prefs))
}

pub(crate) async fn put_theme_overrides(
    AuthJwt(_): AuthJwt,
    State(state): State<AppState>,
    Json(prefs): Json<ThemeOverridesPrefs>,
) -> ApiResult<Json<ThemeOverridesPrefs>> {
    let bytes = serde_json::to_vec(&prefs)?;
    state.store.put_setting(SETTING_KEY, &bytes)?;
    Ok(Json(prefs))
}
```

Notes:
- `#[serde(default)]` on every field so an empty server payload (`{}`) deserializes cleanly to the default — no migration needed when adding fields.
- Storage shape uses `HashMap<String, String>` rather than a typed enum, so frontend schema evolution doesn't require Rust edits.
- Always `AuthJwt`-protected so anonymous reads can't leak user-scoped prefs and anonymous writes can't poison the store.

### Router wiring

```rust
// apps/aura-os-server/src/router/preferences.rs
pub(super) fn preferences_routes() -> Router<AppState> {
    Router::new().route(
        "/api/preferences/theme-overrides",
        get(preferences::get_theme_overrides).put(preferences::put_theme_overrides),
    )
}
```

Register it in `router/mod.rs` alongside the other `_routes()` mergers. The route lives **inside** the `protected_api_router` so the JWT middleware runs before the handler.

### Frontend API (`interface/src/shared/api/preferences.ts`)

```ts
export interface ThemeOverridesPrefs {
  dark: Record<string, string>;
  light: Record<string, string>;
  global: Record<string, string>;
}

export const preferencesApi = {
  getThemeOverrides: (): Promise<ThemeOverridesPrefs> =>
    apiFetch("/api/preferences/theme-overrides"),
  putThemeOverrides: (prefs: ThemeOverridesPrefs): Promise<ThemeOverridesPrefs> =>
    apiFetch("/api/preferences/theme-overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }),
};
```

Register on `api/client.ts` so callers use `api.preferences.X` consistently.

### Write-through helper

Every durable write goes through one helper that does **both** layers:

```ts
function persistStore(next: StoredOverrides): void {
  saveOverrides(next);                                          // localStorage — sync, sets up next page load
  void api.preferences.putThemeOverrides(next).catch(() => {}); // server — best-effort, survives reinstall
}
```

Then replace every `saveOverrides(next)` in the hook/store with `persistStore(next)`. Failed PUTs are intentionally silent — the localStorage write already succeeded, and the next change re-pushes the full blob.

### Post-login hydration

The authoritative copy is on the server, but the local cache might be stale (fresh install, different device). Hydrate after the user is identified, **only when the server has meaningful data** so a fresh-install server response doesn't clobber a richer local state.

```ts
let _hydrationUserId: string | null = null;

useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _hydrationUserId) return;
  _hydrationUserId = userId;
  if (!userId) return;
  void hydrateFromServer();
});

async function hydrateFromServer(): Promise<void> {
  let server;
  try {
    server = await api.preferences.getThemeOverrides();
  } catch {
    return;  // server down / 401 — keep local
  }
  const hasContent =
    Object.keys(server.global).length > 0 ||
    Object.keys(server.dark).length > 0 ||
    Object.keys(server.light).length > 0;
  if (!hasContent) return;  // don't clobber local with a fresh-install empty
  saveOverrides({ dark: server.dark, light: server.light, global: server.global });
  window.dispatchEvent(new CustomEvent("aura-theme-overrides-hydrated"));
}
```

The `hasContent` guard is the load-bearing piece of this pattern. Without it, a user who builds up preferences offline on a device that came online before the server had any data would lose them on the first server response.

### Telling already-mounted hooks to re-read

The subscription writes to localStorage, but mounted hook instances hold their own `useState` snapshot. Emit a custom DOM event after the localStorage write so any mounted hook picks up the new value without remounting:

```ts
useEffect(() => {
  if (typeof window === "undefined") return;
  const handler = () => setStore(loadOverrides());
  window.addEventListener("aura-theme-overrides-hydrated", handler);
  return () => window.removeEventListener("aura-theme-overrides-hydrated", handler);
}, []);
```

This is what makes "open Settings on a fresh install" show the user's saved color the moment the hydrate response lands.

### Which local cache layer? — Variant 1 (localStorage + useState) vs Variant 2 (IndexedDB + Zustand)

The protocol layer above (URL, server module, `AuthJwt`, `hasContent`, `useAuthStore.subscribe`) is non-negotiable — that's what makes Pattern B a coherent pattern. The **local cache layer**, however, has two valid shapes in the codebase. Pick by the state shape and first-paint needs of the new preference; do not try to force convergence.

| | **Variant 1: localStorage + useState** | **Variant 2: IndexedDB + Zustand** |
|---|---|---|
| **Reference PRs** | #20 (theme overrides), #15 (desktop logo) | #16 (agent drag order) |
| **State shape** | Small, self-contained blob | Large, or already part of an existing Zustand store |
| **First-paint reads** | **Synchronous** — applied before first paint | Async — fine if the feature renders progressively after hydrate |
| **Write-through** | Explicit `persistStore(next)` helper: sync `localStorage.setItem` + fire-and-forget `PUT` | Zustand setter mutates state; a `subscribeWithSelector` middleware mirrors to IndexedDB; setter also fires `PUT` |
| **Hydrate dispatch** | Write localStorage + dispatch a custom DOM event (`aura-<feature>-hydrated`) so mounted hook instances re-read | `useStore.setState(...)` — Zustand subscribers auto-re-render |
| **Boot wiring** | Needs a `<FeatureBridge />` in `main.tsx` so the subscription registers | Usually fine — the store is already imported by feature components; verify it loads before auth changes can fire |

**Why both exist:**

- **V1** wins for theme-like prefs that must paint synchronously on the first frame. Theme tokens have to be applied before paint, so localStorage's sync API matters; IndexedDB's async hydration would cause a visible flash.
- **V2** wins when the pref already lives inside a larger Zustand store (e.g. agent order is a field on `useAgentStore` alongside `agents`, `history`, `pinnedAgentIds`). Splitting it into useState+localStorage would split one logical store into two, and the surrounding state is typically too large for localStorage anyway.

**Don't mix variants within one feature.** The write-through helper, hydrate dispatch, and bridge wiring are all coupled to the choice. Pick one and stick with it.

### Mount the bridge (V1 only)

V1 hooks register the `useAuthStore.subscribe` at module load — but the module only runs when something imports it. For theme overrides this is guaranteed because `ThemeOverridesBridge` (which calls `useThemeOverrides()` for its side effects) is rendered in `main.tsx`. When adding a new V1 preference, **make sure something equivalent runs at app boot** — otherwise the subscription never registers and post-login hydration is silently dead.

V2 stores are typically imported by many components, so a bridge usually isn't needed; just verify the store module is loaded before any auth state change can fire.

### Extending Pattern B

To add a new app-wide preference:

1. **Server**: new file in `apps/aura-os-server/src/handlers/preferences/` with `GET`/`PUT` handlers, a `SETTING_KEY` constant, and a `#[derive(Default, Serialize, Deserialize)]` struct with `#[serde(default)]` on every field.
2. **Router**: append the route to `router/preferences.rs` (or add a new `preferences_<feature>.rs` if it deserves its own file).
3. **Frontend API**: extend `preferencesApi` with `get<Feature>()` / `put<Feature>()` methods.
4. **Pick a cache-layer variant** (see "Which local cache layer?" above) — V1 (localStorage + useState) or V2 (IndexedDB + Zustand).
5. **Store/hook**: route every write through that variant's write-through path (V1: explicit `persistStore` helper; V2: Zustand setter + `subscribe` middleware). Add a `useAuthStore.subscribe` block that calls `hydrateFromServer` on user identity change, guarded by a `hasContent` check.
6. **Boot wiring** (V1 only): confirm the file containing the subscription is loaded at app boot — typically a bridge component mounted in `main.tsx`.

### What survives, by scenario

| Scenario | Project pattern (`.aura/`) | App-wide pattern (`/api/preferences/*`) |
|---|---|---|
| App reinstalled, same machine | ✅ workspace untouched | ✅ server store lives in the OS user-data dir (`dirs::data_local_dir()`) outside the app install — same behavior on Windows / macOS / Linux |
| Project moved to a new machine | ✅ `.aura/` travels with it | ❌ pref is per-user-per-machine; would need an upstream user-account service |
| Project synced via git | ✅ commit `.aura/appearance.json` (images typically gitignored) | n/a |
| App data directory wiped | ⚠️ if `local_workspace_path` is set, no loss; otherwise falls back to canonical path (also wiped) | ❌ wiped along with the server store |
| Different machine | ❌ only travels if the workspace travels | ❌ per-machine |

---

## When to use which

- **Conceptually belongs to a project** → Pattern A.
- **Conceptually belongs to a user / the whole app** → Pattern B.
- **Truly disposable, lost-on-reinstall is fine, no server roundtrip wanted** → just `localStorage`. Be honest in the PR description that this WON'T survive a reinstall, and prefer Pattern B if you're unsure.

If you are about to use `localStorage` for anything a user would be annoyed to lose, stop and use Pattern B instead.

## Cross-reference

- PR #15 (desktop logo color) — V1 reference; carries the `handlers/preferences/` + `router/preferences.rs` skeleton and demonstrates the localStorage write-through + `aura-desktop-prefs-hydrated` custom DOM event. Originally shipped against a bespoke `/api/desktop/preferences` endpoint, later migrated to the canonical `/api/preferences/desktop`.
- PR #16 (agent drag order) — V2 reference; uses Zustand `subscribeWithSelector` + IndexedDB for the local cache. First user of the canonical `/api/preferences/<feature>` shape — reference for `AgentOrderPrefs` struct, `hasContent` guard, and `useAuthStore.subscribe` trigger.
- PR #18 (project appearance) — canonical instance of Pattern A; reference for `.aura/` path resolution, atomic writes, binary asset handlers, and the `withToken` JWT-on-img helper.
- PR #20 (icon select accent) — V1 reference for `localStorage`-backed theme tokens; `/api/preferences/theme-overrides` round-trips the full `StoredOverrides` blob (dark + light + global slices), with `ThemeOverridesBridge` mounted in `main.tsx` to register the subscription at boot.
