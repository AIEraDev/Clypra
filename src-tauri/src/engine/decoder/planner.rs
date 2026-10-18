use super::d3d11::D3D11VADecoderBackend;
use super::d3d12::D3D12VADecoderBackend;
use super::software::SoftwareFFmpegBackend;
use super::traits::{DecoderSession, VideoDecoderBackend};
use super::types::{DecoderError, DecoderRequest};

/// Data-driven planner that selects the optimal decoder backend for a stream.
/// Priority order:
/// 1. D3D12VA (same D3D12 device, zero-copy)
/// 2. D3D11VA (fallback hardware)
/// 3. SoftwareFFmpeg (CPU fallback)
pub struct DecoderPlanner {
    backends: Vec<Box<dyn VideoDecoderBackend>>,
}

impl DecoderPlanner {
    pub fn new() -> Self {
        Self {
            backends: vec![
                Box::new(D3D12VADecoderBackend),
                Box::new(D3D11VADecoderBackend),
                Box::new(SoftwareFFmpegBackend),
            ],
        }
    }

    pub fn select_backend(&self, request: &DecoderRequest) -> Option<&dyn VideoDecoderBackend> {
        self.backends
            .iter()
            .find(|backend| backend.supports(request))
            .map(|v| v.as_ref())
    }

    pub fn open_session(
        &self,
        request: &DecoderRequest,
    ) -> Result<Box<dyn DecoderSession>, DecoderError> {
        let backend = self
            .select_backend(request)
            .ok_or_else(|| DecoderError::UnsupportedStream(format!("{:?}", request.stream)))?;
        backend.create(request)
    }
}

impl Default for DecoderPlanner {
    fn default() -> Self {
        Self::new()
    }
}
