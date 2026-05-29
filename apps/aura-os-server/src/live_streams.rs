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

use aura_os_harness::{HarnessCommandSender, HarnessInbound, HarnessOutbound, HarnessSession};

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
    /// the session. `None` for streams registered via
    /// [`LiveStreamRegistry::register_receiver`], where the session is
    /// owned elsewhere (e.g. chat turns whose session lives in
    /// `chat_sessions`).
    session: Mutex<Option<HarnessSession>>,
    /// Optional inbound command channel for streams that do NOT own the
    /// harness session. When present, [`LiveStream::cancel`] forwards
    /// `HarnessInbound::Cancel` so the upstream harness aborts the
    /// in-flight turn in addition to firing the cancellation token.
    /// `None` for the owned-session [`LiveStreamRegistry::register`]
    /// path, where dropping the session is sufficient to tear the run
    /// down.
    cancel_tx: Option<HarnessCommandSender>,
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
    /// synthetic `stream_cancelled` terminal frame and tears down. For
    /// streams that do not own the harness session (registered via
    /// [`LiveStreamRegistry::register_receiver`]), this additionally
    /// forwards `HarnessInbound::Cancel` over the stored command channel
    /// so the upstream harness aborts its in-flight turn — dropping the
    /// (unowned) session is not enough in that case.
    pub fn cancel(&self) {
        self.cancel.cancel();
        if let Some(tx) = &self.cancel_tx {
            if let Err(err) = tx.try_send(HarnessInbound::Cancel) {
                debug!(
                    target: "aura::streams",
                    attach_id = %self.attach_id,
                    error = %err,
                    "live stream cancel: failed to forward Cancel to harness"
                );
            }
        }
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
        let rx = session.events_tx.subscribe();
        let cancel = CancellationToken::new();
        let stream = Arc::new(LiveStream {
            attach_id: attach_id.clone(),
            kind,
            scope,
            events,
            session: Mutex::new(Some(session)),
            cancel_tx: None,
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            terminated_at: Mutex::new(None),
            cancel: cancel.clone(),
        });
        self.inner.insert(attach_id.clone(), stream.clone());

        spawn_forwarder(stream.clone(), rx, cancel);

        stream
    }

    /// Register a stream that pumps an already-subscribed broadcast
    /// receiver into a replay log WITHOUT owning the underlying
    /// [`HarnessSession`]. Used for chat turns where the harness session
    /// is reused across turns and lives in `chat_sessions`, not here —
    /// so the live stream must observe the turn's frames without holding
    /// (and therefore dropping/closing) the shared session.
    ///
    /// `cancel_tx` is the harness inbound command channel; when present,
    /// [`LiveStream::cancel`] forwards `HarnessInbound::Cancel` over it
    /// so an explicit cancel actually aborts the upstream turn (dropping
    /// an unowned session would not). Terminal detection and TTL
    /// retention match [`LiveStreamRegistry::register`] exactly via the
    /// shared [`spawn_forwarder`].
    pub fn register_receiver(
        self: &Arc<Self>,
        kind: StreamKind,
        scope: StreamScope,
        rx: broadcast::Receiver<HarnessOutbound>,
        cancel_tx: Option<HarnessCommandSender>,
    ) -> Arc<LiveStream> {
        let attach_id = uuid::Uuid::new_v4().to_string();
        let events = EventLog::new(self.stream_capacity);
        let cancel = CancellationToken::new();
        let stream = Arc::new(LiveStream {
            attach_id: attach_id.clone(),
            kind,
            scope,
            events,
            session: Mutex::new(None),
            cancel_tx,
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            terminated_at: Mutex::new(None),
            cancel: cancel.clone(),
        });
        self.inner.insert(attach_id.clone(), stream.clone());

        spawn_forwarder(stream.clone(), rx, cancel);

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

/// Shared forwarder body for [`LiveStreamRegistry::register`] and
/// [`LiveStreamRegistry::register_receiver`]. Pumps every harness frame
/// from `rx` into the stream's replay log, marking the stream terminal
/// on `AssistantMessageEnd` / `Error` (or on cancellation / upstream
/// close). Keeping this single source of truth ensures the owned-session
/// and unowned-receiver paths stay in lockstep on terminal detection.
fn spawn_forwarder(
    stream: Arc<LiveStream>,
    mut rx: broadcast::Receiver<HarnessOutbound>,
    cancel: CancellationToken,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    stream
                        .events
                        .append(serde_json::json!({ "type": "stream_cancelled" }));
                    stream.mark_terminated();
                    break;
                }
                res = rx.recv() => match res {
                    Ok(evt) => {
                        let terminal = matches!(
                            evt,
                            HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                        );
                        if let Ok(value) = serde_json::to_value(&evt) {
                            stream.events.append(value);
                        }
                        if terminal {
                            stream.mark_terminated();
                            break;
                        }
                    }
                    // The forwarder is the only consumer that must
                    // never lose frames; if it lags we cannot
                    // recover the dropped ones, so just continue.
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        stream.mark_terminated();
                        break;
                    }
                }
            }
        }
        debug!(
            target: "aura::streams",
            attach_id = %stream.attach_id,
            latest_seq = stream.events.latest_seq(),
            "live stream forwarder terminated"
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_harness::{ErrorMsg, HarnessSession, TextDelta};
    use tokio::sync::mpsc;

    fn fake_session() -> HarnessSession {
        let (events_tx, _) = broadcast::channel(16);
        let (raw_events_tx, _) = broadcast::channel(16);
        let (commands_tx, _commands_rx) = mpsc::channel(16);
        HarnessSession {
            session_id: "sess-1".to_string(),
            run_id: "run-1".to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
        }
    }

    #[tokio::test]
    async fn forwarder_records_frames_and_marks_terminal() {
        let registry = Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        });
        let session = fake_session();
        let events_tx = session.events_tx.clone();
        let scope = StreamScope {
            user_id: Some("u1".to_string()),
            project_id: Some("p1".to_string()),
            ..Default::default()
        };
        let stream = registry.register(StreamKind::SpecGen, scope, session);

        // A non-terminal frame is recorded and the stream stays live.
        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "hello".to_string(),
            }))
            .unwrap();
        // A terminal frame ends it.
        events_tx
            .send(HarnessOutbound::Error(ErrorMsg {
                code: "boom".to_string(),
                message: "boom".to_string(),
                recoverable: false,
                support_id: None,
            }))
            .unwrap();

        // Let the forwarder drain.
        for _ in 0..50 {
            if stream.is_terminated() && stream.events.latest_seq() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(stream.is_terminated(), "terminal frame should end stream");
        assert_eq!(stream.events.latest_seq(), 2, "both frames recorded");

        let summary = stream.summary();
        assert_eq!(summary.kind, StreamKind::SpecGen);
        assert!(summary.terminated);
        assert_eq!(summary.latest_seq, 2);
    }

    #[tokio::test]
    async fn list_for_scope_filters_by_user_and_project() {
        let registry = Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        });
        let s1 = registry.register(
            StreamKind::SpecGen,
            StreamScope {
                user_id: Some("u1".to_string()),
                project_id: Some("p1".to_string()),
                ..Default::default()
            },
            fake_session(),
        );
        let _s2 = registry.register(
            StreamKind::SpecGen,
            StreamScope {
                user_id: Some("u2".to_string()),
                project_id: Some("p1".to_string()),
                ..Default::default()
            },
            fake_session(),
        );

        let mine = registry.list_for_scope("u1", None, None);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].attach_id, s1.attach_id);

        let mine_p2 = registry.list_for_scope("u1", Some("p2"), None);
        assert!(mine_p2.is_empty(), "project filter excludes p1 stream");

        let mine_p1 = registry.list_for_scope("u1", Some("p1"), None);
        assert_eq!(mine_p1.len(), 1);
    }

    #[tokio::test]
    async fn register_receiver_records_frames_and_marks_terminal() {
        let registry = Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        });
        // The receiver path does NOT own the session: the broadcast
        // sender lives on the caller's side (here, the test), mirroring
        // the reused chat session in `chat_sessions`.
        let (events_tx, _rx0) = broadcast::channel::<HarnessOutbound>(16);
        let scope = StreamScope {
            user_id: Some("u1".to_string()),
            project_id: Some("p1".to_string()),
            session_id: Some("sess-1".to_string()),
            ..Default::default()
        };
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            scope,
            events_tx.subscribe(),
            None,
        );

        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "hello".to_string(),
            }))
            .unwrap();
        events_tx
            .send(HarnessOutbound::Error(ErrorMsg {
                code: "boom".to_string(),
                message: "boom".to_string(),
                recoverable: false,
                support_id: None,
            }))
            .unwrap();

        for _ in 0..50 {
            if stream.is_terminated() && stream.events.latest_seq() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(stream.is_terminated(), "terminal frame should end stream");
        assert_eq!(stream.events.latest_seq(), 2, "both frames recorded");

        let summary = stream.summary();
        assert_eq!(summary.kind, StreamKind::ChatTurn);
        assert!(summary.terminated);
        assert_eq!(summary.latest_seq, 2);
    }

    #[tokio::test]
    async fn register_receiver_lists_and_filters_by_scope() {
        let registry = Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        });
        let (tx1, _r1) = broadcast::channel::<HarnessOutbound>(16);
        let (tx2, _r2) = broadcast::channel::<HarnessOutbound>(16);
        let s1 = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("u1".to_string()),
                project_id: Some("p1".to_string()),
                session_id: Some("sess-a".to_string()),
                ..Default::default()
            },
            tx1.subscribe(),
            None,
        );
        let _s2 = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("u2".to_string()),
                project_id: Some("p1".to_string()),
                session_id: Some("sess-b".to_string()),
                ..Default::default()
            },
            tx2.subscribe(),
            None,
        );

        let mine = registry.list_for_scope("u1", None, None);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].attach_id, s1.attach_id);

        let mine_p2 = registry.list_for_scope("u1", Some("p2"), None);
        assert!(mine_p2.is_empty(), "project filter excludes p1 stream");
    }

    /// The unowned-receiver path's `cancel()` must additionally forward
    /// `HarnessInbound::Cancel` over the stored command channel (the
    /// owned-session path relies on dropping the session instead).
    #[tokio::test]
    async fn register_receiver_cancel_forwards_harness_cancel() {
        let registry = Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        });
        let (events_tx, _rx0) = broadcast::channel::<HarnessOutbound>(16);
        let (commands_tx, mut commands_rx) = mpsc::channel(4);
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope::default(),
            events_tx.subscribe(),
            Some(commands_tx),
        );

        stream.cancel();

        let observed = tokio::time::timeout(Duration::from_millis(200), commands_rx.recv())
            .await
            .expect("cancel should forward a command before timeout")
            .expect("commands_tx still open");
        assert!(
            matches!(observed, HarnessInbound::Cancel),
            "cancel must forward HarnessInbound::Cancel, got {observed:?}",
        );

        // The forwarder also observes the cancellation token and marks
        // the stream terminal with a synthetic frame.
        for _ in 0..50 {
            if stream.is_terminated() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(stream.is_terminated(), "cancel should mark the stream terminal");
    }
}
