# Cross-agent / WS tracing reference

Phase 6 of the `send_to_agent` cross-agent UX fix pinned a single
diagnostic convention so the next "B's UI didn't live-update after A
called `send_to_agent`" report can be reconstructed end-to-end with
**one log filter** plus **one devtools toggle** — no re-instrumentation.

## Tracing targets

Two structured-log targets cover the full chain:

| Target              | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `aura::cross_agent` | Cross-agent reply pipeline + persist-task event observation.   |
| `aura::ws`          | WS publisher + per-connection forwarder.                       |

## Log sites

All sites below were locked in across Phases 3–6. New sites added in a
later phase belong with their kin under the same target.

### `aura::cross_agent`

| Level | Message                                          | Where                                                              |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------ |
| debug | `persist_task started`                           | `persist_task::run_persist_loop` entry (Phase 3).                  |
| debug | `persist_task observed harness event`            | `persist_task::run_persist_loop` after each `rx.recv` (Phase 6).   |
| debug | `user_message persisted; publishing ws event`    | `streaming::open_harness_chat_stream` pre-publish (Phase 6).       |
| debug | (callback dispatch decisions: depth/loopback)    | `cross_agent_reply::spawn_cross_agent_reply_callback` (Phase 3).   |
| error | `cross-agent reply callback failed`              | `cross_agent_reply` HTTP failure path (Phase 3).                   |

### `aura::ws`

| Level | Message                                          | Where                                                              |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------ |
| debug | `publishing chat event`                          | `event_bus::publish_chat_event` pre-broadcast (Phase 4).           |
| trace | `ws event published`                             | `event_bus::publish_chat_event` on `Ok` (Phase 4).                 |
| debug | `no ws subscribers; event dropped`               | `event_bus::publish_chat_event` on `SendError` (Phase 4).          |
| debug | `ws subscriber connected` / `disconnected`       | `handlers::ws::handle_ws` lifecycle (Phase 4).                     |
| warn  | `ws subscriber lagged behind; dropped messages`  | `handlers::ws::handle_ws` on `RecvError::Lagged` (Phase 4).        |
| trace | `forwarding ws message to client`                | `handlers::ws::handle_ws` per-message forward (Phase 6).           |

## Turning the chain on

```
RUST_LOG=aura::ws=debug,aura::cross_agent=debug cargo run -p aura-os-server
```

Append `,aura::ws=trace` if you want the per-message forwarder log
(`forwarding ws message to client`) and the `ws event published`
trace as well.

## UI-side companion

Set `window.__AURA_DEBUG_CROSS_AGENT__ = true` from devtools to
unlock two `console.debug` lines that mirror the server targets:

| Tag                                | Where                                                           |
| ---------------------------------- | --------------------------------------------------------------- |
| `[aura.cross-agent] ws raw`        | `event-store::connectEventSocket` after `parseAuraEvent`.       |
| `[aura.cross-agent] ws event`      | `use-chat-history-sync` subscription, pre-`matchesChatEvent`.   |

Together with the server targets above, this gives a single grep
(`aura::cross_agent` / `aura::ws` on the server, `[aura.cross-agent]`
in the browser console) that covers the full A → server → ws → B chain.
