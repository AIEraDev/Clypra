//! Frame production scheduler — Phase 4.
//!
//! # Design
//!
//! The scheduler answers one question: **"What frame must exist?"**
//! The renderer answers: **"Where should this frame be displayed?"**
//!
//! ## Invariant
//!
//! For N presentation targets requesting the same `FrameKey`, the scheduler
//! performs **one** frame-production operation and presents the resulting
//! `Arc<FrameResource>` independently to all N targets.
//!
//! ```text
//! FrameKey  ──►  FrameScheduler  ──►  Arc<FrameResource>
//!                                            │
//!                      ┌────────────────────┼────────────────────┐
//!                      ▼                    ▼                    ▼
//!                 Target Program       Target Source       Target External
//! ```
//!
//! ## Two-layer cache
//!
//! ```text
//! DecodedFrameCache  key: (sequence_id, timestamp_us, quality)   ← no render_revision
//! CompositionCache   key: FrameKey (includes render_revision)
//! ```
//!
//! A timeline edit increments `render_revision`, invalidating the composition
//! cache but **not** the decoded-frame cache. The decoded frame is reused for
//! recomposition without re-decoding.
//!
//! ## In-flight deduplication
//!
//! If three targets simultaneously request the same uncached `FrameKey`, one
//! production job is started. All three callers await the same
//! `tokio::sync::watch` channel. When production completes, all three receive
//! the same `Arc<FrameResource>` — no duplicate decode occurs.
//!
//! ## Caller (fan-out) pattern
//!
//! ```rust,ignore
//! let ticket = scheduler.request(key.clone(), FrameDeadline::immediate(FramePriority::Realtime)).await;
//! let resource = scheduler.await_frame(ticket).await?;
//!
//! for id in target_manager.active_targets() {
//!     match target_manager.acquire_for_present(&id) {
//!         Ok(mut pf) => { renderer.render(&resource, &mut pf)?; pf.present(); }
//!         Err(e)     => log::warn!("Target {id} failed: {e}"),
//!     }
//! }
//! ```

use crate::wgpu_compositor::frame_cache::FrameResourceCache;
use crate::wgpu_compositor::frame_deadline::FrameDeadline;
use crate::wgpu_compositor::frame_request::PreviewQuality;
use crate::wgpu_compositor::frame_resource::FrameResource;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use tokio::sync::watch;

// ---------------------------------------------------------------------------
// SequenceId — which clip/sequence a frame belongs to
// ---------------------------------------------------------------------------

/// Opaque identifier for a decode sequence (clip, camera feed, sub-sequence).
///
/// Phase 4 introduces this as a `u64` newtype. The mapping from existing
/// `request_id: String` strings in `native_core` to `SequenceId` is a
/// Phase 5 concern — Phase 4 tests use synthetic values (`SequenceId(0)` etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SequenceId(pub u64);

impl fmt::Display for SequenceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Seq({})", self.0)
    }
}

// ---------------------------------------------------------------------------
// FrameKey — the deduplication unit
// ---------------------------------------------------------------------------

/// The unit of work deduplication in the scheduler.
///
/// Two requests with the same `FrameKey` share one production job — even if
/// they come from different presentation targets. Target identity is
/// deliberately absent; it belongs to [`PresentationRequest`].
///
/// [`render_revision`] is included so that a timeline edit (new effect,
/// transition change) is not reused from the composition cache. The
/// [`DecodedCacheKey`] omits it so the raw decode is still reusable.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FrameKey {
    /// Which clip / sequence this frame belongs to.
    pub sequence_id: SequenceId,
    /// Presentation timestamp in microseconds.
    pub timestamp_us: i64,
    /// Quality tier. Different qualities are separate production jobs.
    pub quality: PreviewQuality,
    /// Incremented when timeline composition changes (effects, transitions).
    /// Invalidates the [`CompositionCache`] without discarding decoded frames.
    pub render_revision: u64,
}

impl FrameKey {
    /// The decoded-frame cache key derived from this key.
    /// Strips `render_revision` so a composition change doesn't force re-decode.
    pub fn decoded_key(&self) -> DecodedCacheKey {
        DecodedCacheKey {
            sequence_id: self.sequence_id,
            timestamp_us: self.timestamp_us,
            quality: self.quality,
        }
    }
}

impl fmt::Display for FrameKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} @ {}us {:?} rev{}",
            self.sequence_id, self.timestamp_us, self.quality, self.render_revision
        )
    }
}

// ---------------------------------------------------------------------------
// DecodedCacheKey — cache key without render_revision
// ---------------------------------------------------------------------------

/// Key for the decoded-frame layer of the two-level cache.
///
/// Deliberately omits `render_revision`. A timeline edit (new effect applied,
/// transition added) changes `render_revision` but does not require re-decoding
/// the underlying video frame — the decoded result can be recomposed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DecodedCacheKey {
    pub sequence_id: SequenceId,
    pub timestamp_us: i64,
    pub quality: PreviewQuality,
}

// ---------------------------------------------------------------------------
// SchedulerConfig
// ---------------------------------------------------------------------------

/// Capacity and concurrency knobs for the scheduler.
///
/// Phase 5 (`PerformanceManager`) will make these adaptive. For Phase 4
/// they are static.
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Max entries in the decoded-frame cache (raw NV12/P010 before composition).
    pub decoded_cache_capacity: usize,
    /// Max entries in the composition cache (fully composed, ready-to-render).
    pub composition_cache_capacity: usize,
    /// Max concurrent production jobs. Requests beyond this block until a slot
    /// is free. Phase 5 will use this for backpressure; Phase 4 allows all
    /// in-flight jobs that are structurally distinct.
    pub max_in_flight: usize,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            decoded_cache_capacity: 8,
            composition_cache_capacity: 4,
            max_in_flight: 2,
        }
    }
}

// ---------------------------------------------------------------------------
// SchedulerError
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchedulerError {
    /// The ticket was explicitly cancelled before the frame was ready.
    Cancelled,
    /// The producer returned an error or panicked.
    ProducerFailed(String),
}

impl fmt::Display for SchedulerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => write!(f, "frame request cancelled"),
            Self::ProducerFailed(e) => write!(f, "frame production failed: {e}"),
        }
    }
}

impl std::error::Error for SchedulerError {}

// ---------------------------------------------------------------------------
// FrameProducer — the decode/compose abstraction
// ---------------------------------------------------------------------------

/// Synchronous frame production callback.
///
/// The scheduler calls this on a `tokio::spawn_blocking` thread so the async
/// runtime is not blocked. Implementations should:
/// - Decode the frame identified by `key.sequence_id` and `key.timestamp_us`.
/// - Apply composition / effects at `key.render_revision`.
/// - Return a fully GPU-resident `Arc<FrameResource>`.
///
/// # Thread safety
///
/// Implementations must be `Send + Sync + 'static` because they are called
/// from a blocking thread pool. Use `Arc<Mutex<...>>` internally if state
/// mutation is required.
pub trait FrameProducer: Send + Sync + 'static {
    fn produce(&self, key: &FrameKey) -> Result<Arc<FrameResource>, String>;
}

// ---------------------------------------------------------------------------
// FrameTicket — opaque handle returned by request()
// ---------------------------------------------------------------------------

/// Opaque handle returned by [`FrameScheduler::request`].
///
/// Call [`FrameScheduler::await_frame`] to wait for the result, or
/// [`FrameScheduler::cancel`] to discard background work before it starts.
pub struct FrameTicket {
    inner: TicketInner,
}

enum TicketInner {
    /// Cache hit — the frame is already available.
    CacheHit(Arc<FrameResource>),
    /// Production is in-flight; await the watch channel.
    InFlight(watch::Receiver<Option<Result<Arc<FrameResource>, String>>>),
    /// Cancelled by the caller before the frame was ready.
    Cancelled,
}

impl FrameTicket {
    /// Cancel this ticket. If production has not yet started, it is skipped.
    /// If already in-flight, it completes normally but the result is discarded.
    pub fn cancel(self) -> CancelledTicket {
        CancelledTicket
    }
}

/// Token returned by [`FrameTicket::cancel`]. Pass to
/// [`FrameScheduler::await_frame`] to get `Err(SchedulerError::Cancelled)`.
pub struct CancelledTicket;

impl From<CancelledTicket> for FrameTicket {
    fn from(_: CancelledTicket) -> Self {
        FrameTicket {
            inner: TicketInner::Cancelled,
        }
    }
}

// ---------------------------------------------------------------------------
// InFlight — one production job
// ---------------------------------------------------------------------------

struct InFlight {
    /// Broadcast channel for the production result.
    /// `None` = still in progress; `Some(Ok(r))` = done; `Some(Err(e))` = failed.
    tx: Arc<watch::Sender<Option<Result<Arc<FrameResource>, String>>>>,
}

// ---------------------------------------------------------------------------
// FrameSchedulerInner — mutex-protected state
// ---------------------------------------------------------------------------

struct FrameSchedulerInner {
    /// Jobs currently running on the blocking thread pool.
    in_flight: HashMap<FrameKey, InFlight>,
    /// Raw decoded frames — keyed without render_revision.
    decoded_cache: FrameResourceCache<DecodedCacheKey, Arc<FrameResource>>,
    /// Fully composed frames — keyed with full FrameKey.
    composition_cache: FrameResourceCache<FrameKey, Arc<FrameResource>>,
    /// Monotonically increasing count of production invocations.
    /// Used by tests to assert that deduplication is working.
    production_count: u64,
}

impl FrameSchedulerInner {
    fn new(config: &SchedulerConfig) -> Self {
        Self {
            in_flight: HashMap::new(),
            decoded_cache: FrameResourceCache::new(config.decoded_cache_capacity),
            composition_cache: FrameResourceCache::new(config.composition_cache_capacity),
            production_count: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// FrameScheduler — the public API
// ---------------------------------------------------------------------------

/// Schedules frame production with request deduplication and multi-target
/// fan-out support.
///
/// # Concurrency model
///
/// - All state is protected by a `parking_lot::Mutex` (non-async, brief locks).
/// - Production is dispatched via `tokio::task::spawn_blocking`.
/// - Results are broadcast to all waiters via `tokio::sync::watch`.
///
/// # Clone behaviour
///
/// `FrameScheduler` is cheaply cloneable (`Arc` internally). All clones share
/// the same production state, caches, and in-flight map.
#[derive(Clone)]
pub struct FrameScheduler {
    inner: Arc<Mutex<FrameSchedulerInner>>,
    producer: Arc<dyn FrameProducer>,
}

impl FrameScheduler {
    /// Create a new scheduler with the given producer and configuration.
    pub fn new(producer: Arc<dyn FrameProducer>, config: SchedulerConfig) -> Self {
        Self {
            inner: Arc::new(Mutex::new(FrameSchedulerInner::new(&config))),
            producer,
        }
    }

    // -----------------------------------------------------------------------
    // request — submit a frame production request
    // -----------------------------------------------------------------------

    /// Submit a frame production request.
    ///
    /// Returns a [`FrameTicket`] immediately. The ticket resolves to an
    /// `Arc<FrameResource>` via [`await_frame`]:
    ///
    /// - **Cache hit**: the ticket resolves immediately with the cached frame.
    /// - **In-flight hit**: the ticket joins an existing production job; no
    ///   duplicate decode occurs.
    /// - **Cache miss**: a new production job is dispatched.
    ///
    /// The `priority` argument is stored for Phase 5 scheduling policy; Phase 4
    /// dispatches all jobs immediately (no priority queue).
    pub async fn request(&self, key: FrameKey, _deadline: FrameDeadline) -> FrameTicket {
        // --- fast path: check composition cache (brief sync lock) -----------
        {
            let mut inner = self.inner.lock();
            if let Some(resource) = inner.composition_cache.get(&key) {
                return FrameTicket {
                    inner: TicketInner::CacheHit(resource),
                };
            }

            // --- join existing in-flight job --------------------------------
            if let Some(in_flight) = inner.in_flight.get(&key) {
                let rx = in_flight.tx.subscribe();
                return FrameTicket {
                    inner: TicketInner::InFlight(rx),
                };
            }

            // --- start new production job -----------------------------------
            let (tx, rx) = watch::channel(None);
            let tx = Arc::new(tx);
            inner.in_flight.insert(
                key.clone(),
                InFlight {
                    tx: Arc::clone(&tx),
                },
            );

            // Clone handles for the async task.
            let inner_arc = Arc::clone(&self.inner);
            let producer_arc = Arc::clone(&self.producer);
            let key_clone = key.clone();

            tokio::spawn(async move {
                // Run the blocking producer on the thread pool.
                let result = tokio::task::spawn_blocking({
                    let k = key_clone.clone();
                    move || producer_arc.produce(&k)
                })
                .await
                .unwrap_or_else(|e| Err(format!("spawn_blocking panic: {e}")));

                // Update scheduler state (brief sync lock).
                {
                    let mut guard = inner_arc.lock();
                    guard.in_flight.remove(&key_clone);
                    guard.production_count += 1;

                    if let Ok(ref resource) = result {
                        // Populate both cache layers.
                        guard
                            .composition_cache
                            .insert(key_clone.clone(), Arc::clone(resource));
                        guard
                            .decoded_cache
                            .insert(key_clone.decoded_key(), Arc::clone(resource));
                    }
                }

                // Broadcast result to all waiters (outside the lock).
                let _ = tx.send(Some(result));
            });

            FrameTicket {
                inner: TicketInner::InFlight(rx),
            }
        }
    }

    // -----------------------------------------------------------------------
    // await_frame — wait for a ticket to resolve
    // -----------------------------------------------------------------------

    /// Await the frame for a given ticket.
    ///
    /// - If the ticket is a cache hit, returns immediately.
    /// - If the ticket is in-flight, suspends until production completes.
    /// - If the ticket was cancelled, returns `Err(SchedulerError::Cancelled)`.
    pub async fn await_frame(
        &self,
        ticket: FrameTicket,
    ) -> Result<Arc<FrameResource>, SchedulerError> {
        match ticket.inner {
            TicketInner::CacheHit(r) => Ok(r),

            TicketInner::Cancelled => Err(SchedulerError::Cancelled),

            TicketInner::InFlight(mut rx) => {
                // wait_for suspends until the predicate returns true.
                // The Ref from wait_for is dropped before we clone the value.
                let result_clone = {
                    let borrow = rx.wait_for(|v| v.is_some()).await.map_err(|_| {
                        SchedulerError::ProducerFailed("watch channel closed".to_string())
                    })?;
                    borrow.as_ref().unwrap().clone()
                };
                result_clone.map_err(SchedulerError::ProducerFailed)
            }
        }
    }

    // -----------------------------------------------------------------------
    // cancel — discard a ticket
    // -----------------------------------------------------------------------

    /// Cancel a pending ticket.
    ///
    /// If production for this key is already in-flight, it completes normally
    /// (the result is cached), but this ticket returns
    /// `Err(SchedulerError::Cancelled)` from `await_frame`.
    ///
    /// Phase 5 will add queue-level cancellation for Background priority jobs
    /// that haven't yet started.
    pub fn cancel(&self, _ticket: FrameTicket) -> FrameTicket {
        FrameTicket {
            inner: TicketInner::Cancelled,
        }
    }

    // -----------------------------------------------------------------------
    // get_cached — sync lookup (no production)
    // -----------------------------------------------------------------------

    /// Directly look up a completed frame without scheduling production.
    ///
    /// Returns `None` if the frame is not in either cache layer.
    pub fn get_cached(&self, key: &FrameKey) -> Option<Arc<FrameResource>> {
        let mut inner = self.inner.lock();
        // Check composition cache first (most complete result).
        if let Some(r) = inner.composition_cache.get(key) {
            return Some(r);
        }
        // Fall back to decoded-frame cache (render_revision-agnostic).
        inner.decoded_cache.get(&key.decoded_key())
    }

    // -----------------------------------------------------------------------
    // production_count — test observable
    // -----------------------------------------------------------------------

    /// Total number of production jobs completed since the scheduler was
    /// created or last reset.
    ///
    /// Primarily used by tests to assert that deduplication is working:
    /// N targets requesting the same key → `production_count == 1`.
    pub fn production_count(&self) -> u64 {
        self.inner.lock().production_count
    }

    /// Number of production jobs currently running on the blocking thread pool.
    ///
    /// Used by [`PerformanceManager`] to populate [`ResourceBudget::in_flight_count`].
    pub fn in_flight_count(&self) -> usize {
        self.inner.lock().in_flight.len()
    }

    // -----------------------------------------------------------------------
    // reset — clear on project close / session reset
    // -----------------------------------------------------------------------

    /// Clear all caches and in-flight state.
    ///
    /// Called on project close. In-flight production jobs complete normally
    /// but their results are discarded.
    pub fn reset(&self) {
        let mut inner = self.inner.lock();
        inner.in_flight.clear();
        inner.decoded_cache.clear();
        inner.composition_cache.clear();
        inner.production_count = 0;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wgpu_compositor::frame_request::PreviewQuality;

    // -----------------------------------------------------------------------
    // Pure type / key tests (no GPU required)
    // -----------------------------------------------------------------------

    #[test]
    fn sequence_id_display() {
        assert_eq!(SequenceId(42).to_string(), "Seq(42)");
    }

    #[test]
    fn frame_key_eq_and_hash() {
        use std::collections::HashSet;
        let k1 = FrameKey {
            sequence_id: SequenceId(1),
            timestamp_us: 1000,
            quality: PreviewQuality::Full,
            render_revision: 0,
        };
        let k2 = k1.clone();
        let k3 = FrameKey {
            sequence_id: SequenceId(1),
            timestamp_us: 1000,
            quality: PreviewQuality::Full,
            render_revision: 1,
        };
        assert_eq!(k1, k2);
        assert_ne!(k1, k3);
        let mut set = HashSet::new();
        set.insert(k1);
        set.insert(k2); // duplicate — should not grow set
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn decoded_key_strips_render_revision() {
        let k0 = FrameKey {
            sequence_id: SequenceId(1),
            timestamp_us: 500,
            quality: PreviewQuality::Half,
            render_revision: 0,
        };
        let k1 = FrameKey {
            sequence_id: SequenceId(1),
            timestamp_us: 500,
            quality: PreviewQuality::Half,
            render_revision: 1,
        };
        // Different FrameKeys (different render_revision)…
        assert_ne!(k0, k1);
        // …but same DecodedCacheKey (render_revision absent).
        assert_eq!(k0.decoded_key(), k1.decoded_key());
    }

    #[test]
    fn scheduler_config_default_values_are_sensible() {
        let cfg = SchedulerConfig::default();
        assert!(cfg.decoded_cache_capacity > 0);
        assert!(cfg.composition_cache_capacity > 0);
        assert!(cfg.max_in_flight > 0);
        // Decoded cache is larger — raw frames live longer than composed ones.
        assert!(cfg.decoded_cache_capacity >= cfg.composition_cache_capacity);
    }

    #[test]
    fn scheduler_error_display() {
        assert!(!SchedulerError::Cancelled.to_string().is_empty());
        assert!(!SchedulerError::ProducerFailed("boom".to_string())
            .to_string()
            .is_empty());
    }

    #[test]
    fn cancelled_ticket_does_not_require_production() {
        // Structural: CancelledTicket → FrameTicket roundtrip.
        let ticket = FrameTicket {
            inner: TicketInner::Cancelled,
        };
        // Matches Cancelled variant — no GPU or async needed.
        assert!(matches!(ticket.inner, TicketInner::Cancelled));
    }
}
