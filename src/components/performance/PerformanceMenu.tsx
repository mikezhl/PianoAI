import { Check, ChevronDown, ExternalLink } from "lucide-react";

export interface PerformanceMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
  sourceUrl?: string;
  sourceTitle?: string;
}

interface PerformanceMenuProps {
  ariaLabel: string;
  value: string;
  options: PerformanceMenuOption[];
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}

export default function PerformanceMenu({
  ariaLabel,
  value,
  options,
  open,
  disabled = false,
  onToggle,
  onSelect,
}: PerformanceMenuProps) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="performance-menu">
      <button
        type="button"
        className={`flat-button performance-menu-trigger ${open ? "active" : ""}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? "—"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="performance-menu-panel" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <div key={option.value} className="performance-menu-option-row">
              <button
                type="button"
                className={`performance-menu-option ${option.value === value ? "active" : ""}`}
                onClick={() => onSelect(option.value)}
                disabled={option.disabled}
                role="option"
                aria-selected={option.value === value}
              >
                <span>{option.label}</span>
                {option.value === value ? <Check size={16} aria-hidden="true" /> : null}
              </button>
              {option.sourceUrl ? (
                <a
                  className="performance-menu-source-link"
                  href={option.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`打开${option.label}的音频来源`}
                  title={option.sourceTitle ?? `打开${option.label}的音频来源`}
                >
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
