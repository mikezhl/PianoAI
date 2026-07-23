import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AskAiDialog from "./AskAiDialog";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = document.execCommand;

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  document.execCommand = originalExecCommand;
});

describe("AskAiDialog", () => {
  it("copies the complete prompt and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <AskAiDialog open prompt="Prompt with guide URL" onClose={vi.fn()} />,
    ));
    const copyButton = container.querySelector(".ask-ai-copy-button") as HTMLButtonElement;
    await act(async () => copyButton.click());

    expect(writeText).toHaveBeenCalledWith("Prompt with guide URL");
    expect(copyButton.textContent).toContain("Copied");

    await act(async () => root.unmount());
    container.remove();
  });

  it("closes on Escape and restores focus to the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <AskAiDialog open prompt="Prompt" onClose={onClose} />,
    ));
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ));
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => root.render(
      <AskAiDialog open={false} prompt="Prompt" onClose={onClose} />,
    ));
    expect(document.activeElement).toBe(opener);

    await act(async () => root.unmount());
    container.remove();
    opener.remove();
  });

  it("falls back to selection-based copying when Clipboard API is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    document.execCommand = execCommand;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <AskAiDialog open prompt="Fallback prompt" onClose={vi.fn()} />,
    ));
    const copyButton = container.querySelector(".ask-ai-copy-button") as HTMLButtonElement;
    await act(async () => copyButton.click());

    expect(writeText).toHaveBeenCalledWith("Fallback prompt");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton.textContent).toContain("Copied");

    await act(async () => root.unmount());
    container.remove();
  });
});
