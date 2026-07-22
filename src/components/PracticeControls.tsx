import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { Hand } from "../types";

interface PracticeControlsProps {
  isPlaying: boolean;
  followLeft: boolean;
  followRight: boolean;
  showHands?: boolean;
  showStepControls?: boolean;
  className?: string;
  ariaLabel?: string;
  playAriaLabel?: string;
  playTitle?: string;
  previousDisabled?: boolean;
  playDisabled?: boolean;
  nextDisabled?: boolean;
  onPrevious?: () => void;
  onTogglePlay: () => void;
  onNext?: () => void;
  onToggleHand?: (hand: Hand) => void;
}

export default function PracticeControls({
  isPlaying,
  followLeft,
  followRight,
  showHands = true,
  showStepControls = true,
  className = "",
  ariaLabel = "练习控制",
  playAriaLabel,
  playTitle,
  previousDisabled = false,
  playDisabled = false,
  nextDisabled = false,
  onPrevious,
  onTogglePlay,
  onNext,
  onToggleHand,
}: PracticeControlsProps) {
  return (
    <div className={`practice-controls ${className}`.trim()} aria-label={ariaLabel}>
      {showHands ? (
        <button
          type="button"
          className={`practice-hand-button ${followLeft ? "active" : ""}`}
          onClick={() => onToggleHand?.("left")}
          aria-pressed={followLeft}
        >
          左手
        </button>
      ) : null}

      {showStepControls ? (
        <button
          type="button"
          className="practice-step-button"
          onClick={onPrevious}
          disabled={previousDisabled}
          aria-label="上一个音"
          title="上一个音（←）"
        >
          <ChevronLeft size={21} aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        className="practice-play-button"
        onClick={onTogglePlay}
        disabled={playDisabled}
        aria-label={playAriaLabel ?? (isPlaying ? "暂停" : "开始")}
        title={playTitle}
      >
        {isPlaying ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
      </button>

      {showStepControls ? (
        <button
          type="button"
          className="practice-step-button"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label="下一个音"
          title="下一个音（→）"
        >
          <ChevronRight size={21} aria-hidden="true" />
        </button>
      ) : null}

      {showHands ? (
        <button
          type="button"
          className={`practice-hand-button ${followRight ? "active" : ""}`}
          onClick={() => onToggleHand?.("right")}
          aria-pressed={followRight}
        >
          右手
        </button>
      ) : null}
    </div>
  );
}
