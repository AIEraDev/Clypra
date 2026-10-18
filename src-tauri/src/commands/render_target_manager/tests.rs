use super::*;

#[test]
fn render_target_id_named_constants_are_distinct() {
    assert_ne!(RenderTargetId::PROGRAM, RenderTargetId::SOURCE);
    assert_ne!(RenderTargetId::SOURCE, RenderTargetId::EXTERNAL);
    assert_ne!(RenderTargetId::PROGRAM, RenderTargetId::EXTERNAL);
}

#[test]
fn render_target_id_new_unique_does_not_collide_with_constants() {
    let id = RenderTargetId::new_unique();
    assert_ne!(id, RenderTargetId::PROGRAM);
    assert_ne!(id, RenderTargetId::SOURCE);
    assert_ne!(id, RenderTargetId::EXTERNAL);
}

#[test]
fn render_target_id_sequential_unique_ids_differ() {
    let a = RenderTargetId::new_unique();
    let b = RenderTargetId::new_unique();
    assert_ne!(a, b);
}

#[test]
fn render_target_id_display() {
    assert_eq!(format!("{}", RenderTargetId::PROGRAM), "Program");
    assert_eq!(format!("{}", RenderTargetId::SOURCE), "Source");
    assert_eq!(format!("{}", RenderTargetId::EXTERNAL), "External");
    assert_eq!(format!("{}", RenderTargetId(42)), "Target(42)");
}

#[test]
fn frame_priority_ordering() {
    use crate::wgpu_compositor::frame_request::FramePriority;
    assert!(FramePriority::Realtime > FramePriority::Interactive);
    assert!(FramePriority::Interactive > FramePriority::Background);
}

#[test]
fn monitor_id_equality() {
    let a = MonitorId(r"\\.\DISPLAY1".to_string());
    let b = MonitorId(r"\\.\DISPLAY1".to_string());
    let c = MonitorId(r"\\.\DISPLAY2".to_string());
    assert_eq!(a, b);
    assert_ne!(a, c);
}
