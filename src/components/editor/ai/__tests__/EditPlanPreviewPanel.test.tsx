import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { buildPlanPreview } from "@/core/editPlan/preview";
import type { TimelineState } from "@/core/editPlan/compile";
import type { EditPlan } from "@/core/editPlan/types";
import type { Clip, Track } from "@/types";
import { EditPlanPreviewPanel } from "../EditPlanPreviewPanel";

function makeState(epoch = 1): TimelineState {
  return {
    tracks: [
      {
        id: "v1",
        name: "v1",
        type: "video",
        order: 0,
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        volume: 1,
        height: 60,
      } as Track,
    ],
    clips: [
      {
        id: "c1",
        mediaId: "m1",
        trackId: "v1",
        name: "c1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 1,
      } as Clip,
    ],
    transitions: [],
    gaps: [],
    selectedClipIds: [],
    epoch,
    frameRate: 30,
  };
}

const samplePlan: EditPlan = {
  schemaVersion: 1,
  planId: "ui-plan-1",
  baseEpoch: 1,
  intent: "Remove silence",
  ops: [{ op: "deleteRange", track: "v1", startMs: 2000, endMs: 4000, ripple: true }],
};

describe("EditPlanPreviewPanel (Phase 3)", () => {
  it("disables Apply and shows re-run action when epoch is stale", () => {
    const preview = buildPlanPreview(samplePlan, makeState(1));
    const onRerun = vi.fn();

    render(
      <I18nProvider>
        <EditPlanPreviewPanel
          preview={preview}
          liveEpoch={2}
          onToggleOp={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onRerun={onRerun}
        />
      </I18nProvider>,
    );

    const applyBtn = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    const rerunBtn = screen.getByRole("button", { name: "Timeline changed, re-run" });
    fireEvent.click(rerunBtn);
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it("calls onApprove with filteredPlan and onReject on user click", () => {
    const preview = buildPlanPreview(samplePlan, makeState(1));
    const onApprove = vi.fn();
    const onReject = vi.fn();

    render(
      <I18nProvider>
        <EditPlanPreviewPanel
          preview={preview}
          liveEpoch={1}
          onToggleOp={vi.fn()}
          onApprove={onApprove}
          onReject={onReject}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApprove).toHaveBeenCalledWith(preview.filteredPlan);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders Keep / Undo banner after apply", () => {
    const preview = buildPlanPreview(samplePlan, makeState(1));
    const onKeep = vi.fn();
    const onUndo = vi.fn();

    render(
      <I18nProvider>
        <EditPlanPreviewPanel
          preview={preview}
          liveEpoch={2}
          appliedOpCount={1}
          onToggleOp={vi.fn()}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onKeep={onKeep}
          onUndo={onUndo}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
