import { Check, ChevronDown, Gauge, Keyboard, Music, Upload } from "lucide-react";
import type { RefObject } from "react";
import type { MidiState } from "../types";
import type { MusicXmlLibraryItem } from "virtual:musicxml-library";

interface TopBarProps {
  title: string;
  libraryItems: MusicXmlLibraryItem[];
  selectedLibraryItemId: string | null;
  midi: MidiState;
  playbackBpm: number;
  tempoPanelOpen: boolean;
  libraryPanelOpen: boolean;
  selectedInputName: string | null;
  midiPanelOpen: boolean;
  tempoControlRef: RefObject<HTMLDivElement | null>;
  libraryControlRef: RefObject<HTMLDivElement | null>;
  midiControlRef: RefObject<HTMLDivElement | null>;
  onToggleTempoPanel: () => void;
  onToggleLibraryPanel: () => void;
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

export default function TopBar({
  title,
  libraryItems,
  selectedLibraryItemId,
  midi,
  playbackBpm,
  tempoPanelOpen,
  libraryPanelOpen,
  selectedInputName,
  midiPanelOpen,
  tempoControlRef,
  libraryControlRef,
  midiControlRef,
  onToggleTempoPanel,
  onToggleLibraryPanel,
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

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="score-title" aria-live="polite">
          {title}
        </div>
      </div>

      <div className="topbar-right">
        <div className="tempo-control" ref={tempoControlRef}>
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
        </div>

        <div className="midi-control" ref={midiControlRef}>
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
        </div>

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

        <button type="button" className="flat-button import-button" onClick={onImportScore}>
          <Upload size={20} aria-hidden="true" />
          <span>导入谱子</span>
        </button>
      </div>
    </header>
  );
}
