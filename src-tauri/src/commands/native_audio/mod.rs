mod clips;
mod playback;
mod types;

#[cfg(test)]
mod tests;

pub use clips::*;
pub use playback::*;
pub use types::*;

use crate::native_audio::NativeAudioClock;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

pub(super) fn audio_clock(app: &AppHandle) -> Result<Arc<Mutex<NativeAudioClock>>, String> {
    app.try_state::<Arc<Mutex<NativeAudioClock>>>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Native audio clock is not initialized".to_string())
}
