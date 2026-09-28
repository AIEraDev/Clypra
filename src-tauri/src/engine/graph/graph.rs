//! Render Graph (DAG)
//!
//! Owns the directed acyclic graph of passes, dependency analysis,
//! node culling (visibility, zero-opacity, occlusion), topological sorting,
//! and resource barrier scheduling.

use super::super::render_plan::RenderPlan;
use super::super::surface::ResourceState;
use super::super::types::{BlendMode, CanvasSpec, LayerVisibility, MediaTime, PixelFormat};
use super::node::{
    ColorGradeParams, CullReason, EffectSpec, NodeCacheKey, NodeId, OverlayType, PassKind,
    RenderPassNode, ResourceId,
};
use super::resource_pool::{GraphResourcePool, TransientResourceDesc};
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};

/// Resource state transition barrier required on the GPU command list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceBarrier {
    pub resource: ResourceId,
    pub before: ResourceState,
    pub after: ResourceState,
}

/// Compilation or execution error in the Render Graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    CycleDetected,
    MissingResource(ResourceId),
    MissingNode(NodeId),
    InvalidDependency(String),
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GraphError::CycleDetected => write!(f, "Cycle detected in Render Graph dependencies"),
            GraphError::MissingResource(r) => write!(f, "Missing resource {:?}", r),
            GraphError::MissingNode(n) => write!(f, "Missing node {:?}", n),
            GraphError::InvalidDependency(s) => write!(f, "Invalid graph dependency: {s}"),
        }
    }
}

/// Core Render Graph representation.
pub struct RenderGraph {
    pub generation: u64,
    pub project_revision: u64,
    pub time: MediaTime,
    pub canvas: CanvasSpec,
    pub clear_color: [f32; 4],
    pub nodes: Vec<RenderPassNode>,
    pub resources: HashMap<ResourceId, TransientResourceDesc>,
    pub output_node: Option<NodeId>,
    pub final_resource: Option<ResourceId>,
    // Adjacency lists
    dependencies: HashMap<NodeId, Vec<NodeId>>, // Node -> Nodes it depends on
    dependents: HashMap<NodeId, Vec<NodeId>>,   // Node -> Nodes that depend on it
    // Execution schedule and barriers
    pub execution_schedule: Vec<NodeId>,
    pub pass_barriers: HashMap<NodeId, Vec<ResourceBarrier>>,
}

impl RenderGraph {
    pub fn new(
        generation: u64,
        project_revision: u64,
        time: MediaTime,
        canvas: CanvasSpec,
        clear_color: [f32; 4],
    ) -> Self {
        Self {
            generation,
            project_revision,
            time,
            canvas,
            clear_color,
            nodes: Vec::new(),
            resources: HashMap::new(),
            output_node: None,
            final_resource: None,
            dependencies: HashMap::new(),
            dependents: HashMap::new(),
            execution_schedule: Vec::new(),
            pass_barriers: HashMap::new(),
        }
    }

    /// Constructs a Render Graph directly from an evaluated RenderPlan.
    pub fn from_render_plan(plan: &RenderPlan) -> Self {
        let mut graph = Self::new(
            plan.generation,
            plan.project_revision,
            plan.time,
            plan.canvas.clone(),
            plan.clear_color,
        );

        let mut next_node_id = 1u32;
        let mut next_res_id = 1u32;

        let canvas_format = PixelFormat::Rgba8UnormSrgb;
        let canvas_desc = TransientResourceDesc {
            width: plan.canvas.width,
            height: plan.canvas.height,
            format: canvas_format,
        };

        // 1. Initial Canvas Clear Pass
        let clear_res = ResourceId(next_res_id);
        next_res_id += 1;
        graph.resources.insert(clear_res, canvas_desc);

        let clear_node_id = NodeId(next_node_id);
        next_node_id += 1;
        let mut clear_node = RenderPassNode::new(
            clear_node_id,
            "ClearPass",
            PassKind::Clear {
                color: plan.clear_color,
            },
            Vec::new(),
            vec![clear_res],
        );
        clear_node.cache_key = Some(NodeCacheKey::compute(&(
            "clear",
            plan.clear_color.map(|c| c.to_bits()),
        )));
        graph.nodes.push(clear_node);

        let mut current_accumulator_res = clear_res;

        // 2. Process layers sorted by z-index
        let mut sorted_layers = plan.layers.clone();
        sorted_layers.sort_by_key(|l| l.z_index);

        for layer in sorted_layers {
            let is_hidden = layer.visibility == LayerVisibility::Hidden;
            let is_zero_opacity = layer.opacity <= 0.0 && layer.effects.is_empty();

            // Determine if layer is an overlay or media clip
            let is_text_or_overlay = layer.asset_id.starts_with("overlay:")
                || layer.asset_id.starts_with("text:")
                || layer.effects.iter().any(|e| {
                    e.get("type")
                        .and_then(|v| v.as_str())
                        .map(|s| s == "text" || s == "subtitle")
                        .unwrap_or(false)
                });

            let layer_output_res = if is_text_or_overlay {
                // Overlay pass
                let overlay_res = ResourceId(next_res_id);
                next_res_id += 1;
                graph.resources.insert(overlay_res, canvas_desc);

                let overlay_node_id = NodeId(next_node_id);
                next_node_id += 1;

                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                layer.layer_id.hash(&mut hasher);
                layer.source_time.hash(&mut hasher);
                serde_json::to_string(&layer.effects)
                    .unwrap_or_default()
                    .hash(&mut hasher);
                let content_hash = hasher.finish();

                let mut overlay_node = RenderPassNode::new(
                    overlay_node_id,
                    format!("Overlay_{}", layer.layer_id),
                    PassKind::Overlay {
                        overlay_type: OverlayType::Text,
                        content_hash,
                    },
                    Vec::new(),
                    vec![overlay_res],
                );
                overlay_node.cache_key = Some(NodeCacheKey::compute(&(
                    "overlay",
                    layer.layer_id.clone(),
                    content_hash,
                )));

                if is_hidden {
                    overlay_node.cull(CullReason::LayerHidden);
                } else if is_zero_opacity {
                    overlay_node.cull(CullReason::ZeroOpacity);
                }

                graph.nodes.push(overlay_node);
                overlay_res
            } else {
                // Media clip branch: Source -> ColorGrade -> TransformEffect
                // A. Source Ingestion Pass
                let src_res = ResourceId(next_res_id);
                next_res_id += 1;
                graph.resources.insert(src_res, canvas_desc);

                let src_node_id = NodeId(next_node_id);
                next_node_id += 1;
                let mut src_node = RenderPassNode::new(
                    src_node_id,
                    format!("Source_{}", layer.clip_id),
                    PassKind::Source {
                        asset_id: layer.asset_id.clone(),
                        clip_id: layer.clip_id.clone(),
                        source_time: layer.source_time,
                    },
                    Vec::new(),
                    vec![src_res],
                );
                let src_cache_key = NodeCacheKey::compute(&(
                    "source",
                    layer.asset_id.clone(),
                    layer.source_time.as_micros(),
                ));
                src_node.cache_key = Some(src_cache_key);

                if is_hidden {
                    src_node.cull(CullReason::LayerHidden);
                } else if is_zero_opacity {
                    src_node.cull(CullReason::ZeroOpacity);
                }
                graph.nodes.push(src_node);

                // B. Color Grade Pass
                let grade_res = ResourceId(next_res_id);
                next_res_id += 1;
                graph.resources.insert(grade_res, canvas_desc);

                let grade_node_id = NodeId(next_node_id);
                next_node_id += 1;
                let grade_params = extract_color_grade_params(&layer.color_grade);
                let mut grade_node = RenderPassNode::new(
                    grade_node_id,
                    format!("ColorGrade_{}", layer.clip_id),
                    PassKind::ColorGrade {
                        params: grade_params.clone(),
                    },
                    vec![src_res],
                    vec![grade_res],
                );
                let grade_cache_key =
                    src_cache_key.combine(NodeCacheKey::compute(&("color_grade", grade_params)));
                grade_node.cache_key = Some(grade_cache_key);

                if is_hidden {
                    grade_node.cull(CullReason::LayerHidden);
                } else if is_zero_opacity {
                    grade_node.cull(CullReason::ZeroOpacity);
                }
                graph.nodes.push(grade_node);

                // C. Transform & Effects Pass
                let transform_res = ResourceId(next_res_id);
                next_res_id += 1;
                graph.resources.insert(transform_res, canvas_desc);

                let transform_node_id = NodeId(next_node_id);
                next_node_id += 1;
                let effects: Vec<EffectSpec> = layer
                    .effects
                    .iter()
                    .enumerate()
                    .map(|(idx, e)| EffectSpec {
                        effect_id: format!("{}_{idx}", layer.layer_id),
                        effect_type: e
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("generic")
                            .to_string(),
                        params: e.clone(),
                    })
                    .collect();

                let mut transform_node = RenderPassNode::new(
                    transform_node_id,
                    format!("Transform_{}", layer.clip_id),
                    PassKind::TransformEffect {
                        transform: layer.transform.clone(),
                        opacity: layer.opacity,
                        effects: effects.clone(),
                    },
                    vec![grade_res],
                    vec![transform_res],
                );
                let transform_cache_key = grade_cache_key.combine(NodeCacheKey::compute(&(
                    "transform",
                    layer.transform.x.to_bits(),
                    layer.transform.y.to_bits(),
                    layer.transform.scale_x.to_bits(),
                    layer.transform.scale_y.to_bits(),
                    layer.transform.rotation_deg.to_bits(),
                    layer.opacity.to_bits(),
                    effects,
                )));
                transform_node.cache_key = Some(transform_cache_key);

                if is_hidden {
                    transform_node.cull(CullReason::LayerHidden);
                } else if is_zero_opacity {
                    transform_node.cull(CullReason::ZeroOpacity);
                }
                graph.nodes.push(transform_node);

                transform_res
            };

            // D. Composite Pass
            let composite_res = ResourceId(next_res_id);
            next_res_id += 1;
            graph.resources.insert(composite_res, canvas_desc);

            let composite_node_id = NodeId(next_node_id);
            next_node_id += 1;
            let mut composite_node = RenderPassNode::new(
                composite_node_id,
                format!("Composite_{}", layer.layer_id),
                PassKind::Composite {
                    blend_mode: layer.blend_mode,
                    opacity: layer.opacity,
                    z_index: layer.z_index,
                },
                vec![current_accumulator_res, layer_output_res],
                vec![composite_res],
            );

            if is_hidden {
                composite_node.cull(CullReason::LayerHidden);
            } else if is_zero_opacity {
                composite_node.cull(CullReason::ZeroOpacity);
            }

            graph.nodes.push(composite_node);

            // If not culled, update accumulator
            if !is_hidden && !is_zero_opacity {
                current_accumulator_res = composite_res;
            }
        }

        // 3. Final Output Pass
        let output_res = ResourceId(next_res_id);
        graph.resources.insert(output_res, canvas_desc);

        let output_node_id = NodeId(next_node_id);
        let output_node = RenderPassNode::new(
            output_node_id,
            "OutputPass",
            PassKind::Output {
                canvas: plan.canvas.clone(),
            },
            vec![current_accumulator_res],
            vec![output_res],
        );
        graph.nodes.push(output_node);
        graph.output_node = Some(output_node_id);
        graph.final_resource = Some(output_res);

        // Build internal dependency structures
        graph.rebuild_dependencies();
        graph
    }

    /// Rebuilds direct dependencies between nodes based on resource inputs and outputs.
    pub fn rebuild_dependencies(&mut self) {
        self.dependencies.clear();
        self.dependents.clear();

        let mut resource_producers: HashMap<ResourceId, NodeId> = HashMap::new();
        for node in &self.nodes {
            for &out_res in &node.outputs {
                resource_producers.insert(out_res, node.id);
            }
        }

        for node in &self.nodes {
            for &in_res in &node.inputs {
                if let Some(&producer_id) = resource_producers.get(&in_res) {
                    if producer_id != node.id {
                        self.dependencies
                            .entry(node.id)
                            .or_default()
                            .push(producer_id);
                        self.dependents
                            .entry(producer_id)
                            .or_default()
                            .push(node.id);
                    }
                }
            }
        }
    }

    /// Performs occlusion culling: if an upper layer is opaque, fullscreen, and normal blend mode,
    /// lower layers behind it are completely invisible and culled from the graph.
    pub fn cull_occluded_layers(&mut self, plan: &RenderPlan) {
        let mut sorted_layers = plan.layers.clone();
        sorted_layers.sort_by_key(|l| l.z_index);

        // Find the topmost layer that completely occludes everything behind it
        let mut occluding_z = None;
        for layer in sorted_layers.iter().rev() {
            if layer.visibility == LayerVisibility::Visible
                && layer.opacity >= 1.0
                && layer.blend_mode == BlendMode::Normal
                && is_fullscreen_layer(&layer.transform, &plan.canvas)
                && layer.effects.is_empty()
            {
                occluding_z = Some(layer.z_index);
                break;
            }
        }

        if let Some(opaque_z) = occluding_z {
            for layer in &plan.layers {
                if layer.z_index < opaque_z {
                    // Cull all nodes associated with this layer
                    for node in self.nodes.iter_mut() {
                        if (node.name.contains(&layer.clip_id)
                            || node.name.contains(&layer.layer_id))
                            && !node.culled
                        {
                            node.cull(CullReason::Occluded);
                        }
                    }
                }
            }
        }
    }

    /// Eliminates unreferenced dead nodes that do not reach the final output pass.
    pub fn cull_dead_nodes(&mut self) {
        let output_id = match self.output_node {
            Some(id) => id,
            None => return,
        };

        let mut reachable = HashSet::new();
        let mut queue = VecDeque::new();
        reachable.insert(output_id);
        queue.push_back(output_id);

        while let Some(curr) = queue.pop_front() {
            if let Some(deps) = self.dependencies.get(&curr) {
                for &dep in deps {
                    if reachable.insert(dep) {
                        queue.push_back(dep);
                    }
                }
            }
        }

        for node in &mut self.nodes {
            if !reachable.contains(&node.id) && !node.culled {
                node.cull(CullReason::Unreferenced);
            }
        }
    }

    /// Performs topological sort of active nodes using Kahn's algorithm.
    /// Detects cycles and produces a deterministic execution schedule.
    pub fn compile_schedule(&mut self) -> Result<(), GraphError> {
        let active_nodes: HashSet<NodeId> = self
            .nodes
            .iter()
            .filter(|n| n.is_active())
            .map(|n| n.id)
            .collect();

        let mut in_degrees: HashMap<NodeId, usize> = HashMap::new();
        for &id in &active_nodes {
            let deps = self
                .dependencies
                .get(&id)
                .map(|d| d.iter().filter(|dep| active_nodes.contains(dep)).count())
                .unwrap_or(0);
            in_degrees.insert(id, deps);
        }

        let mut ready_queue: VecDeque<NodeId> = in_degrees
            .iter()
            .filter(|&(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        // Sort ready queue for strict deterministic reproducibility
        let mut schedule = Vec::new();

        while let Some(node_id) = ready_queue.pop_front() {
            schedule.push(node_id);

            if let Some(dependents) = self.dependents.get(&node_id) {
                for &dependent in dependents {
                    if active_nodes.contains(&dependent) {
                        if let Some(deg) = in_degrees.get_mut(&dependent) {
                            *deg = deg.saturating_sub(1);
                            if *deg == 0 {
                                ready_queue.push_back(dependent);
                            }
                        }
                    }
                }
            }
        }

        if schedule.len() != active_nodes.len() {
            return Err(GraphError::CycleDetected);
        }

        self.execution_schedule = schedule;
        Ok(())
    }

    /// Computes minimal resource barriers between scheduled passes.
    pub fn schedule_barriers(&mut self) {
        self.pass_barriers.clear();
        let mut resource_states: HashMap<ResourceId, ResourceState> = HashMap::new();

        // Lookup map for fast node access
        let node_map: HashMap<NodeId, &RenderPassNode> =
            self.nodes.iter().map(|n| (n.id, n)).collect();

        for &node_id in &self.execution_schedule {
            let node = match node_map.get(&node_id) {
                Some(n) => *n,
                None => continue,
            };

            let mut barriers = Vec::new();

            // Transition inputs to PixelShaderResource if needed
            for &in_res in &node.inputs {
                let current_state = resource_states
                    .get(&in_res)
                    .copied()
                    .unwrap_or(ResourceState::Common);

                if current_state != ResourceState::PixelShaderResource {
                    barriers.push(ResourceBarrier {
                        resource: in_res,
                        before: current_state,
                        after: ResourceState::PixelShaderResource,
                    });
                    resource_states.insert(in_res, ResourceState::PixelShaderResource);
                }
            }

            // Transition outputs to RenderAttachment or Present
            for &out_res in &node.outputs {
                let target_state = if matches!(node.kind, PassKind::Output { .. }) {
                    ResourceState::Present
                } else {
                    ResourceState::CopyDest // or RenderAttachment
                };

                let current_state = resource_states
                    .get(&out_res)
                    .copied()
                    .unwrap_or(ResourceState::Common);

                if current_state != target_state {
                    barriers.push(ResourceBarrier {
                        resource: out_res,
                        before: current_state,
                        after: target_state,
                    });
                    resource_states.insert(out_res, target_state);
                }
            }

            if !barriers.is_empty() {
                self.pass_barriers.insert(node_id, barriers);
            }
        }
    }

    /// Populates usage intervals into the resource pool for memory aliasing.
    pub fn populate_resource_pool(&self, pool: &mut GraphResourcePool) {
        for (&res_id, &desc) in &self.resources {
            pool.register_resource(res_id, desc);
        }

        let node_map: HashMap<NodeId, &RenderPassNode> =
            self.nodes.iter().map(|n| (n.id, n)).collect();

        for (step, &node_id) in self.execution_schedule.iter().enumerate() {
            if let Some(node) = node_map.get(&node_id) {
                for &in_res in &node.inputs {
                    pool.record_usage(in_res, step);
                }
                for &out_res in &node.outputs {
                    pool.record_usage(out_res, step);
                }
            }
        }

        pool.compile_aliasing();
    }
}

/// Helper function to check if a layer covers the entire canvas.
fn is_fullscreen_layer(
    transform: &super::super::types::LayerTransform,
    canvas: &CanvasSpec,
) -> bool {
    transform.x <= 0.0
        && transform.y <= 0.0
        && transform.scale_x >= 1.0
        && transform.scale_y >= 1.0
        && transform.rotation_deg == 0.0
        && transform.width >= canvas.width as f32
        && transform.height >= canvas.height as f32
}

/// Helper function to parse color grade params from json or defaults.
fn extract_color_grade_params(json: &Option<serde_json::Value>) -> ColorGradeParams {
    let mut params = ColorGradeParams::default();
    if let Some(val) = json {
        if let Some(exp) = val.get("exposure").and_then(|v| v.as_f64()) {
            params.exposure = exp as f32;
        }
        if let Some(c) = val.get("contrast").and_then(|v| v.as_f64()) {
            params.contrast = c as f32;
        }
        if let Some(s) = val.get("saturation").and_then(|v| v.as_f64()) {
            params.saturation = s as f32;
        }
        if let Some(t) = val.get("temperature").and_then(|v| v.as_f64()) {
            params.temperature = t as f32;
        }
        if let Some(lut) = val.get("lut_id").and_then(|v| v.as_str()) {
            params.lut_id = Some(lut.to_string());
        }
    }
    params
}
