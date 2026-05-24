//! Process-wide rate limiter for the `/api/public/*` endpoint family.
//!
//! Two buckets, both lazy-evicted on lookup so a daemon background
//! task isn't needed:
//!
//! - per-[`GuestId`] turn counter, capped at [`PUBLIC_TURN_LIMIT`]
//!   ("3 turns / guest across all modalities").
//! - per-[`IpHash`] daily counter, capped at
//!   [`PUBLIC_IP_DAILY_CEILING`] ("30 turns / IP / day"), to slow
//!   abusers who clear `localStorage` between attempts.
//!
//! All `DashMap` access lives inside synchronous critical sections
//! (lock → clone → drop → await). Holding a `DashMap` ref across an
//! `.await` would block other shards on the same hash bucket and is
//! forbidden by the rules-rust async conventions.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use dashmap::DashMap;

use super::types::{GuestId, IpHash, PublicTurnCount};

/// Maximum number of turns a single guest may run across ALL
/// modalities (chat, image, video, model3d) before the gate trips and
/// the frontend mounts the non-dismissable upgrade modal.
pub(crate) const PUBLIC_TURN_LIMIT: u32 = 3;

/// Daily ceiling on accepted public turns per source IP. Above this
/// value the limiter rejects the same way it rejects a per-guest cap
/// — a user with infinite localStorage churn still can't farm credits.
pub(crate) const PUBLIC_IP_DAILY_CEILING: u32 = 30;

/// Hard daily ceiling on total public turns across ALL guests and IPs.
/// When this trips, public mode drops to 0 turns for everyone until
/// the 24h window resets. This is the last-resort cost protection — if
/// a bug or sophisticated attacker bypasses per-guest and per-IP
/// limits, the global ceiling caps total spend.
pub(crate) const PUBLIC_GLOBAL_DAILY_CEILING: u32 = 500;

/// Eviction window for both buckets. After 24h with no activity an
/// entry is dropped on the next lookup. The choice of window matches
/// the JWT `exp` from the phase-2 setup handler so guest tokens and
/// limiter state expire in lock-step.
pub(crate) const BUCKET_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Per-guest turn counter plus the wall-clock timestamp of its last
/// touch. The timestamp drives lazy TTL eviction.
#[derive(Debug, Clone)]
pub(crate) struct GuestBucket {
    pub(crate) count: u32,
    pub(crate) updated_at: SystemTime,
}

impl GuestBucket {
    fn new(now: SystemTime) -> Self {
        Self {
            count: 0,
            updated_at: now,
        }
    }
}

/// Per-IP daily counter plus the timestamp the day-window opened. The
/// counter resets to zero when `now - opened_at >= BUCKET_TTL`.
#[derive(Debug, Clone)]
pub(crate) struct IpBucket {
    pub(crate) count: u32,
    pub(crate) opened_at: SystemTime,
}

impl IpBucket {
    fn new(now: SystemTime) -> Self {
        Self {
            count: 0,
            opened_at: now,
        }
    }
}

/// Indirection over `SystemTime::now()` so test cases can pin time.
///
/// Phase-4 will exercise the limiter with a `MockClock` that advances
/// in fixed increments, which is the only way to verify the per-IP
/// daily reset deterministically.
pub(crate) trait Clock: Send + Sync + std::fmt::Debug {
    fn now(&self) -> SystemTime;
}

/// Default [`Clock`] used by the production rate limiter.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

/// Process-wide rate limiter shared across every public handler via
/// `AppState`. Cheap to clone (both maps are `Arc<DashMap<...>>` under
/// the hood) and safe to call from any tokio worker.
///
/// Marked `pub` (rather than the workspace default `pub(crate)`)
/// solely because it appears as a field on the `pub` `AppState`
/// struct — every consumer still lives inside this crate.
/// Global daily counter — an atomic count + a mutex-guarded window
/// start time. The mutex only protects the reset check (not every
/// increment), so contention is minimal.
#[derive(Debug)]
struct GlobalBucket {
    count: AtomicU32,
    window_start: Mutex<SystemTime>,
}

#[derive(Debug, Clone)]
pub struct RateLimiter {
    guests: Arc<DashMap<GuestId, GuestBucket>>,
    ips: Arc<DashMap<IpHash, IpBucket>>,
    global: Arc<GlobalBucket>,
    clock: Arc<dyn Clock>,
}

impl RateLimiter {
    /// Build a limiter with the production [`SystemClock`].
    ///
    /// Marked `pub` so integration tests in `tests/common/mod.rs`
    /// (which live outside the crate boundary) can construct an
    /// `AppState` without reaching for a sealed constructor.
    pub fn new() -> Self {
        Self::with_clock(Arc::new(SystemClock))
    }

    /// Build a limiter with a caller-supplied [`Clock`]. Used by phase-4
    /// tests to feed a deterministic clock into the limiter.
    pub(crate) fn with_clock(clock: Arc<dyn Clock>) -> Self {
        let now = clock.now();
        Self {
            guests: Arc::new(DashMap::new()),
            ips: Arc::new(DashMap::new()),
            global: Arc::new(GlobalBucket {
                count: AtomicU32::new(0),
                window_start: Mutex::new(now),
            }),
            clock,
        }
    }

    /// Read the per-guest turn count without mutating it. Used by the
    /// phase-2 `setup` handler to surface the live count back to the
    /// caller after a token refresh.
    pub(crate) fn current_turn_count(&self, guest: &GuestId) -> PublicTurnCount {
        let now = self.clock.now();
        match self.guests.get(guest) {
            Some(bucket) => {
                let count = if Self::is_expired(bucket.updated_at, now) {
                    0
                } else {
                    bucket.count
                };
                PublicTurnCount(count)
            }
            None => PublicTurnCount::zero(),
        }
    }

    /// Reserve one slot for `guest` (and its `ip`). On success returns
    /// the *post-increment* turn count so the caller can stamp it onto
    /// the streamed `limit` frame.
    ///
    /// The increment is atomic in a `DashMap::entry` guard that never
    /// crosses an `.await` boundary. Failed downstream calls cannot
    /// retry for free — the slot is consumed before the upstream call
    /// happens (see [`super::gate::TurnGuard`] for the calling
    /// pattern).
    pub(crate) fn try_reserve(
        &self,
        guest: &GuestId,
        ip: IpHash,
    ) -> Result<PublicTurnCount, RateLimitError> {
        let now = self.clock.now();
        // Check per-guest and per-IP limits first. Only increment the
        // global counter after both pass — otherwise rejected requests
        // (e.g. a guest already at 3/3) would silently consume global
        // budget on every retry attempt.
        self.check_ip_ceiling(ip, now)?;
        let count = self.bump_guest(guest, now)?;
        self.check_global_ceiling(now)?;
        Ok(count)
    }

    fn check_global_ceiling(&self, now: SystemTime) -> Result<(), RateLimitError> {
        // Check if the window has expired and reset if needed.
        {
            let mut start = self.global.window_start.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(elapsed) = now.duration_since(*start) {
                if elapsed >= BUCKET_TTL {
                    self.global.count.store(0, Ordering::Relaxed);
                    *start = now;
                }
            }
        }
        let count = self.global.count.fetch_add(1, Ordering::Relaxed);
        if count >= PUBLIC_GLOBAL_DAILY_CEILING {
            // Undo the increment — we're over the limit.
            self.global.count.fetch_sub(1, Ordering::Relaxed);
            return Err(RateLimitError::Global {
                limit: PUBLIC_GLOBAL_DAILY_CEILING,
            });
        }
        Ok(())
    }

    fn bump_guest(
        &self,
        guest: &GuestId,
        now: SystemTime,
    ) -> Result<PublicTurnCount, RateLimitError> {
        let mut entry = self
            .guests
            .entry(guest.clone())
            .or_insert_with(|| GuestBucket::new(now));
        if Self::is_expired(entry.updated_at, now) {
            entry.count = 0;
            entry.updated_at = now;
        }
        if entry.count >= PUBLIC_TURN_LIMIT {
            return Err(RateLimitError::Guest {
                limit: PUBLIC_TURN_LIMIT,
            });
        }
        entry.count += 1;
        entry.updated_at = now;
        Ok(PublicTurnCount(entry.count))
    }

    fn check_ip_ceiling(&self, ip: IpHash, now: SystemTime) -> Result<(), RateLimitError> {
        let mut entry = self.ips.entry(ip).or_insert_with(|| IpBucket::new(now));
        if Self::is_expired(entry.opened_at, now) {
            entry.count = 0;
            entry.opened_at = now;
        }
        if entry.count >= PUBLIC_IP_DAILY_CEILING {
            return Err(RateLimitError::Ip {
                limit: PUBLIC_IP_DAILY_CEILING,
            });
        }
        entry.count += 1;
        Ok(())
    }

    fn is_expired(stamp: SystemTime, now: SystemTime) -> bool {
        match now.duration_since(stamp) {
            Ok(d) => d >= BUCKET_TTL,
            Err(_) => false,
        }
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

// `RateLimiter::new` is the only `pub` member because integration
// tests construct it through that path. The rest of the surface stays
// `pub(crate)` per the rules-rust public-API discipline (one-liner
// reminder kept here intentionally so a future PR doesn't widen the
// surface without thinking about it).

/// Why [`RateLimiter::try_reserve`] refused to issue a slot. The gate
/// helper translates this into the typed `ApiError::PublicLimitReached`
/// surfaced to the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RateLimitError {
    /// Per-`GuestId` cap reached.
    Guest { limit: u32 },
    /// Per-`IpHash` daily ceiling reached.
    Ip { limit: u32 },
    /// Global daily ceiling reached — all public requests blocked.
    Global { limit: u32 },
}

impl RateLimitError {
    /// Numeric limit value for the `429 { limit }` response shape.
    pub(crate) fn limit(self) -> u32 {
        match self {
            Self::Guest { limit } | Self::Ip { limit } | Self::Global { limit } => limit,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::Mutex;

    use super::*;

    #[derive(Debug)]
    struct MockClock {
        now: Mutex<SystemTime>,
    }

    impl MockClock {
        fn at(start: SystemTime) -> Arc<Self> {
            Arc::new(Self {
                now: Mutex::new(start),
            })
        }

        fn advance(&self, by: Duration) {
            let mut guard = self.now.lock().expect("mock clock poisoned");
            *guard += by;
        }
    }

    impl Clock for MockClock {
        fn now(&self) -> SystemTime {
            *self.now.lock().expect("mock clock poisoned")
        }
    }

    fn ip(octet: u8) -> IpHash {
        IpHash::from_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, octet)))
    }

    #[test]
    fn first_three_turns_succeed_and_fourth_trips_guest_cap() {
        let limiter = RateLimiter::new();
        let guest = GuestId("g-1".to_string());
        let caller = ip(1);
        for expected in 1..=PUBLIC_TURN_LIMIT {
            let count = limiter.try_reserve(&guest, caller).expect("turn allowed");
            assert_eq!(count.get(), expected);
        }
        let err = limiter
            .try_reserve(&guest, caller)
            .expect_err("4th turn must fail");
        assert_eq!(err.limit(), PUBLIC_TURN_LIMIT);
    }

    #[test]
    fn current_turn_count_resets_after_24h() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let clock = MockClock::at(start);
        let limiter = RateLimiter::with_clock(clock.clone());
        let guest = GuestId("g-2".to_string());
        let caller = ip(2);
        limiter.try_reserve(&guest, caller).expect("turn allowed");
        assert_eq!(limiter.current_turn_count(&guest).get(), 1);
        clock.advance(BUCKET_TTL);
        assert_eq!(limiter.current_turn_count(&guest).get(), 0);
    }

    #[test]
    fn ip_daily_ceiling_blocks_distinct_guests_on_same_ip() {
        let limiter = RateLimiter::new();
        let caller = ip(3);
        for n in 0..PUBLIC_IP_DAILY_CEILING {
            let guest = GuestId(format!("g-{n}"));
            limiter.try_reserve(&guest, caller).expect("under ceiling");
        }
        let next = GuestId("g-overflow".to_string());
        let err = limiter
            .try_reserve(&next, caller)
            .expect_err("ip ceiling must trip");
        assert_eq!(err.limit(), PUBLIC_IP_DAILY_CEILING);
    }
}
