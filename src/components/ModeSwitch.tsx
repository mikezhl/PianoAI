import type { AppMode } from "../analysis/types";

interface ModeSwitchProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export default function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div className="mode-switch" role="group" aria-label="应用模式">
      <button
        type="button"
        className={mode === "practice" ? "active" : ""}
        onClick={() => onChange("practice")}
        aria-pressed={mode === "practice"}
        title="练习模式"
      >
        <span>练习</span>
      </button>
      <button
        type="button"
        className={mode === "analysis" ? "active" : ""}
        onClick={() => onChange("analysis")}
        aria-pressed={mode === "analysis"}
        title="分析模式"
      >
        <span>分析</span>
      </button>
      <button
        type="button"
        className={mode === "performance" ? "active" : ""}
        onClick={() => onChange("performance")}
        aria-pressed={mode === "performance"}
        title="演绎模式"
      >
        <span>演绎</span>
      </button>
    </div>
  );
}
