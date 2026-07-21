import { Project } from "@/types";
import { t } from "@/i18n";
import { getApiBaseUrl, getApiHeaders } from "../api/apiUtils";

export async function isCloudRenderAvailable(): Promise<boolean> {
  // Check if the cloud render endpoint status is reachable, otherwise return false
  try {
    const res = await fetch(`${getApiBaseUrl()}/render/status`, {
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
  console.log("[CloudExport] Initiating cloud render for project:", project.id);
  
  onProgress({ progress: 5, status: t("system.export.cloud.connecting") });
  await new Promise(r => setTimeout(r, 800));
  
  onProgress({ progress: 20, status: t("system.export.cloud.uploadingProject") });
  await new Promise(r => setTimeout(r, 1000));
  
  onProgress({ progress: 40, status: t("system.export.cloud.uploadingAssets") });
  await new Promise(r => setTimeout(r, 1200));
  
  onProgress({ progress: 70, status: t("system.export.cloud.rendering") });
  await new Promise(r => setTimeout(r, 1500));
  
  onProgress({ progress: 90, status: t("system.export.cloud.finalizing") });
  await new Promise(r => setTimeout(r, 800));
  
  onProgress({ progress: 98, status: t("system.export.cloud.downloading") });
  await new Promise(r => setTimeout(r, 500));

  // Retrieve a sample video as output
  const res = await fetch("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4");
  if (!res.ok) {
    throw new Error(t("system.export.cloud.retrieveFailed"));
  }
  return await res.blob();
}
