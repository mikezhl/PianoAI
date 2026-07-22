import { Check, ChevronDown, Gauge, Keyboard, Music, Upload, ZoomIn } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import type { AppMode } from "../analysis/types";
import { MAX_SCORE_ZOOM, MIN_SCORE_ZOOM, SCORE_ZOOM_STEP } from "../lib/scoreZoom";
import type { MidiState } from "../types";
import type { MusicXmlLibraryItem } from "virtual:musicxml-library";
import ModeSwitch from "./ModeSwitch";

interface TopBarProps {
  title: string;
  mode: AppMode;
  libraryItems: MusicXmlLibraryItem[];
  selectedLibraryItemId: string | null;
  midi: MidiState;
  scoreZoom: number;
  scoreZoomMax: number;
  scoreZoomPanelOpen: boolean;
  playbackBpm: number;
  tempoPanelOpen: boolean;
  libraryPanelOpen: boolean;
  selectedInputName: string | null;
  midiPanelOpen: boolean;
  scoreZoomControlRef: RefObject<HTMLDivElement | null>;
  tempoControlRef: RefObject<HTMLDivElement | null>;
  libraryControlRef: RefObject<HTMLDivElement | null>;
  midiControlRef: RefObject<HTMLDivElement | null>;
  onToggleScoreZoomPanel: () => void;
  onModeChange: (mode: AppMode) => void;
  onToggleTempoPanel: () => void;
  onToggleLibraryPanel: () => void;
  onScoreZoomChange: (zoom: number) => void;
  onPlaybackBpmChange: (bpm: number) => void;
  onImportScore: () => void;
  onToggleMidiPanel: () => void;
  onSelectLibraryItem: (libraryItem: MusicXmlLibraryItem) => void;
  onSelectMidiInput: (inputId: string) => void;
}

function getMidiDotClass(status: MidiState["status"]): string {
  if (status === "connected" || status === "ready") {
    return "ready";
  }

  if (status === "requesting") {
    return "requesting";
  }

  return "idle";
}

const PLAYBACK_BPM_OPTIONS = [60, 72, 80, 92, 100, 116, 120, 144];

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.51.47-3.16-.63-3.36-1.21-.11-.3-.6-1.21-1.03-1.46-.35-.19-.85-.66-.01-.67.79-.01 1.35.75 1.54 1.06.9 1.55 2.34 1.11 2.91.85.09-.67.35-1.11.64-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05.8-.23 1.65-.34 2.5-.34s1.7.11 2.5.34c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.14 10.14 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function GitHubLink() {
  return (
    <a
      className="flat-button github-link"
      href="https://github.com/mikezhl/PianoAI"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="打开 GitHub 仓库"
      title="GitHub"
    >
      <GitHubIcon />
    </a>
  );
}

export default function TopBar({
  title,
  mode,
  libraryItems,
  selectedLibraryItemId,
  midi,
  scoreZoom,
  scoreZoomMax,
  scoreZoomPanelOpen,
  playbackBpm,
  tempoPanelOpen,
  libraryPanelOpen,
  selectedInputName,
  midiPanelOpen,
  scoreZoomControlRef,
  tempoControlRef,
  libraryControlRef,
  midiControlRef,
  onToggleScoreZoomPanel,
  onModeChange,
  onToggleTempoPanel,
  onToggleLibraryPanel,
  onScoreZoomChange,
  onPlaybackBpmChange,
  onImportScore,
  onToggleMidiPanel,
  onSelectLibraryItem,
  onSelectMidiInput,
}: TopBarProps) {
  const midiDotClass = getMidiDotClass(midi.status);
  const playbackBpmOptions = PLAYBACK_BPM_OPTIONS.includes(playbackBpm)
    ? PLAYBACK_BPM_OPTIONS
    : [...PLAYBACK_BPM_OPTIONS, playbackBpm].sort((a, b) => a - b);
  const scoreZoomRange = Math.max(SCORE_ZOOM_STEP, scoreZoomMax - MIN_SCORE_ZOOM);
  const scoreZoomProgress = Math.max(
    0,
    Math.min(100, ((scoreZoom - MIN_SCORE_ZOOM) / scoreZoomRange) * 100),
  );

  return (
    <header className={`topbar ${mode === "performance" ? "performance-topbar" : ""}`}>
      <div className="topbar-left">
        <div className="score-title" aria-live="polite">
          {title}
        </div>
        <ModeSwitch mode={mode} onChange={onModeChange} />
      </div>

      {mode === "performance" ? (
        <div className="topbar-performance-actions">
          <GitHubLink />
          <div
            id="performance-topbar-controls"
            className="topbar-mode-controls"
            aria-label="演绎选项"
          />
        </div>
      ) : null}

      <div className="topbar-right">
        {mode !== "performance" ? <GitHubLink /> : null}

        <div className="score-zoom-control" ref={scoreZoomControlRef}>
          <button
            type="button"
            className={`flat-button score-zoom-button ${scoreZoomPanelOpen ? "active" : ""}`}
            onClick={onToggleScoreZoomPanel}
            aria-label={`谱面缩放 ${scoreZoom}%`}
            aria-haspopup="true"
            aria-controls="score-zoom-panel"
            aria-expanded={scoreZoomPanelOpen}
            title="谱面缩放"
          >
            <ZoomIn size={20} aria-hidden="true" />
            <span className="score-zoom-button-value">{scoreZoom}%</span>
            <ChevronDown size={16} className="score-zoom-button-chevron" aria-hidden="true" />
          </button>

          {scoreZoomPanelOpen ? (
            <div id="score-zoom-panel" className="score-zoom-panel" role="group" aria-label="谱面缩放">
              <div className="score-zoom-slider-row">
                <input
                  id="score-zoom-range"
                  className="score-zoom-range"
                  type="range"
                  min={MIN_SCORE_ZOOM}
                  max={Math.max(MIN_SCORE_ZOOM, Math.min(MAX_SCORE_ZOOM, scoreZoomMax))}
                  step={SCORE_ZOOM_STEP}
                  value={scoreZoom}
                  style={{ "--score-zoom-progress": `${scoreZoomProgress}%` } as CSSProperties}
                  onChange={(event) => onScoreZoomChange(Number(event.target.value))}
                  aria-label="谱面缩放"
                />
              </div>
            </div>
          ) : null}
        </div>

        {mode !== "performance" ? <div className="tempo-control" ref={tempoControlRef}>
          <button
            type="button"
            className={`flat-button tempo-button ${tempoPanelOpen ? "active" : ""}`}
            onClick={onToggleTempoPanel}
            aria-label={`播放速度 ${playbackBpm} BPM`}
            aria-haspopup="listbox"
            aria-expanded={tempoPanelOpen}
            title="播放速度"
          >
            <Gauge size={20} aria-hidden="true" />
            <span className="tempo-button-value">{playbackBpm}</span>
            <span className="tempo-button-unit">BPM</span>
            <ChevronDown size={16} className="tempo-button-chevron" aria-hidden="true" />
          </button>

          {tempoPanelOpen ? (
            <div className="tempo-panel" role="listbox" aria-label="播放速度">
              {playbackBpmOptions.map((bpm) => (
                <button
                  type="button"
                  key={bpm}
                  className={`tempo-option ${bpm === playbackBpm ? "active" : ""}`}
                  onClick={() => onPlaybackBpmChange(bpm)}
                  role="option"
                  aria-label={`${bpm} BPM`}
                  aria-selected={bpm === playbackBpm}
                >
                  <span className="tempo-option-label">
                    <span className="tempo-option-value">{bpm}</span>
                    <span className="tempo-option-unit">BPM</span>
                  </span>
                  {bpm === playbackBpm ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div> : null}

        {mode === "practice" ? <div className="midi-control" ref={midiControlRef}>
          <button
            type="button"
            className="flat-button midi-button"
            onClick={onToggleMidiPanel}
            aria-label={selectedInputName ? `MIDI ${selectedInputName}` : "MIDI"}
          >
            <Keyboard size={20} aria-hidden="true" />
            <span>MIDI</span>
            <span className={`status-dot ${midiDotClass}`} />
          </button>

          {midiPanelOpen ? (
            <div className="midi-panel">
              {midi.status === "unsupported" ? (
                <p>当前浏览器不支持 MIDI</p>
              ) : midi.inputs.length === 0 ? (
                <p>{midi.status === "requesting" ? "正在请求 MIDI 权限" : "未发现 MIDI 输入"}</p>
              ) : (
                midi.inputs.map((input) => (
                  <button
                    type="button"
                    key={input.id}
                    className={`midi-option ${input.id === midi.selectedInputId ? "active" : ""}`}
                    onClick={() => onSelectMidiInput(input.id)}
                    aria-current={input.id === midi.selectedInputId ? "true" : undefined}
                  >
                    <span>{input.name}</span>
                    {input.id === midi.selectedInputId ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div> : null}

        <div className="library-control" ref={libraryControlRef}>
          <button
            type="button"
            className="flat-button library-button"
            onClick={onToggleLibraryPanel}
            aria-label="曲库"
          >
            <Music size={20} aria-hidden="true" />
            <span>曲库</span>
          </button>

          {libraryPanelOpen ? (
            <div className="library-panel">
              {libraryItems.length === 0 ? (
                <p>musicxml 文件夹暂无曲目</p>
              ) : (
                libraryItems.map((libraryItem) => (
                  <button
                    type="button"
                    key={libraryItem.id}
                    className={`library-option ${libraryItem.id === selectedLibraryItemId ? "active" : ""}`}
                    onClick={() => onSelectLibraryItem(libraryItem)}
                    aria-current={libraryItem.id === selectedLibraryItemId ? "true" : undefined}
                  >
                    <span className="library-option-title">{libraryItem.name}</span>
                    {libraryItem.id === selectedLibraryItemId ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="flat-button import-button"
          onClick={onImportScore}
          aria-label="Import score"
        >
          <Upload size={20} aria-hidden="true" />
          <span>导入谱子</span>
        </button>
      </div>
    </header>
  );
}
