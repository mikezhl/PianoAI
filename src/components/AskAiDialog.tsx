import { Bot, Check, Copy, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface AskAiDialogProps {
  open: boolean;
  prompt: string;
  onClose: () => void;
}

type CopyState = "idle" | "copied" | "error";

function selectableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden);
}

export default function AskAiDialog({ open, prompt, onClose }: AskAiDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setCopyState("idle");
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, [open]);

  useEffect(() => () => {
    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  if (!open) return null;

  function selectPrompt(): void {
    promptRef.current?.focus();
    promptRef.current?.select();
    promptRef.current?.setSelectionRange(0, prompt.length);
  }

  function showCopiedState(): void {
    setCopyState("copied");
    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, 2000);
  }

  async function copyPrompt(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        showCopiedState();
        return;
      }
    } catch {
      // Continue to the selection-based fallback.
    }

    selectPrompt();
    try {
      if (typeof document.execCommand === "function" && document.execCommand("copy")) {
        showCopiedState();
        return;
      }
    } catch {
      // Keep the prompt selected for manual copying.
    }
    setCopyState("error");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const elements = selectableElements(dialogRef.current);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="ask-ai-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ask-ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="ask-ai-dialog-header">
          <div className="ask-ai-dialog-heading">
            <span className="ask-ai-dialog-icon" aria-hidden="true">
              <Bot size={18} />
            </span>
            <h2 id={titleId}>Ask AI</h2>
          </div>
          <button
            type="button"
            className="ask-ai-dialog-close"
            onClick={onClose}
            aria-label="Close Ask AI"
            title="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="ask-ai-dialog-body">
          <textarea
            ref={promptRef}
            className="ask-ai-prompt"
            value={prompt}
            readOnly
            rows={5}
            spellCheck={false}
            aria-label="Prompt to copy"
          />
        </div>

        <div className="ask-ai-dialog-footer">
          <span
            className={`ask-ai-copy-status ${copyState}`}
            role="status"
            aria-live="polite"
          >
            {copyState === "copied"
              ? "Prompt copied"
              : copyState === "error"
                ? "Copy failed. The prompt is selected for manual copying."
                : ""}
          </span>
          <button
            type="button"
            className="flat-button ask-ai-copy-button"
            onClick={() => void copyPrompt()}
            aria-label="Copy prompt"
          >
            {copyState === "copied"
              ? <Check size={18} aria-hidden="true" />
              : <Copy size={18} aria-hidden="true" />}
            <span>{copyState === "copied" ? "Copied" : "Copy prompt"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
