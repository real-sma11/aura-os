# Architecture Guide

This document is the entry point for contributors and AI agents working on Aura.
It describes how the codebase is organized, what principles govern it, and where
new code should go. For setup and running instructions, see [README.md](README.md).

---

## System Overview

Aura is a desktop application for continuous agentic coding. It turns project
requirements into structured specs, extracts ordered tasks, and runs an
autonomous development loop that executes those tasks against agent workspaces.

The stack has three layers:

```
+-----------------------------------------------+
|  Desktop Shell  (tao + wry WebView)            |
|  apps/aura-os-desktop                          |
+-----------------------------------------------+
|  React + TypeScript SPA                        |
|  interface/                                    |
+-----------------------------------------------+
|  Rust HTTP API  (Axum)                         |
|  apps/aura-os-server + crates/                 |
+-----------------------------------------------+
         |          |          |          |
    aura-harness  aura-network  aura-storage  ...
    (sidecar)     (remote)      (remote)
```

The desktop app embeds the Axum server and renders the React SPA in a native
WebView. The server can also run standalone for web/mobile access. A sidecar
**harness** process handles actual agent execution (LLM calls, tool use,
filesystem access). Remote services are optional; the app works local-only.

---

## Repository Layout

```
aura-os/
  apps/                         # Rust binaries
    aura-os-desktop/            #   Native desktop shell (tao + wry)
    aura-os-server/             #   Axum HTTP API server
    aura-os-ide/                #   IDE window helper library
    aura-run-analyze/           #   Run analysis tooling
  crates/                       # Rust libraries (one concern per crate)
    aura-os-core/               #   Shared types, IDs, enums, settings
    aura-os-store/              #   JSON-backed local key-value store
    aura-os-auth/               #   JWT/session auth against external APIs
    aura-os-agents/             #   Agent templates, instances, lifecycle
    aura-os-sessions/           #   Session lifecycle, context rotation
    aura-os-tasks/              #   Task state machine and transitions
    aura-os-projects/           #   Project service (local + network merge)
    aura-os-orgs/               #   Organization CRUD and members
    aura-os-harness/            #   Harness protocol: WS bridge, automaton client
    aura-os-network/            #   Remote sync client + Orbit integration
    aura-os-storage/            #   Remote execution data client
    aura-os-billing/            #   Credit tiers and balance management
    aura-os-integrations/       #   Third-party integration dispatch
    aura-os-browser/            #   In-app browser (CDP backend)
    aura-os-events/             #   Domain event hub and broadcasting
    aura-os-loops/              #   Dev loop lifecycle and registry
    aura-os-terminal/           #   PTY-based terminal for agent commands
    aura-os-automation/         #   Automation event types
    aura-protocol/              #   Protocol type codegen (Rust <-> TypeScript)
    aura-loop-log-schema/       #   Structured log schema for loop runs
    aura-run-heuristics/        #   Run analysis heuristics
  interface/                    # React 19 + TypeScript SPA (Vite)
    src/
      apps/                     #   Feature-isolated app modules
      shared/                   #   Cross-app API clients, types, hooks, utils
      stores/                   #   Zustand domain stores
      features/                 #   Feature-specific UI (chat-ui, left-menu)
      components/               #   Shared UI components
    ios/                        #   Capacitor iOS shell
    android/                    #   Capacitor Android shell
  skills/                       # Bundled skill catalog (SKILL.md per skill)
  vendor/
    zui/                        #   Vendored ZUI component library
    chromiumoxide/              #   Patched chromiumoxide fork
  infra/evals/                  # Evaluation harnesses and benchmarks
  scripts/                      # Dev, CI, release, and lint automation
  docs/                         # Detailed architecture and strategy docs
```

---

## Domain Model

The core workflow follows a strict hierarchy:

```
Project -> Spec -> Task -> Agent (executes) -> Session (context window)
```

- **Project** owns metadata, specs, tasks, and agent instances.
- **Spec** is an AI-generated implementation plan from project requirements.
- **Task** is a concrete unit of work with lifecycle states:
  `pending -> ready -> in_progress -> done | failed | blocked`.
- **Agent** picks the next available task and executes it against a workspace.
- **Session** is a context window. When it fills past a threshold (~80%), the
  agent auto-forks into a new session with a compressed summary.

---

## Backend Architecture (Rust)

### Workspace Organization

The Cargo workspace has 21 library crates and 4 application crates. Dependencies
flow inward: apps depend on crates, crates depend on `aura-os-core`, and
`aura-os-core` depends on nothing internal.

```
apps/aura-os-server  --->  crates/aura-os-agents  --->  crates/aura-os-core
                     --->  crates/aura-os-harness  --->  crates/aura-os-core
                     --->  crates/aura-os-tasks    --->  crates/aura-os-core
                     ...
```

Each crate owns one domain: agents, tasks, sessions, auth, billing, etc. If you
need to add a new domain, create a new crate rather than widening an existing one.

### Server (aura-os-server)

The server is built with Axum and follows a layered architecture:

```
HTTP request -> auth_guard (JWT middleware) -> handler -> domain service -> store/client -> response
```

Key directories:

| Path | Purpose |
|------|---------|
| `src/app_builder/` | Startup: builds `AppState`, spawns background tasks |
| `src/auth_guard/` | JWT validation, session resolution, PRO enforcement |
| `src/handlers/` | Route handlers organized by domain (agents/, browser/, tasks/, loops/) |
| `src/state/` | `AppState` struct — the central dependency container |

**AppState** is the application's dependency container. It holds domain services,
harness clients, event channels, caches, and configuration. Handlers receive it
via Axum extractors.

**Handler organization** mirrors the API surface. When a handler file exceeds
400 lines, split it into a directory module (see [Rust Module Conventions](#rust-module-conventions)).

### Desktop App (aura-os-desktop)

A native window shell using tao (windowing) + wry (WebView). It:
- Embeds and starts the Axum server
- Renders the React SPA in a WebView (or proxies to Vite in dev)
- Manages a sidecar harness process (unless `--external-harness` is passed)
- Handles single-instance locking, auto-updates, and native menus

### Harness System

The harness is a separate process (sibling repo: `aura-harness`) that performs
actual agent execution: LLM API calls, tool use, filesystem operations.

Aura-OS communicates with the harness via:
- **REST** (`AutomatonClient`): start/stop automaton runs, poll events
- **WebSocket** (`SessionBridge`): streaming chat turns (user messages in,
  assistant messages + tool use out)

The `aura-os-harness` crate provides the protocol adapter. It abstracts local
vs. remote harness deployments behind a common trait.

### Persistence

- **Local store** (`aura-os-store`): JSON-backed BTreeMap flushed to disk.
  Stores agent/project/org records, auth sessions, integration configs. Files
  live in `<data_dir>/store/`.
- **Remote storage** (`aura-os-storage`): Client for the `aura-storage` service.
  Stores conversation history, execution traces, and task outputs.
- **Loop logs**: Per-run filesystem bundles under `<data_dir>/loop_logs/`
  containing full event streams.

### Event System

Two event propagation mechanisms:
- **Legacy**: `event_broadcast` (tokio broadcast channel, JSON payloads) — used
  by the frontend SSE stream
- **New**: `event_hub` (typed `DomainEvent` with topic-based filtering) — used
  internally and bridged to legacy for frontend compatibility

---

## Frontend Architecture (React + TypeScript)

### Directory Structure

```
interface/src/
  apps/              # Feature-isolated modules (one per product area)
    agents/          #   Agent management and configuration
    chat/            #   Chat interface and streaming
    browser/         #   In-app browser
    projects/        #   Project management
    tasks/           #   Task board and lifecycle
    marketplace/     #   Skill and agent marketplace
    process/         #   Dev loop execution view
    feed/            #   Activity feed
    notes/           #   Note-taking
    ...
  shared/            # Cross-app reusable code
    api/             #   API clients by domain (core.ts, agents.ts, tasks.ts)
    types/           #   Entity types, enums, IDs (barrel-exported)
    hooks/           #   Reusable hooks
    lib/             #   Library wrappers
    utils/           #   Utility functions
    ui/              #   Shared UI primitives
  stores/            # Zustand domain stores (one per concern)
  features/          # Feature-specific UI (chat-ui, left-menu, onboarding)
  components/        # Shared UI components
```

### Layering Rules

These are strict and enforced by convention:

1. **Apps depend on shared, never on each other.**
   `apps/agents/` may import from `shared/` but never from `apps/chat/`.
2. **Shared never depends on apps.**
   If `shared/` code needs app-specific behavior, it belongs in the app.
3. **Co-locate app-owned code.**
   Routes, hooks, stores, queries, and components that serve one app live in
   that app's directory.
4. **Cross-app code goes to shared.**
   API clients, entity types, and reusable hooks belong in `shared/`.

See [docs/frontend-architecture.md](docs/frontend-architecture.md) for the full
layering rubric and migration guidance.

### App Registration

Each app implements the `AuraApp` interface:
- `LeftPanel` — app-specific sidebar content
- `MainPanel` — core content area
- Optional: `SidekickPanel`, `PreviewPanel`, `ResponsiveControls`

Apps are registered in `registry.ts` with eagerly-imported routes and
lazy-loaded module exports (`createAppDefinition()` with module caching).

### State Management

**Zustand v5** exclusively. Each domain has its own store file in `stores/`.
No Redux, no Context-based state. Stores are subscribable via hooks.

Bootstrap subscriptions run in `main.tsx` before React renders to avoid
WebSocket event race conditions.

### Data Fetching

**TanStack React Query** for server state (caching, invalidation, polling).
API modules live in `shared/api/` segmented by domain. SSE for long-lived
streams; WebSocket for real-time task/process output.

### Styling

CSS variables via the vendored **ZUI** component library. Dark/light theme
tokens in `src/styles/tokens.css` with `[data-theme]` selectors. CSS Modules
for component-scoped styles. No Tailwind.

### Mobile

**Capacitor v8** wraps the SPA for iOS and Android. Mobile is a remote-backed
experience — local workspace features (linked folders, IDE) remain desktop-only.

---

## Skills System

Skills are filesystem-driven, declarative documents that guide agent behavior.

### Structure

```
skills/
  ai-ml/           # Gemini, Whisper, summarization, etc.
  automation/       # Web scraping, health checks, CLI wrappers
  communication/    # Discord, Slack, iMessage, etc.
  development/      # GitHub, coding-agent, canvas, tmux
  media/            # Spotify, camera, GIF search
  productivity/     # Notion, Trello, reminders
  smart-home/       # Hue, weather, places
  security/         # 1Password
  notes/            # Obsidian, Apple Notes, Bear
  utilities/        # General-purpose tools
```

Each skill is a directory containing exactly one `SKILL.md` file with YAML
frontmatter:

```yaml
---
name: skill-name
description: "What this skill does"
metadata:
  openclaw:
    emoji: "..."
    requires: { bins: [...], env: [...] }
    install: [{ id, kind, formula, bins, label }]
allowed-tools: [...]  # Optional: restrict which tools the skill can use
---
# Markdown body: usage instructions injected into the agent prompt
```

### How Skills Work

1. Skills are discovered by scanning `<skills_root>/<category>/<name>/SKILL.md`
2. Agents have installed skills tracked via `HarnessSkillInstallation`
3. At activation, the skill body is rendered into the agent's system prompt
4. `allowed-tools` restricts which harness tools the skill can invoke
5. Skills are prompt directives + permission gates — they don't execute code
   themselves

User-created skills live in `~/.aura/skills` (stable) or `~/.aura-dev/skills`
(dev). The frontend exposes a skill shop catalog (`skill-shop-catalog.json`)
for browsing and installation.

---

## Related Repositories

Aura-OS is the core client. It connects to several optional services:

| Repository | Role | Connection |
|------------|------|------------|
| **[aura-harness](https://github.com/cypher-asi)** | Agent execution sidecar — LLM calls, tool use, filesystem ops | Spawned as local sidecar or connected remotely; bidirectional WS/REST |
| **[aura-network](https://github.com/cypher-asi)** | Org/project sync backend | `AURA_NETWORK_URL`; aura-os is a client |
| **[aura-storage](https://github.com/cypher-asi)** | Execution data store (sessions, traces, artifacts) | `AURA_STORAGE_URL`; aura-os is a client |
| **[aura-integrations](https://github.com/cypher-asi)** | Secret-backed third-party integrations (OAuth, API keys) | `AURA_INTEGRATIONS_URL`; aura-os is a client |
| **[zui](https://github.com/cypher-asi/zui)** | UI component library (React + CSS) | Vendored in `vendor/zui/`; one-way dependency |
| **aura-router** | LLM proxy with billing attribution | `AURA_ROUTER_URL`; routes Claude API calls |
| **z-billing** | Credit purchases and balance management | `Z_BILLING_URL`; aura-os reads balance/tiers |
| **Orbit** | Git/repo hosting service | `ORBIT_BASE_URL`; aura-os is a client |

**Dependency direction:** aura-os is always the client. The only bidirectional
dependency is the harness, which calls back to aura-os for tool dispatch.
All remote services are optional — the app degrades gracefully without them.

---

## Release Builds

Aura ships on five platforms across two channels. The build system is additive
to the product — release-only code paths are gated behind CI or packaging flags
and never change normal runtime behavior.

### Channels

| Channel | Desktop Port | Update Behavior | Artifacts |
|---------|-------------|-----------------|-----------|
| **Nightly** | `19848` (dev) | Auto-update disabled | `.github/workflows/release-nightly.yml` |
| **Stable** | `19847` | Auto-update via signed manifests | `.github/workflows/release-stable.yml` |

The channel is determined at build time via `aura-os-core::Channel`. The desktop
app binds its preferred port per channel; the harness sidecar receives the actual
bound port as `AURA_OS_SERVER_URL` so cross-agent callbacks always hit the live
server regardless of channel or ephemeral fallback.

### Desktop Packaging

Desktop builds use `cargo-packager` configured in
`apps/aura-os-desktop/Cargo.toml`. The desktop `build.rs` bundles the frontend
(`npm run build` in `interface/`) into the binary at compile time. In dev mode,
Vite's dev server is detected and the build step is skipped.

The updater (`apps/aura-os-desktop/src/updater.rs`) checks for updates on
startup, downloads and stages new versions, and can perform in-place replacement
(Windows/Linux) or relocate-and-relaunch (macOS).

### Mobile Packaging

iOS and Android use **Capacitor v8** to wrap the SPA, with **Fastlane** handling
store delivery:

- iOS: `.github/workflows/ios-mobile.yml` → TestFlight / App Store
- Android: `.github/workflows/android-mobile.yml` → Play Store tracks

### CI Verification

Three layers of verification run on every push:

1. **Functional** — Playwright evals (`interface/tests/e2e/evals/`) against the
   dev server and local-stack. Validates org/agent/project/spec/task flows.
2. **Packaging** — `desktop-smoke` workflows build the native binary on macOS,
   Windows, and Linux, launch it, wait for readiness, and run shared smoke
   checks against the embedded server.
3. **Mobile** — `validate-android-shell` and `validate-ios-shell` confirm the
   Capacitor shells build cleanly.

Publishing verification (artifact naming, signatures, update manifests) runs
in the release workflows, not on every PR.

For the full release strategy and phased plan, see
[docs/release-build-strategy.md](docs/release-build-strategy.md). For the
operational workflow map, see
[docs/release-workflows.md](docs/release-workflows.md).

---

## Code Conventions

### Rust

**File size budgets:**

| Unit | Soft Limit | Hard Limit |
|------|------------|------------|
| `.rs` file | 400 lines | 500 lines |
| Function body | 50 lines | 80 lines |
| Parameters | 5 | 7 |

Enforced by `scripts/lint-file-sizes.mjs` (file size) and code review
(function size). See [docs/rust-module-conventions.md](docs/rust-module-conventions.md).

**Module splitting:** When a file exceeds 400 lines, convert to a directory
module. `mod.rs` contains only `mod` declarations and explicit re-exports.
Business logic lives in child modules.

**Visibility:** Default to `pub(crate)`. Use explicit re-exports. Avoid glob
re-exports. `pub` only when another crate consumes it.

**Error handling:** `thiserror` for typed domain errors. Each crate defines its
own error type with contextual variants.

**Workspace lints:** `unsafe_code = "deny"`, `clippy::all = "warn"`.

### TypeScript / React

**File size budgets:** Warn at 400 lines, fail at 600 lines (`.ts`/`.tsx`).

**Component folder pattern:**
```
apps/<app>/components/<Component>/
  index.ts              # Public surface
  <Component>.tsx       # Implementation
  <Component>.module.css
  use<Component>*.ts    # Hooks
  <Component>.test.tsx  # Tests
```

**Naming:** PascalCase for components and types. camelCase for hooks, utilities,
and variables. Kebab-case for file/directory names in shared modules.

**Imports:** Use barrel exports (`index.ts`) for component folders. Import
through the barrel, not internal files.

### Testing

- **Rust:** Inline `#[cfg(test)] mod tests { ... }` for small modules; separate
  `tests.rs` or `tests/` directory for larger areas. Run with
  `cargo test --workspace`.
- **TypeScript:** Colocated `.test.ts`/`.test.tsx` files. Vitest with jsdom.
  Testing Library for component tests.
- **E2E:** Playwright with desktop/tablet/mobile device projects.

### Shared Types

Protocol types are generated from Rust definitions to TypeScript via
`aura-protocol` crate and `sync-protocol-bindings.mjs`. Entity types live in
`interface/src/shared/types/` with barrel exports.

---

## Where to Put New Code

### Adding a backend feature

1. Does it introduce a new domain? Create a new crate in `crates/`.
2. Is it a new API endpoint? Add a handler module in
   `apps/aura-os-server/src/handlers/`. Wire it in the router.
3. Does it need new state? Add fields to `AppState` and initialize in
   `app_builder/`.
4. Does it need persistence? Use `aura-os-store` for local state or
   `aura-os-storage` for remote execution data.

### Adding a frontend feature

1. Does it belong to an existing app? Add it under `interface/src/apps/<app>/`.
2. Is it a new product area? Create a new app directory, implement `AuraApp`,
   register in `registry.ts`, and add routes.
3. Is it reusable? Put it in `interface/src/shared/` (API clients, types, hooks)
   or `interface/src/components/` (UI primitives).
4. Does it need state? Create a Zustand store in `interface/src/stores/`.

### Adding a skill

1. Choose the appropriate category directory under `skills/`.
2. Create `skills/<category>/<name>/SKILL.md` with the standard frontmatter.
3. Add the skill to `interface/src/data/skill-shop-catalog.json` if it should
   appear in the marketplace.

### Adding an integration

1. Define the provider in `crates/aura-os-integrations/` (provider kind,
   trusted methods, request/response contracts).
2. Add workspace tool builders in the server's `handlers/agents/workspace_tools/`.
3. Wire the UI in `interface/src/apps/integrations/`.

---

## Anti-Patterns to Avoid

- **Cross-app imports in the frontend.** Never import from one app into another.
  Extract shared code to `shared/` first.
- **Glob re-exports in Rust modules.** Use explicit `pub(crate) use` re-exports
  so the public surface is reviewable.
- **Putting business logic in `mod.rs`.** It should contain only declarations
  and re-exports.
- **Growing files past limits.** Split at 400 lines (Rust) or 400 lines
  (TypeScript) before adding more.
- **Storing execution data in the local store.** Transcripts, traces, and run
  logs belong in `aura-storage` or loop-log bundles, not in the JSON KV store.
- **Adding `pub` visibility by default.** Start with private, widen to
  `pub(crate)` if needed, and only go `pub` when another crate requires it.
- **Mocking the harness in integration tests.** The harness protocol is complex;
  test against real harness behavior when possible.

---

## Further Reading

| Document | Covers |
|----------|--------|
| [docs/frontend-architecture.md](docs/frontend-architecture.md) | Frontend layering rules, migration guidance, target shape |
| [docs/rust-module-conventions.md](docs/rust-module-conventions.md) | Rust file-size budgets, module directory pattern, re-export discipline |
| [docs/capabilities-and-credentials-architecture.md](docs/capabilities-and-credentials-architecture.md) | Auth, capabilities, and credential flow |
| [docs/release-build-strategy.md](docs/release-build-strategy.md) | Release strategy, phased plan, and verification layers |
| [docs/zui-vendoring.md](docs/zui-vendoring.md) | How ZUI is vendored and updated |
| [docs/render-deployment.md](docs/render-deployment.md) | Deployment configuration for remote services |
