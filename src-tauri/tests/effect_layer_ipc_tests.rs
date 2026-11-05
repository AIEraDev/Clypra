//! Integration tests for Phase 1 Step 4: EffectLayer IPC Type & Contracts
//!
//! Validates:
//! - JSON serialization & deserialization roundtrip for EffectLayer and Transform2D
//! - Backward compatibility: deserialization of requests without effectLayers field
//! - Full compliance with Step 4 task specification payload
//! - Validation rules (limits, non-negative frame, finite coordinates, positive dimensions)
//! - Output resolution scaling and file path normalization in `to_video_project_request`
//! - Layer cache key behavior (Decision #2: decode key invariance, compose key sensitivity)

use tauri_app_lib::commands::native_preview::{
    to_video_project_request, validate_video_project_request, EffectLayer,
    NativeProjectEffectLayer, NativeVideoProjectFrameRequest,
};
use tauri_app_lib::native_core::{
    ColorPolicy, EffectLayerSnapshot, FrameRequest, FrameTime, ProjectSnapshot, QualityTier,
    Transform2D, VideoLayerSnapshot, DEFAULT_TIME_SCALE, NATIVE_CORE_CONTRACT_VERSION,
};

#[test]
fn test_1_effect_layer_json_serialization_roundtrip() {
    let original = NativeProjectEffectLayer {
        layer_id: "test-effect-layer-1".to_string(),
        asset_path: "/path/to/test-effect-fixture.mov".to_string(),
        frame: 15,
        x: 100.0,
        y: 50.0,
        width: Some(320.0),
        height: Some(180.0),
        rotation: 45.0,
        opacity: 0.85,
        z_index: 100,
        blend_mode: "normal".to_string(),
        transform: Some(Transform2D {
            tx: 100.0,
            ty: 50.0,
            sx: 0.5,
            sy: 0.5,
            rotation: 45.0,
        }),
    };

    // Serialize to JSON string
    let json = serde_json::to_string_pretty(&original).expect("Must serialize to JSON");

    // Verify camelCase naming convention
    assert!(json.contains("\"assetPath\""), "JSON should contain camelCase assetPath");
    assert!(json.contains("\"zIndex\""), "JSON should contain camelCase zIndex");
    assert!(json.contains("\"blendMode\""), "JSON should contain camelCase blendMode");
    assert!(json.contains("\"transform\""), "JSON should contain transform object");

    // Deserialize back
    let deserialized: NativeProjectEffectLayer =
        serde_json::from_str(&json).expect("Must deserialize from JSON");

    assert_eq!(deserialized.layer_id, original.layer_id);
    assert_eq!(deserialized.asset_path, original.asset_path);
    assert_eq!(deserialized.frame, 15);
    assert_eq!(deserialized.x, 100.0);
    assert_eq!(deserialized.y, 50.0);
    assert_eq!(deserialized.width, Some(320.0));
    assert_eq!(deserialized.height, Some(180.0));
    assert_eq!(deserialized.rotation, 45.0);
    assert_eq!(deserialized.opacity, 0.85);
    assert_eq!(deserialized.z_index, 100);
    assert_eq!(deserialized.blend_mode, "normal");
    assert_eq!(deserialized.effective_x(), 100.0);
    assert_eq!(deserialized.effective_y(), 50.0);
    assert_eq!(deserialized.effective_scale_x(), 0.5);
    assert_eq!(deserialized.effective_scale_y(), 0.5);
    assert_eq!(deserialized.effective_rotation(), 45.0);
}

#[test]
fn test_2_backward_compatibility_omitted_effect_layers() {
    // Legacy JSON payload omitting `effectLayers` entirely
    let legacy_json = r#"{
        "canvasWidth": 1920,
        "canvasHeight": 1080,
        "clearColor": [0.0, 0.0, 0.0, 1.0],
        "layers": [],
        "rasterLayers": [],
        "textLayers": []
    }"#;

    let request: NativeVideoProjectFrameRequest =
        serde_json::from_str(legacy_json).expect("Legacy payload without effectLayers must deserialize");

    assert!(
        request.effect_layers.is_empty(),
        "effect_layers should default to an empty vector when omitted"
    );
    assert_eq!(request.canvas_width, 1920);
    assert_eq!(request.canvas_height, 1080);
    assert!(validate_video_project_request(&request).is_ok());
}

#[test]
fn test_3_exact_task_specification_schema_roundtrip() {
    // Exact schema specified in the Phase 0 Audit Step 4 task
    let task_spec_json = r#"{
        "canvasWidth": 640,
        "canvasHeight": 360,
        "videoLayers": [],
        "textLayers": [],
        "effectLayers": [{
            "assetPath": "/path/to/test-effect-fixture.mov",
            "frame": 0,
            "zIndex": 100,
            "opacity": 1.0,
            "transform": { "tx": 0.0, "ty": 0.0, "sx": 1.0, "sy": 1.0, "rotation": 0.0 }
        }]
    }"#;

    let request: NativeVideoProjectFrameRequest =
        serde_json::from_str(task_spec_json).expect("Task spec JSON must deserialize cleanly");

    assert_eq!(request.canvas_width, 640);
    assert_eq!(request.canvas_height, 360);
    assert_eq!(request.effect_layers.len(), 1);

    let layer = &request.effect_layers[0];
    assert_eq!(layer.asset_path, "/path/to/test-effect-fixture.mov");
    assert_eq!(layer.frame, 0);
    assert_eq!(layer.z_index, 100);
    assert_eq!(layer.opacity, 1.0);
    assert_eq!(layer.effective_x(), 0.0);
    assert_eq!(layer.effective_y(), 0.0);
    assert_eq!(layer.effective_scale_x(), 1.0);
    assert_eq!(layer.effective_scale_y(), 1.0);
    assert_eq!(layer.effective_rotation(), 0.0);

    // Validation must succeed
    assert!(validate_video_project_request(&request).is_ok());
}

#[test]
fn test_4_versioned_frame_request_roundtrip_with_effect_layer() {
    let frame_request = FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "test-effect-request-1".to_string(),
        frame_time: FrameTime::new(30, 1_000_000, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-effects-1".to_string(),
            frame_rate: 30,
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![VideoLayerSnapshot {
                layer_id: "base-video".to_string(),
                asset_id: "asset-video-1".to_string(),
                video_path: "/tmp/base-video.mp4".to_string(),
                source_time: FrameTime::new(30, 1_000_000, DEFAULT_TIME_SCALE).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                crop: None,
                color_grade: None,
                body_effect: None,
            }],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: vec![EffectLayerSnapshot {
                layer_id: Some("anim-overlay".to_string()),
                asset_path: "/tmp/overlay.mov".to_string(),
                frame: 30,
                x: 100.0,
                y: 200.0,
                width: Some(640.0),
                height: Some(360.0),
                rotation: 0.0,
                opacity: 0.9,
                z_index: 50,
                blend_mode: "normal".to_string(),
                transform: Some(Transform2D {
                    tx: 100.0,
                    ty: 200.0,
                    sx: 1.0,
                    sy: 1.0,
                    rotation: 0.0,
                }),
            }],
            transition: None,
        },
        output_width: 1920,
        output_height: 1080,
        quality: QualityTier::Full,
        color_policy: ColorPolicy::default(),
        render_graph_version: 1,
        generation: Some(1),
        mode: Some("playback".to_string()),
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
        is_scrubbing: Some(false),
        allow_keyframe_approx: Some(false),
    };

    // Must validate cleanly
    assert!(frame_request.validate().is_ok());

    // Serialize and deserialize
    let json = serde_json::to_string(&frame_request).expect("Must serialize FrameRequest");
    let deserialized: FrameRequest =
        serde_json::from_str(&json).expect("Must deserialize FrameRequest");

    assert_eq!(deserialized.project.effect_layers.len(), 1);
    let layer = &deserialized.project.effect_layers[0];
    assert_eq!(layer.asset_path, "/tmp/overlay.mov");
    assert_eq!(layer.frame, 30);
    assert_eq!(layer.z_index, 50);
    assert_eq!(layer.opacity, 0.9);
}

#[test]
fn test_5_validation_rejects_invalid_effect_layers() {
    fn make_valid_request(layer: EffectLayer) -> NativeVideoProjectFrameRequest {
        NativeVideoProjectFrameRequest {
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            layers: vec![],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: vec![layer],
            transition: None,
            quality: QualityTier::Full,
            mode: None,
            is_scrubbing: None,
            allow_keyframe_approx: None,
            generation: None,
        }
    }

    // 1. Empty asset path
    let mut bad_layer = NativeProjectEffectLayer {
        layer_id: "".to_string(),
        asset_path: "   ".to_string(),
        frame: 0,
        x: 0.0,
        y: 0.0,
        width: None,
        height: None,
        rotation: 0.0,
        opacity: 1.0,
        z_index: 0,
        blend_mode: "normal".to_string(),
        transform: None,
    };
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 2. Negative frame
    bad_layer.asset_path = "/valid/path.mov".to_string();
    bad_layer.frame = -1;
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 3. Non-finite coordinates
    bad_layer.frame = 0;
    bad_layer.x = f32::NAN;
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 4. Invalid opacity (> 1.0 or < 0.0)
    bad_layer.x = 0.0;
    bad_layer.opacity = 1.5;
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    bad_layer.opacity = -0.1;
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 5. Non-positive dimensions
    bad_layer.opacity = 1.0;
    bad_layer.width = Some(0.0);
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 6. Non-positive transform scale
    bad_layer.width = None;
    bad_layer.transform = Some(Transform2D {
        tx: 0.0,
        ty: 0.0,
        sx: -1.0,
        sy: 1.0,
        rotation: 0.0,
    });
    assert!(validate_video_project_request(&make_valid_request(bad_layer.clone())).is_err());

    // 7. Unsupported blend mode
    bad_layer.transform = None;
    bad_layer.blend_mode = "invalid_blend_mode_name".to_string();
    assert!(validate_video_project_request(&make_valid_request(bad_layer)).is_err());
}

#[test]
fn test_6_to_video_project_request_scales_effect_layers_proportionally() {
    let frame_request = FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "test-scale-request".to_string(),
        frame_time: FrameTime::new(0, 0, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-scale".to_string(),
            frame_rate: 30,
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: vec![EffectLayerSnapshot {
                layer_id: Some("scaled-effect".to_string()),
                asset_path: "/tmp/effect.mov".to_string(),
                frame: 10,
                x: 200.0,
                y: 100.0,
                width: Some(400.0),
                height: Some(300.0),
                rotation: 15.0,
                opacity: 0.8,
                z_index: 20,
                blend_mode: "normal".to_string(),
                transform: Some(Transform2D {
                    tx: 200.0,
                    ty: 100.0,
                    sx: 1.0,
                    sy: 1.0,
                    rotation: 15.0,
                }),
            }],
            transition: None,
        },
        // Request downscaled preview at 960x540 (0.5x scale)
        output_width: 960,
        output_height: 540,
        quality: QualityTier::Half,
        color_policy: ColorPolicy::default(),
        render_graph_version: 1,
        generation: None,
        mode: None,
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
        is_scrubbing: None,
        allow_keyframe_approx: None,
    };

    let legacy = to_video_project_request(&frame_request).expect("Must convert cleanly");
    assert_eq!(legacy.canvas_width, 960);
    assert_eq!(legacy.canvas_height, 540);
    assert_eq!(legacy.effect_layers.len(), 1);

    let layer = &legacy.effect_layers[0];
    assert_eq!(layer.frame, 10);
    assert_eq!(layer.x, 100.0, "x should be scaled by 0.5");
    assert_eq!(layer.y, 50.0, "y should be scaled by 0.5");
    assert_eq!(layer.width, Some(200.0), "width should be scaled by 0.5");
    assert_eq!(layer.height, Some(150.0), "height should be scaled by 0.5");
    assert_eq!(layer.rotation, 15.0, "rotation should remain in degrees");
    assert_eq!(layer.opacity, 0.8, "opacity should be preserved");
    assert_eq!(layer.z_index, 20, "z_index should be preserved");

    let t = layer.transform.as_ref().expect("transform should exist");
    assert_eq!(t.tx, 100.0, "tx should be scaled by 0.5");
    assert_eq!(t.ty, 50.0, "ty should be scaled by 0.5");
    assert_eq!(t.sx, 1.0, "sx scale factor is preserved");
    assert_eq!(t.sy, 1.0, "sy scale factor is preserved");
    assert_eq!(t.rotation, 15.0, "rotation is preserved");
}

#[test]
fn test_7_cache_key_behavior_invariance_and_sensitivity() {
    let base_request = FrameRequest {
        contract_version: NATIVE_CORE_CONTRACT_VERSION,
        request_id: "req-1".to_string(),
        frame_time: FrameTime::new(10, 333_333, DEFAULT_TIME_SCALE).unwrap(),
        project: ProjectSnapshot {
            schema_version: 1,
            project_revision: "rev-1".to_string(),
            frame_rate: 30,
            canvas_width: 1920,
            canvas_height: 1080,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            video_layers: vec![VideoLayerSnapshot {
                layer_id: "video-1".to_string(),
                asset_id: "asset-1".to_string(),
                video_path: "/media/video.mp4".to_string(),
                source_time: FrameTime::new(10, 333_333, DEFAULT_TIME_SCALE).unwrap(),
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                blend_mode: "normal".to_string(),
                crop: None,
                color_grade: None,
                body_effect: None,
            }],
            raster_layers: vec![],
            text_layers: vec![],
            effect_layers: vec![],
            transition: None,
        },
        output_width: 1920,
        output_height: 1080,
        quality: QualityTier::Full,
        color_policy: ColorPolicy::default(),
        render_graph_version: 1,
        generation: None,
        mode: None,
        scrub_velocity_px_per_second: None,
        requested_at_ms: None,
        is_scrubbing: None,
        allow_keyframe_approx: None,
    };

    let base_decode_key = base_request.decode_cache_key().unwrap();
    let base_composite_key = base_request.cache_key().unwrap();

    // Add an effect layer
    let mut with_effect = base_request.clone();
    with_effect.project.effect_layers = vec![EffectLayerSnapshot {
        layer_id: Some("fx-1".to_string()),
        asset_path: "/media/explosion.mov".to_string(),
        frame: 5,
        x: 400.0,
        y: 300.0,
        width: Some(300.0),
        height: Some(300.0),
        rotation: 0.0,
        opacity: 1.0,
        z_index: 10,
        blend_mode: "normal".to_string(),
        transform: None,
    }];

    let effect_decode_key = with_effect.decode_cache_key().unwrap();
    let effect_composite_key = with_effect.cache_key().unwrap();

    // Architectural Decision #2 Rule 1:
    // Raw video decode cache key MUST BE INVARIANT to effect layers!
    // Adding or removing overlays must NOT invalidate underlying pre-decoded video frames!
    assert_eq!(
        base_decode_key, effect_decode_key,
        "decode_cache_key must be invariant to effect layers (Decision #2)"
    );

    // Architectural Decision #2 Rule 2:
    // Composited frame cache key MUST BE SENSITIVE to effect layers!
    // The rendered pixels differ when an effect is present vs absent.
    assert_ne!(
        base_composite_key, effect_composite_key,
        "cache_key must differ when an effect layer is present"
    );

    // Architectural Decision #2 Rule 3:
    // Advancing the effect frame changes the composited frame key!
    let mut next_effect_frame = with_effect.clone();
    next_effect_frame.project.effect_layers[0].frame = 6;
    let next_frame_key = next_effect_frame.cache_key().unwrap();

    assert_ne!(
        effect_composite_key, next_frame_key,
        "cache_key must differ when effect layer frame advances"
    );
}
