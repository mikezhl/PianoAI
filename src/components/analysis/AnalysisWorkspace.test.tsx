import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisTab, AnalysisViewItem, ScoreAnalysis } from "../../analysis/types";
import type { ScoreData } from "../../types";
import AnalysisWorkspace from "./AnalysisWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audioMocks = vi.hoisted(() => ({
  cancelScheduledPlayback: vi.fn(),
  playScoreRange: vi.fn(async () => true),
}));

vi.mock("../../lib/audio", () => audioMocks);
vi.mock("./AnalysisNavigator", () => ({
  default: ({
    items,
    onSelect,
    onTogglePlay,
  }: {
    items: AnalysisViewItem[];
    onSelect: (id: string, rangeIndex?: number) => void;
    onTogglePlay: (id: string) => void;
    onTabChange: (tab: AnalysisTab) => void;
  }) => createElement("div", null,
    createElement("button", {
      "data-testid": "play",
      onClick: () => onTogglePlay(items[0].id),
    }),
    createElement("button", {
      "data-testid": "select",
      onClick: () => onSelect(items[0].id, 0),
    }),
  ),
}));
vi.mock("./AnalysisScoreViewer", () => ({
  default: ({
    rangeKey,
    onRenderReady,
  }: {
    rangeKey: string | null;
    onRenderReady: (rangeKey: string | null) => void;
  }) => createElement("button", {
    "data-testid": "ready",
    onClick: () => onRenderReady(rangeKey),
  }),
}));
vi.mock("./AnalysisDetailPanel", () => ({ default: () => null }));

const range = {
  start: { measureIndex: 0, offsetQuarter: { numerator: 0, denominator: 1 } },
  end: { measureIndex: 1, offsetQuarter: { numerator: 0, denominator: 1 } },
};
const score = {
  title: "fixture",
  xml: "",
  noteGroups: [{
    id: "group",
    hand: "right" as const,
    measureIndex: 0,
    startTick: 0,
    absoluteTick: 0,
    durationTicks: 240,
    notes: [],
    playbackEvents: [{ midis: [60], offsetTicks: 0, durationTicks: 240 }],
  }],
  measureStarts: [0],
  measureDurations: [480],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  totalTicks: 480,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
} satisfies ScoreData;
const analysis = {
  score: { id: "fixture-score" },
  sections: [{
    id: "section",
    label: "Section",
    summary: "Summary",
    range,
  }],
  motifFamilies: [],
  leftHandAnalysisMode: "chord-groups",
  leftHandChordFamilies: [],
  leftHandTextureFamilies: [],
} as unknown as ScoreAnalysis;

beforeEach(() => {
  audioMocks.cancelScheduledPlayback.mockClear();
  audioMocks.playScoreRange.mockClear().mockResolvedValue(true);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderWorkspace() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(AnalysisWorkspace, {
    score,
    analysis,
    loadState: "ready",
    loadError: null,
    scoreZoom: 1,
    playbackBpm: 120,
  })));
  return { container, root };
}

describe("AnalysisWorkspace range playback", () => {
  it("waits for the selected range and starts pending playback once", async () => {
    const { container, root } = await renderWorkspace();
    await act(async () => (container.querySelector('[data-testid="play"]') as HTMLButtonElement).click());
    expect(audioMocks.playScoreRange).not.toHaveBeenCalled();

    const ready = container.querySelector('[data-testid="ready"]') as HTMLButtonElement;
    await act(async () => ready.click());
    expect(audioMocks.playScoreRange).toHaveBeenCalledTimes(1);

    await act(async () => ready.click());
    expect(audioMocks.playScoreRange).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("cancels pending playback after a manual selection", async () => {
    const { container, root } = await renderWorkspace();
    await act(async () => (container.querySelector('[data-testid="play"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[data-testid="select"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('[data-testid="ready"]') as HTMLButtonElement).click());
    expect(audioMocks.playScoreRange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
