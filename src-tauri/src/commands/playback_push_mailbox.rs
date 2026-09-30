//! Transport-independent Phase 2b mailbox for continuous preview playback.
//!
//! The render worker only calls `submit`: it never invokes a WebView transport.
//! A dedicated sender thread owns the potentially slow sink. Exact seek/scrub
//! intentionally do not use this type.

use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_IN_FLIGHT: u64 = 2;
const WATCHDOG_AFTER: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlaybackPushCounters {
    pub superseded_mailbox: u64,
    pub stream_stall: u64,
    pub stall_recovered: u64,
    pub closed_channel: u64,
}

#[derive(Debug)]
pub struct Delivery<T> {
    pub generation: u64,
    pub delivery_seq: u64,
    pub frame_id: u64,
    pub payload: T,
}

#[derive(Debug)]
struct Pending<T> {
    generation: u64,
    frame_id: u64,
    payload: T,
}

#[derive(Debug)]
struct State<T> {
    active: bool,
    generation: u64,
    next_delivery_seq: u64,
    consumed_delivery_seq: u64,
    last_watermark_progress: Instant,
    pending: Option<Pending<T>>,
    counters: PlaybackPushCounters,
}

/// One overwriteable completed-frame slot plus a two-delivery flow-control cap.
/// `delivery_seq` counts sends; `frame_id` is render identity and may skip.
pub struct PlaybackPushMailbox<T> {
    state: Mutex<State<T>>,
    changed: Condvar,
}

impl<T> Default for PlaybackPushMailbox<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                active: false,
                generation: 0,
                next_delivery_seq: 0,
                consumed_delivery_seq: 0,
                last_watermark_progress: Instant::now(),
                pending: None,
                counters: PlaybackPushCounters::default(),
            }),
            changed: Condvar::new(),
        }
    }
}

impl<T: Send + 'static> PlaybackPushMailbox<T> {
    /// Must be called before displaying an exact frame for the new generation.
    pub fn begin_generation(&self, generation: u64) {
        let mut state = self.state.lock().expect("push mailbox lock poisoned");
        if generation < state.generation {
            return;
        }
        // Playback submits many frame demands for one generation. Only an
        // actual generation change is a fence/reset; treating every demand as
        // one would defeat watermark flow control.
        if state.active && generation == state.generation {
            return;
        }
        if state.pending.take().is_some() {
            state.counters.superseded_mailbox += 1;
        }
        state.generation = generation;
        // Delivery sequence is global; only the consumption watermark resets.
        state.consumed_delivery_seq = state.next_delivery_seq;
        state.last_watermark_progress = Instant::now();
        state.active = true;
        self.changed.notify_all();
    }

    /// Constant-time producer entrypoint. It cannot call or wait for a sink.
    pub fn submit(&self, generation: u64, frame_id: u64, payload: T) -> bool {
        let mut state = self.state.lock().expect("push mailbox lock poisoned");
        if !state.active || generation != state.generation {
            return false;
        }
        if state
            .pending
            .replace(Pending {
                generation,
                frame_id,
                payload,
            })
            .is_some()
        {
            state.counters.superseded_mailbox += 1;
        }
        self.changed.notify_one();
        true
    }

    /// Old-generation feedback is ignored. A new watermark wakes the sender.
    pub fn acknowledge(&self, generation: u64, consumed_delivery_seq: u64) -> bool {
        let mut state = self.state.lock().expect("push mailbox lock poisoned");
        if !state.active
            || generation != state.generation
            || consumed_delivery_seq <= state.consumed_delivery_seq
        {
            return false;
        }
        state.consumed_delivery_seq = consumed_delivery_seq.min(state.next_delivery_seq);
        state.last_watermark_progress = Instant::now();
        self.changed.notify_one();
        true
    }

    pub fn close(&self) {
        let mut state = self.state.lock().expect("push mailbox lock poisoned");
        state.active = false;
        state.pending = None;
        self.changed.notify_all();
    }

    pub fn counters(&self) -> PlaybackPushCounters {
        self.state
            .lock()
            .expect("push mailbox lock poisoned")
            .counters
            .clone()
    }

    pub fn is_active(&self) -> bool {
        self.state
            .lock()
            .expect("push mailbox lock poisoned")
            .active
    }

    fn next_delivery_or_wait(&self) -> Option<Delivery<T>> {
        let mut state = self.state.lock().expect("push mailbox lock poisoned");
        loop {
            if !state.active {
                return None;
            }
            let in_flight = state.next_delivery_seq - state.consumed_delivery_seq;
            if in_flight < MAX_IN_FLIGHT {
                if let Some(pending) = state.pending.take() {
                    state.next_delivery_seq += 1;
                    return Some(Delivery {
                        generation: pending.generation,
                        delivery_seq: state.next_delivery_seq,
                        frame_id: pending.frame_id,
                        payload: pending.payload,
                    });
                }
            }

            if in_flight > 0 && state.last_watermark_progress.elapsed() >= WATCHDOG_AFTER {
                state.counters.stream_stall += 1;
                state.counters.stall_recovered += 1;
                state.consumed_delivery_seq = state.next_delivery_seq;
                state.last_watermark_progress = Instant::now();
                continue;
            }
            let (next, _) = self
                .changed
                .wait_timeout(state, Duration::from_millis(25))
                .expect("push mailbox lock poisoned while waiting");
            state = next;
        }
    }

    /// Starts exactly one transport owner. A send error is clean terminal
    /// teardown: the producer is stopped and no background thread remains.
    pub fn spawn_sender<S>(self: &Arc<Self>, mut sink: S) -> JoinHandle<()>
    where
        S: FnMut(Delivery<T>) -> Result<(), ()> + Send + 'static,
    {
        let mailbox = Arc::clone(self);
        thread::spawn(move || {
            while let Some(delivery) = mailbox.next_delivery_or_wait() {
                if sink(delivery).is_err() {
                    let mut state = mailbox.state.lock().expect("push mailbox lock poisoned");
                    state.counters.closed_channel += 1;
                    state.active = false;
                    state.pending = None;
                    mailbox.changed.notify_all();
                    break;
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn newest_mailbox_value_replaces_old_value_once() {
        let mailbox = PlaybackPushMailbox::default();
        mailbox.begin_generation(1);
        assert!(mailbox.submit(1, 10, "first"));
        assert!(mailbox.submit(1, 12, "latest"));
        assert_eq!(mailbox.counters().superseded_mailbox, 1);
    }

    #[test]
    fn cap_uses_delivery_sequence_not_frame_identity() {
        let mailbox = Arc::new(PlaybackPushMailbox::default());
        mailbox.begin_generation(1);
        let (tx, rx) = mpsc::channel();
        let sender = mailbox.spawn_sender(move |delivery| {
            tx.send((delivery.delivery_seq, delivery.frame_id))
                .map_err(|_| ())
        });
        mailbox.submit(1, 10, ());
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), (1, 10));
        mailbox.submit(1, 999, ());
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), (2, 999));
        mailbox.submit(1, 4_000, ());
        assert!(rx.recv_timeout(Duration::from_millis(40)).is_err());
        assert!(mailbox.acknowledge(1, 2));
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), (3, 4_000));
        mailbox.close();
        sender.join().unwrap();
    }

    #[test]
    fn generation_reset_clears_work_and_rejects_old_acknowledgements() {
        let mailbox = PlaybackPushMailbox::default();
        mailbox.begin_generation(1);
        mailbox.submit(1, 1, ());
        mailbox.begin_generation(2);
        assert!(!mailbox.submit(1, 2, ()));
        assert!(!mailbox.acknowledge(1, 1));
        assert_eq!(mailbox.counters().superseded_mailbox, 1);
    }

    #[test]
    fn same_generation_does_not_reset_the_consumption_watermark() {
        let mailbox = PlaybackPushMailbox::default();
        mailbox.begin_generation(1);
        mailbox.submit(1, 1, ());
        // Simulate the first send before acknowledging it.
        let _ = mailbox.next_delivery_or_wait().unwrap();
        assert!(mailbox.acknowledge(1, 1));
        mailbox.begin_generation(1);
        assert!(!mailbox.acknowledge(1, 1));
    }

    #[test]
    fn slow_sink_does_not_block_submitter() {
        let mailbox = Arc::new(PlaybackPushMailbox::default());
        mailbox.begin_generation(1);
        let (entered_tx, entered_rx) = mpsc::channel();
        let sender = mailbox.spawn_sender(move |_| {
            entered_tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(100));
            Ok(())
        });
        mailbox.submit(1, 1, ());
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let started = Instant::now();
        mailbox.submit(1, 2, ());
        assert!(started.elapsed() < Duration::from_millis(20));
        mailbox.close();
        sender.join().unwrap();
    }

    #[test]
    fn closed_sink_stops_sender_cleanly() {
        let mailbox = Arc::new(PlaybackPushMailbox::default());
        mailbox.begin_generation(1);
        let sender = mailbox.spawn_sender(|_| Err(()));
        mailbox.submit(1, 1, ());
        sender.join().unwrap();
        assert_eq!(mailbox.counters().closed_channel, 1);
    }

    #[test]
    fn watchdog_resets_the_cap_and_records_recovery() {
        let mailbox = Arc::new(PlaybackPushMailbox::default());
        mailbox.begin_generation(1);
        let (tx, rx) = mpsc::channel();
        let sender =
            mailbox.spawn_sender(move |delivery| tx.send(delivery.delivery_seq).map_err(|_| ()));
        mailbox.submit(1, 1, ());
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), 1);
        mailbox.submit(1, 2, ());
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), 2);
        mailbox.submit(1, 3, ());
        // No ack: watchdog releases the two-delivery cap after 500 ms.
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), 3);
        let counters = mailbox.counters();
        assert_eq!(counters.stream_stall, 1);
        assert_eq!(counters.stall_recovered, 1);
        mailbox.close();
        sender.join().unwrap();
    }
}
