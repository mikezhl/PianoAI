import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { Hand } from "../types";

interface PracticeControlsProps {
  isPlaying: boolean;
  followLeft: boolean;
  followRight: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onToggleHand: (hand: Hand) => void;
}

export default function PracticeControls({
  isPlaying,
  followLeft,
  followRight,
  onPrevious,
  onTogglePlay,
  onNext,
  onToggleHand,
}: PracticeControlsProps) {
  return (
    <div className="practice-controls" aria-label="练习控制">
      <button
        type="button"
        className={`practice-hand-button ${followLeft ? "active" : ""}`}
        onClick={() => onToggleHand("left")}
        aria-pressed={followLeft}
      >
        左手
      </button>

      <button
        type="button"
        className="practice-step-button"
        onClick={onPrevious}
        aria-label="上一个音"
        title="上一个音（←）"
      >
        <ChevronLeft size={21} aria-hidden="true" />
      </button>

      <button type="button" className="practice-play-button" onClick={onTogglePlay} aria-label={isPlaying ? "暂停" : "开始"}>
        {isPlaying ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
      </button>

      <button
        type="button"
        className="practice-step-button"
        onClick={onNext}
        aria-label="下一个音"
        title="下一个音（→）"
      >
        <ChevronRight size={21} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`practice-hand-button ${followRight ? "active" : ""}`}
        onClick={() => onToggleHand("right")}
        aria-pressed={followRight}
      >
        右手
      </button>
    </div>
  );
}
