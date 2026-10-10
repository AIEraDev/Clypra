import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export class HarnessResultCollector {
  constructor(suiteName = "Clypra Verification Harness") {
    this.suiteName = suiteName;
    this.startTime = Date.now();
    this.results = [];
  }

  record({ name, category, status, durationMs, exitCode = 0, details = "", artifacts = [] }) {
    this.results.push({
      name,
      category,
      status, // 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'
      durationMs,
      exitCode,
      details,
      artifacts,
      timestamp: new Date().toISOString(),
    });
  }

  printSummary() {
    const totalDurationMs = Date.now() - this.startTime;
    console.log("\n==================================================");
    console.log(`📊 ${this.suiteName} Summary`);
    console.log("==================================================");

    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let blockedCount = 0;

    for (const r of this.results) {
      let icon = "⚪";
      if (r.status === "PASSED") {
        icon = "✅";
        passedCount++;
      } else if (r.status === "FAILED") {
        icon = "❌";
        failedCount++;
      } else if (r.status === "SKIPPED") {
        icon = "⏭️";
        skippedCount++;
      } else if (r.status === "BLOCKED") {
        icon = "🚫";
        blockedCount++;
      }

      const durationStr = `${(r.durationMs / 1000).toFixed(2)}s`;
      console.log(`${icon} [${r.category}] ${r.name.padEnd(35)} ${r.status.padEnd(8)} (${durationStr})`);
      if (r.details && r.status !== "PASSED") {
        console.log(`    ↳ ${r.details}`);
      }
    }

    console.log("--------------------------------------------------");
    console.log(
      `Total: ${this.results.length} | Passed: ${passedCount} | Failed: ${failedCount} | Skipped: ${skippedCount} | Blocked: ${blockedCount}`,
    );
    console.log(`Total Duration: ${(totalDurationMs / 1000).toFixed(2)}s\n`);

    return failedCount === 0 && blockedCount === 0;
  }

  async saveJsonReport(outputPath = "test-results/verification-report.json") {
    const fullPath = path.resolve(process.cwd(), outputPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const payload = {
      suite: this.suiteName,
      executedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - this.startTime,
      summary: {
        total: this.results.length,
        passed: this.results.filter((r) => r.status === "PASSED").length,
        failed: this.results.filter((r) => r.status === "FAILED").length,
        skipped: this.results.filter((r) => r.status === "SKIPPED").length,
        blocked: this.results.filter((r) => r.status === "BLOCKED").length,
      },
      results: this.results,
    };
    await writeFile(fullPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`📄 Structured JSON verification report saved to: ${outputPath}`);
  }
}
