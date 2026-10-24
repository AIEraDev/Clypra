# Canvas Patterns API Integration Plan

## Overview
Canvas background patterns are texture images/backgrounds that should be fetched from a remote Studio backend API, not hardcoded CSS gradients. This document outlines the API structure, backend requirements, and frontend integration plan.

---

## 1. Backend Requirements (Studio Workspace)

### 1.1 Pattern Storage
- **CDN/Storage Service**: AWS S3, Cloudflare R2, or similar
- **Image Formats**: PNG, JPEG, WebP (recommended for web)
- **Resolution Requirements**:
  - Thumbnail: 200×200px (for grid preview)
  - Full: 1920×1080px or higher (for canvas application)
- **File Size Limits**:
  - Thumbnail: Max 50KB
  - Full: Max 2MB

### 1.2 Pattern Metadata Schema
```typescript
interface Pattern {
  id: string;                    // Unique pattern ID
  name: string;                  // Display name (e.g., "Candy Cane")
  category: string;              // "christmas", "abstract", "geometric", "seasonal", etc.
  thumbnailUrl: string;          // CDN URL for preview thumbnail
  fullUrl: string;               // CDN URL for full-resolution pattern
  tags: string[];                // Searchable tags
  isPremium: boolean;            // Premium/paid content flag
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  downloadCount?: number;        // Usage statistics
  colorPalette?: string[];       // Dominant colors for filtering
}
```

### 1.3 API Endpoints

#### Get Patterns (Paginated)
```
GET /api/v1/patterns
Query Parameters:
  - category: string (optional) - Filter by category
  - tags: string[] (optional) - Filter by tags
  - isPremium: boolean (optional) - Filter premium content
  - page: number (default: 1)
  - limit: number (default: 50, max: 100)
  - search: string (optional) - Search by name

Response:
{
  "patterns": Pattern[],
  "total": number,
  "page": number,
  "limit": number,
  "hasMore": boolean
}
```

#### Get Pattern by ID
```
GET /api/v1/patterns/:id

Response: Pattern
```

#### Get Pattern Categories
```
GET /api/v1/patterns/categories

Response:
{
  "categories": [
    { "id": "christmas", "name": "Christmas", "count": 42 },
    { "id": "abstract", "name": "Abstract", "count": 156 },
    { "id": "geometric", "name": "Geometric", "count": 89 }
  ]
}
```

#### Upload Pattern (Admin Only)
```
POST /api/v1/patterns
Content-Type: multipart/form-data
Body:
  - name: string
  - category: string
  - tags: string[]
  - isPremium: boolean
  - thumbnail: File (image)
  - full: File (image)

Response: Pattern
```

---

## 2. Frontend Integration

### 2.1 API Client Service
Create a dedicated service for pattern API calls:

**Location**: `src/services/patternService.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface Pattern {
  id: string;
  name: string;
  category: string;
  thumbnailUrl: string;
  fullUrl: string;
  tags: string[];
  isPremium: boolean;
  createdAt: string;
  updatedAt: string;
  colorPalette?: string[];
}

export interface PatternsResponse {
  patterns: Pattern[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface PatternCategory {
  id: string;
  name: string;
  count: number;
}

class PatternService {
  private baseUrl = import.meta.env.VITE_STUDIO_API_URL || "https://api.clypra.studio";

  async getPatterns(params?: {
    category?: string;
    tags?: string[];
    isPremium?: boolean;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PatternsResponse> {
    // Use Tauri HTTP client for desktop app
    const response = await invoke<PatternsResponse>("fetch_patterns", {
      baseUrl: this.baseUrl,
      params: params || {},
    });
    return response;
  }

  async getPatternById(id: string): Promise<Pattern> {
    const response = await invoke<Pattern>("fetch_pattern_by_id", {
      baseUrl: this.baseUrl,
      id,
    });
    return response;
  }

  async getCategories(): Promise<PatternCategory[]> {
    const response = await invoke<{ categories: PatternCategory[] }>(
      "fetch_pattern_categories",
      { baseUrl: this.baseUrl }
    );
    return response.categories;
  }

  // Download pattern image to local cache
  async downloadPattern(url: string): Promise<string> {
    const localPath = await invoke<string>("download_pattern", { url });
    return localPath;
  }
}

export const patternService = new PatternService();
```

### 2.2 Update BackgroundInspectorPanel Component

**File**: `src/components/editor/properties/BackgroundInspectorPanel.tsx`

Add state management for API patterns:
```typescript
const [patterns, setPatterns] = useState<Pattern[]>([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [selectedCategory, setSelectedCategory] = useState<string>("all");

useEffect(() => {
  const fetchPatterns = async () => {
    if (selectedMode !== "pattern") return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await patternService.getPatterns({
        category: selectedCategory === "all" ? undefined : selectedCategory,
        page: 1,
        limit: 50,
      });
      setPatterns(response.patterns);
    } catch (err) {
      console.error("Failed to fetch patterns:", err);
      setError("Failed to load patterns. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  fetchPatterns();
}, [selectedMode, selectedCategory]);

// Handle pattern selection
const handlePatternSelect = async (pattern: Pattern) => {
  try {
    // Download pattern to local cache for offline access
    const localPath = await patternService.downloadPattern(pattern.fullUrl);
    
    // Update canvas background
    handleUpdate({
      type: "media",
      mediaUrl: localPath,
      isTransparent: false,
    });
  } catch (err) {
    console.error("Failed to apply pattern:", err);
  }
};
```

### 2.3 UI Updates for Loading/Error States

```typescript
{/* Pattern Grid View */}
{selectedMode === "pattern" && (
  <div className="space-y-2">
    {loading && (
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 21 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg bg-white/5 animate-pulse"
          />
        ))}
      </div>
    )}
    
    {error && (
      <div className="p-4 text-center text-red-400 text-sm">
        {error}
      </div>
    )}
    
    {!loading && !error && patterns.length === 0 && (
      <div className="p-4 text-center text-white/40 text-sm">
        No patterns found
      </div>
    )}
    
    {!loading && !error && patterns.length > 0 && (
      <div className="grid grid-cols-7 gap-2">
        {patterns.map((pattern) => (
          <button
            key={pattern.id}
            onClick={() => handlePatternSelect(pattern)}
            className="relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-cyan-500/50 transition-all group"
            style={{
              backgroundImage: `url(${pattern.thumbnailUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            title={pattern.name}
          >
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            {pattern.isPremium && (
              <div className="absolute top-1 right-1 px-1 py-0.5 bg-yellow-500/90 text-[9px] font-bold text-black rounded">
                PRO
              </div>
            )}
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

---

## 3. Tauri Backend Commands

### 3.1 HTTP Client Commands
**File**: `src-tauri/src/commands/http.rs`

```rust
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct Pattern {
    pub id: String,
    pub name: String,
    pub category: String,
    pub thumbnail_url: String,
    pub full_url: String,
    pub tags: Vec<String>,
    pub is_premium: bool,
    pub created_at: String,
    pub updated_at: String,
    pub color_palette: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternsResponse {
    pub patterns: Vec<Pattern>,
    pub total: usize,
    pub page: usize,
    pub limit: usize,
    pub has_more: bool,
}

#[command]
pub async fn fetch_patterns(
    base_url: String,
    params: serde_json::Value,
) -> Result<PatternsResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/patterns", base_url);
    
    let response = client
        .get(&url)
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    
    let data = response
        .json::<PatternsResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(data)
}

#[command]
pub async fn download_pattern(url: String) -> Result<String, String> {
    // Download pattern image and cache locally
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read bytes: {}", e))?;
    
    // Save to app cache directory
    let cache_dir = tauri::api::path::cache_dir()
        .ok_or("Failed to get cache directory")?
        .join("clypra")
        .join("patterns");
    
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    
    let file_name = url.split('/').last().unwrap_or("pattern.png");
    let file_path = cache_dir.join(file_name);
    
    std::fs::write(&file_path, bytes)
        .map_err(|e| format!("Failed to save file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}
```

---

## 4. Environment Configuration

### 4.1 Add Studio API URL to .env
```env
VITE_STUDIO_API_URL=https://api.clypra.studio
```

### 4.2 Development/Staging URLs
```env
# Development
VITE_STUDIO_API_URL=http://localhost:3000

# Staging
VITE_STUDIO_API_URL=https://staging-api.clypra.studio

# Production
VITE_STUDIO_API_URL=https://api.clypra.studio
```

---

## 5. Implementation Phases

### Phase 1: Backend Setup (Studio Team)
- [ ] Set up CDN/storage service (S3, R2)
- [ ] Create pattern database schema
- [ ] Implement API endpoints
- [ ] Upload initial pattern library
- [ ] Set up image optimization pipeline

### Phase 2: Frontend Integration (Current)
- [x] Add TODO comments to BackgroundInspectorPanel
- [ ] Create patternService API client
- [ ] Implement Tauri HTTP commands
- [ ] Update BackgroundInspectorPanel with API integration
- [ ] Add loading/error states
- [ ] Add pattern caching

### Phase 3: Testing & Optimization
- [ ] Test with slow network conditions
- [ ] Implement offline fallback patterns
- [ ] Add pattern search functionality
- [ ] Add category filtering
- [ ] Implement infinite scroll for large libraries
- [ ] Add pattern preview modal
- [ ] Optimize image loading performance

### Phase 4: Premium Features
- [ ] Implement premium pattern access control
- [ ] Add pattern purchase flow
- [ ] Add user pattern uploads
- [ ] Add pattern usage analytics

---

## 6. Migration Strategy

### Current State
- Using hardcoded CSS gradients as mock patterns
- 21 placeholder patterns in `PATTERN_PRESETS`

### Migration Steps
1. Keep mock patterns as fallback if API fails
2. Add feature flag: `VITE_ENABLE_PATTERN_API=true/false`
3. Implement API integration with fallback to mock data
4. Test with both API and mock data
5. Remove mock data after API is stable

```typescript
const shouldUseMockData = 
  !import.meta.env.VITE_ENABLE_PATTERN_API || 
  import.meta.env.DEV;

useEffect(() => {
  if (shouldUseMockData) {
    setPatterns(PATTERN_PRESETS.map(p => ({
      id: p.id,
      name: p.label,
      category: "mock",
      thumbnailUrl: "", // Use CSS background
      fullUrl: "",
      tags: [],
      isPremium: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })));
  } else {
    fetchPatternsFromAPI();
  }
}, [selectedMode, shouldUseMockData]);
```

---

## 7. Performance Considerations

### Image Optimization
- Use WebP format for modern browsers
- Implement lazy loading for pattern grid
- Preload thumbnails on hover
- Cache downloaded patterns locally

### API Optimization
- Implement pagination (50 patterns per page)
- Use HTTP caching headers (Cache-Control, ETag)
- Compress API responses (gzip)
- CDN for pattern images

### Offline Support
- Cache recently used patterns
- Provide offline fallback patterns
- Show cached patterns when API is unavailable

---

## 8. Security Considerations

- Validate image file types on upload
- Scan uploads for malware/exploits
- Implement rate limiting on API endpoints
- Use signed URLs for premium content
- Sanitize pattern metadata (XSS prevention)

---

## 9. Analytics & Monitoring

### Track Pattern Usage
- Most popular patterns
- Download count per pattern
- Category preferences
- Premium conversion rate

### Monitor API Performance
- Response times
- Error rates
- CDN hit/miss ratio
- Cache effectiveness

---

## Next Steps

1. **Immediate**: Keep TODO comments in code, use mock data
2. **Short-term**: Studio team sets up backend infrastructure
3. **Medium-term**: Implement frontend API integration
4. **Long-term**: Add premium features, analytics, user uploads

---

## Contact

For questions about this API integration plan, contact:
- Frontend: [Your Team]
- Backend/Studio: [Studio Team]
- DevOps: [DevOps Team]
