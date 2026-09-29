//! Render Graph Resource Pool and Memory Aliasing
//!
//! Manages transient intermediate textures during graph execution.
//! Analyzes resource lifetimes in topological order and aliases non-overlapping
//! resources into the same memory allocations to minimize GPU VRAM consumption.

use super::super::types::PixelFormat;
use super::node::ResourceId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Description of a transient texture required by a pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TransientResourceDesc {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
}

impl TransientResourceDesc {
    pub fn memory_bytes(&self) -> usize {
        let bpp = match self.format {
            PixelFormat::P010 => 3,
            PixelFormat::Nv12 => 2,
            PixelFormat::Rgba16Float => 8,
            _ => 4,
        };
        (self.width as usize) * (self.height as usize) * bpp
    }
}

/// Active execution interval of a resource in the topological pass schedule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LifetimeInterval {
    pub start_step: usize,
    pub end_step: usize,
}

impl LifetimeInterval {
    #[inline]
    pub fn overlaps(&self, other: &LifetimeInterval) -> bool {
        !(self.end_step < other.start_step || other.end_step < self.start_step)
    }
}

/// Physical memory allocation slot that can host multiple aliased transient resources.
#[derive(Debug, Clone)]
pub struct PhysicalAllocationSlot {
    pub slot_id: usize,
    pub desc: TransientResourceDesc,
    pub memory_bytes: usize,
    pub assigned_resources: Vec<ResourceId>,
}

/// Pool managing transient GPU resources and memory aliasing.
#[derive(Default)]
pub struct GraphResourcePool {
    /// Descriptors of registered virtual transient resources
    resources: HashMap<ResourceId, TransientResourceDesc>,
    /// Lifetime intervals per resource
    lifetimes: HashMap<ResourceId, LifetimeInterval>,
    /// Physical allocation slots sharing non-overlapping resources
    physical_slots: Vec<PhysicalAllocationSlot>,
    /// Mapping from virtual ResourceId to physical slot index
    resource_to_slot: HashMap<ResourceId, usize>,
}

impl GraphResourcePool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a transient resource and its descriptor.
    pub fn register_resource(&mut self, id: ResourceId, desc: TransientResourceDesc) {
        self.resources.insert(id, desc);
    }

    /// Records the usage lifetime interval of a resource in topological pass steps.
    pub fn record_usage(&mut self, id: ResourceId, step: usize) {
        self.lifetimes
            .entry(id)
            .and_modify(|interval| {
                if step < interval.start_step {
                    interval.start_step = step;
                }
                if step > interval.end_step {
                    interval.end_step = step;
                }
            })
            .or_insert(LifetimeInterval {
                start_step: step,
                end_step: step,
            });
    }

    /// Compiles physical memory allocation slots using greedy interval-graph coloring.
    /// Resources with non-overlapping lifetimes and identical/compatible format share the same slot.
    pub fn compile_aliasing(&mut self) {
        self.physical_slots.clear();
        self.resource_to_slot.clear();

        // Sort resources deterministically by start step, then by size descending
        let mut sorted_res: Vec<_> = self.lifetimes.keys().copied().collect();
        sorted_res.sort_by_key(|r| {
            let interval = self.lifetimes.get(r).copied().unwrap_or(LifetimeInterval {
                start_step: 0,
                end_step: 0,
            });
            let bytes = self.resources.get(r).map(|d| d.memory_bytes()).unwrap_or(0);
            (interval.start_step, std::cmp::Reverse(bytes))
        });

        for res_id in sorted_res {
            let res_interval = match self.lifetimes.get(&res_id) {
                Some(i) => *i,
                None => continue,
            };
            let res_desc = match self.resources.get(&res_id) {
                Some(d) => *d,
                None => continue,
            };

            // Try to find an existing physical slot with compatible format and no lifetime overlap
            let mut matched_slot = None;
            for (slot_idx, slot) in self.physical_slots.iter_mut().enumerate() {
                if slot.desc == res_desc {
                    let has_overlap = slot.assigned_resources.iter().any(|&assigned_id| {
                        if let Some(other_interval) = self.lifetimes.get(&assigned_id) {
                            res_interval.overlaps(other_interval)
                        } else {
                            false
                        }
                    });

                    if !has_overlap {
                        matched_slot = Some(slot_idx);
                        break;
                    }
                }
            }

            if let Some(slot_idx) = matched_slot {
                self.physical_slots[slot_idx]
                    .assigned_resources
                    .push(res_id);
                self.resource_to_slot.insert(res_id, slot_idx);
            } else {
                let new_slot_id = self.physical_slots.len();
                self.physical_slots.push(PhysicalAllocationSlot {
                    slot_id: new_slot_id,
                    desc: res_desc,
                    memory_bytes: res_desc.memory_bytes(),
                    assigned_resources: vec![res_id],
                });
                self.resource_to_slot.insert(res_id, new_slot_id);
            }
        }
    }

    /// Returns the physical slot index assigned to a virtual resource.
    #[inline]
    pub fn get_slot(&self, id: &ResourceId) -> Option<usize> {
        self.resource_to_slot.get(id).copied()
    }

    /// Total number of unique physical allocation slots.
    #[inline]
    pub fn physical_slot_count(&self) -> usize {
        self.physical_slots.len()
    }

    /// Number of virtual resources that were aliased into another resource's slot.
    #[inline]
    pub fn aliased_count(&self) -> usize {
        self.resources
            .len()
            .saturating_sub(self.physical_slots.len())
    }

    /// Peak VRAM footprint of all allocated physical slots combined.
    pub fn peak_vram_bytes(&self) -> usize {
        self.physical_slots.iter().map(|s| s.memory_bytes).sum()
    }

    /// Theoretical unaliased VRAM footprint (if each virtual resource had its own texture).
    pub fn unaliased_vram_bytes(&self) -> usize {
        self.resources.values().map(|d| d.memory_bytes()).sum()
    }
}
