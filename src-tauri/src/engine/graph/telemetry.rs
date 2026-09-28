//! Render Graph Telemetry and Diagnostics
//!
//! Provides granular metrics on DAG structure, node culling, cache hits,
//! memory aliasing savings, and execution latency.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderGraphTelemetry {
    /// Total number of nodes defined in the graph
    pub node_count: usize,
    /// Number of active passes scheduled for execution
    pub active_pass_count: usize,
    /// Number of passes culled due to visibility, opacity, occlusion, or unreferenced outputs
    pub culled_node_count: usize,
    /// Number of static branch nodes reused directly from cache
    pub cached_branch_hits: usize,
    /// Number of physical transient GPU allocations made
    pub physical_allocations: usize,
    /// Number of virtual resources aliased into shared physical allocations
    pub aliased_resources: usize,
    /// Actual peak GPU memory in bytes for transient allocations
    pub peak_vram_bytes: usize,
    /// Unaliased GPU memory in bytes (if aliasing were disabled)
    pub unaliased_vram_bytes: usize,
    /// Total VRAM bytes saved by memory aliasing
    pub vram_savings_bytes: usize,
    /// Compilation time of the DAG in microseconds
    pub compile_time_us: u64,
    /// Execution time of scheduled passes in microseconds
    pub execution_time_us: u64,
}

impl RenderGraphTelemetry {
    pub fn new() -> Self {
        Self::default()
    }
}
