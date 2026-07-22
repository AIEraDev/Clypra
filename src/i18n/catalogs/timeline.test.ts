import { describe, expect, test } from "vitest";

import { t } from "@/i18n";

const translate = t as (key: string) => string;

describe("timeline history localization", () => {
  test("translates command and transaction labels", () => {
    expect([
      translate("timeline.history.deleteClip"),
      translate("timeline.history.restoreRippleDelete"),
      translate("timeline.history.toggleTrackVisible"),
      translate("timeline.transaction.deleteClips"),
      translate("timeline.transaction.deleteLeftAtPlayhead"),
      translate("timeline.transaction.deleteRightAtPlayhead"),
    ]).toEqual([
      "删除片段",
      "恢复波纹删除",
      "切换轨道可见性",
      "删除片段",
      "删除播放头左侧",
      "删除播放头右侧",
    ]);
  });
});
