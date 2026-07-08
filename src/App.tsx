import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import PianoKeyboard from "./components/PianoKeyboard";
import PracticeControls from "./components/PracticeControls";
import ScoreViewer from "./components/ScoreViewer";
import TopBar from "./components/TopBar";
import { cancelScheduledPlayback, playGroups, playMidiNotes } from "./lib/audio";
import { readScoreXmlFromFile, readScoreXmlFromUrl } from "./lib/fileImport";
import {
  getGroupsAtTick,
  getStepTicks,
  groupsContainAllPressed,
  parseMusicXml,
} from "./lib/musicXml";
import { useMidi } from "./lib/midi";
import {
  buildLoopSteps,
  getGroupMidis,
  getSelectedGroups,
  getSelectedIds,
  handEnabled,
  moveSelectedGroup,
  selectBoxGroups,
  selectGroup,
  setSelectionBoundary,
  setSelectionHands,
} from "./lib/practice";
import { clampPlaybackBpm, DEFAULT_PLAYBACK_BPM, ticksToMilliseconds } from "./lib/playbackTiming";
import { clampScoreZoom, floorScoreZoomToStep, MAX_SCORE_ZOOM, MIN_SCORE_ZOOM } from "./lib/scoreZoom";
import { Hand, ScoreData, SelectionState } from "./types";
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
  const lastAudibleMidiNotesRef = useRef<number[]>([]);
  const pointerPressedNotesRef = useRef<Set<number>>(new Set());
  const [score, setScore] = useState<ScoreData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const { midi, selectedInputName, requestAccess, selectInput } = useMidi();
  const appShellStyle = useMemo(
    () => ({
      "--viewport-long-edge": `${viewportProfile.longEdge}px`,
      "--viewport-short-edge": `${viewportProfile.shortEdge}px`,
    }) as CSSProperties,
    [viewportProfile.longEdge, viewportProfile.shortEdge],
  );

  const loadScoreXml = useCallback((xml: string, fileName: string) => {
    const parsed = parseMusicXml(xml, fileName);
    cancelScheduledPlayback();
    setScore(parsed);
    setImportError(null);
    setIsPlaying(false);
    setCurrentStepIndex(0);
    setSelection({ range: null, loopIndex: 0 });
    setHoveredGroupId(null);
    setScoreZoomMax(MAX_SCORE_ZOOM);
  }, []);

  const stepTicks = useMemo(() => getStepTicks(score), [score]);
  const activeTick = stepTicks[currentStepIndex] ?? 0;
  const activeGroups = useMemo(() => getGroupsAtTick(score, activeTick), [score, activeTick]);
  const waitingGroups = useMemo(
    () => activeGroups.filter((group) => handEnabled(group, followLeft, followRight)),
    [activeGroups, followLeft, followRight],
  );
  const referenceGroups = useMemo(
    () => activeGroups.filter((group) => !handEnabled(group, followLeft, followRight)),
    [activeGroups, followLeft, followRight],
  );
  const selectedIds = useMemo(() => (score ? getSelectedIds(score, selection) : []), [score, selection]);
  const selectedGroups = useMemo(() => (score ? getSelectedGroups(score, selection) : []), [score, selection]);
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
  const [scoreZoom, setScoreZoom] = useState(100);
  const [scoreZoomMax, setScoreZoomMax] = useState(MAX_SCORE_ZOOM);
  const [scoreZoomPanelOpen, setScoreZoomPanelOpen] = useState(false);

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
    followLeft,
    followRight,
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
        return current;
      }

      return current + 1;
    });
  }, [score, stepTicks.length]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    void readScoreXmlFromFile(file)
      .then((xml) => {
        loadScoreXml(xml, file.name);
        setSelectedLibraryItemId(null);
      })
      .catch((error) => {
        setImportError(error instanceof Error ? error.message : "导入失败");
      });

    event.target.value = "";
  }, [loadScoreXml]);

  const handleGroupSelect = useCallback(
    (groupId: string, extend: boolean) => {
      if (!score) {
        return;
      }

      const group = score.noteGroups.find((candidate) => candidate.id === groupId);
      setSelection((current) => selectGroup(score, current, groupId, extend));
      if (group) {
        void playGroups([group], "4n", playbackBpm);
      }
    },
    [playbackBpm, score],
  );

  const handleBoxSelect = useCallback(
    (groupIds: string[]) => {
      if (!score) {
        return;
      }

      setSelection(groupIds.length > 0 ? selectBoxGroups(score, groupIds) : { range: null, loopIndex: 0 });
    },
    [score],
  );

  const expandSelectionToBothHands = useCallback(() => {
    if (!score) {
      return;
    }

    setSelection((current) => setSelectionHands(score, current, ["right", "left"]));
  }, [score]);

  const shrinkSelectionToHand = useCallback(
    (hand: Hand) => {
      if (!score) {
        return;
      }

      setSelection((current) => setSelectionHands(score, current, [hand]));
    },
    [score],
  );

  const resizeSelectionBoundary = useCallback(
    (edge: "start" | "end", tick: number) => {
      if (!score) {
        return;
      }

      setSelection((current) => setSelectionBoundary(score, current, edge, tick));
    },
    [score],
  );

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (!score || score.noteGroups.length === 0) {
        return;
      }

      const nextSelection = moveSelectedGroup(score, selection, direction, activeGroups[0] ?? score.noteGroups[0]);
      const nextSelectedIds = getSelectedIds(score, nextSelection);
      const nextGroup = score.noteGroups.find((group) => group.id === nextSelectedIds[0]);
      const moved = nextSelectedIds.length !== selectedIds.length
        || nextSelectedIds.some((id, index) => id !== selectedIds[index]);

      setSelection(nextSelection);
      if (nextGroup && moved) {
        void playGroups([nextGroup], "4n", playbackBpm);
      }
    },
    [activeGroups, playbackBpm, score, selectedIds, selection],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveSelection]);

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
    const previous = new Set(lastAudibleMidiNotesRef.current);
    const justPressed = midi.pressedNotes.filter((midiNote) => !previous.has(midiNote));
    lastAudibleMidiNotesRef.current = midi.pressedNotes;

    if (justPressed.length > 0) {
      void playMidiNotes(justPressed, "8n");
    }
  }, [midi.pressedNotes]);

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

    if (!isPlaying && selectedStartGroup) {
      setCurrentStepIndex(stepTicks.findIndex((tick) => tick === selectedStartGroup.absoluteTick));
    }

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
    void readScoreXmlFromUrl(libraryItem.url, libraryItem.fileName)
      .then((xml) => {
        loadScoreXml(xml, libraryItem.fileName);
        setSelectedLibraryItemId(libraryItem.id);
      })
      .catch((error) => {
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
      data-layout-mode={viewportProfile.layoutMode}
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

      <ScoreViewer
        score={score}
        scoreZoom={scoreZoom / 100}
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
        onClearSelection={() => setSelection({ range: null, loopIndex: 0 })}
      />

      <PracticeControls
        isPlaying={isPlaying}
        followLeft={followLeft}
        followRight={followRight}
        onTogglePlay={togglePlay}
        onToggleHand={toggleHand}
      />

      <PianoKeyboard
        targetNotes={targetNotes}
        pressedNotes={inputPressedNotes}
        onKeyPress={handlePianoKeyPress}
        onKeyRelease={handlePianoKeyRelease}
      />
    </main>
  );
}
