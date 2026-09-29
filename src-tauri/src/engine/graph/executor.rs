//! Render Graph Executor
//!
//! Executes scheduled passes in topological order.
//! Intercepts cached static branches (bypassing redundant decoding, color grading,
//! and transformation passes), records resource state transitions, and produces
//! the final RenderedFrame for presentation.

use super::super::presenter::RenderedFrame;
use super::super::surface::{
    GpuFence, ResourceState, SurfaceBackend, SurfaceHandle, SurfaceOwner, SurfaceSync, VideoSurface,
};
use super::super::types::PixelFormat;
use super::cache::RenderGraphCache;
use super::graph::{GraphError, RenderGraph};
use super::node::{NodeId, PassKind, ResourceId};
use super::resource_pool::GraphResourcePool;
use super::telemetry::RenderGraphTelemetry;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

/// Execution engine for compiled Render Graphs.
pub struct RenderGraphExecutor {
    pool: GraphResourcePool,
}

impl Default for RenderGraphExecutor {
    fn default() -> Self {
        Self {
            pool: GraphResourcePool::new(),
        }
    }
}

impl RenderGraphExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Compiles and executes the Render Graph against available video surfaces and intermediate cache.
    pub fn execute(
        &mut self,
        graph: &mut RenderGraph,
        cache: &mut RenderGraphCache,
        available_surfaces: &HashMap<String, VideoSurface>,
    ) -> Result<(RenderedFrame, RenderGraphTelemetry), GraphError> {
        let compile_start = Instant::now();

        // 1. Cull dead nodes & occlusion
        graph.cull_dead_nodes();

        // 2. Compile topological schedule
        graph.compile_schedule()?;

        // 3. Schedule minimal GPU barriers
        graph.schedule_barriers();

        // 4. Memory analysis and aliasing
        self.pool = GraphResourcePool::new();
        graph.populate_resource_pool(&mut self.pool);

        let compile_time_us = compile_start.elapsed().as_micros() as u64;

        // 5. Execute scheduled passes
        let exec_start = Instant::now();
        cache.advance_frame();

        let mut resource_surfaces: HashMap<ResourceId, VideoSurface> = HashMap::new();
        let mut cached_branch_hits = 0;

        let node_map: HashMap<NodeId, &super::node::RenderPassNode> =
            graph.nodes.iter().map(|n| (n.id, n)).collect();

        for &node_id in &graph.execution_schedule {
            let node = match node_map.get(&node_id) {
                Some(n) => *n,
                None => continue,
            };

            // Check if this pass node is already cached
            if let Some(cache_key) = node.cache_key {
                if let Some(cached_surface) = cache.get(&cache_key) {
                    cached_branch_hits += 1;
                    if let Some(&out_res) = node.outputs.first() {
                        resource_surfaces.insert(out_res, cached_surface.clone());
                    }
                    continue; // Bypass GPU execution entirely!
                }
            }

            // Execute pass
            let produced_surface = match &node.kind {
                PassKind::Clear { color } => {
                    create_solid_surface(graph.canvas.width, graph.canvas.height, *color)
                }
                PassKind::Source { asset_id, .. } => {
                    if let Some(surf) = available_surfaces.get(asset_id) {
                        surf.clone()
                    } else {
                        // Fallback to placeholder surface
                        create_solid_surface(
                            graph.canvas.width,
                            graph.canvas.height,
                            [0.0, 0.0, 0.0, 1.0],
                        )
                    }
                }
                PassKind::ColorGrade { params } => {
                    let in_surf = node
                        .inputs
                        .first()
                        .and_then(|r| resource_surfaces.get(r))
                        .cloned()
                        .unwrap_or_else(|| {
                            create_solid_surface(
                                graph.canvas.width,
                                graph.canvas.height,
                                [0.0, 0.0, 0.0, 1.0],
                            )
                        });
                    apply_simulated_color_grade(in_surf, params)
                }
                PassKind::TransformEffect {
                    transform, opacity, ..
                } => {
                    let in_surf = node
                        .inputs
                        .first()
                        .and_then(|r| resource_surfaces.get(r))
                        .cloned()
                        .unwrap_or_else(|| {
                            create_solid_surface(
                                graph.canvas.width,
                                graph.canvas.height,
                                [0.0, 0.0, 0.0, 1.0],
                            )
                        });
                    apply_simulated_transform(in_surf, transform, *opacity)
                }
                PassKind::Composite {
                    blend_mode,
                    opacity,
                    ..
                } => {
                    let bg_surf = node
                        .inputs
                        .first()
                        .and_then(|r| resource_surfaces.get(r))
                        .cloned()
                        .unwrap_or_else(|| {
                            create_solid_surface(
                                graph.canvas.width,
                                graph.canvas.height,
                                graph.clear_color,
                            )
                        });

                    let fg_surf = node
                        .inputs
                        .get(1)
                        .and_then(|r| resource_surfaces.get(r))
                        .cloned();

                    if let Some(fg) = fg_surf {
                        apply_simulated_blend(bg_surf, fg, *blend_mode, *opacity)
                    } else {
                        bg_surf
                    }
                }
                PassKind::Overlay { .. } => {
                    // Render overlay (e.g. text/subtitle)
                    create_solid_surface(
                        graph.canvas.width,
                        graph.canvas.height,
                        [1.0, 1.0, 1.0, 0.8], // Text overlay
                    )
                }
                PassKind::Output { .. } => {
                    let mut final_surf = node
                        .inputs
                        .first()
                        .and_then(|r| resource_surfaces.get(r))
                        .cloned()
                        .unwrap_or_else(|| {
                            create_solid_surface(
                                graph.canvas.width,
                                graph.canvas.height,
                                graph.clear_color,
                            )
                        });
                    final_surf.transition_state(ResourceState::Present);
                    final_surf
                }
            };

            // Store produced surface for downstream consumers
            if let Some(&out_res) = node.outputs.first() {
                resource_surfaces.insert(out_res, produced_surface.clone());
            }

            // Store in cache if cache key exists
            if let Some(cache_key) = node.cache_key {
                cache.insert(cache_key, produced_surface);
            }
        }

        let exec_time_us = exec_start.elapsed().as_micros() as u64;

        // Retrieve final output surface
        let final_surface = graph
            .final_resource
            .and_then(|r| resource_surfaces.remove(&r))
            .unwrap_or_else(|| {
                create_solid_surface(graph.canvas.width, graph.canvas.height, graph.clear_color)
            });

        let rendered_frame = RenderedFrame {
            surface: final_surface,
            pts: graph.time,
            generation: graph.generation,
        };

        let culled_count = graph.nodes.iter().filter(|n| n.culled).count();

        let telemetry = RenderGraphTelemetry {
            node_count: graph.nodes.len(),
            active_pass_count: graph.execution_schedule.len(),
            culled_node_count: culled_count,
            cached_branch_hits,
            physical_allocations: self.pool.physical_slot_count(),
            aliased_resources: self.pool.aliased_count(),
            peak_vram_bytes: self.pool.peak_vram_bytes(),
            unaliased_vram_bytes: self.pool.unaliased_vram_bytes(),
            vram_savings_bytes: self
                .pool
                .unaliased_vram_bytes()
                .saturating_sub(self.pool.peak_vram_bytes()),
            compile_time_us,
            execution_time_us: exec_time_us,
        };

        Ok((rendered_frame, telemetry))
    }
}

/// Helper function to create a solid color surface for canvas or placeholder.
pub fn create_solid_surface(width: u32, height: u32, color: [f32; 4]) -> VideoSurface {
    let r = (color[0].clamp(0.0, 1.0) * 255.0) as u8;
    let g = (color[1].clamp(0.0, 1.0) * 255.0) as u8;
    let b = (color[2].clamp(0.0, 1.0) * 255.0) as u8;
    let a = (color[3].clamp(0.0, 1.0) * 255.0) as u8;

    // Allocate 4 bytes per pixel RGBA
    let pixel = [r, g, b, a];
    let total_pixels = (width as usize) * (height as usize);
    let mut buffer = Vec::with_capacity(total_pixels * 4);
    for _ in 0..total_pixels {
        buffer.extend_from_slice(&pixel);
    }

    let sync = SurfaceSync {
        producer_fence: Some(GpuFence::new(1, 0x1000)),
        consumer_fence: Some(GpuFence::new(1, 0x2000)),
        producer_value: 1,
        consumer_value: 1,
        fence_value: 1,
        is_ready: true,
        keyed_mutex_key: None,
    };

    let handle = SurfaceHandle::Cpu {
        buffer: Arc::new(buffer),
        stride_y: (width as usize) * 4,
        stride_uv: 0,
    };

    let mut surf = VideoSurface::new(
        SurfaceBackend::D3D12,
        width,
        height,
        PixelFormat::Rgba8UnormSrgb,
        sync,
        handle,
    );
    surf.owner = SurfaceOwner::ReadyQueue;
    surf
}

fn apply_simulated_color_grade(
    mut surface: VideoSurface,
    _params: &super::node::ColorGradeParams,
) -> VideoSurface {
    surface.transition_state(ResourceState::PixelShaderResource);
    surface
}

fn apply_simulated_transform(
    mut surface: VideoSurface,
    _transform: &super::super::types::LayerTransform,
    _opacity: f32,
) -> VideoSurface {
    surface.transition_state(ResourceState::PixelShaderResource);
    surface
}

fn apply_simulated_blend(
    mut bg: VideoSurface,
    _fg: VideoSurface,
    _mode: super::super::types::BlendMode,
    _opacity: f32,
) -> VideoSurface {
    bg.transition_state(ResourceState::CopyDest);
    bg
}
