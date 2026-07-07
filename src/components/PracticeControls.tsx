import { Pause, Play } from "lucide-react";
import type { Hand } from "../types";

interface PracticeControlsProps {
  isPlaying: boolean;
  followLeft: boolean;
  followRight: boolean;
  onTogglePlay: () => void;
  onToggleHand: (hand: Hand) => void;
}

export default function PracticeControls({
  isPlaying,
  followLeft,
  followRight,
  onTogglePlay,
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

      <button type="button" className="practice-play-button" onClick={onTogglePlay} aria-label={isPlaying ? "暂停" : "开始"}>
        {isPlaying ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
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
