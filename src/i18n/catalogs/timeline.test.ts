import { describe, expect, test } from "vitest";

import timelineSource from "../../components/editor/timeline/Timeline.tsx?raw";
import timelineToolbarSource from "../../components/editor/timeline/TimelineToolbar.tsx?raw";
import editingActionsSource from "../../core/interactions/EditingActions.ts?raw";
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

  test("wires user-visible transaction labels through the timeline catalog", () => {
    expect(timelineSource).toContain('beginTransaction(t("timeline.transaction.deleteClips"))');
    expect(timelineToolbarSource).toContain('beginTransaction(t("timeline.transaction.deleteClips"))');
    expect(editingActionsSource).toContain('t("timeline.transaction.deleteLeftAtPlayhead")');
    expect(editingActionsSource).toContain('t("timeline.transaction.deleteRightAtPlayhead")');
  });
});
