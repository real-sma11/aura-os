//! Registry of resumable harness streams (Phase 2 of intelligent
//! reconnect).
//!
//! Long-running harness flows surfaced over SSE — spec generation, chat
//! turns, image/video/3D generation — historically tied the
//! [`HarnessSession`] lifetime to the HTTP response: the session lived
//! inside the SSE `stream::unfold`, so the moment the client's
//! connection dropped, `commands_tx` dropped, the harness WS bridge
//! closed, and the harness tore the run down. A reconnecting client had
//! nothing to attach back to.
//!
//! [`LiveStreamRegistry`] decouples the two. When a flow starts, the
//! handler registers its [`HarnessSession`] here. A background forwarder
//! task pumps every harness frame into a bounded, sequenced
//! [`EventLog`], holding the session alive until the run reaches a
//! terminal event. The SSE response merely *attaches* to the registered
//! stream and can be re-established (with a `?since=<seq>` cursor) any
//! number of times without disturbing the underlying run. Completed
//! streams linger for a TTL so a client that reconnects just after the
//! final frame still receives the tail of the output.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::debug;

use aura_os_harness::{HarnessOutbound, HarnessSession};

use crate::event_log::EventLog;

/// Opaque handle a client uses to (re)attach to a stream.
pub type AttachId = String;

/// Default per-stream replay ring size (number of harness frames).
pub const DEFAULT_STREAM_LOG_CAPACITY: usize = 4096;
/// Env var overriding [`DEFAULT_STREAM_LOG_CAPACITY`].
pub const STREAM_LOG_CAPACITY_ENV: &str = "AURA_STREAM_LOG_CAPACITY";

/// Default retention for a terminated stream before the sweeper drops
/// it, in seconds.
pub const DEFAULT_STREAM_TTL_SECS: u64 = 300;
/// Env var overriding [`DEFAULT_STREAM_TTL_SECS`].
pub const STREAM_TTL_SECS_ENV: &str = "AURA_STREAM_TTL_SECS";

/// Kind of harness flow a stream represents. Lets the client route a
/// reattached stream back into the right UI surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    SpecGen,
    SpecSummary,
    ChatTurn,
    ImageGen,
    VideoGen,
    Mesh3dGen,
}

/// Ownership / addressing metadata used for authz filtering and to let
/// the client match a reattached stream to a mounted view.
#[derive(Clone, Debug, Default, Serialize)]
pub struct StreamScope {
    pub user_id: Option<String>,
    pub project_id: Option<String>,
    pub agent_instance_id: Option<String>,
    pub session_id: Option<String>,
}

/// A single registered, resumable harness stream.
pub struct LiveStream {
    pub attach_id: AttachId,
    pub kind: StreamKind,
    pub scope: StreamScope,
    /// Sequenced replay ring of serialized harness frames. Survives the
    /// underlying [`HarnessSession`] being dropped on completion.
    pub events: Arc<EventLog>,
    /// Held only to keep `commands_tx` (and therefore the upstream
    /// harness WS) alive while the run is in flight. Cleared by the
    /// forwarder once the stream terminates so the harness can release
    /// the session.
    session: Mutex<Option<HarnessSession>>,
    started_at_ms: i64,
    terminated_at: Mutex<Option<Instant>>,
    cancel: CancellationToken,
}

impl LiveStream {
    /// True once a terminal frame (or cancellation / upstream close) has
    /// been observed.
    pub fn is_terminated(&self) -> bool {
        self.terminated_at
            .lock()
            .expect("live stream terminated_at poisoned")
            .is_some()
    }

    fn mark_terminated(&self) {
        let mut guard = self
            .terminated_at
            .lock()
            .expect("live stream terminated_at poisoned");
        if guard.is_none() {
            *guard = Some(Instant::now());
        }
        // Dropping the session closes the upstream harness WS now that
        // we have all the frames buffered for replay.
        *self
            .session
            .lock()
            .expect("live stream session poisoned") = None;
    }

    /// Request cancellation of the underlying run. The forwarder emits a
    /// synthetic `stream_cancelled` terminal frame and tears down.
    pub fn cancel(&self) {
        self.cancel.cancel();
    }

    /// Build the listing summary for `GET /api/streams/active`.
    pub fn summary(&self) -> ActiveStreamSummary {
        ActiveStreamSummary {
            attach_id: self.attach_id.clone(),
            kind: self.kind,
            scope: self.scope.clone(),
            latest_seq: self.events.latest_seq(),
            terminated: self.is_terminated(),
            started_at_ms: self.started_at_ms,
        }
    }
}

/// JSON row in the `GET /api/streams/active` response.
#[derive(Clone, Debug, Serialize)]
pub struct ActiveStreamSummary {
    pub attach_id: AttachId,
    pub kind: StreamKind,
    pub scope: StreamScope,
    pub latest_seq: u64,
    pub terminated: bool,
    pub started_at_ms: i64,
}

/// Registry of all live/recently-terminated harness streams.
pub struct LiveStreamRegistry {
    inner: DashMap<AttachId, Arc<LiveStream>>,
    stream_capacity: usize,
    ttl: Duration,
}

impl LiveStreamRegistry {
    /// Build a registry, reading capacity/TTL from the environment.
    pub fn from_env() -> Arc<Self> {
        let stream_capacity = std::env::var(STREAM_LOG_CAPACITY_ENV)
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(DEFAULT_STREAM_LOG_CAPACITY);
        let ttl_secs = std::env::var(STREAM_TTL_SECS_ENV)
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(DEFAULT_STREAM_TTL_SECS);
        let registry = Arc::new(Self {
            inner: DashMap::new(),
            stream_capacity,
            ttl: Duration::from_secs(ttl_secs),
        });
        registry.clone().spawn_sweeper();
        registry
    }

    /// Register a freshly-opened harness session and start pumping its
    /// frames into a replay log. Returns the live stream handle whose
    /// `attach_id` the client uses to attach.
    pub fn register(
        self: &Arc<Self>,
        kind: StreamKind,
        scope: StreamScope,
        session: HarnessSession,
    ) -> Arc<LiveStream> {
        let attach_id = uuid::Uuid::new_v4().to_string();
        let events = EventLog::new(self.stream_capacity);
        let mut rx = session.events_tx.subscribe();
        let cancel = CancellationToken::new();
        let stream = Arc::new(LiveStream {
            attach_id: attach_id.clone(),
            kind,
            scope,
            events,
            session: Mutex::new(Some(session)),
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            terminated_at: Mutex::new(None),
            cancel: cancel.clone(),
        });
        self.inner.insert(attach_id.clone(), stream.clone());

        let stream_for_task = stream.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        stream_for_task
                            .events
                            .append(serde_json::json!({ "type": "stream_cancelled" }));
                        stream_for_task.mark_terminated();
                        break;
                    }
                    res = rx.recv() => match res {
                        Ok(evt) => {
                            let terminal = matches!(
                                evt,
                                HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                            );
                            if let Ok(value) = serde_json::to_value(&evt) {
                                stream_for_task.events.append(value);
                            }
                            if terminal {
                                stream_for_task.mark_terminated();
                                break;
                            }
                        }
                        // The forwarder is the only consumer that must
                        // never lose frames; if it lags we cannot
                        // recover the dropped ones, so just continue.
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => {
                            stream_for_task.mark_terminated();
                            break;
                        }
                    }
                }
            }
            debug!(
                target: "aura::streams",
                attach_id = %stream_for_task.attach_id,
                latest_seq = stream_for_task.events.latest_seq(),
                "live stream forwarder terminated"
            );
        });

        stream
    }

    /// Look up a stream by attach id.
    pub fn get(&self, attach_id: &str) -> Option<Arc<LiveStream>> {
        self.inner.get(attach_id).map(|e| e.value().clone())
    }

    /// All streams visible to `user_id`, optionally narrowed to a
    /// project / agent instance. A stream with no `user_id` scope is
    /// treated as visible to everyone (used by anonymous flows).
    pub fn list_for_scope(
        &self,
        user_id: &str,
        project_id: Option<&str>,
        agent_instance_id: Option<&str>,
    ) -> Vec<ActiveStreamSummary> {
        self.inner
            .iter()
            .filter(|entry| {
                let s = &entry.value().scope;
                let user_ok = s.user_id.as_deref().map(|u| u == user_id).unwrap_or(true);
                let project_ok = project_id
                    .map(|p| s.project_id.as_deref() == Some(p))
                    .unwrap_or(true);
                let instance_ok = agent_instance_id
                    .map(|a| s.agent_instance_id.as_deref() == Some(a))
                    .unwrap_or(true);
                user_ok && project_ok && instance_ok
            })
            .map(|entry| entry.value().summary())
            .collect()
    }

    fn spawn_sweeper(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let now = Instant::now();
                let ttl = self.ttl;
                self.inner.retain(|_, stream| {
                    match *stream
                        .terminated_at
                        .lock()
                        .expect("live stream terminated_at poisoned")
                    {
                        Some(at) => now.duration_since(at) < ttl,
                        None => true,
                    }
                });
            }
        });
    }
}
