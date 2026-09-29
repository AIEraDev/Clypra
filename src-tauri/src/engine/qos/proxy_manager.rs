//! Asynchronous Proxy Manager
//!
//! Manages proxy variant registration, background generation requests,
//! and safe availability checks. Never blocks playback threads when
//! proxies are requested or generated.

use super::super::frame::ColorMetadata;
use super::super::types::{CodecType, ColorSpace};
use super::types::{ProxyId, ProxyVariant};
use std::collections::HashMap;
use std::path::PathBuf;

/// Manages multi-resolution proxy variants for project assets.
#[derive(Default)]
pub struct AsyncProxyManager {
    proxies: HashMap<ProxyId, ProxyVariant>,
    asset_to_proxies: HashMap<String, Vec<ProxyId>>,
    next_proxy_id: u64,
}

impl AsyncProxyManager {
    pub fn new() -> Self {
        Self {
            proxies: HashMap::new(),
            asset_to_proxies: HashMap::new(),
            next_proxy_id: 1,
        }
    }

    /// Registers a known pre-existing proxy for an asset.
    pub fn register_proxy(&mut self, variant: ProxyVariant) {
        let id = variant.id;
        let asset_id = variant.source_asset.clone();
        self.proxies.insert(id, variant);
        self.asset_to_proxies.entry(asset_id).or_default().push(id);
    }

    /// Submits an asynchronous request to generate a proxy.
    /// Returns the assigned ProxyId immediately without blocking playback.
    pub fn request_proxy_generation(
        &mut self,
        source_asset: impl Into<String>,
        width: u32,
        height: u32,
        codec: CodecType,
    ) -> ProxyId {
        let asset_id = source_asset.into();
        let proxy_id = ProxyId(self.next_proxy_id);
        self.next_proxy_id += 1;

        let variant = ProxyVariant {
            id: proxy_id,
            source_asset: asset_id.clone(),
            codec,
            width,
            height,
            frame_rate: 60.0,
            color: ColorMetadata {
                primaries: ColorSpace::Rec709,
                is_full_range: false,
                bit_depth: 8,
            },
            path: PathBuf::from(format!("/cache/proxies/{}_{}.mp4", asset_id, proxy_id.0)),
            is_ready: false,
        };

        self.proxies.insert(proxy_id, variant);
        self.asset_to_proxies
            .entry(asset_id)
            .or_default()
            .push(proxy_id);
        proxy_id
    }

    /// Called by background worker when proxy encoding completes.
    pub fn complete_proxy_generation(&mut self, proxy_id: ProxyId, final_path: PathBuf) -> bool {
        if let Some(proxy) = self.proxies.get_mut(&proxy_id) {
            proxy.path = final_path;
            proxy.is_ready = true;
            true
        } else {
            false
        }
    }

    /// Checks if an asset has a ready, usable proxy stream.
    pub fn get_ready_proxy(&self, asset_id: &str) -> Option<&ProxyVariant> {
        self.asset_to_proxies.get(asset_id).and_then(|ids| {
            ids.iter()
                .filter_map(|id| self.proxies.get(id))
                .find(|p| p.is_ready)
        })
    }

    /// Retrieves proxy metadata by ID.
    pub fn get_proxy(&self, id: ProxyId) -> Option<&ProxyVariant> {
        self.proxies.get(&id)
    }

    /// Returns all registered proxies for an asset.
    pub fn get_asset_proxies(&self, asset_id: &str) -> Vec<&ProxyVariant> {
        self.asset_to_proxies
            .get(asset_id)
            .map(|ids| ids.iter().filter_map(|id| self.proxies.get(id)).collect())
            .unwrap_or_default()
    }
}
