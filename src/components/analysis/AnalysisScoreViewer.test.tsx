import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreRange } from "../../analysis/types";
import type { ScoreData } from "../../types";
import AnalysisScoreViewer, { analysisRenderMeasureRange } from "./AnalysisScoreViewer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const osmdMocks = vi.hoisted(() => ({
  load: vi.fn<(xml: string, title: string) => Promise<void>>(async () => undefined),
  render: vi.fn(),
  setOptions: vi.fn<(options: { drawFromMeasureNumber: number; drawUpToMeasureNumber: number }) => void>(),
}));

vi.mock("opensheetmusicdisplay", () => ({
  OpenSheetMusicDisplay: class {
    Zoom = 1;
    GraphicSheet = { MeasureList: [] };
    private host: HTMLElement;

    constructor(host: HTMLElement) {
      this.host = host;
    }

    load(xml: string, title: string) {
      return osmdMocks.load(xml, title);
    }

    setOptions(options: { drawFromMeasureNumber: number; drawUpToMeasureNumber: number }) {
      osmdMocks.setOptions(options);
    }

    render() {
      osmdMocks.render();
      this.host.replaceChildren(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    }
  },
}));

const score = {
  title: "fixture",
  xml: "<score-partwise/>",
  noteGroups: [],
  measureStarts: [0, 240, 2160, 4080, 6000, 7920, 9840],
  measureDurations: [240, 1920, 1920, 1920, 1920, 1920, 1920],
  measureTimeSignatures: Array.from({ length: 7 }, () => ({ beats: 4, beatType: 4 })),
  totalTicks: 11760,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
} satisfies ScoreData;

function range(
  startMeasureIndex: number,
  endMeasureIndex: number,
  endNumerator = 0,
): ScoreRange {
  return {
    start: { measureIndex: startMeasureIndex, offsetQuarter: { numerator: 0, denominator: 1 } },
    end: { measureIndex: endMeasureIndex, offsetQuarter: { numerator: endNumerator, denominator: 1 } },
  };
}

function viewerProps(
  renderRange: ScoreRange,
  rangeKey: string,
  isPlaying = false,
  scoreZoom = 1,
  viewerScore: ScoreData = score,
) {
  return {
    score: viewerScore,
    scoreZoom,
    overlayItems: [],
    selectedId: null,
    selectedRangeIndex: 0,
    renderRange,
    rangeKey,
    isPlaying,
    playbackTick: null,
    onSelect: vi.fn(),
    onRenderReady: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  osmdMocks.load.mockClear();
  osmdMocks.render.mockClear();
  osmdMocks.setOptions.mockClear();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("analysis render measure range", () => {
  it("maps a pickup range to OSMD's one-based measure options", () => {
    expect(analysisRenderMeasureRange(range(0, 1))).toEqual({
      startMeasureIndex: 0,
      endMeasureIndex: 0,
      drawFromMeasureNumber: 1,
      drawUpToMeasureNumber: 1,
    });
  });

  it("keeps a partial ending measure in the rendered range", () => {
    expect(analysisRenderMeasureRange(range(2, 4, 1))).toEqual({
      startMeasureIndex: 2,
      endMeasureIndex: 4,
      drawFromMeasureNumber: 3,
      drawUpToMeasureNumber: 5,
    });
  });

  it("excludes an end position at the next measure start", () => {
    expect(analysisRenderMeasureRange(range(2, 4))).toEqual({
      startMeasureIndex: 2,
      endMeasureIndex: 3,
      drawFromMeasureNumber: 3,
      drawUpToMeasureNumber: 4,
    });
  });
});

describe("AnalysisScoreViewer rendering", () => {
  it("keeps the score chunk while a quick selection switch only reports the latest range ready", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const first = viewerProps(range(0, 1), "first");
    const second = viewerProps(range(4, 6), "second");

    await act(async () => root.render(createElement(AnalysisScoreViewer, first)));
    await act(async () => root.render(createElement(AnalysisScoreViewer, second)));
    await act(async () => vi.runAllTimersAsync());

    expect(osmdMocks.render).toHaveBeenCalledTimes(1);
    expect(osmdMocks.setOptions).toHaveBeenLastCalledWith({
      drawFromMeasureNumber: 1,
      drawUpToMeasureNumber: 7,
    });
    expect(first.onRenderReady).not.toHaveBeenCalledWith("first");
    expect(second.onRenderReady).toHaveBeenCalledWith("second");

    await act(async () => root.unmount());
  });

  it("keeps placeholders for the complete score while only rendering required chunks", async () => {
    const longScore = {
      ...score,
      measureStarts: Array.from({ length: 26 }, (_, index) => index * 1920),
      measureDurations: Array.from({ length: 26 }, () => 1920),
      measureTimeSignatures: Array.from({ length: 26 }, () => ({ beats: 4, beatType: 4 })),
      totalTicks: 26 * 1920,
    } satisfies ScoreData;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(createElement(
      AnalysisScoreViewer,
      viewerProps(range(24, 26), "tail", false, 1, longScore),
    )));
    await act(async () => vi.runAllTimersAsync());

    expect(container.querySelectorAll("[data-score-chunk]")).toHaveLength(3);
    expect(container.querySelector('[data-score-chunk="0"]')).not.toBeNull();
    expect(container.querySelector('[data-score-chunk="2"]')).not.toBeNull();
    expect(osmdMocks.setOptions).toHaveBeenCalledWith({
      drawFromMeasureNumber: 13,
      drawUpToMeasureNumber: 26,
    });
    await act(async () => root.unmount());
  });

  it("does not treat every placeholder as visible before DOM offsets are available", async () => {
    const longScore = {
      ...score,
      measureStarts: Array.from({ length: 60 }, (_, index) => index * 1920),
      measureDurations: Array.from({ length: 60 }, () => 1920),
      measureTimeSignatures: Array.from({ length: 60 }, () => ({ beats: 4, beatType: 4 })),
      totalTicks: 60 * 1920,
    } satisfies ScoreData;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(createElement(
      AnalysisScoreViewer,
      viewerProps(range(0, 1), "start", false, 1, longScore),
    )));
    await act(async () => vi.runAllTimersAsync());

    expect(container.querySelectorAll("[data-score-chunk]")).toHaveLength(5);
    expect(osmdMocks.render).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("defers range layout while playback is active", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const playing = viewerProps(range(0, 1), "range", true);

    await act(async () => root.render(createElement(AnalysisScoreViewer, playing)));
    await act(async () => vi.runAllTimersAsync());
    expect(osmdMocks.render).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".analysis-score-chunk.queued, .analysis-score-chunk.rendering")).toHaveLength(0);

    await act(async () => root.render(createElement(AnalysisScoreViewer, {
      ...playing,
      isPlaying: false,
    })));
    await act(async () => vi.runAllTimersAsync());
    expect(osmdMocks.render).toHaveBeenCalledTimes(1);

    await act(async () => root.render(createElement(AnalysisScoreViewer, {
      ...playing,
      scoreZoom: 1.2,
    })));
    await act(async () => vi.runAllTimersAsync());
    expect(osmdMocks.render).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
