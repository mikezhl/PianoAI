import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Focus } from "lucide-react";
import type { AnalysisSection, ScoreAnalysis, ScoreRange } from "../../analysis/types";
import {
  cancelScheduledPlayback,
  PERFORMANCE_PLAYBACK_START_DELAY_MS,
  playPerformanceNotes,
} from "../../lib/audio";
import { getSelectedGroups } from "../../lib/practice";
import { formatPlaybackTime } from "../../lib/playbackTiming";
import {
  scorePositionToTimelineTick,
  scorePositionToTick,
  scoreRangeToTickBounds,
  tickBoundsToScoreRange,
  tickToScorePosition,
  timelineTickToScorePosition,
} from "../../lib/scoreIdentity";
import {
  buildTempoProfile,
  interpolateScoreTickAtPerformanceTime,
  interpretationRangeTickBounds,
  interpolatePerformanceTime,
} from "../../performance/interpretation";
import { buildInterpretationPlaybackNotes } from "../../performance/interpretationPlayback";
import {
  buildReferencePerformanceSummary,
  getReferenceAnalysisCapabilities,
  type ReferencePerformanceSummary,
} from "../../performance/referenceAnalysis";
import {
  loadReferenceCatalogEntries,
  loadReferenceInterpretation,
} from "../../performance/referenceCatalog";
import { buildReferencePerformanceVisualization } from "../../performance/referenceVisualization";
import type { DynamicsScaleMode } from "../../performance/dynamicsScale";
import type {
  PerformancePlaybackNote,
  ReferenceInterpretation,
  ReferenceInterpretationCatalogEntry,
  ScoreIdentity,
} from "../../performance/types";
import type { Hand, NoteGroup, ScoreData, SelectionState } from "../../types";
import PracticeControls from "../PracticeControls";
import ScoreViewer from "../ScoreViewer";
import PerformanceMenu, { type PerformanceMenuOption } from "./PerformanceMenu";
import type { PerformanceScoreOverlayConfig } from "./PerformanceScoreOverlay";

type ReferenceLoadState = "idle" | "loading" | "ready" | "error";
type OpenMenu = "reference" | null;
type PlaybackMode = "score" | "standardized" | "original";
const EMPTY_PLAYBACK_TIMELINE = { originUs: 0, durationMs: 0 };
const EMPTY_GROUP_IDS: string[] = [];
const EMPTY_PRESSED_NOTES: number[] = [];
const PLAYBACK_UI_INTERVAL_MS = 33;
const DYNAMICS_SCALE_STORAGE_KEY = "pianoai.performance.dynamics-scale-mode";

function initialDynamicsScaleMode(): DynamicsScaleMode {
  try {
    return window.localStorage.getItem(DYNAMICS_SCALE_STORAGE_KEY) === "global" ? "global" : "local";
  } catch {
    return "local";
  }
}

interface PerformanceWorkspaceProps {
  score: ScoreData | null;
  scoreIdentity: ScoreIdentity | null;
  analysis: ScoreAnalysis | null;
  scoreZoom: number;
  allowBoxSelect: boolean;
  selectedIds: string[];
  selection: SelectionState;
  scorePlaybackActive: boolean;
  scorePlaybackGroups: NoteGroup[];
  scorePlaybackPositionMs: number;
  scorePlaybackDurationMs: number;
  onToggleScorePlayback: () => void;
  onSeekScorePlayback: (positionMs: number) => void;
  onStartScorePlaybackAt: (positionMs: number) => void;
  onScoreZoomLimitChange: (maxZoom: number) => void;
  onGroupSelect: (groupId: string, extend: boolean) => void;
  onBoxSelect: (groupIds: string[]) => void;
  onExpandSelectionToBothHands: () => void;
  onShrinkSelectionToHand: (hand: Hand) => void;
  onResizeSelectionBoundary: (edge: "start" | "end", tick: number) => void;
  onClearSelection: () => void;
  onDismissSelection: () => void;
}

function formatRange(range: ScoreRange): string {
  const start = range.start.measureIndex;
  const end = Math.max(start, range.end.measureIndex - 1);
  return start === end ? `m${start}` : `m${start}–${end}`;
}

function fallbackSection(range: ScoreRange, label: string): AnalysisSection {
  return {
    id: "performance-range",
    label,
    range,
    summary: "",
    confidence: "high",
    layer: "structure",
    kind: "theme",
    displayNumber: 1,
    tonality: "",
    understanding: "",
  };
}

function describeDurationTendency(durationRatio: number | undefined): string | null {
  if (durationRatio == null) return null;
  if (durationRatio >= 1.12) return "整体偏连奏";
  if (durationRatio <= 0.88) return "整体偏短奏";
  return "整体时值自然";
}

function describeTempoVariation(tempo: PerformanceScoreOverlayConfig["tempo"]): string | null {
  const values = tempo.flatMap((sample) =>
    sample.tempoMode === "free-time" || sample.normalizedTempoRatio == null
      ? []
      : [sample.normalizedTempoRatio],
  );
  if (values.length < 2) return null;
  const spread = Math.round((Math.max(...values) - Math.min(...values)) * 100);
  return spread < 4 ? "速度变化克制" : `速度跨度 ${spread}%`;
}

function buildPerformanceSummaryText(
  summary: ReferencePerformanceSummary,
  tempo: PerformanceScoreOverlayConfig["tempo"],
): string | null {
  const items = [
    summary.upperStaffBalance != null
      ? summary.upperStaffBalance > 0.06
        ? "右手更突出"
        : summary.upperStaffBalance < -0.06 ? "左手更突出" : "双手较均衡"
      : null,
    describeDurationTendency(summary.durationRatioMedian),
    summary.pedalDownRatio != null ? `踏板覆盖 ${Math.round(summary.pedalDownRatio * 100)}%` : null,
    describeTempoVariation(tempo),
  ].filter((item): item is string => item != null);
  return items.join(" · ") || null;
}

function buildPlaybackTimeline(notes: PerformancePlaybackNote[]) {
  if (notes.length === 0) return EMPTY_PLAYBACK_TIMELINE;
  const originUs = Math.min(...notes.map((note) => note.onsetUs));
  const endUs = Math.max(...notes.map((note) => note.offsetUs));
  return { originUs, durationMs: Math.max(0, (endUs - originUs) / 1000) };
}

interface PlaybackCursorFrame {
  tick: number;
  groupIds: string[];
}

function buildPlaybackCursorFrames(notes: PerformancePlaybackNote[]): PlaybackCursorFrame[] {
  const idsByTick = new Map<number, Set<string>>();
  for (const note of notes) {
    const ids = idsByTick.get(note.scoreTick) ?? new Set<string>();
    ids.add(note.scoreGroupId);
    idsByTick.set(note.scoreTick, ids);
  }
  return [...idsByTick]
    .map(([tick, groupIds]) => ({ tick, groupIds: [...groupIds] }))
    .sort((left, right) => left.tick - right.tick);
}

function cursorFrameAtTick(frames: PlaybackCursorFrame[], tick: number): PlaybackCursorFrame | null {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].tick <= tick) low = middle + 1;
    else high = middle;
  }
  return frames[Math.max(0, low - 1)] ?? null;
}

interface OriginalPlaybackWindow {
  startSeconds: number;
  endSeconds: number;
}

function buildOriginalPlaybackWindow(
  score: ScoreData,
  range: ScoreRange,
  reference: ReferenceInterpretation,
): OriginalPlaybackWindow | null {
  const { startTick, endTick } = interpretationRangeTickBounds(score, range, reference);
  const mappedStart = interpolatePerformanceTime(score, reference.timeMap, startTick)?.timeUs
    ?? reference.timeMap[0]?.timeUs;
  const mappedEnd = interpolatePerformanceTime(score, reference.timeMap, endTick)?.timeUs
    ?? reference.timeMap.at(-1)?.timeUs;
  if (mappedStart == null || mappedEnd == null) return null;
  const startUs = Math.max(0, Math.min(reference.audio.durationUs, mappedStart));
  const endUs = Math.max(startUs, Math.min(reference.audio.durationUs, mappedEnd));
  if (!reference.audio.url || endUs <= startUs) return null;
  return {
    startSeconds: startUs / 1_000_000,
    endSeconds: endUs / 1_000_000,
  };
}

async function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await new Promise<void>((resolve, reject) => {
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(audio.error ?? new Error("原始录音加载失败"));
    };
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("error", handleError);
    };
    audio.addEventListener("loadedmetadata", handleLoaded, { once: true });
    audio.addEventListener("error", handleError, { once: true });
    audio.load();
  });
}

export default function PerformanceWorkspace({
  score,
  scoreIdentity,
  analysis,
  scoreZoom,
  allowBoxSelect,
  selectedIds,
  selection,
  scorePlaybackActive,
  scorePlaybackGroups,
  scorePlaybackPositionMs,
  scorePlaybackDurationMs,
  onToggleScorePlayback,
  onSeekScorePlayback,
  onStartScorePlaybackAt,
  onScoreZoomLimitChange,
  onGroupSelect,
  onBoxSelect,
  onExpandSelectionToBothHands,
  onShrinkSelectionToHand,
  onResizeSelectionBoundary,
  onClearSelection,
  onDismissSelection,
}: PerformanceWorkspaceProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const originalPlaybackFrameRef = useRef<number | null>(null);
  const playbackSessionRef = useRef(0);
  const originalPlaybackSessionRef = useRef(0);
  const standardizedPlaybackActiveRef = useRef(false);
  const playbackStartedAtRef = useRef<number | null>(null);
  const playbackStartPositionRef = useRef(0);
  const playbackPositionRef = useRef(0);
  const playbackDurationRef = useRef(0);
  const playbackLastUiUpdateRef = useRef(0);
  const resumeAfterSeekRef = useRef(false);
  const resumeOriginalAfterSeekRef = useRef(false);
  const resumeScoreAfterSeekRef = useRef(false);
  const scoreSeekPositionRef = useRef(0);
  const referenceRestoreTickRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const [topbarTarget, setTopbarTarget] = useState<HTMLElement | null>(null);
  const [referenceEntries, setReferenceEntries] = useState<ReferenceInterpretationCatalogEntry[]>([]);
  const [selectedReference, setSelectedReference] = useState<ReferenceInterpretation | null>(null);
  const [catalogLoadState, setCatalogLoadState] = useState<ReferenceLoadState>("idle");
  const [interpretationLoadState, setInterpretationLoadState] = useState<ReferenceLoadState>("idle");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isOriginalPlaying, setIsOriginalPlaying] = useState(false);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("standardized");
  const [dynamicsScaleMode, setDynamicsScaleMode] = useState<DynamicsScaleMode>(initialDynamicsScaleMode);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  useEffect(() => {
    setTopbarTarget(document.getElementById("performance-topbar-controls"));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DYNAMICS_SCALE_STORAGE_KEY, dynamicsScaleMode);
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
  }, [dynamicsScaleMode]);

  const selectedGroups = useMemo(
    () => score ? getSelectedGroups(score, selection) : [],
    [score, selection],
  );
  const selectedStartGroup = selectedGroups.length === 1 ? selectedGroups[0] : null;
  const playbackTarget = useMemo(() => {
    if (!score) return null;
    const selectedRange = selection.range;
    if (selectedRange && selectedGroups.length > 1) {
      const endTick = selectedGroups.length > 0
        ? Math.max(...selectedGroups.map((group) => group.absoluteTick + Math.max(1, group.durationTicks)))
        : Math.min(score.totalTicks, selectedRange.endTick + 1);
      const range = tickBoundsToScoreRange(score, selectedRange.startTick, endTick);
      return { range, label: formatRange(range) };
    }
    return { range: tickBoundsToScoreRange(score, 0, score.totalTicks), label: "全曲" };
  }, [score, selectedGroups, selection.range]);
  const playbackRangeKey = playbackTarget ? JSON.stringify(playbackTarget.range) : "";
  const displaySections = useMemo<AnalysisSection[]>(() => {
    if (analysis?.sections.length) return analysis.sections;
    return playbackTarget ? [fallbackSection(playbackTarget.range, playbackTarget.label)] : [];
  }, [analysis, playbackTarget]);

  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    const controller = new AbortController();
    setReferenceEntries([]);
    setSelectedReference(null);
    setSelectedReferenceId(null);
    setReferenceError(null);
    if (!scoreIdentity) {
      setCatalogLoadState("idle");
      setInterpretationLoadState("idle");
      return () => controller.abort();
    }
    setCatalogLoadState("loading");
    setInterpretationLoadState("idle");
    void loadReferenceCatalogEntries(scoreIdentity, controller.signal)
      .then((items) => {
        setReferenceEntries(items);
        setSelectedReferenceId(items[0]?.interpretationId ?? null);
        setCatalogLoadState("ready");
        if (items.length === 0) setInterpretationLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setReferenceError(error instanceof Error ? error.message : "专业演绎加载失败");
        setCatalogLoadState("error");
        setInterpretationLoadState("error");
      });
    return () => controller.abort();
  }, [scoreIdentity]);

  const selectedReferenceEntry = useMemo(
    () => referenceEntries.find((reference) => reference.interpretationId === selectedReferenceId)
      ?? referenceEntries[0]
      ?? null,
    [referenceEntries, selectedReferenceId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setSelectedReference(null);
    if (!selectedReferenceEntry) {
      return () => controller.abort();
    }
    setReferenceError(null);
    setInterpretationLoadState("loading");
    void loadReferenceInterpretation(selectedReferenceEntry, controller.signal)
      .then((reference) => {
        setSelectedReference(reference);
        setInterpretationLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setReferenceError(error instanceof Error ? error.message : "专业演绎加载失败");
        setInterpretationLoadState("error");
      });
    return () => controller.abort();
  }, [selectedReferenceEntry]);
  const originalPlaybackWindow = useMemo(
    () => score && playbackTarget && selectedReference
      ? buildOriginalPlaybackWindow(score, playbackTarget.range, selectedReference)
      : null,
    [playbackTarget, score, selectedReference],
  );
  const capabilities = useMemo(
    () => selectedReference ? getReferenceAnalysisCapabilities(selectedReference) : null,
    [selectedReference],
  );

  const referenceOptions = useMemo<PerformanceMenuOption[]>(() => {
    if (referenceEntries.length === 0) {
      return [{
        value: "",
        label: catalogLoadState === "loading" ? "加载中…" : "暂无参考",
        disabled: true,
      }];
    }
    return referenceEntries.map((reference) => ({
      value: reference.interpretationId,
      label: reference.performerName,
      sourceUrl: reference.source.url,
      sourceTitle: reference.source.title,
    }));
  }, [catalogLoadState, referenceEntries]);
  const referenceTempo = useMemo(
    () => score && selectedReference
      ? buildTempoProfile(score, selectedReference.timeMap, analysis)
      : [],
    [analysis, score, selectedReference],
  );
  const performanceSummary = useMemo(() => {
    if (!score || !playbackTarget || !selectedReference) return null;
    const summary = buildReferencePerformanceSummary(score, playbackTarget.range, selectedReference);
    const label = `${playbackTarget.label}演绎`;
    const detail = buildPerformanceSummaryText(summary, referenceTempo);
    if (!detail) return null;
    return { label, detail, title: `${label}摘要：${detail}` };
  }, [playbackTarget, referenceTempo, score, selectedReference]);
  const detailedVisualization = useMemo(
    () => score && selectedReference
      ? buildReferencePerformanceVisualization(score, selectedReference)
      : null,
    [score, selectedReference],
  );
  const standardizedNotes = useMemo(
    () => score && playbackTarget && selectedReference
      ? buildInterpretationPlaybackNotes(score, playbackTarget.range, selectedReference)
      : [],
    [playbackTarget, score, selectedReference],
  );
  const playbackTimeline = useMemo(() => buildPlaybackTimeline(standardizedNotes), [standardizedNotes]);
  const playbackTickBounds = useMemo(
    () => score && playbackTarget
      ? scoreRangeToTickBounds(score, playbackTarget.range)
      : null,
    [playbackTarget, score],
  );
  const playbackCursorFrames = useMemo(
    () => buildPlaybackCursorFrames(standardizedNotes),
    [standardizedNotes],
  );
  const selectionPlaybackPositionMs = useMemo(() => {
    if (!selection.range) return 0;
    if (!selectedStartGroup || standardizedNotes.length === 0) return null;
    const groupNotes = standardizedNotes.filter((note) => note.scoreGroupId === selectedStartGroup.id);
    if (groupNotes.length === 0) return null;
    const firstGroupTick = Math.min(...groupNotes.map((note) => note.scoreTick));
    const firstGroupOnsetUs = Math.min(
      ...groupNotes
        .filter((note) => note.scoreTick === firstGroupTick)
        .map((note) => note.onsetUs),
    );
    return Math.max(0, (firstGroupOnsetUs - playbackTimeline.originUs) / 1000);
  }, [playbackTimeline.originUs, selectedStartGroup, selection.range, standardizedNotes]);
  playbackDurationRef.current = playbackTimeline.durationMs;
  scoreSeekPositionRef.current = scorePlaybackPositionMs;
  const transportPositionMs = playbackMode === "score" ? scorePlaybackPositionMs : playbackPositionMs;
  const transportDurationMs = playbackMode === "score" ? scorePlaybackDurationMs : playbackTimeline.durationMs;
  const playbackProgress = transportDurationMs > 0
    ? Math.min(1, transportPositionMs / transportDurationMs)
    : 0;
  const transportLabel = playbackMode === "score"
    ? "机械原谱"
    : playbackMode === "original" ? "原始录音" : "标准化演绎";
  const performancePositionAtTick = useCallback((tick: number) => {
    if (!score || !selectedReference || !playbackTickBounds || playbackTimeline.durationMs <= 0) return 0;
    if (tick <= playbackTickBounds.startTick) return 0;
    if (tick >= playbackTickBounds.endTick) return playbackTimeline.durationMs;
    const writtenPosition = tickToScorePosition(score, tick);
    const timelineTick = scorePositionToTimelineTick(score, {
      ...writtenPosition,
      playbackOccurrence: 0,
    });
    const mapped = interpolatePerformanceTime(score, selectedReference.timeMap, timelineTick);
    return Math.max(0, Math.min(
      playbackTimeline.durationMs,
      ((mapped?.timeUs ?? playbackTimeline.originUs) - playbackTimeline.originUs) / 1000,
    ));
  }, [playbackTickBounds, playbackTimeline.durationMs, playbackTimeline.originUs, score, selectedReference]);
  const performanceTickAtPosition = useCallback((positionMs: number) => {
    if (!score || !selectedReference || !playbackTickBounds || playbackTimeline.durationMs <= 0) return null;
    if (positionMs <= 0) return playbackTickBounds.startTick;
    if (positionMs >= playbackTimeline.durationMs) return playbackTickBounds.endTick;
    const timelineTick = interpolateScoreTickAtPerformanceTime(
      score,
      selectedReference.timeMap,
      playbackTimeline.originUs + positionMs * 1000,
    );
    if (timelineTick == null) return null;
    const writtenPosition = timelineTickToScorePosition(score, timelineTick);
    const writtenTick = scorePositionToTick(score, writtenPosition);
    return Math.max(playbackTickBounds.startTick, Math.min(playbackTickBounds.endTick, writtenTick));
  }, [playbackTickBounds, playbackTimeline.durationMs, playbackTimeline.originUs, score, selectedReference]);
  const scorePositionAtTick = useCallback((tick: number) => {
    if (!playbackTickBounds || scorePlaybackDurationMs <= 0) return 0;
    const tickDuration = playbackTickBounds.endTick - playbackTickBounds.startTick;
    if (tickDuration <= 0) return 0;
    const ratio = (tick - playbackTickBounds.startTick) / tickDuration;
    return Math.max(0, Math.min(scorePlaybackDurationMs, ratio * scorePlaybackDurationMs));
  }, [playbackTickBounds, scorePlaybackDurationMs]);
  const scoreTickAtPosition = useCallback((positionMs: number) => {
    if (!playbackTickBounds || scorePlaybackDurationMs <= 0) return null;
    const ratio = Math.max(0, Math.min(1, positionMs / scorePlaybackDurationMs));
    return playbackTickBounds.startTick
      + ratio * (playbackTickBounds.endTick - playbackTickBounds.startTick);
  }, [playbackTickBounds, scorePlaybackDurationMs]);
  const standardizedPlaybackDescription = selectedReference?.generation.status === "automatically-validated"
    ? "AI 自动生成的标准化演绎"
    : "自动段落时间图与乐谱回退；低置信度单音不会直接播放";
  const playbackScoreTick = useMemo(() => {
    if (!score || !selectedReference) return null;
    const currentUs = playbackTimeline.originUs + playbackPositionMs * 1000;
    return interpolateScoreTickAtPerformanceTime(score, selectedReference.timeMap, currentUs);
  }, [playbackPositionMs, playbackTimeline.originUs, score, selectedReference]);
  const playbackCursorFrame = useMemo(
    () => playbackScoreTick == null ? null : cursorFrameAtTick(playbackCursorFrames, playbackScoreTick),
    [playbackCursorFrames, playbackScoreTick],
  );
  const playbackActiveGroups = useMemo(() => {
    if (!score || !playbackCursorFrame) return [];
    const activeIds = new Set(playbackCursorFrame.groupIds);
    return score.noteGroups.filter((group) => activeIds.has(group.id));
  }, [playbackCursorFrame, score]);
  const cancelOriginalPlaybackFrame = useCallback(() => {
    if (originalPlaybackFrameRef.current != null) cancelAnimationFrame(originalPlaybackFrameRef.current);
    originalPlaybackFrameRef.current = null;
  }, []);

  const stopOriginalPlayback = useCallback(() => {
    originalPlaybackSessionRef.current += 1;
    cancelOriginalPlaybackFrame();
    originalAudioRef.current?.pause();
    setIsOriginalPlaying(false);
  }, [cancelOriginalPlaybackFrame]);

  const updatePlaybackPosition = useCallback((positionMs: number) => {
    const nextPosition = Math.max(0, Math.min(playbackDurationRef.current, positionMs));
    playbackPositionRef.current = nextPosition;
    setPlaybackPositionMs(nextPosition);
  }, []);

  const pauseOriginalPlayback = useCallback(() => {
    const audio = originalAudioRef.current;
    if (audio && originalPlaybackWindow) {
      updatePlaybackPosition(
        Math.max(0, (audio.currentTime * 1_000_000 - playbackTimeline.originUs) / 1000),
      );
    }
    stopOriginalPlayback();
  }, [originalPlaybackWindow, playbackTimeline.originUs, stopOriginalPlayback, updatePlaybackPosition]);

  const cancelPlaybackFrame = useCallback(() => {
    if (playbackFrameRef.current != null) cancelAnimationFrame(playbackFrameRef.current);
    playbackFrameRef.current = null;
  }, []);

  const pausePlayback = useCallback(() => {
    standardizedPlaybackActiveRef.current = false;
    playbackSessionRef.current += 1;
    cancelScheduledPlayback();
    cancelPlaybackFrame();
    if (playbackStartedAtRef.current != null) {
      updatePlaybackPosition(
        playbackStartPositionRef.current
        + Math.max(0, performance.now() - playbackStartedAtRef.current),
      );
    }
    playbackStartedAtRef.current = null;
    setIsPlaying(false);
  }, [cancelPlaybackFrame, updatePlaybackPosition]);

  const resetPlaybackAt = useCallback((positionMs: number) => {
    const wasPlaying = standardizedPlaybackActiveRef.current;
    standardizedPlaybackActiveRef.current = false;
    playbackSessionRef.current += 1;
    if (wasPlaying) cancelScheduledPlayback();
    cancelPlaybackFrame();
    playbackStartedAtRef.current = null;
    setIsPlaying(false);
    stopOriginalPlayback();
    updatePlaybackPosition(positionMs);
  }, [cancelPlaybackFrame, stopOriginalPlayback, updatePlaybackPosition]);

  useEffect(() => () => {
    playbackSessionRef.current += 1;
    originalPlaybackSessionRef.current += 1;
    cancelScheduledPlayback();
    cancelPlaybackFrame();
    cancelOriginalPlaybackFrame();
    originalAudioRef.current?.pause();
  }, [cancelOriginalPlaybackFrame, cancelPlaybackFrame]);
  useEffect(() => {
    resetPlaybackAt(0);
  }, [playbackRangeKey, resetPlaybackAt]);
  useEffect(() => {
    if (selectionPlaybackPositionMs == null) return;
    resetPlaybackAt(selectionPlaybackPositionMs);
  }, [resetPlaybackAt, selectionPlaybackPositionMs]);

  const startPlaybackAt = useCallback(async (requestedPositionMs: number, stopScore = true) => {
    if (standardizedNotes.length === 0 || playbackTimeline.durationMs <= 0) return;
    setPlaybackMode("standardized");
    if (stopScore && scorePlaybackActive) onToggleScorePlayback();
    stopOriginalPlayback();
    const startPositionMs = requestedPositionMs >= playbackTimeline.durationMs - 1
      ? 0
      : Math.max(0, Math.min(playbackTimeline.durationMs, requestedPositionMs));
    playbackSessionRef.current += 1;
    const session = playbackSessionRef.current;
    standardizedPlaybackActiveRef.current = true;
    cancelScheduledPlayback();
    cancelPlaybackFrame();
    playbackStartedAtRef.current = null;
    playbackStartPositionRef.current = startPositionMs;
    playbackLastUiUpdateRef.current = 0;
    updatePlaybackPosition(startPositionMs);
    setIsPlaying(true);

    const remainingDurationMs = await playPerformanceNotes(standardizedNotes, {
      startOffsetMs: startPositionMs,
    });
    if (playbackSessionRef.current !== session) return;
    if (remainingDurationMs <= 0) {
      standardizedPlaybackActiveRef.current = false;
      setIsPlaying(false);
      return;
    }

    playbackStartedAtRef.current = performance.now() + PERFORMANCE_PLAYBACK_START_DELAY_MS;
    const advance = (now: number) => {
      if (playbackSessionRef.current !== session || playbackStartedAtRef.current == null) return;
      const nextPosition = playbackStartPositionRef.current
        + Math.max(0, now - playbackStartedAtRef.current);
      playbackPositionRef.current = Math.min(playbackTimeline.durationMs, nextPosition);
      if (
        now - playbackLastUiUpdateRef.current >= PLAYBACK_UI_INTERVAL_MS
        || nextPosition >= playbackTimeline.durationMs
      ) {
        playbackLastUiUpdateRef.current = now;
        setPlaybackPositionMs(playbackPositionRef.current);
      }
      if (nextPosition >= playbackTimeline.durationMs) {
        standardizedPlaybackActiveRef.current = false;
        playbackFrameRef.current = null;
        playbackStartedAtRef.current = null;
        setIsPlaying(false);
        return;
      }
      playbackFrameRef.current = requestAnimationFrame(advance);
    };
    playbackFrameRef.current = requestAnimationFrame(advance);
  }, [cancelPlaybackFrame, onToggleScorePlayback, playbackTimeline.durationMs, scorePlaybackActive, standardizedNotes, stopOriginalPlayback, updatePlaybackPosition]);

  const startOriginalPlaybackAt = useCallback(async (requestedPositionMs: number, stopScore = true) => {
    const audio = originalAudioRef.current;
    if (!audio || !originalPlaybackWindow) return;
    setPlaybackMode("original");
    if (stopScore && scorePlaybackActive) onToggleScorePlayback();
    pausePlayback();
    originalPlaybackSessionRef.current += 1;
    const session = originalPlaybackSessionRef.current;
    cancelOriginalPlaybackFrame();
    const startPositionMs = requestedPositionMs >= playbackTimeline.durationMs - 1
      ? 0
      : Math.max(0, Math.min(playbackTimeline.durationMs, requestedPositionMs));
    updatePlaybackPosition(startPositionMs);
    playbackLastUiUpdateRef.current = 0;
    try {
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        await waitForAudioMetadata(audio);
      }
      if (originalPlaybackSessionRef.current !== session) return;
      const requestedSeconds = (playbackTimeline.originUs + startPositionMs * 1000) / 1_000_000;
      audio.currentTime = Math.max(
        originalPlaybackWindow.startSeconds,
        Math.min(originalPlaybackWindow.endSeconds, requestedSeconds),
      );
      const playPromise = audio.play();
      await playPromise;
      if (originalPlaybackSessionRef.current !== session) return;
      setIsOriginalPlaying(true);
      const advanceOriginal = (now: number) => {
        if (originalPlaybackSessionRef.current !== session || audio.paused) {
          originalPlaybackFrameRef.current = null;
          return;
        }
        if (audio.currentTime >= originalPlaybackWindow.endSeconds) {
          stopOriginalPlayback();
          updatePlaybackPosition(playbackTimeline.durationMs);
          return;
        }
        if (now - playbackLastUiUpdateRef.current >= PLAYBACK_UI_INTERVAL_MS) {
          playbackLastUiUpdateRef.current = now;
          updatePlaybackPosition(
            Math.max(0, (audio.currentTime * 1_000_000 - playbackTimeline.originUs) / 1000),
          );
        }
        originalPlaybackFrameRef.current = requestAnimationFrame(advanceOriginal);
      };
      originalPlaybackFrameRef.current = requestAnimationFrame(advanceOriginal);
    } catch (error) {
      if (originalPlaybackSessionRef.current !== session) return;
      setIsOriginalPlaying(false);
      console.error("Failed to play original reference audio", error);
    }
  }, [cancelOriginalPlaybackFrame, onToggleScorePlayback, originalPlaybackWindow, pausePlayback, playbackTimeline.durationMs, playbackTimeline.originUs, scorePlaybackActive, stopOriginalPlayback, updatePlaybackPosition]);

  const selectedModeIsPlaying = playbackMode === "score"
    ? scorePlaybackActive
    : playbackMode === "original" ? isOriginalPlaying : isPlaying;

  const currentScoreTick = useCallback(() => {
    if (playbackMode === "score") return scoreTickAtPosition(scorePlaybackPositionMs);
    const audio = originalAudioRef.current;
    const positionMs = playbackMode === "original" && audio && originalPlaybackWindow
      ? Math.max(0, (audio.currentTime * 1_000_000 - playbackTimeline.originUs) / 1000)
      : playbackPositionRef.current;
    return performanceTickAtPosition(positionMs);
  }, [
    originalPlaybackWindow,
    performanceTickAtPosition,
    playbackMode,
    playbackTimeline.originUs,
    scorePlaybackPositionMs,
    scoreTickAtPosition,
  ]);

  const selectPlaybackMode = useCallback((nextMode: PlaybackMode) => {
    if (nextMode === playbackMode) return;
    const wasPlaying = selectedModeIsPlaying;

    if (playbackMode === "score" && scorePlaybackActive) onToggleScorePlayback();
    if (playbackMode === "standardized" && isPlaying) pausePlayback();
    if (playbackMode === "original" && isOriginalPlaying) pauseOriginalPlayback();
    const scoreTick = currentScoreTick();

    const performancePosition = scoreTick == null
      ? playbackPositionRef.current
      : performancePositionAtTick(scoreTick);
    const scorePosition = scoreTick == null
      ? scorePlaybackPositionMs
      : scorePositionAtTick(scoreTick);
    setPlaybackMode(nextMode);

    if (nextMode === "score") {
      if (wasPlaying) onStartScorePlaybackAt(scorePosition);
      else onSeekScorePlayback(scorePosition);
      return;
    }

    updatePlaybackPosition(performancePosition);
    if (!wasPlaying) return;
    if (nextMode === "standardized") void startPlaybackAt(performancePosition, false);
    else void startOriginalPlaybackAt(performancePosition, false);
  }, [
    currentScoreTick,
    isOriginalPlaying,
    isPlaying,
    onSeekScorePlayback,
    onStartScorePlaybackAt,
    onToggleScorePlayback,
    pausePlayback,
    performancePositionAtTick,
    playbackMode,
    scorePlaybackActive,
    scorePlaybackPositionMs,
    scorePositionAtTick,
    selectedModeIsPlaying,
    startOriginalPlaybackAt,
    startPlaybackAt,
    pauseOriginalPlayback,
    updatePlaybackPosition,
  ]);

  const toggleSelectedPlayback = useCallback(() => {
    if (playbackMode === "score") {
      if (scorePlaybackActive) onToggleScorePlayback();
      else onStartScorePlaybackAt(scorePlaybackPositionMs);
      return;
    }
    if (playbackMode === "original") {
      if (isOriginalPlaying) pauseOriginalPlayback();
      else void startOriginalPlaybackAt(playbackPositionRef.current);
      return;
    }
    if (isPlaying) pausePlayback();
    else void startPlaybackAt(playbackPositionRef.current);
  }, [
    isOriginalPlaying,
    isPlaying,
    onStartScorePlaybackAt,
    onToggleScorePlayback,
    pausePlayback,
    playbackMode,
    scorePlaybackActive,
    scorePlaybackPositionMs,
    startOriginalPlaybackAt,
    startPlaybackAt,
    pauseOriginalPlayback,
  ]);

  const beginProgressSeek = useCallback(() => {
    if (seekingRef.current) return;
    seekingRef.current = true;
    resumeScoreAfterSeekRef.current = playbackMode === "score" && scorePlaybackActive;
    resumeAfterSeekRef.current = playbackMode === "standardized" && isPlaying;
    resumeOriginalAfterSeekRef.current = playbackMode === "original" && isOriginalPlaying;
    if (resumeScoreAfterSeekRef.current) onToggleScorePlayback();
    if (resumeAfterSeekRef.current) pausePlayback();
    if (resumeOriginalAfterSeekRef.current) pauseOriginalPlayback();
  }, [isOriginalPlaying, isPlaying, onToggleScorePlayback, pauseOriginalPlayback, pausePlayback, playbackMode, scorePlaybackActive]);

  const commitProgressSeek = useCallback(() => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    const shouldResume = resumeAfterSeekRef.current;
    const shouldResumeOriginal = resumeOriginalAfterSeekRef.current;
    const shouldResumeScore = resumeScoreAfterSeekRef.current;
    resumeAfterSeekRef.current = false;
    resumeOriginalAfterSeekRef.current = false;
    resumeScoreAfterSeekRef.current = false;
    if (shouldResumeScore) onStartScorePlaybackAt(scoreSeekPositionRef.current);
    else if (shouldResume) void startPlaybackAt(playbackPositionRef.current);
    else if (shouldResumeOriginal) void startOriginalPlaybackAt(playbackPositionRef.current);
  }, [onStartScorePlaybackAt, startOriginalPlaybackAt, startPlaybackAt]);

  const updateTransportPosition = useCallback((positionMs: number) => {
    if (playbackMode === "score") {
      scoreSeekPositionRef.current = positionMs;
      onSeekScorePlayback(positionMs);
    } else {
      updatePlaybackPosition(positionMs);
    }
  }, [onSeekScorePlayback, playbackMode, updatePlaybackPosition]);

  useEffect(() => {
    const tick = referenceRestoreTickRef.current;
    if (tick == null || playbackTimeline.durationMs <= 0) return;
    updatePlaybackPosition(performancePositionAtTick(tick));
    referenceRestoreTickRef.current = null;
  }, [performancePositionAtTick, playbackTimeline.durationMs, selectedReference, updatePlaybackPosition]);

  const showOverlay = Boolean(score && capabilities && Object.values(capabilities).some(Boolean));
  const performanceOverlay = useMemo<PerformanceScoreOverlayConfig | null>(() => score && capabilities && showOverlay ? {
    capabilities,
    dynamicsScaleMode,
    tempo: referenceTempo,
    sections: displaySections,
    visualization: detailedVisualization,
  } : null, [
    detailedVisualization,
    dynamicsScaleMode,
    displaySections,
    capabilities,
    referenceTempo,
    score,
    showOverlay,
  ]);

  const topbarControls = (
    <div className="performance-topbar-controls" ref={toolbarRef}>
      <PerformanceMenu
        ariaLabel="专业演绎"
        value={selectedReferenceId ?? ""}
        options={referenceOptions}
        open={openMenu === "reference"}
        disabled={catalogLoadState === "loading" || referenceEntries.length === 0}
        onToggle={() => setOpenMenu((current) => current === "reference" ? null : "reference")}
        onSelect={(value) => {
          if (playbackMode === "score" && scorePlaybackActive) onToggleScorePlayback();
          if (playbackMode === "standardized" && isPlaying) pausePlayback();
          if (playbackMode === "original") pauseOriginalPlayback();
          referenceRestoreTickRef.current = currentScoreTick();
          setSelectedReferenceId(value);
          setOpenMenu(null);
        }}
      />
    </div>
  );

  return (
    <>
      {topbarTarget ? createPortal(topbarControls, topbarTarget) : null}

      <section
        className="performance-workspace"
        aria-label="演绎模式"
        data-score-id={scoreIdentity?.scoreId ?? ""}
        data-source-hash={scoreIdentity?.sourceHash ?? ""}
        data-reference-count={referenceEntries.length}
        data-reference-load-state={interpretationLoadState}
        data-reference-error={referenceError ?? ""}
        data-reference-alignment-status={selectedReference?.generation.status ?? ""}
      >
        <div className="performance-score">
          <ScoreViewer
            score={score}
            scoreZoom={scoreZoom}
            showScrollProgress={false}
            onScoreZoomLimitChange={onScoreZoomLimitChange}
            allowBoxSelect={allowBoxSelect}
            activeGroups={scorePlaybackActive ? scorePlaybackGroups : playbackActiveGroups}
            followActive={scorePlaybackActive || isPlaying || isOriginalPlaying}
            showActiveCursor
            performanceOverlay={performanceOverlay}
            selectedIds={selectedIds}
            loopGroupIds={EMPTY_GROUP_IDS}
            pressedNotes={EMPTY_PRESSED_NOTES}
            onGroupSelect={onGroupSelect}
            onBoxSelect={onBoxSelect}
            onExpandSelectionToBothHands={onExpandSelectionToBothHands}
            onShrinkSelectionToHand={onShrinkSelectionToHand}
            onResizeSelectionBoundary={onResizeSelectionBoundary}
            onClearSelection={onClearSelection}
            onDismissSelection={onDismissSelection}
          />
        </div>

        {selectedReference?.audio.url ? (
          <audio
            ref={originalAudioRef}
            src={selectedReference.audio.url}
            preload="metadata"
            hidden
            onTimeUpdate={(event) => {
              if (!originalPlaybackWindow) return;
              const audio = event.currentTarget;
              if (audio.currentTime >= originalPlaybackWindow.endSeconds) {
                audio.pause();
                setIsOriginalPlaying(false);
                updatePlaybackPosition(playbackTimeline.durationMs);
                return;
              }
              updatePlaybackPosition(
                Math.max(0, (audio.currentTime * 1_000_000 - playbackTimeline.originUs) / 1000),
              );
            }}
            onPause={() => {
              cancelOriginalPlaybackFrame();
              setIsOriginalPlaying(false);
            }}
            onPlay={() => setIsOriginalPlaying(true)}
            onEnded={() => {
              originalPlaybackSessionRef.current += 1;
              cancelOriginalPlaybackFrame();
              setIsOriginalPlaying(false);
              if (originalPlaybackWindow) updatePlaybackPosition(playbackTimeline.durationMs);
            }}
          />
        ) : null}

        <footer className="performance-playback-dock" aria-label="演绎播放控制">
          <div className="performance-playback-actions">
            <div className="performance-playback-source-switch" role="group" aria-label="播放模式">
              <button
                type="button"
                className={`performance-playback-mode-button ${playbackMode === "score" ? "active" : ""}`.trim()}
                onClick={() => selectPlaybackMode("score")}
                disabled={!score}
                aria-label="选择机械原谱"
                aria-pressed={playbackMode === "score"}
                title="机械原谱"
              >
                机械原谱
              </button>
              <button
                type="button"
                className={`performance-playback-mode-button ${playbackMode === "standardized" ? "active" : ""}`.trim()}
                onClick={() => selectPlaybackMode("standardized")}
                disabled={playbackTimeline.durationMs <= 0}
                aria-label="选择标准化演绎"
                aria-pressed={playbackMode === "standardized"}
                title={standardizedPlaybackDescription}
              >
                标准化演绎
              </button>
              <button
                type="button"
                className={`performance-playback-mode-button ${playbackMode === "original" ? "active" : ""}`.trim()}
                onClick={() => selectPlaybackMode("original")}
                disabled={!originalPlaybackWindow}
                aria-label="选择原始录音"
                aria-pressed={playbackMode === "original"}
                title="当前演奏者的原始录音"
              >
                原始录音
              </button>
            </div>
            <PracticeControls
              className="performance-practice-controls"
              ariaLabel="演绎播放"
              isPlaying={selectedModeIsPlaying}
              followLeft={false}
              followRight={false}
              showHands={false}
              showStepControls={false}
              playDisabled={transportDurationMs <= 0}
              playAriaLabel={`${selectedModeIsPlaying ? "暂停" : "播放"}${transportLabel}`}
              playTitle={`${selectedModeIsPlaying ? "暂停" : "播放"}${transportLabel}`}
              onTogglePlay={toggleSelectedPlayback}
            />
            <div className="performance-playback-secondary">
              <button
                type="button"
                className={`performance-dynamics-scale-toggle ${dynamicsScaleMode === "local" ? "active" : ""}`.trim()}
                onClick={() => setDynamicsScaleMode((current) => current === "local" ? "global" : "local")}
                disabled={!capabilities?.dynamics}
                aria-label="Local dynamics scale"
                aria-pressed={dynamicsScaleMode === "local"}
                title={capabilities?.dynamics ? `Local dynamics scale: ${dynamicsScaleMode === "local" ? "On" : "Off"}` : "Dynamics are unavailable"}
              >
                <Focus size={20} strokeWidth={2.25} aria-hidden="true" />
              </button>
              {performanceSummary ? (
                <output
                  className="performance-playback-context interpretation"
                  aria-label="参考演奏摘要"
                  title={performanceSummary.title}
                >
                  <span className="performance-summary-label">
                    <b>{performanceSummary.label}</b>
                  </span>
                  <span className="performance-summary-detail">{performanceSummary.detail}</span>
                </output>
              ) : null}
            </div>
          </div>

          <div className="playback-progress-row performance-playback-progress">
            <time className="playback-progress-time" aria-label={`当前时间 ${formatPlaybackTime(transportPositionMs)}`}>
              {formatPlaybackTime(transportPositionMs)}
            </time>
            <div className="score-scroll-progress">
              <span className="score-scroll-progress-track" aria-hidden="true">
                <span className="score-scroll-progress-fill" style={{ width: `${playbackProgress * 100}%` }} />
                <span className="score-scroll-progress-thumb" style={{ left: `${playbackProgress * 100}%` }} />
              </span>
              <input
                type="range"
                className="performance-playback-range"
                min={0}
                max={Math.max(1, transportDurationMs)}
                step={10}
                value={Math.min(transportPositionMs, Math.max(1, transportDurationMs))}
                disabled={transportDurationMs <= 0}
                aria-label={`${transportLabel}播放进度`}
                aria-valuetext={`${formatPlaybackTime(transportPositionMs)} / ${formatPlaybackTime(transportDurationMs)}`}
                title={`${formatPlaybackTime(transportPositionMs)} / ${formatPlaybackTime(transportDurationMs)}`}
                onChange={(event) => updateTransportPosition(Number(event.target.value))}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  beginProgressSeek();
                }}
                onPointerUp={commitProgressSeek}
                onPointerCancel={commitProgressSeek}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
                    beginProgressSeek();
                  }
                }}
                onKeyUp={commitProgressSeek}
              />
            </div>
            <time className="playback-progress-time" aria-label={`总时长 ${formatPlaybackTime(transportDurationMs)}`}>
              {formatPlaybackTime(transportDurationMs)}
            </time>
          </div>
        </footer>
      </section>
    </>
  );
}
