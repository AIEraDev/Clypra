use crate::engine::clock::{EngineClock, PlaybackClock};
use crate::engine::render_plan::RenderPlan;
use crate::engine::state_machine::{PlaybackCommand, PlaybackMode, PlaybackStateSnapshot, QoSTier};
use crate::engine::timeline::commands::{CommandEnvelope, ProjectError};
use crate::engine::timeline::evaluator::{PureTimelineEvaluator, TimelineEvaluator};
use crate::engine::timeline::model::ProjectState;
use crate::engine::types::MediaTime;
use crossbeam::channel::{bounded, Receiver, Sender, TrySendError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Unified engine command sent across the boundary to the dedicated playback thread.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum EngineCommand {
    /// Playback control command (Play, Pause, Seek, Scrub, Step, etc.)
    Playback(PlaybackCommand),
    /// Transactional document mutation
    Project(CommandEnvelope),
    /// Graceful thread shutdown
    Shutdown,
}

/// Bounded outgoing queue for evaluated scene plans (RenderPlan).
/// A RenderPlan is a scene evaluation result, NOT a video frame.
pub type PlaybackPlanQueue = Sender<RenderPlan>;
pub type PlaybackPlanReceiver = Receiver<RenderPlan>;

/// Thread-safe client handle used by UI / Tauri commands to send commands
/// and observe state without ever blocking on the data plane.
pub struct PlaybackController {
    command_tx: Sender<EngineCommand>,
    snapshot_rx: Receiver<PlaybackStateSnapshot>,
    is_running: Arc<AtomicBool>,
    thread_handle: Option<JoinHandle<()>>,
}

impl PlaybackController {
    /// Spawns a new dedicated native playback engine thread.
    pub fn spawn(
        initial_project: ProjectState,
        plan_queue: PlaybackPlanQueue,
    ) -> Result<Self, String> {
        let (command_tx, command_rx) = bounded::<EngineCommand>(64);
        let (snapshot_tx, snapshot_rx) = bounded::<PlaybackStateSnapshot>(16);
        let is_running = Arc::new(AtomicBool::new(true));
        let thread_running = is_running.clone();

        let thread_handle = thread::Builder::new()
            .name("clypra-playback-controller".to_string())
            .spawn(move || {
                let mut engine_loop = EngineControlLoop::new(
                    initial_project,
                    command_rx,
                    snapshot_tx,
                    plan_queue,
                    thread_running,
                );
                engine_loop.run();
            })
            .map_err(|e| format!("Failed to spawn playback controller thread: {e}"))?;

        Ok(Self {
            command_tx,
            snapshot_rx,
            is_running,
            thread_handle: Some(thread_handle),
        })
    }

    /// Sends a playback command (Play, Pause, Seek, Scrub, Step).
    #[inline]
    pub fn send_playback_command(&self, cmd: PlaybackCommand) -> Result<(), String> {
        self.command_tx
            .send(EngineCommand::Playback(cmd))
            .map_err(|e| format!("Failed to send playback command: {e}"))
    }

    /// Sends a transactional project document mutation.
    #[inline]
    pub fn send_project_command(&self, envelope: CommandEnvelope) -> Result<(), String> {
        self.command_tx
            .send(EngineCommand::Project(envelope))
            .map_err(|e| format!("Failed to send project command: {e}"))
    }

    /// Retrieves the most recent observer state snapshot without blocking.
    #[inline]
    pub fn poll_state(&self) -> Option<PlaybackStateSnapshot> {
        let mut latest = None;
        while let Ok(snapshot) = self.snapshot_rx.try_recv() {
            latest = Some(snapshot);
        }
        latest
    }

    /// Blocking read for next state snapshot (primarily for tests).
    #[inline]
    pub fn recv_state(&self, timeout: Duration) -> Option<PlaybackStateSnapshot> {
        self.snapshot_rx.recv_timeout(timeout).ok()
    }
}

impl Drop for PlaybackController {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        let _ = self.command_tx.send(EngineCommand::Shutdown);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

/// The internal state and real-time execution loop running on the dedicated OS thread.
struct EngineControlLoop {
    project: ProjectState,
    evaluator: Box<dyn TimelineEvaluator>,
    clock: EngineClock,
    mode: PlaybackMode,
    quality_tier: QoSTier,
    generation: u64,
    dropped_frames: u64,
    last_snapshot_instant: Instant,
    last_presented_frame_instant: Instant,
    command_rx: Receiver<EngineCommand>,
    snapshot_tx: Sender<PlaybackStateSnapshot>,
    plan_tx: Sender<RenderPlan>,
    is_running: Arc<AtomicBool>,
}

impl EngineControlLoop {
    fn new(
        project: ProjectState,
        command_rx: Receiver<EngineCommand>,
        snapshot_tx: Sender<PlaybackStateSnapshot>,
        plan_tx: Sender<RenderPlan>,
        is_running: Arc<AtomicBool>,
    ) -> Self {
        Self {
            project,
            evaluator: Box::new(PureTimelineEvaluator::new()),
            clock: EngineClock::new(),
            mode: PlaybackMode::Idle,
            quality_tier: QoSTier::Full,
            generation: 1,
            dropped_frames: 0,
            last_snapshot_instant: Instant::now(),
            last_presented_frame_instant: Instant::now(),
            command_rx,
            snapshot_tx,
            plan_tx,
            is_running,
        }
    }

    fn run(&mut self) {
        while self.is_running.load(Ordering::Acquire) {
            let frame_interval = self.calculate_frame_interval();

            // 1. Process pending commands
            let timeout = if self.mode == PlaybackMode::Play {
                // In continuous play mode, wait up to frame interval
                let elapsed = self.last_presented_frame_instant.elapsed();
                if elapsed < frame_interval {
                    frame_interval - elapsed
                } else {
                    Duration::from_millis(0)
                }
            } else {
                // In idle/scrub/seek mode, block up to 50ms for commands
                Duration::from_millis(50)
            };

            let command_opt = if timeout.is_zero() {
                self.command_rx.try_recv().ok()
            } else {
                self.command_rx.recv_timeout(timeout).ok()
            };

            if let Some(command) = command_opt {
                if !self.handle_command(command) {
                    break; // Shutdown received
                }
            }

            // Drain any additional backlog commands immediately
            while let Ok(command) = self.command_rx.try_recv() {
                if !self.handle_command(command) {
                    return; // Shutdown received
                }
            }

            // 2. Playback tick (if actively playing)
            if self.mode == PlaybackMode::Play {
                let now = Instant::now();
                if now.duration_since(self.last_presented_frame_instant) >= frame_interval {
                    self.last_presented_frame_instant = now;
                    let current_time = self.clock.tick();
                    let plan =
                        self.evaluator
                            .evaluate(&self.project, current_time, self.generation);
                    let _ = self.plan_tx.try_send(plan);
                }
            }

            // 3. Emit 30 Hz observer state snapshot
            if self.last_snapshot_instant.elapsed() >= Duration::from_millis(33) {
                self.emit_snapshot();
                self.last_snapshot_instant = Instant::now();
            }
        }
    }

    /// Calculates expected time interval per frame based on canvas FPS.
    fn calculate_frame_interval(&self) -> Duration {
        let fps = self.project.settings.canvas.fps;
        if fps <= 0.0 {
            Duration::from_millis(16)
        } else {
            let micros = (1_000_000.0 / fps).round() as u64;
            Duration::from_micros(micros)
        }
    }

    /// Handles a single incoming command. Returns false on Shutdown.
    fn handle_command(&mut self, command: EngineCommand) -> bool {
        match command {
            EngineCommand::Shutdown => false,
            EngineCommand::Project(envelope) => {
                match self.project.apply(envelope) {
                    Ok(_new_rev) => {
                        // When paused/seeking, immediately refresh current frame to reflect edits
                        if self.mode != PlaybackMode::Play {
                            let plan = self.evaluator.evaluate(
                                &self.project,
                                self.clock.now(),
                                self.generation,
                            );
                            let _ = self.plan_tx.try_send(plan);
                        }
                    }
                    Err(ProjectError::RevisionConflict { expected, actual }) => {
                        eprintln!(
                            "[PlaybackController] Rejected project mutation: revision conflict expected {expected} vs actual {actual}"
                        );
                    }
                    Err(e) => {
                        eprintln!("[PlaybackController] Project mutation failed: {e}");
                    }
                }
                self.emit_snapshot();
                true
            }
            EngineCommand::Playback(cmd) => {
                self.handle_playback_command(cmd);
                self.emit_snapshot();
                true
            }
        }
    }

    fn handle_playback_command(&mut self, cmd: PlaybackCommand) {
        match cmd {
            PlaybackCommand::Play => {
                self.mode = PlaybackMode::Play;
                self.clock.start();
                self.last_presented_frame_instant = Instant::now();
            }
            PlaybackCommand::Pause => {
                self.mode = PlaybackMode::Idle;
                self.clock.pause();
            }
            PlaybackCommand::Seek {
                target_time,
                generation,
            } => {
                self.generation = generation;
                self.mode = PlaybackMode::Seek;
                self.clock.set_time(target_time);

                // Immediate target frame evaluation
                let plan = self
                    .evaluator
                    .evaluate(&self.project, target_time, self.generation);
                let _ = self.plan_tx.try_send(plan);
            }
            PlaybackCommand::Scrub {
                mut target_time,
                mut generation,
            } => {
                // Coalesce rapid scrubbing: drain any queued Scrub commands to find the latest
                while let Ok(EngineCommand::Playback(PlaybackCommand::Scrub {
                    target_time: next_t,
                    generation: next_gen,
                })) = self.command_rx.try_recv()
                {
                    target_time = next_t;
                    generation = next_gen;
                }

                self.generation = generation;
                self.mode = PlaybackMode::Scrub;
                self.clock.set_time(target_time);

                // Immediate latest scrub frame evaluation
                let plan = self
                    .evaluator
                    .evaluate(&self.project, target_time, self.generation);
                let _ = self.plan_tx.try_send(plan);
            }
            PlaybackCommand::Step {
                delta_frames,
                generation,
            } => {
                self.generation = generation;
                self.mode = PlaybackMode::FrameStep;

                let fps = self.project.settings.canvas.fps.max(1.0);
                let frame_dur_micros = (1_000_000.0 / fps).round() as i64;
                let current_micros = self.clock.now().as_micros();
                let new_micros = (current_micros + (delta_frames as i64 * frame_dur_micros)).max(0);
                let target_time = MediaTime::from_micros(new_micros);

                self.clock.set_time(target_time);

                let plan = self
                    .evaluator
                    .evaluate(&self.project, target_time, self.generation);
                let _ = self.plan_tx.try_send(plan);
            }
            PlaybackCommand::SetSpeed(speed) => {
                self.clock.set_speed(speed);
            }
            PlaybackCommand::SetQuality(tier) => {
                self.quality_tier = tier;
            }
        }
    }

    /// Emits a state snapshot to the UI observer channel.
    fn emit_snapshot(&self) {
        let snapshot = PlaybackStateSnapshot {
            position: self.clock.now(),
            duration: self.project.sequence.duration,
            mode: self.mode,
            is_playing: self.mode == PlaybackMode::Play,
            quality_tier: self.quality_tier,
            buffered_until: self.clock.now(),
            dropped_frames: self.dropped_frames,
            presented_fps: self.project.settings.canvas.fps as f32,
            generation: self.generation,
        };
        // Non-blocking try_send: if the UI is slow reading snapshots, drop intermediate ones
        match self.snapshot_tx.try_send(snapshot) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {}
            Err(TrySendError::Disconnected(_)) => {}
        }
    }
}
