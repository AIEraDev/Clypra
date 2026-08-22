use super::contracts::{FramePacket, NativeCoreError};
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone)]
struct CacheEntry {
    packet: FramePacket,
    bytes: usize,
}

/// Byte-bounded LRU cache for native frame packets.
///
/// The cache owns CPU readback buffers during the migration bridge. The
/// eventual native surface will replace the packet data with shared GPU
/// resources, but the cache contract remains the same.
#[derive(Debug)]
pub struct FrameCache {
    max_bytes: usize,
    current_bytes: usize,
    entries: HashMap<String, CacheEntry>,
    order: VecDeque<String>,
}

impl FrameCache {
    pub fn new(max_bytes: usize) -> Result<Self, NativeCoreError> {
        if max_bytes == 0 {
            return Err(NativeCoreError::Cache(
                "Frame cache budget must be non-zero".to_string(),
            ));
        }
        Ok(Self {
            max_bytes,
            current_bytes: 0,
            entries: HashMap::new(),
            order: VecDeque::new(),
        })
    }

    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    pub fn current_bytes(&self) -> usize {
        self.current_bytes
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&mut self, key: &str) -> Option<FramePacket> {
        let entry = self.entries.get(key)?.clone();
        self.touch(key);
        Some(entry.packet)
    }

    pub fn insert(&mut self, key: String, packet: FramePacket) -> bool {
        let bytes = packet.data.len();
        if bytes > self.max_bytes {
            return false;
        }

        if let Some(previous) = self.entries.remove(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(previous.bytes);
            self.order.retain(|item| item != &key);
        }

        while self.current_bytes + bytes > self.max_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.current_bytes = self.current_bytes.saturating_sub(removed.bytes);
            }
        }

        self.current_bytes += bytes;
        self.order.push_back(key.clone());
        self.entries.insert(key, CacheEntry { packet, bytes });
        true
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|item| item != key);
        self.order.push_back(key.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_core::contracts::{FrameTime, PixelFormat, NATIVE_CORE_CONTRACT_VERSION};

    fn packet(request_id: &str, bytes: usize) -> FramePacket {
        FramePacket {
            contract_version: NATIVE_CORE_CONTRACT_VERSION,
            request_id: request_id.to_string(),
            frame_time: FrameTime::new(0, 0, 1).unwrap(),
            width: bytes as u32,
            height: 1,
            stride: (bytes * 4) as u32,
            format: PixelFormat::Rgba8Srgb,
            data: vec![0; bytes],
        }
    }

    #[test]
    fn cache_evicts_oldest_entry_by_bytes() {
        let mut cache = FrameCache::new(8).unwrap();
        assert!(cache.insert("a".to_string(), packet("a", 4)));
        assert!(cache.insert("b".to_string(), packet("b", 4)));
        assert!(cache.get("a").is_some());
        assert!(cache.insert("c".to_string(), packet("c", 4)));
        assert!(cache.get("b").is_none());
        assert!(cache.get("a").is_some());
        assert!(cache.get("c").is_some());
    }

    #[test]
    fn cache_rejects_entries_larger_than_budget() {
        let mut cache = FrameCache::new(4).unwrap();
        assert!(!cache.insert("large".to_string(), packet("large", 5)));
        assert_eq!(cache.len(), 0);
    }
}
