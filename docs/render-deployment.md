# Render Deployment — aura-os

Single Web Service that builds both frontend and backend. The backend serves the frontend from `interface/dist` (same as local development).

## Render Service Setup

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Repository** | `cypher-asi/aura-os` |
| **Branch** | `main` |
| **Build Command** | See [Build Command](#build-command) below — clones `aura-harness` and builds the bundled `aura-node` sidecar alongside the server. |
| **Start Command** | `./target/release/aura-os-server` |
| **Plan** | Starter ($7/mo) or higher |

### Build Command

```bash
cd interface && npm ci && npm run build && cd .. \
  && cargo build --release -p aura-os-server \
  && git clone --depth 1 https://github.com/cypher-asi/aura-harness.git ../aura-harness \
  && cargo build --release --manifest-path ../aura-harness/Cargo.toml --bin aura-node \
  && cp ../aura-harness/target/release/aura-node ./target/release/aura-node
```

This mirrors the desktop installer pipeline (`infra/scripts/release/prepare-desktop-sidecar.mjs`): clone the sibling `aura-harness` checkout, `cargo build --release` its `aura-node` bin, and stage the resulting binary next to `aura-os-server`. At startup `aura-os-server` spawns it as a child process — same shape as `apps/aura-os-desktop/src/harness/sidecar.rs` — and stamps `LOCAL_HARNESS_URL` so all chat / generation traffic flows through the bundled sidecar.

If your fork pins a particular harness commit, replace `--depth 1 https://github.com/cypher-asi/aura-harness.git` with `-b <ref>` or `--branch <ref>` and the matching upstream URL.

## Environment Variables

### Required

| Variable | Value |
|----------|-------|
| `AURA_SERVER_PORT` | `10000` |
| `AURA_SERVER_HOST` | `0.0.0.0` |
| `VITE_API_URL` | `https://YOUR-SERVICE.onrender.com` |
| `AURA_ROUTER_URL` | `https://aura-router.onrender.com` |
| `Z_BILLING_URL` | `https://z-billing.onrender.com` |
| `SWARM_BASE_URL` | URL of the deployed `aura-node` service. Used by remote / swarm-mode agents (per-agent VM provisioning). With the bundled sidecar in place this is independent of chat — chat goes to the local sidecar via the build step above. |

`VITE_API_URL` is consumed twice from the same Render env: the Vite build bakes it into the frontend bundle so the UI knows where to call, and the `aura-os-server` process reads it at runtime to stamp cross-agent tool callback URLs (so remote harness agents can reach back into the service over its public URL instead of loopback). One env var, two jobs — no duplication.

### Local harness sidecar resolution

The `aura-node` binary serves two protocols on a single port: a WebSocket `/stream` endpoint that `LocalHarness` uses (chat, public chat, generations) and an HTTP agents/sessions API that `SwarmHarness` uses (per-agent VM provisioning for remote-mode agents). The server resolves the **local-harness** base URL — the one chat connects to — like the desktop sidecar does:

1. **`AURA_HARNESS_BIN` or candidate paths** — at boot, `aura-os-server` looks for a precompiled `aura-node` artefact (the build command above stages one at `./target/release/aura-node`). When it finds one, it spawns the binary as a child process and stamps `LOCAL_HARNESS_URL` to its bound URL automatically. **This is the production path**.
2. **`LOCAL_HARNESS_URL` if explicitly set** — explicit operator override, useful only when chat sessions must target a different upstream from the bundled sidecar.
3. **`SWARM_BASE_URL` if set** — fallback when no binary was found and `LOCAL_HARNESS_URL` is unset. Lets a deployment without the bundled sidecar still route chat at the deployed `aura-node` swarm gateway.
4. **`http://localhost:<channel-port>` default** — only useful in local dev where the developer is running aura-node manually.

In a properly-configured Render deploy you should see this log line at boot (look for it under "Logs" in the Render dashboard):

```
INFO Spawning local harness sidecar from precompiled binary
INFO aura-harness sidecar process spawned
INFO Local harness sidecar ready at http://127.0.0.1:19080
INFO Local harness base URL resolved resolved_url=http://127.0.0.1:19080 source=LOCAL_HARNESS_URL
```

If the build step didn't stage the binary, the server falls through to the `SWARM_BASE_URL` fallback and chat still works (just routed at the remote `aura-node`); a `Local harness base URL resolved … source=SWARM_BASE_URL` boot line confirms this. If both fail (unlikely in production) chat returns 503 and the boot log carries an `error!` line with remediation steps.

### Optional overrides

| Variable | Value |
|----------|-------|
| `AURA_SERVER_BASE_URL` | `https://YOUR-SERVICE.onrender.com` — explicit override that wins over `VITE_API_URL`. Only needed when the frontend and backend must advertise different public URLs (e.g. a separate CDN origin). Leave unset otherwise. |
| `AURA_HARNESS_BIN` | Absolute path to a precompiled `aura-node` binary. Only set if you want to override where the sidecar spawn looks for the binary (e.g. you build it into a non-standard location, or you want to swap implementations without redeploying). The default candidate scan finds anything the build command stages at `./target/release/aura-node`. |
| `AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN` | `true` to disable both the bundled-sidecar spawn and the legacy source-build spawn. Set this only when you're explicitly pointing chat at a remote `aura-node` service via `LOCAL_HARNESS_URL` or `SWARM_BASE_URL` and don't want the server to launch its own copy. |

### Recommended (full functionality)

| Variable | Value |
|----------|-------|
| `AURA_NETWORK_URL` | `https://aura-network.onrender.com` |
| `AURA_STORAGE_URL` | `https://aura-storage.onrender.com` |
| `ORBIT_BASE_URL` | `https://orbit-sfvu.onrender.com` |
| `INTERNAL_SERVICE_TOKEN` | (same value as other services) |

### Optional

| Variable | Value |
|----------|-------|
| `REQUIRE_ZERO_PRO` | `true` (default) or `false` |

## Prerequisites

1. **Vendored ZUI** — Aura now vendors `@cypher-asi/zui` under `vendor/zui`, and `interface/package.json` resolves it from inside this repo. Render builds no longer need a sibling checkout or a separately published ZUI package.

2. **Local storage model** — Aura no longer depends on the old embedded C++ database layer. Browser-owned persistence lives in IndexedDB, while the local backend uses a lightweight JSON/runtime store.

## Post-Deploy Verification

```bash
# Health check (should return 401 — no auth)
curl https://YOUR-SERVICE.onrender.com/api/auth/session

# Login
curl -X POST https://YOUR-SERVICE.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'

# Frontend loads
open https://YOUR-SERVICE.onrender.com
```

## Notes

- Port 10000 is Render's default. The server reads `AURA_SERVER_PORT`.
- Host `0.0.0.0` is required — Render rejects `127.0.0.1` bindings.
- `VITE_API_URL` (or the explicit `AURA_SERVER_BASE_URL` override) is the server's own public URL. It's stamped into cross-agent tool endpoints (`send_to_agent`, `spawn_agent`, etc.) so the remote harness / `aura-swarm` can call back in. Without it the server falls back to `http://<AURA_SERVER_HOST>:<AURA_SERVER_PORT>`, and `0.0.0.0` is normalized to `127.0.0.1` — which is unreachable from any other host.
- Render instances still have ephemeral local disk. Browser-owned persisted state remains in the browser, server auth uses the in-memory validation cache, and any local backend compatibility state should be treated as rebuildable.
- The build takes ~3-5 minutes (Node frontend + Rust backend + `aura-node` sidecar).
- `SWARM_BASE_URL` MUST be set in production for remote/swarm-mode agents. Chat uses the bundled sidecar staged at `./target/release/aura-node` by the build step above — independent of `SWARM_BASE_URL`.

## Troubleshooting

- `external tool callback unreachable: http://127.0.0.1:<port>/...` — the server is handing remote harnesses a loopback URL because neither `VITE_API_URL` nor the optional `AURA_SERVER_BASE_URL` override is set. Set `VITE_API_URL` to the service's public https URL (e.g. `https://YOUR-SERVICE.onrender.com`) and redeploy; this also fixes the frontend bundle in the same build.
- `local harness websocket connect failed` (chat returns 503 / SSE closes immediately) — three layered checks, in order:
  1. **Sidecar didn't spawn.** Look for `Spawning local harness sidecar from precompiled binary` in boot logs. If it's missing, the build step didn't stage the binary. Confirm the build command clones `aura-harness` and copies `aura-node` to `./target/release/aura-node`, and that the directory is writable. A `Failed to spawn aura-harness sidecar` warning identifies a binary-permission or platform mismatch.
  2. **Sidecar spawned but never went healthy.** Look for `Timed out waiting for aura-harness sidecar to become ready`. The sidecar process probably crashed on startup; rerun the build to confirm the binary builds clean against the same Rust toolchain, and check that the chosen sidecar port (default `19080` stable / `19081` dev — see `aura_os_core::Channel::preferred_sidecar_port`) isn't already bound by another process.
  3. **No sidecar AND no remote URL.** Boot logs carry `production misconfiguration: autospawn is disabled and the resolved harness URL is loopback / unset`. Fix: drop `AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN` so the bundled sidecar can launch, or set `SWARM_BASE_URL` / `LOCAL_HARNESS_URL` on the Render dashboard to a reachable `aura-node` service URL. Verify by hitting that URL's `/health` from a Render shell before debugging further.

## Orbit ENOSPC runbook

Symptom: users see repeated push failures whose reason text contains

```
remote: fatal: write error: No space left on device
error: remote unpack failed: index-pack abnormal exit
error: RPC failed; curl 18 transfer closed with outstanding read data remaining
```

This is orbit (`ORBIT_BASE_URL`, typically `https://orbit-sfvu.onrender.com`)
reporting that its local filesystem is full. The aura-os-server classifies
this as `remote_storage_exhausted` (see `classify_push_failure` in
`apps/aura-os-server/src/handlers/dev_loop.rs`) and, starting with the orbit
capacity guard:

1. Trips `OrbitCapacityGuard` for the configured `ORBIT_BASE_URL` so
   retries are annotated with a cooldown window instead of silently piling
   more `tmp_pack_*` objects onto orbit's already-full rootfs.
2. Emits a `push_deferred` + `project_push_stuck` event carrying
   `class: "remote_storage_exhausted"`, a remediation string, and
   `retry_after_secs`. The UI renders a dedicated "Orbit out of disk"
   status (amber dot on the Orbit indicator, banner on the project
   header, and a class-specific row on the task card).

### Diagnosis

```bash
# 1. Confirm the orbit service is live (health endpoint is unauth'd).
curl -s -o /dev/null -w "%{http_code}\n" "$ORBIT_BASE_URL/health"
# Expect 2xx; a timeout or 5xx suggests orbit itself is down, not ENOSPC.

# 2. Inspect orbit's disk usage through the Render dashboard
#    (Service → Metrics → Disk). Note that Render surfaces the
#    *persistent disk* only; pack indexing happens on the ephemeral
#    rootfs so 0% persistent disk usage does NOT mean orbit has space.

# 3. Shell into the orbit service (Render → Shell) and run:
df -h /                          # ephemeral rootfs usage
du -sh /path/to/orbit/repos/*    # per-repo size
find /path/to/orbit/repos -type d -name 'tmp_pack_*' | xargs -r du -sh
```

### Operator action (on the orbit Render service)

1. Remove stale quarantine / `tmp_pack_*` directories left behind by
   earlier failed pushes:

   ```bash
   find /path/to/orbit/repos -type d \
     \( -name 'tmp_pack_*' -o -path '*/objects/incoming-*' \) \
     -mmin +10 -print -exec rm -rf {} +
   ```

2. Run `git gc --prune=now` inside affected repos to drop unreferenced
   loose objects.
3. If disk usage stays high, upgrade the Render plan — the ephemeral
   rootfs scales with instance tier.

Once space is freed, the *next* successful push from aura-os
automatically clears the guard (`git_pushed` handler calls
`OrbitCapacityGuard::clear`) and restores the Orbit indicator to
green.

### Cooldown tuning

The guard's window is controlled by `AURA_ORBIT_ENOSPC_COOLDOWN_SECS`
on the aura-os-server side (default 900s / 15 minutes). Setting it to
`0` disables the cooldown entirely — use only for integration tests
that need to hammer orbit on purpose.
