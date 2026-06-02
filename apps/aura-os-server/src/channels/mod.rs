//! Server-side wiring for the external-chat bridge (`aura-os-channels`).
//!
//! The `aura-os-channels` crate owns the transport-agnostic bridge runtime
//! and persistence, but the real agent dispatch needs server internals
//! (the auth validation cache, the [`AuthService`], and the in-process HTTP
//! client that talks to this server's own chat endpoint). That lives here as
//! [`ServerMessageDispatcher`].
//!
//! Phase 3 only introduces the dispatcher; nothing instantiates it yet
//! (HTTP routes + bridge spawn land in Phase 4). The type is `pub` so it
//! stays reachable and doesn't trip dead-code warnings in the meantime.

pub mod dispatcher;

pub use dispatcher::ServerMessageDispatcher;
