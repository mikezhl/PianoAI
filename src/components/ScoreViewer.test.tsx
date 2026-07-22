import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreData } from "../types";
import ScoreViewer from "./ScoreViewer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const osmdMocks = vi.hoisted(() => ({
  renderCount: 0,
}));

vi.mock("opensheetmusicdisplay", () => ({
  OpenSheetMusicDisplay: class {
    EngravingRules = { SheetMaximumWidth: 0 };
    Zoom = 1;
    private host: HTMLElement;

    constructor(host: HTMLElement) {
      this.host = host;
    }

    async load() {
      return undefined;
    }

    renderNext() {
      osmdMocks.renderCount += 1;
      let svg = this.host.querySelector("svg");
      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.width = "500px";
        svg.style.height = "100px";
        this.host.append(svg);
      }
      svg.setAttribute("width", osmdMocks.renderCount === 1 ? "100" : "200");
      svg.setAttribute("height", "20");
      return {
        done: false,
        lastRenderedMeasure: [{
          parentSourceMeasure: { measureListIndex: osmdMocks.renderCount * 24 - 1 },
        }],
      };
    }
  },
  VexFlowMusicSheetCalculator: class {},
}));

vi.mock("../lib/displayXml", () => ({
  prepareMusicXmlForPracticeDisplay: (xml: string) => xml,
}));

vi.mock("../lib/osmdHorizontalPedals", () => ({
  installHorizontalPedalLayoutFix: vi.fn(),
}));

const score = {
  title: "Long score fixture",
  xml: "<score-partwise/>",
  noteGroups: [],
  measureStarts: [0],
  measureDurations: [1_920],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  totalTicks: 1_920,
  canSeparateHands: true,
  hasLeftHand: true,
  hasRightHand: true,
} satisfies ScoreData;

function viewerProps() {
  return {
    score,
    scoreZoom: 1,
    onScoreZoomLimitChange: vi.fn(),
    allowBoxSelect: true,
    activeGroups: [],
    followActive: false,
    selectedIds: [],
    loopGroupIds: [],
    pressedNotes: [],
    onGroupSelect: vi.fn(),
    onBoxSelect: vi.fn(),
    onExpandSelectionToBothHands: vi.fn(),
    onShrinkSelectionToHand: vi.fn(),
    onResizeSelectionBoundary: vi.fn(),
    onClearSelection: vi.fn(),
    onDismissSelection: vi.fn(),
  };
}

let frameId = 0;
let scheduledFrames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  frameId = 0;
  scheduledFrames = new Map();
  osmdMocks.renderCount = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frameId += 1;
    scheduledFrames.set(frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    scheduledFrames.delete(id);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScoreViewer incremental rendering", () => {
  it("updates the SVG display size in the same frame as a new render batch", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(ScoreViewer, viewerProps())));
    await vi.waitFor(() => expect(osmdMocks.renderCount).toBe(1));

    const scroll = container.querySelector(".score-scroll") as HTMLDivElement;
    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
    });
    scroll.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 1_000,
      height: 400,
      top: 0,
      right: 1_000,
      bottom: 400,
      left: 0,
      toJSON: () => ({}),
    });

    const svg = container.querySelector(".osmd-host svg") as SVGSVGElement;
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 500,
      height: 100,
      top: 0,
      right: 500,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    });

    await act(async () => scroll.dispatchEvent(new Event("scroll")));
    const renderFrameEntry = [...scheduledFrames.entries()].at(-1);
    expect(renderFrameEntry).toBeDefined();
    scheduledFrames.delete(renderFrameEntry![0]);

    await act(async () => renderFrameEntry![1](0));

    expect(osmdMocks.renderCount).toBe(2);
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.style.width).toBe("1050px");
    expect(svg.style.height).toBe("105px");
    expect(scheduledFrames.size).toBe(1);

    await act(async () => root.unmount());
  });

  it("publishes the zoom limit again when the score identity changes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onScoreZoomLimitChange = vi.fn();
    const props = { ...viewerProps(), onScoreZoomLimitChange };
    await act(async () => root.render(createElement(ScoreViewer, props)));
    await vi.waitFor(() => expect(osmdMocks.renderCount).toBe(1));

    const scroll = container.querySelector(".score-scroll") as HTMLDivElement;
    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
    });
    const firstMeasureFrame = [...scheduledFrames.entries()].at(-1)!;
    scheduledFrames.delete(firstMeasureFrame[0]);
    await act(async () => firstMeasureFrame[1](0));
    expect(onScoreZoomLimitChange).toHaveBeenCalledTimes(1);

    await act(async () => root.render(createElement(ScoreViewer, {
      ...props,
      score: { ...score, title: "Replacement score" },
    })));
    await vi.waitFor(() => expect(osmdMocks.renderCount).toBe(2));
    const secondMeasureFrame = [...scheduledFrames.entries()].at(-1)!;
    scheduledFrames.delete(secondMeasureFrame[0]);
    await act(async () => secondMeasureFrame[1](0));

    expect(onScoreZoomLimitChange).toHaveBeenCalledTimes(2);
    expect(onScoreZoomLimitChange.mock.calls[1]).toEqual(onScoreZoomLimitChange.mock.calls[0]);

    await act(async () => root.unmount());
  });
});
