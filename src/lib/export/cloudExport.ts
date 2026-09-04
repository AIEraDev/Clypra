import { Project } from "@/types";
import { getApiBaseUrl, getApiHeaders } from "../api/apiUtils";

/**
 * Cloud Export & Render Service
 *
 * NOTE: Mobile cloud rendering is currently marked as low priority / disabled.
 * When enabled in the future, this module dispatches project payloads to
 * the dedicated Clypra cloud rendering backend.
 */

export async function isCloudRenderAvailable(): Promise<boolean> {
  // Mobile/cloud render is deprioritized. Check if a cloud render endpoint is reachable.
  try {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return false;
    const res = await fetch(`${baseUrl}/render/status`, {
      method: "GET",
      headers: getApiHeaders(),
    }).catch(() => null);
    return !!res && res.ok;
  } catch {
    return false;
  }
}

export async function renderViaCloud(
  project: Project,
  payload: { clips: any[]; tracks: any[]; transitions: any[]; mediaAssets: any[]; duration: number },
  onProgress: (progress: { progress: number; status: string }) => void
): Promise<Blob> {
  console.log("[CloudExport] Initiating cloud render check for project:", project?.id);

  const available = await isCloudRenderAvailable();
  if (!available) {
    throw new Error(
      "Cloud rendering is currently unavailable. Mobile cloud render is disabled; please export locally."
    );
  }

  const baseUrl = getApiBaseUrl();
  onProgress({ progress: 10, status: "Submitting render job to Cloud Render service..." });

  const res = await fetch(`${baseUrl}/render/jobs`, {
    method: "POST",
    headers: {
      ...getApiHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: project.id,
      payload,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Cloud render job submission failed (${res.status}): ${errorText || res.statusText}`);
  }

  const job = await res.json();
  const jobId = job.id;

  // Poll for completion (up to 2 minutes)
  let attempts = 0;
  while (attempts < 120) {
    attempts++;
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(`${baseUrl}/render/jobs/${jobId}`, {
      headers: getApiHeaders(),
    });
    if (!pollRes.ok) {
      throw new Error(`Cloud render polling failed with status: ${pollRes.status}`);
    }
    const statusData = await pollRes.json();
    onProgress({
      progress: statusData.progress ?? 50,
      status: statusData.statusText ?? "Rendering on cloud...",
    });

    if (statusData.status === "completed" && statusData.downloadUrl) {
      const downloadRes = await fetch(statusData.downloadUrl);
      if (!downloadRes.ok) {
        throw new Error("Failed to download completed cloud render");
      }
      return await downloadRes.blob();
    }
    if (statusData.status === "failed") {
      throw new Error(statusData.error || "Cloud render job failed");
    }
  }

  throw new Error("Cloud render timed out after 2 minutes");
}
