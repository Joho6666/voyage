import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripDiffModal } from "@/components/ai/TripDiffModal";
import { chongqingTrip } from "@/data/demo/chongqing";
import type { TripChangeSet } from "@/types/diff";

afterEach(cleanup);

const changeSet: TripChangeSet = {
  id: "cs-1",
  summary: "第二天改乘地铁，少走 800 米",
  metrics: {
    walkDistanceBeforeMeters: 6800,
    walkDistanceAfterMeters: 6000,
    walkDistanceDiffMeters: -800,
    walkDurationBeforeMinutes: 95,
    walkDurationAfterMinutes: 83,
    walkDurationSavedMinutes: 12,
    estimatedCostBefore: 300,
    estimatedCostAfter: 308,
    costDiff: 8,
    transitChanges: [{ fromPlaceName: "洪崖洞", toPlaceName: "三峡博物馆", oldMode: "walk", newMode: "metro", detail: "步行 1.2 公里 → 轨道 2 号线 3 站" }],
  },
  itemChanges: [
    { type: "replaced", itemId: "it-1", placeName: "解放碑", detail: "解放碑 → 三峡博物馆（避开人流）" },
    { type: "added", placeName: "人民大礼堂", detail: "顺路新增人民大礼堂" },
  ],
  actions: [],
  beforeTrip: chongqingTrip,
  proposedTrip: chongqingTrip,
};

describe("TripDiffModal", () => {
  it("renders nothing when there is no change set", () => {
    const { container } = render(<TripDiffModal changeSet={null} open onOpenChange={() => {}} onApply={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the quantified metrics and per-item change badges", () => {
    render(<TripDiffModal changeSet={changeSet} open onOpenChange={() => {}} onApply={() => {}} />);
    expect(screen.getByText("第二天改乘地铁，少走 800 米")).toBeInTheDocument();
    expect(screen.getByText("1 段交通置换")).toBeInTheDocument();
    expect(screen.getByText("节省约 12 分钟步行")).toBeInTheDocument();
    expect(screen.getByText("替换")).toBeInTheDocument();
    expect(screen.getByText("新增")).toBeInTheDocument();
    expect(screen.getByText("解放碑 → 三峡博物馆（避开人流）")).toBeInTheDocument();
    // Cost up by ¥8 must be labelled as an increase, never hidden.
    expect(screen.getByText("+¥8")).toBeInTheDocument();
    expect(screen.getByText("打车替换所增加费用")).toBeInTheDocument();
  });

  it("applies the exact change set and closes on confirm", () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(<TripDiffModal changeSet={changeSet} open onOpenChange={onOpenChange} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: /应用此修改/ }));
    expect(onApply).toHaveBeenCalledWith(changeSet);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels without applying", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    render(<TripDiffModal changeSet={changeSet} open onOpenChange={onOpenChange} onApply={onApply} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /放弃修改/ }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
