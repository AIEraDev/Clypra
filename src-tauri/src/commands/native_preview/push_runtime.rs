use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::Serialize;
use tauri::Manager;
use crate::native_core::FrameRequest;

/// Benchmark-only owner for the Phase 2b playback push path. It is not opened
/// by default and therefore cannot change the invoke bridge until the caller
/// explicitly opts into a measured session.
pub struct NativePlaybackPushRuntime {
    pub(crate) mailbox: Arc<crate::commands::playback_push_mailbox::PlaybackPushMailbox<PushBridgeFrame>>,
    pub(crate) latest_render: Mutex<Option<FrameRequest>>,
    pub(crate) render_notify: tokio::sync::Notify,
    pub(crate) render_worker_started: std::sync::atomic::AtomicBool,
    pub(crate) sender_started: std::sync::atomic::AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackPushStatus {
    pub active: bool,
    pub sender_started: bool,
    pub render_worker_started: bool,
    pub superseded_mailbox: u64,
    pub stream_stall: u64,
    pub stall_recovered: u64,
    pub closed_channel: u64,
}

pub(crate) struct PushBridgeFrame {
    pub(crate) rgba: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}
/*
    rgba: Vec<u8>,
    */

impl Default for NativePlaybackPushRuntime {
    fn default() -> Self {
        Self {
            mailbox: Arc::new(Default::default()),
            latest_render: Mutex::new(None),
            render_notify: tokio::sync::Notify::new(),
            render_worker_started: std::sync::atomic::AtomicBool::new(false),
            sender_started: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

pub(crate) fn push_runtime(app: &tauri::AppHandle) -> Result<Arc<NativePlaybackPushRuntime>, String> {
    app.try_state::<Arc<NativePlaybackPushRuntime>>()
        .map(|state| Arc::clone(&state))
        .ok_or_else(|| "Native playback push runtime is unavailable".to_string())
}

impl NativePlaybackPushRuntime {
    pub(crate) fn status(&self) -> NativePlaybackPushStatus {
        let counters = self.mailbox.counters();
        NativePlaybackPushStatus {
            active: self.mailbox.is_active(),
            sender_started: self.sender_started.load(Ordering::Acquire),
            render_worker_started: self.render_worker_started.load(Ordering::Acquire),
            superseded_mailbox: counters.superseded_mailbox,
            stream_stall: counters.stream_stall,
            stall_recovered: counters.stall_recovered,
            closed_channel: counters.closed_channel,
        }
    }
}

pub(crate) fn push_packet(
    delivery: crate::commands::playback_push_mailbox::Delivery<PushBridgeFrame>,
) -> Result<tauri::ipc::InvokeResponseBody, ()> {
    const HEADER_BYTES: usize = 52;
    let width = delivery.payload.width;
    let height = delivery.payload.height;
    let stride = width.checked_mul(4).ok_or(())?;
    if delivery.payload.rgba.len() != stride as usize * height as usize {
        return Err(());
    }
    let mut packet = vec![0_u8; HEADER_BYTES + delivery.payload.rgba.len()];
    packet[0..4].copy_from_slice(&0x4350_4652_u32.to_le_bytes());
    packet[4..6].copy_from_slice(&1_u16.to_le_bytes());
    packet[6..8].copy_from_slice(&(HEADER_BYTES as u16).to_le_bytes());
    packet[8..16].copy_from_slice(&delivery.generation.to_le_bytes());
    packet[16..24].copy_from_slice(&delivery.delivery_seq.to_le_bytes());
    packet[24..32].copy_from_slice(&delivery.frame_id.to_le_bytes());
    let t8 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_micros() as u64;
    packet[32..40].copy_from_slice(&t8.to_le_bytes());
    packet[40..44].copy_from_slice(&width.to_le_bytes());
    packet[44..48].copy_from_slice(&height.to_le_bytes());
    packet[48..52].copy_from_slice(&stride.to_le_bytes());
    packet[HEADER_BYTES..].copy_from_slice(&delivery.payload.rgba);
    Ok(tauri::ipc::InvokeResponseBody::Raw(packet))
}

pub(crate) async fn run_push_render_worker(app: tauri::AppHandle, runtime: Arc<NativePlaybackPushRuntime>) {
    loop {
        // Create the notification future before inspecting the mailbox. If a
        // submit lands in the tiny interval between `take()` and `await`, the
        // permit is retained by Notify instead of being lost forever.
        let notified = runtime.render_notify.notified();
        let request = {
            runtime
                .latest_render
                .lock()
                .expect("push render mailbox lock poisoned")
                .take()
        };
        let Some(request) = request else {
            notified.await;
            continue;
        };
        let generation = request.generation.unwrap_or_default();
        let frame_id = request.frame_time.frame_index;
        if let Ok(rgba) = super::render_frame_request_rgba(&app, &request).await {
            // The sender owns transport; this producer only replaces a slot.
            let _ = runtime.mailbox.submit(
                generation,
                frame_id,
                PushBridgeFrame {
                    rgba,
                    width: request.output_width,
                    height: request.output_height,
                },
            );
        }
    }
}

