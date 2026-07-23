import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoreAnalysis } from "../../analysis/types";
import type { PerformanceScoreOverlayConfig } from "./PerformanceScoreOverlay";
import type { ReferenceInterpretation, ScoreIdentity } from "../../performance/types";
import type { ScoreData, SelectionState } from "../../types";
import useScoreInteraction from "../../hooks/useScoreInteraction";
import PerformanceWorkspace from "./PerformanceWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audioMocks = vi.hoisted(() => ({
  cancelScheduledPlayback: vi.fn(),
  playGroups: vi.fn(),
  playPerformanceNotes: vi.fn<(notes: unknown[], options?: { startOffsetMs?: number }) => Promise<number>>(),
}));

vi.mock("../../lib/audio", () => ({
  ...audioMocks,
  PERFORMANCE_PLAYBACK_START_DELAY_MS: 60,
}));
vi.mock("../ScoreViewer", () => ({
  default: ({
    score,
    activeGroups = [],
    followActive = false,
    showActiveCursor = false,
    performanceOverlay,
    onGroupHover,
    onGroupSelect,
  }: {
    score?: ScoreData | null;
    activeGroups?: Array<{ id: string }>;
    followActive?: boolean;
    showActiveCursor?: boolean;
    performanceOverlay?: PerformanceScoreOverlayConfig | null;
    onGroupHover?: (groupId: string | null) => void;
    onGroupSelect?: (groupId: string, extend: boolean) => void;
  }) => createElement(
    "div",
    {
      "data-testid": "score-viewer",
      "data-active-groups": activeGroups.map((group) => group.id).join(","),
      "data-follow-active": String(followActive),
      "data-show-active-cursor": String(showActiveCursor),
      "data-performance-overlay": performanceOverlay ? "overview" : "",
      "data-dynamics-scale-mode": performanceOverlay?.dynamicsScaleMode ?? "",
      "data-group-hover-enabled": String(Boolean(onGroupHover)),
    },
    score?.noteGroups.map((group) => createElement("button", {
      key: group.id,
      "data-testid": `select-${group.id}`,
      onClick: () => onGroupSelect?.(group.id, false),
    })),
  ),
}));

const identity: ScoreIdentity = {
  scoreId: "score",
  sourceHash: `sha256:${"A".repeat(64)}`,
  identitySource: "library-source",
};
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
    notes: [{
      id: "note",
      scoreRef: {
        partId: "P1",
        measureIndex: 0,
        offsetQuarter: { numerator: 0, denominator: 1 },
        staff: 1,
        voice: "1",
        writtenPitch: "C4",
        ordinalAtPosition: 0,
      },
      midi: 60,
      name: "C4",
      hand: "right" as const,
      staff: 1,
      measureIndex: 0,
      startTick: 0,
      absoluteTick: 0,
      durationTicks: 240,
      playbackEvents: [],
    }],
    playbackEvents: [],
  }, {
    id: "group-2",
    hand: "right" as const,
    measureIndex: 0,
    startTick: 240,
    absoluteTick: 240,
    durationTicks: 240,
    notes: [{
      id: "note-2",
      scoreRef: {
        partId: "P1",
        measureIndex: 0,
        offsetQuarter: { numerator: 1, denominator: 2 },
        staff: 1,
        voice: "1",
        writtenPitch: "D4",
        ordinalAtPosition: 0,
      },
      midi: 62,
      name: "D4",
      hand: "right" as const,
      staff: 1,
      measureIndex: 0,
      startTick: 240,
      absoluteTick: 240,
      durationTicks: 240,
      playbackEvents: [],
    }],
    playbackEvents: [],
  }],
  measureStarts: [0],
  measureDurations: [480],
  measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  totalTicks: 480,
  canSeparateHands: true,
  hasLeftHand: false,
  hasRightHand: true,
} satisfies ScoreData;
const threeGroupScore = {
  ...score,
  noteGroups: [...score.noteGroups, {
    id: "group-3",
    hand: "right" as const,
    measureIndex: 0,
    startTick: 480,
    absoluteTick: 480,
    durationTicks: 240,
    notes: [{
      id: "note-3",
      scoreRef: {
        partId: "P1",
        measureIndex: 0,
        offsetQuarter: { numerator: 1, denominator: 1 },
        staff: 1,
        voice: "1",
        writtenPitch: "E4",
        ordinalAtPosition: 0,
      },
      midi: 64,
      name: "E4",
      hand: "right" as const,
      staff: 1,
      measureIndex: 0,
      startTick: 480,
      absoluteTick: 480,
      durationTicks: 240,
      playbackEvents: [],
    }],
    playbackEvents: [],
  }],
  measureDurations: [720],
  totalTicks: 720,
} satisfies ScoreData;
const analysis = {
  form: {
    label: "A–B–Coda",
    summary: "主题经对比段后进入尾声。",
  },
  sections: [{ id: "A", label: "A", kind: "theme", range }],
} as unknown as ScoreAnalysis;
let topbarTarget: HTMLDivElement;
let scheduledAnimationFrame: FrameRequestCallback | null;
let referenceFixtures: ReferenceInterpretation[];

function reference(id: string, performerName: string, durationUs: number): ReferenceInterpretation {
  return {
    schemaVersion: "2.1.0",
    interpretationId: id,
    score: identity,
    performerId: id,
    performerName,
    evidenceId: id,
    source: { title: id, url: `https://example.com/${id}`, kind: "original-recording" },
    audio: { url: `/audio/${id}.m4a`, fileName: `${id}.m4a`, objectKey: `reference-audio/${"b".repeat(64)}.m4a`, sha256: "B".repeat(64), durationUs, format: "audio/mp4", sampleRate: 48_000, channels: 2, storage: "cloudflare-r2" },
    timeMap: [
      { scorePosition: range.start, timeUs: 0, confidence: 0.9 },
      { scorePosition: range.end, timeUs: durationUs, confidence: 0.9 },
    ],
    noteExpressions: [],
    pedals: { sustain: [] },
    generation: {
      status: "automated-candidate",
      algorithmVersion: "test",
      validationPolicyVersion: "test",
      models: ["test"],
      evaluationId: id,
      evaluationSha256: `sha256:${"A".repeat(64)}`,
      dimensions: {},
      coverage: { scoreNotes: 2, matchedNotes: 0, ornamentGestures: 0, uncertainNotes: 2, extraEvents: 0, scoreCoverage: 0, performanceCoverage: 0 },
    },
  };
}

function workspaceProps() {
  return {
    score,
    scoreIdentity: identity,
    analysis,
    scoreZoom: 1,
    allowBoxSelect: true,
    selectedIds: [],
    selection: { range: null, loopIndex: 0 },
    scorePlaybackActive: false,
    scorePlaybackGroups: [],
    scorePlaybackPositionMs: 0,
    scorePlaybackDurationMs: 10_000,
    onToggleScorePlayback: vi.fn(),
    onSeekScorePlayback: vi.fn(),
    onStartScorePlaybackAt: vi.fn(),
    onScoreZoomLimitChange: vi.fn(),
    onGroupSelect: vi.fn(),
    onBoxSelect: vi.fn(),
    onExpandSelectionToBothHands: vi.fn(),
    onShrinkSelectionToHand: vi.fn(),
    onResizeSelectionBoundary: vi.fn(),
    onClearSelection: vi.fn(),
    onDismissSelection: vi.fn(),
  };
}

function InteractiveWorkspace({ scoreData = score }: { scoreData?: ScoreData }) {
  const [selection, setSelection] = useState<SelectionState>(workspaceProps().selection);
  const interaction = useScoreInteraction({
    score: scoreData,
    selection,
    setSelection,
    navigationFallbackGroup: scoreData.noteGroups[0],
    playbackBpm: 92,
    keyboardEnabled: true,
  });
  return createElement(PerformanceWorkspace, {
    ...workspaceProps(),
    score: scoreData,
    selection,
    selectedIds: interaction.selectedIds,
    onGroupSelect: interaction.handleGroupSelect,
    onBoxSelect: interaction.handleBoxSelect,
    onExpandSelectionToBothHands: interaction.expandSelectionToBothHands,
    onShrinkSelectionToHand: interaction.shrinkSelectionToHand,
    onResizeSelectionBoundary: interaction.resizeSelectionBoundary,
    onClearSelection: interaction.handleClearSelection,
    onDismissSelection: interaction.dismissSelection,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.getElementById("performance-topbar-controls")?.remove();
  topbarTarget = document.createElement("div");
  topbarTarget.id = "performance-topbar-controls";
  document.body.appendChild(topbarTarget);
  scheduledAnimationFrame = null;
  audioMocks.cancelScheduledPlayback.mockReset();
  audioMocks.playGroups.mockReset();
  audioMocks.playPerformanceNotes.mockReset().mockResolvedValue(500);
  vi.spyOn(performance, "now").mockReturnValue(1_000);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    scheduledAnimationFrame = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  referenceFixtures = [reference("one", "Pianist One", 1_000_000), reference("two", "Pianist Two", 1_200_000)];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/data/performances/catalog.json")) {
      const catalogEntries = referenceFixtures.map(({ schemaVersion: _schema, timeMap: _timeMap, noteExpressions: _notes, pedals: _pedals, generation: _generation, ...entry }) => {
        const { url: _audioUrl, ...audio } = entry.audio;
        return { ...entry, audio };
      });
      return new Response(JSON.stringify({ schemaVersion: "2.1.0", references: catalogEntries }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const detail = referenceFixtures.find((candidate) => url.endsWith(`/data/performances/interpretations/${candidate.interpretationId}.json`));
    return new Response(JSON.stringify(detail && {
      schemaVersion: detail.schemaVersion,
      interpretationId: detail.interpretationId,
      score: detail.score,
      timeMap: detail.timeMap,
      noteExpressions: detail.noteExpressions,
      pedals: detail.pedals,
      generation: detail.generation,
    }), { status: detail ? 200 : 404, headers: { "Content-Type": "application/json" } });
  }));
});

afterEach(() => {
  topbarTarget.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PerformanceWorkspace", () => {
  it("默认展示第一位演奏者且菜单只列出真实演奏者", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const referenceMenu = topbarTarget.querySelector('button[aria-label="专业演绎"]') as HTMLButtonElement;
    expect(referenceMenu.textContent).toContain("Pianist One");
    await act(async () => referenceMenu.click());
    expect(Array.from(topbarTarget.querySelectorAll(".performance-menu-option")).map((option) => option.textContent)).toEqual([
      "Pianist One",
      "Pianist Two",
    ]);
    const sourceLinks = Array.from(topbarTarget.querySelectorAll<HTMLAnchorElement>(".performance-menu-source-link"));
    expect(sourceLinks.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
    expect(sourceLinks.every((link) => link.target === "_blank")).toBe(true);
    expect(topbarTarget.querySelector('button[aria-label="演绎维度"]')).toBeNull();
    const sharedPlaybackControls = container.querySelector(".performance-practice-controls")!;
    expect(sharedPlaybackControls.classList.contains("practice-controls")).toBe(true);
    expect(Array.from(sharedPlaybackControls.children).map((element) => element.className)).toEqual([
      "practice-play-button",
    ]);
    const playbackActions = container.querySelector(".performance-playback-actions")!;
    expect(Array.from(playbackActions.children).map((element) => element.className)).toEqual([
      "performance-playback-source-switch",
      "practice-controls performance-practice-controls",
      "performance-playback-secondary",
    ]);
    const secondaryControls = playbackActions.querySelector(".performance-playback-secondary")!;
    expect(Array.from(secondaryControls.children).map((element) => element.className)).toEqual([
      "performance-dynamics-scale-toggle active",
    ]);
    const dynamicsScaleToggle = secondaryControls.querySelector('button[aria-label="Local dynamics scale"]')!;
    expect(dynamicsScaleToggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-dynamics-scale-mode")).toBe("local");
    expect(playbackActions.querySelector('button[aria-label="选择机械原谱"]')).not.toBeNull();
    expect(playbackActions.querySelector('button[aria-label="选择标准化演绎"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(playbackActions.querySelector('button[aria-label="选择原始录音"]')).not.toBeNull();
    expect(container.querySelector(".performance-playback-controls")).toBeNull();
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-group-hover-enabled")).toBe("false");
    expect(container.querySelector(".performance-practice-controls .practice-play-button")).not.toBeNull();
    expect(container.querySelector(".performance-practice-controls .practice-step-button")).toBeNull();
    expect(Array.from(container.querySelectorAll(".performance-playback-progress .playback-progress-time")).map((time) => time.textContent))
      .toEqual(["0:00", "0:01"]);
    expect(Array.from(container.querySelector(".performance-playback-progress")!.children).map((element) => element.className)).toEqual([
      "playback-progress-time",
      "score-scroll-progress",
      "playback-progress-time",
    ]);
    expect(container.querySelector(".performance-playback-progress .score-scroll-progress-track")).not.toBeNull();
    expect(container.querySelector(".performance-playback-insight")).toBeNull();
    expect(container.querySelector(".performance-playback-context")).toBeNull();
    expect(container.querySelectorAll(".performance-summary-label, .performance-summary-detail")).toHaveLength(0);
    expect(container.querySelectorAll(".performance-analysis-form, .performance-analysis-summary")).toHaveLength(0);
    expect(container.querySelectorAll(".performance-readout-item")).toHaveLength(0);
    expect(container.querySelector(".performance-menu")).toBeNull();
    expect(topbarTarget.querySelectorAll(".performance-menu")).toHaveLength(1);
    expect(container.querySelector(".performance-tempo-display")).toBeNull();
    await act(async () => root.unmount());
  });

  it("toggles the local dynamics scale and restores the saved preference", async () => {
    referenceFixtures.forEach((fixture) => {
      fixture.generation.status = "automatically-validated";
      fixture.generation.dimensions = { dynamics: 1 };
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector('.performance-dynamics-scale-toggle:not(:disabled)')).not.toBeNull();
    });

    const toggle = container.querySelector('button[aria-label="Local dynamics scale"]') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-dynamics-scale-mode")).toBe("global");
    expect(window.localStorage.getItem("pianoai.performance.dynamics-scale-mode")).toBe("global");
    await act(async () => root.unmount());

    const restoredRoot = createRoot(container);
    await act(async () => restoredRoot.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Local dynamics scale"]')?.getAttribute("aria-pressed")).toBe("false");
    });
    await act(async () => restoredRoot.unmount());
  });

  it("使用练习模式播放引擎播放机械原谱并在谱面跟随当前音组", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onToggleScorePlayback = vi.fn();
    const onStartScorePlaybackAt = vi.fn();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      onToggleScorePlayback,
      onStartScorePlaybackAt,
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });

    await act(async () => (container.querySelector('button[aria-label="选择机械原谱"]') as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-active-groups")).toBe("group");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-follow-active")).toBe("false");
    const scorePlaybackButton = container.querySelector('button[aria-label="播放机械原谱"]') as HTMLButtonElement;
    await act(async () => scorePlaybackButton.click());
    expect(onStartScorePlaybackAt).toHaveBeenCalledWith(0);
    expect(onToggleScorePlayback).not.toHaveBeenCalled();
    expect(audioMocks.playPerformanceNotes).not.toHaveBeenCalled();

    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      scorePlaybackActive: true,
      scorePlaybackGroups: [score.noteGroups[1]],
      onToggleScorePlayback,
      onStartScorePlaybackAt,
    })));
    expect(container.querySelector('button[aria-label="选择机械原谱"]')?.classList.contains("active")).toBe(true);
    expect(container.querySelector('button[aria-label="暂停机械原谱"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-active-groups")).toBe("group-2");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-follow-active")).toBe("true");
    await act(async () => (container.querySelector('button[aria-label="暂停机械原谱"]') as HTMLButtonElement).click());
    expect(onToggleScorePlayback).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("机械原谱激活后底部时间轴使用练习播放位置并可 seek", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onSeekScorePlayback = vi.fn();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      scorePlaybackPositionMs: 2_500,
      scorePlaybackDurationMs: 10_000,
      onSeekScorePlayback,
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });

    await act(async () => (container.querySelector('button[aria-label="选择机械原谱"]') as HTMLButtonElement).click());
    const progress = container.querySelector('input[aria-label="机械原谱播放进度"]') as HTMLInputElement;
    expect(Number(progress.value)).toBe(2_500);
    expect(Number(progress.max)).toBe(10_000);
    expect(container.querySelector(".performance-playback-progress .playback-progress-time")?.textContent).toBe("0:03");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(progress, "6000");
      progress.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSeekScorePlayback).toHaveBeenCalledWith(6_000);
    await act(async () => root.unmount());
  });

  it("通过底部播放栏和可拖动进度条播放标准化专业演绎", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });
    const playButton = container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement;
    const progress = container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement;
    expect(playButton.getAttribute("aria-label")).toBe("播放标准化演绎");
    expect(progress).not.toBeNull();
    expect(Number(progress.max)).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-active-groups")).toBe("group");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-follow-active")).toBe("false");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-show-active-cursor")).toBe("true");
    await act(async () => playButton.click());
    expect(audioMocks.playPerformanceNotes).toHaveBeenCalledTimes(1);
    expect(audioMocks.playPerformanceNotes.mock.calls[0][1]).toEqual({ startOffsetMs: 0 });
    expect(playButton.getAttribute("aria-label")).toBe("暂停标准化演绎");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-follow-active")).toBe("true");
    await act(async () => scheduledAnimationFrame?.(1_310));
    expect(Number(progress.value)).toBe(250);
    await act(async () => playButton.click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(progress, "750");
      progress.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector(".performance-playback-progress .playback-progress-time")?.textContent).toBe("0:01");
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-active-groups")).toBe("group-2");
    await act(async () => playButton.click());
    expect(audioMocks.playPerformanceNotes.mock.calls[1][1]).toEqual({ startOffsetMs: 750 });
    expect((container.querySelector("audio") as HTMLAudioElement).src).toContain("/__reference_audio__/one.m4a");
    await act(async () => root.unmount());
  });

  it("暂停后切换播放模式时通过乐谱位置换算并保留进度", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onSeekScorePlayback = vi.fn();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      onSeekScorePlayback,
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });

    const playButton = container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement;
    await act(async () => playButton.click());
    await act(async () => scheduledAnimationFrame?.(1_310));
    vi.mocked(performance.now).mockReturnValue(1_310);
    await act(async () => playButton.click());
    expect(Number((container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement).value)).toBe(250);

    await act(async () => (container.querySelector('button[aria-label="选择机械原谱"]') as HTMLButtonElement).click());
    expect(onSeekScorePlayback).toHaveBeenLastCalledWith(2_500);

    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      scorePlaybackPositionMs: 2_500,
      onSeekScorePlayback,
    })));
    expect(Number((container.querySelector('input[aria-label="机械原谱播放进度"]') as HTMLInputElement).value)).toBe(2_500);

    await act(async () => (container.querySelector('button[aria-label="选择标准化演绎"]') as HTMLButtonElement).click());
    expect(Number((container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement).value)).toBe(250);
    await act(async () => root.unmount());
  });

  it("播放中切换音源会在同一乐谱位置继续播放", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onStartScorePlaybackAt = vi.fn();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      onStartScorePlaybackAt,
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });

    await act(async () => (container.querySelector('button[aria-label="播放标准化演绎"]') as HTMLButtonElement).click());
    await act(async () => scheduledAnimationFrame?.(1_310));
    vi.mocked(performance.now).mockReturnValue(1_310);
    await act(async () => (container.querySelector('button[aria-label="选择原始录音"]') as HTMLButtonElement).click());

    const audio = container.querySelector("audio") as HTMLAudioElement;
    await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(audio.currentTime).toBeCloseTo(0.25, 3);

    await act(async () => (container.querySelector('button[aria-label="选择机械原谱"]') as HTMLButtonElement).click());
    expect(onStartScorePlaybackAt).toHaveBeenCalledWith(2_500);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("机械原谱拖动结束后从新位置恢复而不是回到拖动前", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onToggleScorePlayback = vi.fn();
    const onSeekScorePlayback = vi.fn();
    const onStartScorePlaybackAt = vi.fn();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      scorePlaybackActive: true,
      scorePlaybackPositionMs: 2_500,
      onToggleScorePlayback,
      onSeekScorePlayback,
      onStartScorePlaybackAt,
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    await act(async () => (container.querySelector('button[aria-label="选择机械原谱"]') as HTMLButtonElement).click());
    const progress = container.querySelector('input[aria-label="机械原谱播放进度"]') as HTMLInputElement;

    await act(async () => progress.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(progress, "6000");
      progress.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => progress.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })));

    expect(onToggleScorePlayback).toHaveBeenCalledTimes(1);
    expect(onSeekScorePlayback).toHaveBeenLastCalledWith(6_000);
    expect(onStartScorePlaybackAt).toHaveBeenCalledWith(6_000);
    await act(async () => root.unmount());
  });

  it("从底部播放区按当前谱面范围播放和停止原始录音", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });
    const originalAction = container.querySelector('button[aria-label="选择原始录音"]') as HTMLButtonElement;
    expect(originalAction.closest(".performance-playback-actions")).not.toBeNull();
    await act(async () => originalAction.click());
    await act(async () => (container.querySelector('button[aria-label="播放原始录音"]') as HTMLButtonElement).click());
    const audio = container.querySelector("audio") as HTMLAudioElement;
    await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    const stopAction = container.querySelector('button[aria-label="暂停原始录音"]') as HTMLButtonElement;
    expect(container.querySelector('button[aria-label="选择原始录音"]')?.classList.contains("active")).toBe(true);
    await act(async () => stopAction.click());
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("等待原始录音元数据时切换演奏者不会启动失效的播放任务", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-count")).toBe("2");
    });

    const referenceMenu = topbarTarget.querySelector('button[aria-label="专业演绎"]') as HTMLButtonElement;
    await act(async () => (container.querySelector('button[aria-label="选择原始录音"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('button[aria-label="播放原始录音"]') as HTMLButtonElement).click());
    const audio = container.querySelector("audio") as HTMLAudioElement;

    await act(async () => referenceMenu.click());
    const secondReference = Array.from(topbarTarget.querySelectorAll(".performance-menu-option"))
      .find((option) => option.textContent?.includes("Pianist Two")) as HTMLButtonElement;
    await act(async () => secondReference.click());
    await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("没有静态曲式分析时仍以全曲范围显示专业速度", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, { ...workspaceProps(), analysis: null })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    expect(container.querySelector('[data-testid="score-viewer"]')?.getAttribute("data-performance-overlay")).toBe("overview");
    expect(container.querySelector(".performance-rail-toolbar")).toBeNull();
    await act(async () => root.unmount());
  });

  it("单音选区会作为连续播放起点而不是只播放该音", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      score: threeGroupScore,
      selection: { range: { startTick: 0, endTick: 0, hands: ["right"] }, loopIndex: 0 },
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    const progress = container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement;
    const playButton = container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement;
    expect(Number(progress.max)).toBeGreaterThan(1);
    expect(playButton.disabled).toBe(false);
    await act(async () => playButton.click());
    expect((audioMocks.playPerformanceNotes.mock.calls[0][0] as Array<{ scoreGroupId: string }>)
      .map((note) => note.scoreGroupId)).toEqual(["group", "group-2", "group-3"]);
    await act(async () => root.unmount());
  });

  it("鼠标选择中间音符后从该位置连续播放到曲尾", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(InteractiveWorkspace, { scoreData: threeGroupScore })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    await act(async () => (container.querySelector('[data-testid="select-group-2"]') as HTMLButtonElement).click());
    const progress = container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement;
    expect(Number(progress.max)).toBeCloseTo(1_000, 0);
    expect(Number(progress.value)).toBeCloseTo(1_000 / 3, 0);
    audioMocks.playPerformanceNotes.mockClear();
    await act(async () => (container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement).click());
    expect((audioMocks.playPerformanceNotes.mock.calls[0][0] as Array<{ scoreGroupId: string }>)
      .map((note) => note.scoreGroupId)).toEqual(["group", "group-2", "group-3"]);
    expect(audioMocks.playPerformanceNotes.mock.calls[0][1]?.startOffsetMs).toBeCloseTo(1_000 / 3, 0);
    await act(async () => root.unmount());
  });

  it("方向键选择中间音符后从该位置连续播放到曲尾", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(InteractiveWorkspace, { scoreData: threeGroupScore })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    const progress = container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement;
    expect(Number(progress.max)).toBeCloseTo(1_000, 0);
    expect(Number(progress.value)).toBeCloseTo(1_000 / 3, 0);
    audioMocks.playPerformanceNotes.mockClear();
    await act(async () => (container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement).click());
    expect((audioMocks.playPerformanceNotes.mock.calls[0][0] as Array<{ scoreGroupId: string }>)
      .map((note) => note.scoreGroupId)).toEqual(["group", "group-2", "group-3"]);
    expect(audioMocks.playPerformanceNotes.mock.calls[0][1]?.startOffsetMs).toBeCloseTo(1_000 / 3, 0);
    await act(async () => root.unmount());
  });

  it("多音区间播放仍使用区间内的相对进度", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      score: threeGroupScore,
      selectedIds: ["group-2", "group-3"],
      selection: { range: { startTick: 240, endTick: 480, hands: ["right"] }, loopIndex: 0 },
    })));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    const progress = container.querySelector('input[aria-label="标准化演绎播放进度"]') as HTMLInputElement;
    expect(Number(progress.max)).toBeCloseTo(2_000 / 3, 0);
    expect(Number(progress.value)).toBe(0);
    await act(async () => (container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement).click());
    expect((audioMocks.playPerformanceNotes.mock.calls[0][0] as Array<{ scoreGroupId: string }>)
      .map((note) => note.scoreGroupId)).toEqual(["group-2", "group-3"]);
    expect(audioMocks.playPerformanceNotes.mock.calls[0][1]).toEqual({ startOffsetMs: 0 });
    await act(async () => root.unmount());
  });

  it("空闲时改变谱面选区不会取消点击或方向键触发的公共预听", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    audioMocks.cancelScheduledPlayback.mockClear();
    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      selection: { range: { startTick: 0, endTick: 0, hands: ["right"] }, loopIndex: 0 },
    })));
    expect(audioMocks.cancelScheduledPlayback).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("标准化演绎播放中改变选区会取消已经调度的音频", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(PerformanceWorkspace, workspaceProps())));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    await act(async () => (container.querySelector(".performance-practice-controls .practice-play-button") as HTMLButtonElement).click());
    audioMocks.cancelScheduledPlayback.mockClear();

    await act(async () => root.render(createElement(PerformanceWorkspace, {
      ...workspaceProps(),
      selectedIds: ["group-2"],
      selection: { range: { startTick: 240, endTick: 240, hands: ["right"] }, loopIndex: 0 },
    })));

    expect(audioMocks.cancelScheduledPlayback).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("演绎模式方向键选音后保留公共音符预听调度", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(InteractiveWorkspace)));
    await vi.waitFor(() => {
      expect(container.querySelector(".performance-workspace")?.getAttribute("data-reference-load-state")).toBe("ready");
    });
    audioMocks.cancelScheduledPlayback.mockClear();
    audioMocks.playGroups.mockClear();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(audioMocks.playGroups).toHaveBeenCalledTimes(1);
    expect(audioMocks.cancelScheduledPlayback).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
