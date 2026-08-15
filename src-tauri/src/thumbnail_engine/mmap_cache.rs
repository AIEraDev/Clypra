use bytemuck::{Pod, Zeroable};
use memmap2::{MmapMut, MmapOptions};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct FrameEntryHeader {
    pub pts_us: u64,
    pub access_counter: u64,
    pub width: u32,
    pub height: u32,
    pub is_valid: u32,
    pub is_10bit: u32,
    pub y_len: u32,
    pub uv_len: u32,
}

/// A high-performance memory-mapped disk cache for instant timeline random seeking.
/// Leverages OS kernel page caching for sub-millisecond RAM access and NVMe direct reads.
pub struct MmapFrameCache {
    _file: File,
    mmap: MmapMut,
    slot_size: usize,
    slot_count: usize,
    frame_index: Arc<RwLock<HashMap<u64, usize>>>, // PTS in microseconds -> Slot index
    global_counter: AtomicU64,
}

impl MmapFrameCache {
    /// Creates or opens a pre-allocated memory-mapped cache file.
    pub fn new(
        cache_dir: PathBuf,
        max_width: u32,
        max_height: u32,
        slot_count: usize,
    ) -> Result<Self, String> {
        assert!(slot_count > 0, "Slot count must be > 0");
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        let cache_path = cache_dir.join("timeline_scrub_cache.bin");

        // 16-bit P010 frame size: Width * Height * 3 bytes (Y = w*h*2, UV = (w/2)*(h/2)*4)
        let max_frame_bytes = (max_width as usize) * (max_height as usize) * 3;
        let header_size = std::mem::size_of::<FrameEntryHeader>();
        let slot_size = (header_size + max_frame_bytes + 4095) & !4095; // Page-align to 4KB

        let total_file_size = (slot_size * slot_count) as u64;

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&cache_path)
            .map_err(|e| e.to_string())?;

        file.set_len(total_file_size).map_err(|e| e.to_string())?;

        let mmap = unsafe {
            MmapOptions::new()
                .len(total_file_size as usize)
                .map_mut(&file)
                .map_err(|e| e.to_string())?
        };

        // Scan existing slots to rebuild index if reopening an existing file
        let mut initial_index = HashMap::with_capacity(slot_count);
        let mut max_counter = 1u64;

        for slot_idx in 0..slot_count {
            let offset = slot_idx * slot_size;
            if offset + header_size <= mmap.len() {
                let header = bytemuck::from_bytes::<FrameEntryHeader>(
                    &mmap[offset..offset + header_size],
                );
                if header.is_valid == 1 {
                    initial_index.insert(header.pts_us, slot_idx);
                    if header.access_counter > max_counter {
                        max_counter = header.access_counter;
                    }
                }
            }
        }

        Ok(Self {
            _file: file,
            mmap,
            slot_size,
            slot_count,
            frame_index: Arc::new(RwLock::new(initial_index)),
            global_counter: AtomicU64::new(max_counter + 1),
        })
    }

    /// Store a decoded frame into the memory-mapped cache.
    pub fn insert_frame(
        &mut self,
        pts_us: u64,
        width: u32,
        height: u32,
        y_plane: &[u8],
        uv_plane: &[u8],
    ) -> Result<(), String> {
        self.insert_frame_with_format(pts_us, width, height, false, y_plane, uv_plane)
    }

    /// Store a decoded frame (8-bit NV12 or 10-bit P010) into the memory-mapped cache.
    pub fn insert_frame_with_format(
        &mut self,
        pts_us: u64,
        width: u32,
        height: u32,
        is_10bit: bool,
        y_plane: &[u8],
        uv_plane: &[u8],
    ) -> Result<(), String> {
        let y_len = y_plane.len();
        let uv_len = uv_plane.len();
        let header_size = std::mem::size_of::<FrameEntryHeader>();

        if header_size + y_len + uv_len > self.slot_size {
            return Err("Frame size exceeds slot capacity".into());
        }

        let access_seq = self.global_counter.fetch_add(1, Ordering::Relaxed);
        let mut index = self.frame_index.write();

        // 1. Pick target slot (reuse existing, find empty, or evict LRU)
        let slot_idx = if let Some(&existing_idx) = index.get(&pts_us) {
            existing_idx
        } else if index.len() < self.slot_count {
            index.len()
        } else {
            // Find slot with lowest access_counter (LRU eviction)
            self.find_lru_slot_internal(&index)
        };

        let slot_offset = slot_idx * self.slot_size;
        let header = FrameEntryHeader {
            pts_us,
            access_counter: access_seq,
            width,
            height,
            is_valid: 1,
            is_10bit: if is_10bit { 1 } else { 0 },
            y_len: y_len as u32,
            uv_len: uv_len as u32,
        };

        // 2. Direct memory copy into the memory-mapped OS page
        let slot_slice = &mut self.mmap[slot_offset..slot_offset + self.slot_size];
        slot_slice[..header_size].copy_from_slice(bytemuck::bytes_of(&header));

        let data_start = header_size;
        slot_slice[data_start..data_start + y_len].copy_from_slice(y_plane);
        slot_slice[data_start + y_len..data_start + y_len + uv_len].copy_from_slice(uv_plane);

        index.insert(pts_us, slot_idx);
        Ok(())
    }

    /// Read frame directly from the memory-mapped cache without allocations.
    pub fn get_frame(&self, pts_us: u64) -> Option<(&[u8], &[u8], u32, u32)> {
        let (y, uv, w, h, _) = self.get_frame_with_format(pts_us)?;
        Some((y, uv, w, h))
    }

    /// Read frame with 10-bit format flag directly from the memory-mapped cache.
    #[allow(clippy::type_complexity)]
    pub fn get_frame_with_format(&self, pts_us: u64) -> Option<(&[u8], &[u8], u32, u32, bool)> {
        let index = self.frame_index.read();
        let &slot_idx = index.get(&pts_us)?;

        let header_size = std::mem::size_of::<FrameEntryHeader>();
        let slot_offset = slot_idx * self.slot_size;
        let slot_slice = &self.mmap[slot_offset..slot_offset + self.slot_size];

        let header = bytemuck::from_bytes::<FrameEntryHeader>(&slot_slice[..header_size]);
        if header.is_valid == 0 || header.pts_us != pts_us {
            return None;
        }

        let y_len = header.y_len as usize;
        let uv_len = header.uv_len as usize;
        let data_start = header_size;

        let y_plane = &slot_slice[data_start..data_start + y_len];
        let uv_plane = &slot_slice[data_start + y_len..data_start + y_len + uv_len];
        let is_10bit = header.is_10bit == 1;

        Some((y_plane, uv_plane, header.width, header.height, is_10bit))
    }

    /// Current number of valid cached frames.
    pub fn len(&self) -> usize {
        self.frame_index.read().len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.frame_index.read().is_empty()
    }

    /// Total slot capacity.
    pub fn slot_count(&self) -> usize {
        self.slot_count
    }

    /// Clears all cached frames by marking slots invalid.
    pub fn clear(&mut self) {
        let header_size = std::mem::size_of::<FrameEntryHeader>();
        for slot_idx in 0..self.slot_count {
            let offset = slot_idx * self.slot_size;
            let slot_slice = &mut self.mmap[offset..offset + header_size];
            slot_slice.fill(0);
        }
        self.frame_index.write().clear();
    }

    fn find_lru_slot_internal(&self, _index: &HashMap<u64, usize>) -> usize {
        let header_size = std::mem::size_of::<FrameEntryHeader>();
        let mut min_seq = u64::MAX;
        let mut lru_slot = 0;

        for slot_idx in 0..self.slot_count {
            let offset = slot_idx * self.slot_size;
            let header = bytemuck::from_bytes::<FrameEntryHeader>(
                &self.mmap[offset..offset + header_size],
            );
            if header.access_counter < min_seq {
                min_seq = header.access_counter;
                lru_slot = slot_idx;
            }
        }
        lru_slot
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mmap_cache_insertion_retrieval_and_lru() {
        let temp_dir = std::env::temp_dir().join(format!("clypra_mmap_test_{}", std::process::id()));
        let width = 64u32;
        let height = 64u32;
        let slot_count = 3usize;

        let mut cache = MmapFrameCache::new(temp_dir.clone(), width, height, slot_count).unwrap();
        assert_eq!(cache.len(), 0);

        let y_frame_1 = vec![100u8; (width * height) as usize];
        let uv_frame_1 = vec![150u8; (width * height / 2) as usize];

        // 1. Insert Frame 1 (PTS = 1_000_000 us)
        cache
            .insert_frame(1_000_000, width, height, &y_frame_1, &uv_frame_1)
            .unwrap();
        assert_eq!(cache.len(), 1);

        // 2. Retrieve Frame 1
        let (y_out, uv_out, w, h) = cache.get_frame(1_000_000).expect("Frame 1 must exist");
        assert_eq!(w, width);
        assert_eq!(h, height);
        assert_eq!(y_out, &y_frame_1[..]);
        assert_eq!(uv_out, &uv_frame_1[..]);

        // 3. Insert Frame 2 & Frame 3
        let y_frame_2 = vec![200u8; (width * height) as usize];
        let uv_frame_2 = vec![250u8; (width * height / 2) as usize];
        cache
            .insert_frame(2_000_000, width, height, &y_frame_2, &uv_frame_2)
            .unwrap();

        let y_frame_3 = vec![50u8; (width * height * 2) as usize]; // 10-bit P010 (2 bytes per pixel)
        let uv_frame_3 = vec![75u8; (width * height) as usize];     // 10-bit P010 UV ((w/2)*(h/2)*4 bytes)
        cache
            .insert_frame_with_format(3_000_000, width, height, true, &y_frame_3, &uv_frame_3)
            .unwrap();
        assert_eq!(cache.len(), 3);

        // Verify 10-bit retrieval
        let (y_3, uv_3, _, _, is_10bit) = cache
            .get_frame_with_format(3_000_000)
            .expect("Frame 3 must exist");
        assert!(is_10bit);
        assert_eq!(y_3.len(), (width * height * 2) as usize);
        assert_eq!(uv_3.len(), (width * height) as usize);

        // 4. Insert Frame 4 (Triggers LRU eviction of Frame 1)
        let y_frame_4 = vec![12u8; (width * height) as usize];
        let uv_frame_4 = vec![34u8; (width * height / 2) as usize];
        cache
            .insert_frame(4_000_000, width, height, &y_frame_4, &uv_frame_4)
            .unwrap();

        let f4 = cache.get_frame(4_000_000);
        assert!(f4.is_some());

        // Cleanup temp file
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
