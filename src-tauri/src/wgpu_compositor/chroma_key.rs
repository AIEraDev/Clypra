// src-tauri/src/wgpu_compositor/chroma_key.rs

use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable, PartialEq)]
pub struct ChromaKeyUniforms {
    /// Target color to remove in normalized sRGB [0.0, 1.0]
    pub key_color: [f32; 3], // Offset 0, Size 12
    /// Core removal radius [0.0, 1.0]
    pub tolerance: f32, // Offset 12, Size 4
    /// Edge feather width [0.0, 1.0]
    pub smoothness: f32, // Offset 16, Size 4
    /// Spill neutralization strength [0.0, 1.0]
    pub despill_amount: f32, // Offset 20, Size 4
    /// Balance between R & B for despill [0.0 = R, 1.0 = B]
    pub despill_balance: f32, // Offset 24, Size 4
    /// Black clip / Pedestal [0.0, 0.5]
    pub matte_pedestal: f32, // Offset 28, Size 4
    /// White clip / Highlight [0.5, 1.0]
    pub matte_highlight: f32, // Offset 32, Size 4
    /// Enable toggle: 0 = Disabled, 1 = Enabled
    pub enabled: u32, // Offset 36, Size 4
    pub _pad0: f32, // Offset 40, Size 4
    pub _pad1: f32, // Offset 44, Size 4
} // Total: 48 bytes (Multiple of 16 bytes)

impl Default for ChromaKeyUniforms {
    fn default() -> Self {
        Self {
            key_color: [0.0, 1.0, 0.0], // Pure Green by default
            tolerance: 0.25,
            smoothness: 0.15,
            despill_amount: 0.85,
            despill_balance: 0.5,
            matte_pedestal: 0.05,
            matte_highlight: 0.95,
            enabled: 0,
            _pad0: 0.0,
            _pad1: 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chroma_key_struct_size_and_alignment() {
        assert_eq!(std::mem::size_of::<ChromaKeyUniforms>(), 48);
        assert_eq!(std::mem::align_of::<ChromaKeyUniforms>(), 4);
    }
}
