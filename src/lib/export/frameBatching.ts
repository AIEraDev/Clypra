const DEFAULT_TARGET_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_FRAMES = 45;

/** Keep compositor export batches bounded by bytes, not frame count. */
export function calculateExportBatchSize(
  frameSizeBytes: number,
  targetBatchBytes = DEFAULT_TARGET_BATCH_BYTES,
): number {
  if (!Number.isFinite(frameSizeBytes) || frameSizeBytes <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.min(MAX_BATCH_FRAMES, Math.floor(targetBatchBytes / frameSizeBytes)),
  );
}
