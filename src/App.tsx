import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import PianoKeyboard from "./components/PianoKeyboard";
import PracticeControls from "./components/PracticeControls";
import ScoreViewer from "./components/ScoreViewer";
import TopBar from "./components/TopBar";
import PerformanceWorkspace from "./components/performance/PerformanceWorkspace";
import AnalysisWorkspace, { type AnalysisLoadState } from "./components/analysis/AnalysisWorkspace";
import type { AppMode, ScoreAnalysis } from "./analysis/types";
import {
  cancelScheduledPlayback,
  handleMidiMonitorEvent,
  playGroups,
  playMidiNotes,
  resetMidiMonitor,
} from "./lib/audio";
import { loadAnalysis } from "./lib/analysis/loadAnalysis";
import { readScoreXmlFromFile, readScoreXmlFromUrl } from "./lib/fileImport";
import {
  getGroupsAtTick,
  getStepTicks,
  groupsContainAllPressed,
  parseMusicXml,
} from "./lib/musicXml";
import { useMidi } from "./lib/midi";
import { sha256Text } from "./lib/scoreIdentity";
import {
  buildLoopSteps,
  getGroupMidis,
  handEnabled,
} from "./lib/practice";
import {
  clampPlaybackBpm,
  DEFAULT_PLAYBACK_BPM,
  formatPlaybackTime,
  ticksToMilliseconds,
} from "./lib/playbackTiming";
import { clampScoreZoom, floorScoreZoomToStep, MAX_SCORE_ZOOM, MIN_SCORE_ZOOM } from "./lib/scoreZoom";
import { Hand, ScoreData, SelectionState } from "./types";
import type { ScoreIdentity } from "./performance/types";
import useScoreInteraction from "./hooks/useScoreInteraction";
import { MUSICXML_LIBRARY, type MusicXmlLibraryItem } from "virtual:musicxml-library";

function playbackDelayMs(durationTicks: number, playbackBpm: number): number {
  return Math.max(1, ticksToMilliseconds(durationTicks, playbackBpm));
}

type AppLayoutMode = "natural-long-edge" | "rotated-long-edge";
type AppSizeClass = "desktop" | "compact" | "regular";

interface ViewportProfile {
  layoutMode: AppLayoutMode;
  sizeClass: AppSizeClass;
  hasCoarsePointer: boolean;
  hasFinePointer: boolean;
  allowBoxSelect: boolean;
  longEdge: number;
  shortEdge: number;
}

function queryMedia(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function getViewportProfile(): ViewportProfile {
  const viewport = typeof window !== "undefined" ? window.visualViewport : null;
  const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const isPortrait = height > width;
  const hasFinePointer = queryMedia("(any-pointer: fine)") || queryMedia("(pointer: fine)");
  const hasCoarsePointer =
    queryMedia("(any-pointer: coarse)") || queryMedia("(pointer: coarse)") || navigator.maxTouchPoints > 0;
  const sizeClass: AppSizeClass =
    shortEdge < 700 ? "compact" : (hasCoarsePointer || isPortrait) && shortEdge < 1100 ? "regular" : "desktop";

  return {
    layoutMode: isPortrait ? "rotated-long-edge" : "natural-long-edge",
    sizeClass,
    hasCoarsePointer,
    hasFinePointer,
    allowBoxSelect: hasFinePointer,
    longEdge,
    shortEdge,
  };
}

function useViewportProfile(): ViewportProfile {
  const [profile, setProfile] = useState(getViewportProfile);

  useEffect(() => {
    const updateProfile = () => setProfile(getViewportProfile());
    const mediaQueries = [
      window.matchMedia("(any-pointer: fine)"),
      window.matchMedia("(any-pointer: coarse)"),
      window.matchMedia("(pointer: fine)"),
      window.matchMedia("(pointer: coarse)"),
    ];

    window.addEventListener("resize", updateProfile);
    window.addEventListener("orientationchange", updateProfile);
    window.visualViewport?.addEventListener("resize", updateProfile);
    mediaQueries.forEach((query) => query.addEventListener("change", updateProfile));
    updateProfile();

    return () => {
      window.removeEventListener("resize", updateProfile);
      window.removeEventListener("orientationchange", updateProfile);
      window.visualViewport?.removeEventListener("resize", updateProfile);
      mediaQueries.forEach((query) => query.removeEventListener("change", updateProfile));
    };
  }, []);

  return profile;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scoreZoomControlRef = useRef<HTMLDivElement | null>(null);
  const tempoControlRef = useRef<HTMLDivElement | null>(null);
  const libraryControlRef = useRef<HTMLDivElement | null>(null);
  const midiControlRef = useRef<HTMLDivElement | null>(null);
  const lastConsumedInputEventRef = useRef(0);
  const pointerPressedNotesRef = useRef<Set<number>>(new Set());
  const scoreLoadSessionRef = useRef(0);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [scoreIdentity, setScoreIdentity] = useState<ScoreIdentity | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("practice");
  const [analysis, setAnalysis] = useState<ScoreAnalysis | null>(null);
  const [analysisLoadState, setAnalysisLoadState] = useState<AnalysisLoadState>("idle");
  const [analysisLoadError, setAnalysisLoadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scorePlaybackSeeked, setScorePlaybackSeeked] = useState(false);
  const [followLeft, setFollowLeft] = useState(false);
  const [followRight, setFollowRight] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [playbackBpm, setPlaybackBpm] = useState(DEFAULT_PLAYBACK_BPM);
  const [tempoPanelOpen, setTempoPanelOpen] = useState(false);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false);
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);
  const [midiPanelOpen, setMidiPanelOpen] = useState(false);
  const [pointerPressedNotes, setPointerPressedNotes] = useState<number[]>([]);
  const [pointerInputEventId, setPointerInputEventId] = useState(0);
  const [selection, setSelection] = useState<SelectionState>({
    range: null,
    loopIndex: 0,
  });
  const viewportProfile = useViewportProfile();
  const selectedLibraryItem = useMemo(
    () => MUSICXML_LIBRARY.find((item) => item.id === selectedLibraryItemId) ?? null,
    [selectedLibraryItemId],
  );
  const { midi, selectedInputName, requestAccess, selectInput, subscribeRawMessages } = useMidi();

  const appShellStyle = useMemo(
    () => ({
      "--viewport-long-edge": `${viewportProfile.longEdge}px`,
      "--viewport-short-edge": `${viewportProfile.shortEdge}px`,
    }) as CSSProperties,
    [viewportProfile.longEdge, viewportProfile.shortEdge],
  );
  const effectiveLayoutMode = appMode === "practice" ? viewportProfile.layoutMode : "natural-long-edge";

  const loadScoreXml = useCallback((xml: string, fileName: string) => {
    const parsed = parseMusicXml(xml, fileName);
    cancelScheduledPlayback();
    setScore(parsed);
    setImportError(null);
    setIsPlaying(false);
    setScorePlaybackSeeked(false);
    setCurrentStepIndex(0);
    setSelection({ range: null, loopIndex: 0 });
    setHoveredGroupId(null);
    setScoreZoomMax(MAX_SCORE_ZOOM);
  }, []);

  const stepTicks = useMemo(() => getStepTicks(score), [score]);
  const activeTick = stepTicks[currentStepIndex]
    ?? (currentStepIndex >= stepTicks.length ? score?.totalTicks ?? 0 : 0);
  const activeGroups = useMemo(() => getGroupsAtTick(score, activeTick), [score, activeTick]);
  const {
    selectedIds,
    selectedGroups,
    handleGroupSelect,
    handleClearSelection,
    dismissSelection,
    handleBoxSelect,
    expandSelectionToBothHands,
    shrinkSelectionToHand,
    resizeSelectionBoundary,
    moveSelection,
  } = useScoreInteraction({
    score,
    selection,
    setSelection,
    navigationFallbackGroup: activeGroups[0] ?? null,
    playbackBpm,
    keyboardEnabled: appMode === "practice" || appMode === "performance",
  });
  const waitingGroups = useMemo(
    () => activeGroups.filter((group) => handEnabled(group, followLeft, followRight)),
    [activeGroups, followLeft, followRight],
  );
  const referenceGroups = useMemo(
    () => activeGroups.filter((group) => !handEnabled(group, followLeft, followRight)),
    [activeGroups, followLeft, followRight],
  );
  const loopSteps = useMemo(() => (score ? buildLoopSteps(score, selection) : []), [score, selection]);
  const selectedStartGroup = selectedGroups.length === 1 ? selectedGroups[0] : null;
  const loopTargetStep =
    selectedGroups.length > 1 && loopSteps.length > 0 ? loopSteps[selection.loopIndex % loopSteps.length] ?? null : null;
  const loopTargetGroups = useMemo(() => loopTargetStep?.groups ?? [], [loopTargetStep]);
  const loopGroupIds = useMemo(() => loopTargetGroups.map((group) => group.id), [loopTargetGroups]);
  const loopWaitingGroups = useMemo(
    () => loopTargetGroups.filter((group) => handEnabled(group, followLeft, followRight)),
    [followLeft, followRight, loopTargetGroups],
  );
  const loopReferenceGroups = useMemo(
    () => loopTargetGroups.filter((group) => !handEnabled(group, followLeft, followRight)),
    [followLeft, followRight, loopTargetGroups],
  );
  const hoveredGroup = score?.noteGroups.find((group) => group.id === hoveredGroupId) ?? null;
  const practicePositionTick = loopTargetStep?.tick
    ?? (!isPlaying && selectedStartGroup && !scorePlaybackSeeked
      ? selectedStartGroup.absoluteTick
      : activeTick);
  const scorePlaybackStartTick = selectedGroups.length > 1 && loopSteps.length > 0
    ? loopSteps[0].tick
    : 0;
  const scorePlaybackEndTick = selectedGroups.length > 1 && loopSteps.length > 0
    ? Math.min(
      score?.totalTicks ?? 0,
      loopSteps[loopSteps.length - 1].tick
        + Math.max(1, ...loopSteps[loopSteps.length - 1].groups.map((group) => group.durationTicks)),
    )
    : score?.totalTicks ?? 0;
  const scorePlaybackPositionMs = ticksToMilliseconds(
    Math.max(0, practicePositionTick - scorePlaybackStartTick),
    playbackBpm,
  );
  const scorePlaybackDurationMs = ticksToMilliseconds(
    Math.max(0, scorePlaybackEndTick - scorePlaybackStartTick),
    playbackBpm,
  );
  const practiceCurrentTime = formatPlaybackTime(ticksToMilliseconds(practicePositionTick, playbackBpm));
  const practiceTotalTime = formatPlaybackTime(ticksToMilliseconds(score?.totalTicks ?? 0, playbackBpm));
  const [scoreZoom, setScoreZoom] = useState(100);
  const [scoreZoomMax, setScoreZoomMax] = useState(MAX_SCORE_ZOOM);
  const [scoreZoomPanelOpen, setScoreZoomPanelOpen] = useState(false);

  useEffect(() => {
    setScorePlaybackSeeked(false);
  }, [selection.range?.endTick, selection.range?.hands, selection.range?.startTick]);

  useEffect(() => {
    let disposed = false;
    if (!score) {
      setScoreIdentity(null);
      return () => {
        disposed = true;
      };
    }

    if (selectedLibraryItem?.scoreId && selectedLibraryItem.sourceHash) {
      setScoreIdentity({
        scoreId: selectedLibraryItem.scoreId,
        sourceHash: selectedLibraryItem.sourceHash,
        identitySource: "library-source",
      });
      return () => {
        disposed = true;
      };
    }

    setScoreIdentity(null);
    void sha256Text(score.xml).then((sourceHash) => {
      if (!disposed) {
        setScoreIdentity({
          scoreId: `local-${sourceHash.slice(7, 23).toLowerCase()}`,
          sourceHash,
          identitySource: "canonical-xml",
        });
      }
    });
    return () => {
      disposed = true;
    };
  }, [score, selectedLibraryItem]);

  useEffect(() => {
    const controller = new AbortController();
    setAnalysis(null);
    setAnalysisLoadError(null);

    if (!score) {
      setAnalysisLoadState("idle");
      return () => controller.abort();
    }

    if (!selectedLibraryItem?.analysisUrl || !selectedLibraryItem.scoreId || !selectedLibraryItem.sourceHash) {
      setAnalysisLoadState("missing");
      return () => controller.abort();
    }

    setAnalysisLoadState("loading");
    void loadAnalysis(
      selectedLibraryItem.analysisUrl,
      { scoreId: selectedLibraryItem.scoreId, sourceHash: selectedLibraryItem.sourceHash },
      controller.signal,
    )
      .then((result) => {
        setAnalysis(result);
        setAnalysisLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setAnalysisLoadError(error instanceof Error ? error.message : "分析结果加载失败");
        setAnalysisLoadState("error");
      });

    return () => controller.abort();
  }, [score, selectedLibraryItem]);

  const targetGroups = useMemo(() => {
    if (loopTargetStep) {
      return loopWaitingGroups.length > 0 ? loopWaitingGroups : loopTargetGroups;
    }

    if (!isPlaying && selectedStartGroup) {
      return [selectedStartGroup];
    }

    if (!isPlaying && hoveredGroup && selectedGroups.length === 0) {
      return [hoveredGroup];
    }

    return waitingGroups;
  }, [
    hoveredGroup,
    isPlaying,
    loopTargetGroups,
    loopTargetStep,
    loopWaitingGroups,
    selectedStartGroup,
    selectedGroups,
    waitingGroups,
  ]);

  const targetNotes = useMemo(() => getGroupMidis(targetGroups), [targetGroups]);
  const inputPressedNotes = useMemo(
    () => [...new Set([...midi.pressedNotes, ...pointerPressedNotes])].sort((a, b) => a - b),
    [midi.pressedNotes, pointerPressedNotes],
  );
  const inputEventId = midi.eventId + pointerInputEventId;

  const scoreActiveGroups = useMemo(
    () => (loopTargetStep ? loopTargetGroups : isPlaying ? activeGroups : targetGroups),
    [activeGroups, isPlaying, loopTargetGroups, loopTargetStep, targetGroups],
  );

  const advanceLoopSelection = useCallback(() => {
    setSelection((current) => ({
      ...current,
      loopIndex: loopSteps.length > 0 ? (current.loopIndex + 1) % loopSteps.length : 0,
    }));
  }, [loopSteps.length]);

  const advanceStep = useCallback(() => {
    if (!score || stepTicks.length === 0) {
      return;
    }

    setCurrentStepIndex((current) => {
      if (current >= stepTicks.length - 1) {
        setIsPlaying(false);
        return stepTicks.length;
      }

      return current + 1;
    });
  }, [score, stepTicks.length]);

  const setScorePlaybackPosition = useCallback((positionMs: number, startPlayback: boolean) => {
    if (!score || scorePlaybackDurationMs <= 0) return;
    cancelScheduledPlayback();
    const requestedRatio = Math.max(0, Math.min(1, positionMs / scorePlaybackDurationMs));
    const ratio = startPlayback && requestedRatio >= 1 ? 0 : requestedRatio;
    const targetTick = scorePlaybackStartTick + ratio * (scorePlaybackEndTick - scorePlaybackStartTick);

    if (selectedGroups.length > 1 && loopSteps.length > 0) {
      const loopIndex = loopSteps.reduce((nearestIndex, step, index) =>
        Math.abs(step.tick - targetTick) < Math.abs(loopSteps[nearestIndex].tick - targetTick)
          ? index
          : nearestIndex, 0);
      setSelection((current) => ({ ...current, loopIndex }));
      setIsPlaying(startPlayback);
      return;
    }

    let low = 0;
    let high = stepTicks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (stepTicks[middle] <= targetTick) low = middle + 1;
      else high = middle;
    }
    const nextIndex = ratio >= 1 ? stepTicks.length : Math.max(0, low - 1);
    setCurrentStepIndex(nextIndex);
    setScorePlaybackSeeked(ratio < 1);
    setIsPlaying(startPlayback);
  }, [
    loopSteps,
    score,
    scorePlaybackDurationMs,
    scorePlaybackEndTick,
    scorePlaybackStartTick,
    selectedGroups.length,
    stepTicks,
  ]);

  const seekScorePlayback = useCallback((positionMs: number) => {
    setScorePlaybackPosition(positionMs, false);
  }, [setScorePlaybackPosition]);

  const startScorePlaybackAt = useCallback((positionMs: number) => {
    if (!score) {
      fileInputRef.current?.click();
      return;
    }
    if (midi.status === "idle") void requestAccess();
    setScorePlaybackPosition(positionMs, true);
  }, [midi.status, requestAccess, score, setScorePlaybackPosition]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const session = scoreLoadSessionRef.current + 1;
    scoreLoadSessionRef.current = session;
    void readScoreXmlFromFile(file)
      .then(async (xml) => ({ xml, canonicalHash: await sha256Text(xml) }))
      .then(({ xml, canonicalHash }) => {
        if (scoreLoadSessionRef.current !== session) {
          return;
        }
        loadScoreXml(xml, file.name);
        const matchingLibraryItem = MUSICXML_LIBRARY.find((item) => item.canonicalHash === canonicalHash);
        setSelectedLibraryItemId(matchingLibraryItem?.id ?? null);
      })
      .catch((error) => {
        if (scoreLoadSessionRef.current !== session) {
          return;
        }
        setImportError(error instanceof Error ? error.message : "导入失败");
      });

    event.target.value = "";
  }, [loadScoreXml]);

  useEffect(() => {
    if (!scoreZoomPanelOpen && !tempoPanelOpen && !libraryPanelOpen && !midiPanelOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const tempoControl = tempoControlRef.current;
      if (tempoControl && tempoControl.contains(target)) {
        return;
      }

      const scoreZoomControl = scoreZoomControlRef.current;
      if (scoreZoomControl && scoreZoomControl.contains(target)) {
        return;
      }

      const libraryControl = libraryControlRef.current;
      if (libraryControl && libraryControl.contains(target)) {
        return;
      }

      const midiControl = midiControlRef.current;
      if (midiControl && midiControl.contains(target)) {
        return;
      }

      setScoreZoomPanelOpen(false);
      setTempoPanelOpen(false);
      setLibraryPanelOpen(false);
      setMidiPanelOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setScoreZoomPanelOpen(false);
        setTempoPanelOpen(false);
        setLibraryPanelOpen(false);
        setMidiPanelOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [scoreZoomPanelOpen, tempoPanelOpen, libraryPanelOpen, midiPanelOpen]);

  useEffect(() => {
    if (appMode !== "practice") {
      resetMidiMonitor();
      return;
    }
    const unsubscribe = subscribeRawMessages((event) => {
      void handleMidiMonitorEvent(event);
    });
    return () => {
      unsubscribe();
      resetMidiMonitor();
    };
  }, [appMode, subscribeRawMessages]);

  useEffect(() => {
    if (!isPlaying || inputEventId === lastConsumedInputEventRef.current) {
      return;
    }

    if (loopTargetStep && loopWaitingGroups.length > 0 && groupsContainAllPressed(loopWaitingGroups, inputPressedNotes)) {
      lastConsumedInputEventRef.current = inputEventId;
      advanceLoopSelection();
      return;
    }

    if (!loopTargetStep && waitingGroups.length > 0 && groupsContainAllPressed(waitingGroups, inputPressedNotes)) {
      lastConsumedInputEventRef.current = inputEventId;
      advanceStep();
    }
  }, [
    advanceLoopSelection,
    advanceStep,
    inputEventId,
    inputPressedNotes,
    isPlaying,
    loopTargetStep,
    loopWaitingGroups,
    waitingGroups,
  ]);

  useEffect(() => {
    if (!isPlaying || !score) {
      return;
    }

    if (loopTargetStep) {
      if (loopWaitingGroups.length > 0) {
        if (loopReferenceGroups.length > 0) {
          void playGroups(loopReferenceGroups, "4n", playbackBpm);
        }
        return;
      }

      void playGroups(loopTargetGroups, "4n", playbackBpm);
      const currentLoopIndex = loopSteps.length > 0 ? selection.loopIndex % loopSteps.length : 0;
      const nextStep = loopSteps[currentLoopIndex + 1];
      const lastStepDuration = Math.max(1, ...loopTargetGroups.map((group) => group.durationTicks));
      const durationTicks = nextStep ? Math.max(1, nextStep.tick - loopTargetStep.tick) : lastStepDuration;
      const durationMs = playbackDelayMs(durationTicks, playbackBpm);
      const timer = window.setTimeout(advanceLoopSelection, durationMs);

      return () => window.clearTimeout(timer);
    }

    if (waitingGroups.length > 0) {
      if (referenceGroups.length > 0) {
        void playGroups(referenceGroups, "4n", playbackBpm);
      }
      return;
    }

    if (activeGroups.length === 0) {
      advanceStep();
      return;
    }

    void playGroups(activeGroups, "4n", playbackBpm);
    const nextTick = stepTicks[currentStepIndex + 1] ?? score.totalTicks;
    const durationTicks =
      nextTick > activeTick ? nextTick - activeTick : Math.max(1, ...activeGroups.map((group) => group.durationTicks));
    const durationMs = playbackDelayMs(durationTicks, playbackBpm);
    const timer = window.setTimeout(advanceStep, durationMs);

    return () => window.clearTimeout(timer);
  }, [
    activeGroups,
    activeTick,
    advanceLoopSelection,
    advanceStep,
    currentStepIndex,
    isPlaying,
    loopReferenceGroups,
    loopSteps,
    loopTargetGroups,
    loopTargetStep,
    loopWaitingGroups.length,
    playbackBpm,
    referenceGroups,
    score,
    selection.loopIndex,
    stepTicks,
    waitingGroups.length,
  ]);

  const handleScoreZoomLimitChange = useCallback((nextMaxZoom: number) => {
    const nextLimit = Math.max(
      MIN_SCORE_ZOOM,
      Math.min(MAX_SCORE_ZOOM, floorScoreZoomToStep(nextMaxZoom)),
    );
    setScoreZoomMax((current) => (current === nextLimit ? current : nextLimit));
    setScoreZoom((current) => (current > nextLimit ? nextLimit : current));
  }, []);

  function toggleHand(hand: Hand) {
    if (hand === "left") {
      setFollowLeft((current) => !current);
    } else {
      setFollowRight((current) => !current);
    }
  }

  function handleModeChange(nextMode: AppMode) {
    if (nextMode === appMode) {
      return;
    }

    cancelScheduledPlayback();
    setIsPlaying(false);
    setScoreZoomPanelOpen(false);
    setTempoPanelOpen(false);
    setLibraryPanelOpen(false);
    setMidiPanelOpen(false);
    setScoreZoomMax(MAX_SCORE_ZOOM);
    setAppMode(nextMode);
  }

  function togglePlay() {
    if (!score) {
      fileInputRef.current?.click();
      return;
    }

    if (isPlaying) {
      cancelScheduledPlayback();
      setIsPlaying(false);
      return;
    }

    if (midi.status === "idle") {
      void requestAccess();
    }

    if (currentStepIndex >= stepTicks.length) {
      setCurrentStepIndex(0);
    } else if (!scorePlaybackSeeked && selectedStartGroup) {
      setCurrentStepIndex(stepTicks.findIndex((tick) => tick === selectedStartGroup.absoluteTick));
    }

    setScorePlaybackSeeked(false);
    setIsPlaying(true);
  }

  function toggleMidiPanel() {
    setScoreZoomPanelOpen(false);
    setTempoPanelOpen(false);
    setLibraryPanelOpen(false);
    setMidiPanelOpen((current) => !current);
    if (midi.status === "idle") {
      void requestAccess();
    }
  }

  function toggleLibraryPanel() {
    setScoreZoomPanelOpen(false);
    setTempoPanelOpen(false);
    setMidiPanelOpen(false);
    setLibraryPanelOpen((current) => !current);
  }

  function toggleTempoPanel() {
    setScoreZoomPanelOpen(false);
    setLibraryPanelOpen(false);
    setMidiPanelOpen(false);
    setTempoPanelOpen((current) => !current);
  }

  function toggleScoreZoomPanel() {
    setTempoPanelOpen(false);
    setLibraryPanelOpen(false);
    setMidiPanelOpen(false);
    setScoreZoomPanelOpen((current) => !current);
  }

  function handleScoreZoomChange(nextZoom: number) {
    setScoreZoom(clampScoreZoom(nextZoom, scoreZoomMax));
  }

  function handlePlaybackBpmChange(nextBpm: number) {
    setPlaybackBpm(clampPlaybackBpm(nextBpm));
    setTempoPanelOpen(false);
  }

  function handleLibraryItemSelect(libraryItem: MusicXmlLibraryItem) {
    setLibraryPanelOpen(false);
    const session = scoreLoadSessionRef.current + 1;
    scoreLoadSessionRef.current = session;
    void readScoreXmlFromUrl(libraryItem.url, libraryItem.fileName)
      .then((xml) => {
        if (scoreLoadSessionRef.current !== session) {
          return;
        }
        loadScoreXml(xml, libraryItem.fileName);
        setSelectedLibraryItemId(libraryItem.id);
      })
      .catch((error) => {
        if (scoreLoadSessionRef.current !== session) {
          return;
        }
        setImportError(error instanceof Error ? error.message : "曲库谱加载失败");
      });
  }

  function handleMidiInputSelect(inputId: string) {
    selectInput(inputId);
    setMidiPanelOpen(false);
  }

  function handlePianoKeyPress(midiNote: number) {
    if (!pointerPressedNotesRef.current.has(midiNote)) {
      pointerPressedNotesRef.current.add(midiNote);
      setPointerPressedNotes(Array.from(pointerPressedNotesRef.current).sort((a, b) => a - b));
      setPointerInputEventId((current) => current + 1);
      void playMidiNotes([midiNote], "8n");
    }
  }

  function handlePianoKeyRelease(midiNote: number) {
    if (!pointerPressedNotesRef.current.has(midiNote)) {
      return;
    }

    pointerPressedNotesRef.current.delete(midiNote);
    setPointerPressedNotes(Array.from(pointerPressedNotesRef.current).sort((a, b) => a - b));
    setPointerInputEventId((current) => current + 1);
  }

  return (
    <main
      className="app-shell"
      data-layout-mode={effectiveLayoutMode}
      data-app-mode={appMode}
      data-size-class={viewportProfile.sizeClass}
      data-has-coarse-pointer={viewportProfile.hasCoarsePointer ? "true" : "false"}
      data-has-fine-pointer={viewportProfile.hasFinePointer ? "true" : "false"}
      style={appShellStyle}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,text/xml,application/xml"
        onChange={handleFileChange}
      />

      <TopBar
        title={score ? score.title : "PianoAI"}
        mode={appMode}
        libraryItems={MUSICXML_LIBRARY}
        selectedLibraryItemId={selectedLibraryItemId}
        midi={midi}
        scoreZoom={scoreZoom}
        scoreZoomMax={scoreZoomMax}
        scoreZoomPanelOpen={scoreZoomPanelOpen}
        playbackBpm={playbackBpm}
        tempoPanelOpen={tempoPanelOpen}
        libraryPanelOpen={libraryPanelOpen}
        selectedInputName={selectedInputName}
        midiPanelOpen={midiPanelOpen}
        scoreZoomControlRef={scoreZoomControlRef}
        tempoControlRef={tempoControlRef}
        libraryControlRef={libraryControlRef}
        midiControlRef={midiControlRef}
        onToggleScoreZoomPanel={toggleScoreZoomPanel}
        onModeChange={handleModeChange}
        onToggleTempoPanel={toggleTempoPanel}
        onToggleLibraryPanel={toggleLibraryPanel}
        onScoreZoomChange={handleScoreZoomChange}
        onPlaybackBpmChange={handlePlaybackBpmChange}
        onImportScore={() => {
          setScoreZoomPanelOpen(false);
          setTempoPanelOpen(false);
          setLibraryPanelOpen(false);
          setMidiPanelOpen(false);
          fileInputRef.current?.click();
        }}
        onToggleMidiPanel={toggleMidiPanel}
        onSelectLibraryItem={handleLibraryItemSelect}
        onSelectMidiInput={handleMidiInputSelect}
      />

      {importError ? <div className="notice-strip">{importError}</div> : null}

      {appMode === "practice" ? (
        <>
          <ScoreViewer
            score={score}
            scoreZoom={scoreZoom / 100}
            progressCurrentTime={practiceCurrentTime}
            progressTotalTime={practiceTotalTime}
            onScoreZoomLimitChange={handleScoreZoomLimitChange}
            allowBoxSelect={viewportProfile.allowBoxSelect}
            activeGroups={scoreActiveGroups}
            followActive={isPlaying}
            selectedIds={selectedIds}
            hoveredId={hoveredGroupId}
            loopGroupIds={loopGroupIds}
            pressedNotes={midi.pressedNotes}
            onGroupHover={setHoveredGroupId}
            onGroupSelect={handleGroupSelect}
            onBoxSelect={handleBoxSelect}
            onExpandSelectionToBothHands={expandSelectionToBothHands}
            onShrinkSelectionToHand={shrinkSelectionToHand}
            onResizeSelectionBoundary={resizeSelectionBoundary}
            onClearSelection={handleClearSelection}
            onDismissSelection={dismissSelection}
          />

          <PracticeControls
            isPlaying={isPlaying}
            followLeft={followLeft}
            followRight={followRight}
            onPrevious={() => moveSelection(-1)}
            onTogglePlay={togglePlay}
            onNext={() => moveSelection(1)}
            onToggleHand={toggleHand}
          />

          <PianoKeyboard
            targetNotes={targetNotes}
            pressedNotes={inputPressedNotes}
            onKeyPress={handlePianoKeyPress}
            onKeyRelease={handlePianoKeyRelease}
          />
        </>
      ) : appMode === "analysis" ? (
        <AnalysisWorkspace
          score={score}
          analysis={analysis}
          loadState={analysisLoadState}
          loadError={analysisLoadError}
          scoreZoom={scoreZoom / 100}
          playbackBpm={playbackBpm}
        />
      ) : (
        <PerformanceWorkspace
          score={score}
          scoreIdentity={scoreIdentity}
          analysis={analysis}
          scoreZoom={scoreZoom / 100}
          allowBoxSelect={viewportProfile.allowBoxSelect}
          selectedIds={selectedIds}
          selection={selection}
          scorePlaybackActive={isPlaying}
          scorePlaybackGroups={scoreActiveGroups}
          scorePlaybackPositionMs={scorePlaybackPositionMs}
          scorePlaybackDurationMs={scorePlaybackDurationMs}
          onToggleScorePlayback={togglePlay}
          onSeekScorePlayback={seekScorePlayback}
          onStartScorePlaybackAt={startScorePlaybackAt}
          onScoreZoomLimitChange={handleScoreZoomLimitChange}
          onGroupSelect={handleGroupSelect}
          onBoxSelect={handleBoxSelect}
          onExpandSelectionToBothHands={expandSelectionToBothHands}
          onShrinkSelectionToHand={shrinkSelectionToHand}
          onResizeSelectionBoundary={resizeSelectionBoundary}
          onClearSelection={handleClearSelection}
          onDismissSelection={dismissSelection}
        />
      )}
    </main>
  );
}
