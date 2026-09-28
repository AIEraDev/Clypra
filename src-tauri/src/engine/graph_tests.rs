//! Acceptance Tests for Phase H: GPU Render Graph & Composition (DAG)
//!
//! Validates:
//! - H1: DAG Construction & Topological Ordering
//! - H2: Static Branch Caching (Overlay Modification Invariant)
//! - H3: Zero-Opacity & Hidden Layer Culling
//! - H4: Fullscreen Opaque Occlusion Culling
//! - H5: Transient Resource Aliasing & Memory Reuse
//! - H6: Explicit Resource State Barrier Generation
//! - H7: Multi-Track Composite & Blend Modes
//! - H8: Empty Scene / Timeline Gap Fast Path
//! - H9: React Freeze & Temporal Decoupling

use super::graph::*;
use super::render_plan::{AudioPlan, RenderLayer, RenderPlan};
use super::surface::{ResourceState, VideoSurface};
use super::types::{
    BlendMode, CanvasSpec, LayerTransform, LayerVisibility, MediaTime, PixelFormat,
};
use std::collections::HashMap;
use std::thread;
use std::time::Duration;

fn create_test_surface(width: u32, height: u32) -> VideoSurface {
    create_solid_surface(width, height, [0.1, 0.2, 0.3, 1.0])
}

// ─── H1: DAG Construction & Topological Ordering ─────────────────────────────
#[test]
fn test_phase_h1_dag_construction_and_topological_ordering() {
    let canvas = CanvasSpec {
        width: 1920,
        height: 1080,
        fps: 60.0,
        sample_rate: 48000,
    };

    let mut layer1 = RenderLayer::video("layer-1", "clip-1", "asset-1", MediaTime(1_000_000));
    layer1.z_index = 0;

    let mut layer2 = RenderLayer::video("layer-2", "clip-2", "asset-2", MediaTime(2_000_000));
    layer2.z_index = 1;

    let plan = RenderPlan {
        generation: 1,
        project_revision: 10,
        time: MediaTime(1_000_000),
        canvas,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![layer1, layer2],
        audio: AudioPlan::default(),
    };

    let mut graph = RenderGraph::from_render_plan(&plan);
    assert!(!graph.nodes.is_empty(), "Graph must contain nodes");

    // Verify expected node types exist
    let node_names: Vec<String> = graph.nodes.iter().map(|n| n.name.clone()).collect();
    assert!(node_names.iter().any(|n| n == "ClearPass"));
    assert!(node_names.iter().any(|n| n.contains("Source_clip-1")));
    assert!(node_names.iter().any(|n| n.contains("ColorGrade_clip-1")));
    assert!(node_names.iter().any(|n| n.contains("Transform_clip-1")));
    assert!(node_names.iter().any(|n| n.contains("Composite_layer-1")));
    assert!(node_names.iter().any(|n| n.contains("Source_clip-2")));
    assert!(node_names.iter().any(|n| n.contains("Composite_layer-2")));
    assert!(node_names.iter().any(|n| n == "OutputPass"));

    // Compile topological schedule
    let res = graph.compile_schedule();
    assert!(res.is_ok(), "Topological sort must succeed without cycles");

    let schedule = &graph.execution_schedule;
    assert_eq!(
        schedule.len(),
        graph.nodes.len(),
        "All active nodes must be scheduled"
    );

    // Verify ordering: ClearPass must be before Composite, Source before Grade, Grade before Transform, Transform before Composite
    let find_idx = |name: &str| -> usize {
        schedule
            .iter()
            .position(|id| {
                graph
                    .nodes
                    .iter()
                    .find(|n| n.id == *id)
                    .map(|n| n.name.contains(name))
                    .unwrap_or(false)
            })
            .expect(&format!("Node {name} not found in schedule"))
    };

    let clear_idx = find_idx("ClearPass");
    let src1_idx = find_idx("Source_clip-1");
    let grade1_idx = find_idx("ColorGrade_clip-1");
    let transform1_idx = find_idx("Transform_clip-1");
    let comp1_idx = find_idx("Composite_layer-1");
    let output_idx = find_idx("OutputPass");

    assert!(src1_idx < grade1_idx, "Source must precede ColorGrade");
    assert!(
        grade1_idx < transform1_idx,
        "ColorGrade must precede Transform"
    );
    assert!(
        transform1_idx < comp1_idx,
        "Transform must precede Composite"
    );
    assert!(clear_idx < comp1_idx, "ClearPass must precede Composite");
    assert!(comp1_idx < output_idx, "Composite must precede OutputPass");
}

// ─── H2: Static Branch Caching (Overlay Modification Invariant) ──────────────
#[test]
fn test_phase_h2_static_branch_caching_overlay_modification() {
    let canvas = CanvasSpec::default();

    let mut video_layer =
        RenderLayer::video("video-1", "clip-video", "asset-video", MediaTime(5_000_000));
    video_layer.z_index = 0;

    let mut text_layer_1 = RenderLayer::video("text-1", "clip-text", "text:caption", MediaTime(0));
    text_layer_1.z_index = 1;
    text_layer_1.effects.push(serde_json::json!({
        "type": "text",
        "content": "Hello World"
    }));

    let plan1 = RenderPlan {
        generation: 1,
        project_revision: 1,
        time: MediaTime(5_000_000),
        canvas: canvas.clone(),
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![video_layer.clone(), text_layer_1],
        audio: AudioPlan::default(),
    };

    let mut cache = RenderGraphCache::new(50, 500 * 1024 * 1024);
    let mut executor = RenderGraphExecutor::new();

    let mut available_surfaces = HashMap::new();
    available_surfaces.insert("asset-video".to_string(), create_test_surface(1920, 1080));

    // Frame 1 Execution (Cold cache)
    let mut graph1 = RenderGraph::from_render_plan(&plan1);
    let (frame1, telemetry1) = executor
        .execute(&mut graph1, &mut cache, &available_surfaces)
        .expect("Frame 1 execution should succeed");

    assert_eq!(frame1.generation, 1);
    assert_eq!(telemetry1.cached_branch_hits, 0, "Cold cache has 0 hits");

    // Frame 2: Video layer is 100% identical, but Text overlay changes content!
    let mut text_layer_2 = RenderLayer::video("text-1", "clip-text", "text:caption", MediaTime(0));
    text_layer_2.z_index = 1;
    text_layer_2.effects.push(serde_json::json!({
        "type": "text",
        "content": "Second Subtitle Line Changed"
    }));

    let plan2 = RenderPlan {
        generation: 2,
        project_revision: 2,
        time: MediaTime(5_000_000), // Same video PTS
        canvas: canvas.clone(),
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![video_layer, text_layer_2],
        audio: AudioPlan::default(),
    };

    let mut graph2 = RenderGraph::from_render_plan(&plan2);
    let (frame2, telemetry2) = executor
        .execute(&mut graph2, &mut cache, &available_surfaces)
        .expect("Frame 2 execution should succeed");

    assert_eq!(frame2.generation, 2);
    // Key Invariant: Video Source, ColorGrade, and Transform nodes were reused from cache!
    assert!(
        telemetry2.cached_branch_hits >= 1,
        "Static video branch must be reused from cache when text changes, got {} hits",
        telemetry2.cached_branch_hits
    );
}

// ─── H3: Zero-Opacity & Hidden Layer Culling ─────────────────────────────────
#[test]
fn test_phase_h3_zero_opacity_and_hidden_layer_culling() {
    let canvas = CanvasSpec::default();

    let mut layer_visible =
        RenderLayer::video("layer-1", "clip-1", "asset-1", MediaTime(1_000_000));
    layer_visible.z_index = 0;
    layer_visible.opacity = 1.0;

    let mut layer_hidden = RenderLayer::video("layer-2", "clip-2", "asset-2", MediaTime(2_000_000));
    layer_hidden.z_index = 1;
    layer_hidden.visibility = LayerVisibility::Hidden;

    let mut layer_zero_opacity =
        RenderLayer::video("layer-3", "clip-3", "asset-3", MediaTime(3_000_000));
    layer_zero_opacity.z_index = 2;
    layer_zero_opacity.opacity = 0.0;

    let plan = RenderPlan {
        generation: 1,
        project_revision: 1,
        time: MediaTime(1_000_000),
        canvas,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![layer_visible, layer_hidden, layer_zero_opacity],
        audio: AudioPlan::default(),
    };

    let mut graph = RenderGraph::from_render_plan(&plan);
    let mut cache = RenderGraphCache::new(50, 100 * 1024 * 1024);
    let mut executor = RenderGraphExecutor::new();
    let surfaces = HashMap::new();

    let (_, telemetry) = executor
        .execute(&mut graph, &mut cache, &surfaces)
        .expect("Execution should succeed");

    // Check that hidden and zero-opacity nodes were culled
    assert!(
        telemetry.culled_node_count > 0,
        "Hidden and zero opacity nodes must be culled"
    );

    // Verify clip-2 and clip-3 are not in the active execution schedule
    let active_names: Vec<String> = graph
        .execution_schedule
        .iter()
        .map(|id| {
            graph
                .nodes
                .iter()
                .find(|n| n.id == *id)
                .unwrap()
                .name
                .clone()
        })
        .collect();

    assert!(
        active_names.iter().all(|n| !n.contains("clip-2")),
        "Hidden clip-2 must not be scheduled"
    );
    assert!(
        active_names.iter().all(|n| !n.contains("clip-3")),
        "Zero-opacity clip-3 must not be scheduled"
    );
}

// ─── H4: Fullscreen Opaque Occlusion Culling ────────────────────────────────
#[test]
fn test_phase_h4_fullscreen_opaque_occlusion_culling() {
    let canvas = CanvasSpec {
        width: 1920,
        height: 1080,
        fps: 60.0,
        sample_rate: 48000,
    };

    // Lower layer (e.g. background 4K video)
    let mut bg_layer = RenderLayer::video("layer-bg", "clip-bg", "asset-bg", MediaTime(1_000_000));
    bg_layer.z_index = 0;

    // Upper layer: 100% opaque, fullscreen, normal blend mode
    let mut fg_layer = RenderLayer::video("layer-fg", "clip-fg", "asset-fg", MediaTime(1_000_000));
    fg_layer.z_index = 10;
    fg_layer.opacity = 1.0;
    fg_layer.blend_mode = BlendMode::Normal;
    fg_layer.transform = LayerTransform {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation_deg: 0.0,
        anchor_x: 0.5,
        anchor_y: 0.5,
    };

    let plan = RenderPlan {
        generation: 1,
        project_revision: 1,
        time: MediaTime(1_000_000),
        canvas,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![bg_layer, fg_layer],
        audio: AudioPlan::default(),
    };

    let mut graph = RenderGraph::from_render_plan(&plan);
    graph.cull_occluded_layers(&plan);

    // Verify background layer nodes were marked as occluded
    let occluded_nodes: Vec<_> = graph
        .nodes
        .iter()
        .filter(|n| n.cull_reason == Some(CullReason::Occluded))
        .collect();

    assert!(
        !occluded_nodes.is_empty(),
        "Background layer must be culled due to occlusion by foreground layer"
    );
    assert!(
        occluded_nodes.iter().any(|n| n.name.contains("clip-bg")),
        "clip-bg must be among the occluded nodes"
    );
}

// ─── H5: Transient Resource Aliasing & Memory Reuse ──────────────────────────
#[test]
fn test_phase_h5_transient_resource_aliasing_and_memory_reuse() {
    let mut pool = GraphResourcePool::new();

    let desc = TransientResourceDesc {
        width: 1920,
        height: 1080,
        format: PixelFormat::Rgba8UnormSrgb,
    };

    // Register 4 virtual resources
    let r1 = ResourceId(1);
    let r2 = ResourceId(2);
    let r3 = ResourceId(3);
    let r4 = ResourceId(4);

    pool.register_resource(r1, desc);
    pool.register_resource(r2, desc);
    pool.register_resource(r3, desc);
    pool.register_resource(r4, desc);

    // Set non-overlapping lifetimes:
    // r1: steps 0..1
    // r2: steps 2..3 (can alias r1!)
    // r3: steps 4..5 (can alias r1 & r2!)
    // r4: steps 0..5 (long-lived accumulator, overlaps everything)
    pool.record_usage(r1, 0);
    pool.record_usage(r1, 1);

    pool.record_usage(r2, 2);
    pool.record_usage(r2, 3);

    pool.record_usage(r3, 4);
    pool.record_usage(r3, 5);

    pool.record_usage(r4, 0);
    pool.record_usage(r4, 5);

    pool.compile_aliasing();

    // Verification:
    // Instead of 4 separate physical slots, r1, r2, and r3 should be aliased into 1 slot,
    // and r4 into a 2nd slot. Total physical slots = 2!
    assert_eq!(
        pool.physical_slot_count(),
        2,
        "4 virtual resources with disjoint lifetimes must compile into 2 physical slots"
    );
    assert_eq!(pool.aliased_count(), 2, "2 resources must be aliased");

    let bytes_per_texture = desc.memory_bytes();
    assert_eq!(pool.unaliased_vram_bytes(), bytes_per_texture * 4);
    assert_eq!(pool.peak_vram_bytes(), bytes_per_texture * 2);
    assert!(pool.peak_vram_bytes() < pool.unaliased_vram_bytes());
}

// ─── H6: Explicit Resource State Barrier Generation ──────────────────────────
#[test]
fn test_phase_h6_explicit_resource_state_barrier_generation() {
    let canvas = CanvasSpec::default();
    let layer = RenderLayer::video("l1", "c1", "a1", MediaTime(0));

    let plan = RenderPlan {
        generation: 1,
        project_revision: 1,
        time: MediaTime(0),
        canvas,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![layer],
        audio: AudioPlan::default(),
    };

    let mut graph = RenderGraph::from_render_plan(&plan);
    graph.compile_schedule().unwrap();
    graph.schedule_barriers();

    // Verify barriers exist
    assert!(
        !graph.pass_barriers.is_empty(),
        "Graph must schedule explicit resource barriers"
    );

    // Verify Output pass has a barrier transitioning final resource to Present state
    let output_id = graph.output_node.unwrap();
    let output_barriers = graph.pass_barriers.get(&output_id).unwrap();
    assert!(
        output_barriers
            .iter()
            .any(|b| b.after == ResourceState::Present),
        "Output pass must transition target to ResourceState::Present"
    );
}

// ─── H7: Multi-Track Composite & Blend Modes ────────────────────────────────
#[test]
fn test_phase_h7_multi_track_composite_and_blend_modes() {
    let canvas = CanvasSpec::default();

    let mut l1 = RenderLayer::video("l1", "c1", "a1", MediaTime(0));
    l1.z_index = 10;
    l1.blend_mode = BlendMode::Normal;

    let mut l2 = RenderLayer::video("l2", "c2", "a2", MediaTime(0));
    l2.z_index = 20;
    l2.blend_mode = BlendMode::Screen;

    let mut l3 = RenderLayer::video("l3", "c3", "a3", MediaTime(0));
    l3.z_index = 30;
    l3.blend_mode = BlendMode::Multiply;

    let plan = RenderPlan {
        generation: 1,
        project_revision: 1,
        time: MediaTime(0),
        canvas,
        clear_color: [0.0, 0.0, 0.0, 1.0],
        layers: vec![l3, l1, l2], // Input out of order
        audio: AudioPlan::default(),
    };

    let mut graph = RenderGraph::from_render_plan(&plan);
    let mut cache = RenderGraphCache::new(50, 100 * 1024 * 1024);
    let mut executor = RenderGraphExecutor::new();

    let (frame, telemetry) = executor
        .execute(&mut graph, &mut cache, &HashMap::new())
        .expect("Execution must succeed");

    assert_eq!(frame.pts, MediaTime(0));
    assert_eq!(telemetry.culled_node_count, 0);
    assert!(telemetry.active_pass_count >= 10);
}

// ─── H8: Empty Scene / Timeline Gap Fast Path ────────────────────────────────
#[test]
fn test_phase_h8_empty_scene_timeline_gap_fast_path() {
    let canvas = CanvasSpec::default();
    let plan = RenderPlan::empty(1, 1, MediaTime(10_000_000), canvas, [0.05, 0.05, 0.05, 1.0]);

    let mut graph = RenderGraph::from_render_plan(&plan);
    let mut cache = RenderGraphCache::new(10, 10 * 1024 * 1024);
    let mut executor = RenderGraphExecutor::new();

    let (frame, telemetry) = executor
        .execute(&mut graph, &mut cache, &HashMap::new())
        .expect("Empty scene must execute cleanly");

    assert_eq!(frame.pts, MediaTime(10_000_000));
    // Fast path: only ClearPass and OutputPass exist
    assert_eq!(telemetry.active_pass_count, 2);
    assert_eq!(telemetry.culled_node_count, 0);
    // Sub-millisecond compile time
    assert!(
        telemetry.compile_time_us < 1000,
        "Empty scene compile time must be sub-millisecond, was {} us",
        telemetry.compile_time_us
    );
}

// ─── H9: React Freeze & Temporal Decoupling ──────────────────────────────────
#[test]
fn test_phase_h9_react_freeze_temporal_decoupling() {
    // Simulate React thread freezing for 100ms
    let react_handle = thread::spawn(|| {
        thread::sleep(Duration::from_millis(100));
        "react_thawed"
    });

    let canvas = CanvasSpec::default();
    let mut cache = RenderGraphCache::new(50, 500 * 1024 * 1024);
    let mut executor = RenderGraphExecutor::new();

    let mut surfaces = HashMap::new();
    surfaces.insert("asset-test".to_string(), create_test_surface(1920, 1080));

    // Native engine executes 30 frames at 60 FPS while React is frozen
    let mut presented_frames = 0;
    for i in 0..30 {
        let pts = MediaTime::from_frame_index(i, 60.0);
        let layer =
            RenderLayer::video(format!("layer-{i}"), format!("clip-{i}"), "asset-test", pts);

        let plan = RenderPlan {
            generation: i as u64,
            project_revision: 1,
            time: pts,
            canvas: canvas.clone(),
            clear_color: [0.0, 0.0, 0.0, 1.0],
            layers: vec![layer],
            audio: AudioPlan::default(),
        };

        let mut graph = RenderGraph::from_render_plan(&plan);
        let (frame, _) = executor
            .execute(&mut graph, &mut cache, &surfaces)
            .expect("Native frame must render");

        assert_eq!(frame.pts, pts);
        presented_frames += 1;
    }

    assert_eq!(presented_frames, 30);
    let react_status = react_handle.join().unwrap();
    assert_eq!(react_status, "react_thawed");
}
