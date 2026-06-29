/**
 * Filters API Client
 * Handles all API calls for color grading filters
 */

import type { FilterAsset, FilterCategory } from "../types";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";

const API_BASE_URL = getApiBaseUrl();

export class FiltersApi {
  /**
   * Get filters manifest with category counts
   */
  static async getManifest(): Promise<{ categories: Array<{ id: string; name: string; count: number }>; totalFilters: number }> {
    const response = await fetch(`${API_BASE_URL}/filters/manifest`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch filters manifest: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get all filter categories
   */
  static async getCategories(): Promise<FilterCategory[]> {
    const response = await fetch(`${API_BASE_URL}/filters/categories`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch filter categories: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get filters by category
   */
  static async getByCategory(category: string): Promise<FilterAsset[]> {
    const response = await fetch(`${API_BASE_URL}/filters/${category}`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch filters for category ${category}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a specific filter by category and ID
   */
  static async getById(category: string, id: string): Promise<FilterAsset> {
    const response = await fetch(`${API_BASE_URL}/filters/${category}/${id}`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch filter ${id}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Search filters
   */
  static async search(query: string): Promise<FilterAsset[]> {
    const response = await fetch(`${API_BASE_URL}/filters/search?q=${encodeURIComponent(query)}`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to search filters: ${response.statusText}`);
    }
    return response.json();
  }
}
