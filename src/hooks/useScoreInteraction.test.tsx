import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteGroup, ScoreData, SelectionState } from "../types";
import useScoreInteraction from "./useScoreInteraction";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audioMocks = vi.hoisted(() => ({
  cancelScheduledPlayback: vi.fn(),
  playGroups: vi.fn(),
}));
vi.mock("../lib/audio", () => audioMocks);

function group(id: string, tick: number, midi: number): NoteGroup {
  return {
    id,
    hand: "right",
    measureIndex: 0,
    startTick: tick,
    absoluteTick: tick,
    durationTicks: 480,
    notes: [{
      id: `note-${id}`,
      scoreRef: {
        partId: "P1",
        measureIndex: 0,
        offsetQuarter: { numerator: tick, denominator: 480 },
        staff: 1,
        voice: "1",
        writtenPitch: `${midi}`,
        ordinalAtPosition: 0,
      },
      midi,
      name: `${midi}`,
      hand: "right",
      staff: 1,
      measureIndex: 0,
      startTick: tick,
      absoluteTick: tick,
      durationTicks: 480,
      playbackEvents: [],
    }],
    playbackEvents: [],
  };
}

const score: ScoreData = {
  title: "fixture",
  xml: "",
  noteGroups: [group("r0", 0, 60), group("r1", 480, 62), group("r2", 960, 64)],
  measureStarts: [0],
  measureDurations: [1440],
  measureTimeSignatures: [{ beats: 3, beatType: 4 }],
  totalTicks: 1440,
  canSeparateHands: true,
  hasLeftHand: false,
  hasRightHand: true,
};

function Harness({ keyboardEnabled }: { keyboardEnabled: boolean }) {
  const [selection, setSelection] = useState<SelectionState>({ range: null, loopIndex: 0 });
  const interaction = useScoreInteraction({
    score,
    selection,
    setSelection,
    navigationFallbackGroup: score.noteGroups[0],
    playbackBpm: 92,
    keyboardEnabled,
  });
  return (
    <div>
      <button type="button" onClick={() => interaction.handleGroupSelect("r1", false)}>选择 r1</button>
      <output data-selected={interaction.selectedIds.join(",")} />
    </div>
  );
}

afterEach(() => {
  audioMocks.cancelScheduledPlayback.mockReset();
  audioMocks.playGroups.mockReset();
});

describe("useScoreInteraction", () => {
  it("让点击和方向键共用同一份谱面选择状态", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness keyboardEnabled />));
    const selectButton = container.querySelector("button") as HTMLButtonElement;
    await act(async () => selectButton.click());
    expect(container.querySelector("output")?.getAttribute("data-selected")).toBe("r1");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(container.querySelector("output")?.getAttribute("data-selected")).toBe("r2");
    expect(audioMocks.playGroups).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("允许分析模式关闭公共方向键导航", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness keyboardEnabled={false} />));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(container.querySelector("output")?.getAttribute("data-selected")).toBe("");
    await act(async () => root.unmount());
  });
});
