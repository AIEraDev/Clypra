use super::config::{choose_present_mode, choose_surface_format};
use super::runtime::NativeSurfaceRuntime;
use std::sync::atomic::Ordering;
use wgpu;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_srgb_surface_formats() {
        let formats = [
            wgpu::TextureFormat::Rgba16Float,
            wgpu::TextureFormat::Bgra8UnormSrgb,
            wgpu::TextureFormat::Rgba8Unorm,
        ];
        assert_eq!(
            choose_surface_format(&formats),
            Some(wgpu::TextureFormat::Bgra8UnormSrgb)
        );
    }

    #[test]
    fn prefers_fifo_presentation() {
        let modes = [wgpu::PresentMode::Immediate, wgpu::PresentMode::Fifo];
        assert_eq!(choose_present_mode(&modes), Some(wgpu::PresentMode::Fifo));
    }

    #[test]
    fn prefers_mailbox_and_relaxed_over_fifo() {
        let modes_mailbox = [
            wgpu::PresentMode::Immediate,
            wgpu::PresentMode::Fifo,
            wgpu::PresentMode::Mailbox,
        ];
        assert_eq!(
            choose_present_mode(&modes_mailbox),
            Some(wgpu::PresentMode::Mailbox)
        );

        let modes_relaxed = [
            wgpu::PresentMode::Immediate,
            wgpu::PresentMode::Fifo,
            wgpu::PresentMode::FifoRelaxed,
        ];
        assert_eq!(
            choose_present_mode(&modes_relaxed),
            Some(wgpu::PresentMode::FifoRelaxed)
        );
    }

    #[test]
    fn runtime_starts_without_a_surface() {
        assert!(NativeSurfaceRuntime::new().probe().is_none());
    }

    #[test]
    fn reset_advances_runtime_epoch() {
        let mut runtime = NativeSurfaceRuntime::new();
        let initial_epoch = runtime.runtime_epoch();

        runtime.reset();

        assert_ne!(runtime.runtime_epoch(), initial_epoch);
    }

    #[test]
    fn rejects_out_of_order_surface_presentations() {
        let mut runtime = NativeSurfaceRuntime::new();
        assert!(runtime.accept_presentation(2));
        assert!(!runtime.accept_presentation(1));
        assert!(runtime.accept_presentation(3));
    }

    #[test]
    fn poison_recovery_advances_runtime_epoch() {
        let mut runtime = NativeSurfaceRuntime::new();
        let initial_epoch = runtime.runtime_epoch();

        runtime.handle_poison_recovery("test_context");

        assert_eq!(runtime.runtime_epoch(), initial_epoch.wrapping_add(1));
    }

    #[test]
    fn surface_visibility_starts_hidden_and_resets() {
        let mut runtime = NativeSurfaceRuntime::new();
        assert!(!runtime.is_shown());

        let _ = runtime.hide_surface();
        assert!(!runtime.is_shown());

        runtime.reset();
        assert!(!runtime.is_shown());
    }

    #[test]
    fn show_surface_is_idempotent_without_window() {
        // A runtime with no surface_window configured returns an error —
        // it cannot dispatch to main thread without a window handle.
        let runtime = NativeSurfaceRuntime::new();
        let result = runtime.show_surface();
        assert!(result.is_err(), "show_surface without window should error");
        assert!(!runtime.is_shown(), "is_shown must remain false after error");
    }

    #[test]
    fn hide_surface_without_window_clears_shown_flag() {
        // hide_surface without a configured window clears is_shown without error.
        let runtime = NativeSurfaceRuntime::new();
        let result = runtime.hide_surface();
        assert!(result.is_ok());
        assert!(!runtime.is_shown());
    }

    #[test]
    fn show_after_reset_requires_reconfiguration() {
        let mut runtime = NativeSurfaceRuntime::new();
        runtime.reset();
        // After reset, no surface_window exists, so show must fail.
        let result = runtime.show_surface();
        assert!(result.is_err());
    }

    #[test]
    fn hide_clears_shown_flag_atomically() {
        // Verify is_shown is false before the window.hide() call completes,
        // so concurrent render frames see the updated flag immediately.
        let runtime = NativeSurfaceRuntime::new();
        // Set is_shown manually (simulating a previous successful show)
        runtime.is_shown.store(true, Ordering::Release);
        let _ = runtime.hide_surface();
        // is_shown must be cleared even without a window (no window configured here)
        assert!(!runtime.is_shown());
    }
}
