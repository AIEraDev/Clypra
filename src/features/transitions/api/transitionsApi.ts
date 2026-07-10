/**
 * Transitions API Client
 * Handles all API calls for transition effects from the Clypra API.
 *
 * All transition data lives in Cloudflare R2, served through the API.
 * Use transitionCacheManager to persist definitions locally after fetching.
 */

import type { TransitionAsset, TransitionCategory } from "../types";
import { getApiHeaders, getApiBaseUrl } from "@/lib/api";

const API_BASE_URL = getApiBaseUrl();

export class TransitionsApi {
  /**
   * Get the transitions manifest (category list + counts).
   * Lightweight — use this for initial panel population.
   */
  static async getManifest(): Promise<{
    categories: Array<{ id: string; name: string; count: number }>;
    totalCount: number;
  }> {
    const response = await fetch(`${API_BASE_URL}/transitions/manifest`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch transitions manifest: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get all transition categories with descriptions.
   */
  static async getCategories(): Promise<TransitionCategory[]> {
    const response = await fetch(`${API_BASE_URL}/transitions/categories`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch transition categories: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get transitions by category.
   * Returns only published transitions for non-admin callers.
   */
  static async getByCategory(category: string): Promise<TransitionAsset[]> {
    const response = await fetch(`${API_BASE_URL}/transitions/${category}`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch transitions for category ${category}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a specific transition by category and ID.
   */
  static async getById(category: string, id: string): Promise<TransitionAsset> {
    const response = await fetch(`${API_BASE_URL}/transitions/${category}/${id}`, {
      headers: getApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch transition ${id}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Search transitions across all categories.
   */
  static async search(query: string): Promise<TransitionAsset[]> {
    const response = await fetch(
      `${API_BASE_URL}/transitions/search?q=${encodeURIComponent(query)}`,
      { headers: getApiHeaders() },
    );
    if (!response.ok) {
      throw new Error(`Failed to search transitions: ${response.statusText}`);
    }
    return response.json();
  }
}
