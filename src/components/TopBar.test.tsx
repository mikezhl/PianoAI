import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MidiState } from "../types";
import TopBar from "./TopBar";

const midi = {
  status: "idle",
  inputs: [],
  selectedInputId: null,
  pressedNotes: [],
  eventId: 0,
  error: null,
} satisfies MidiState;

function topBarMarkup(mode: "practice" | "performance" = "practice"): string {
  const controlRef = createRef<HTMLDivElement>();
  return renderToStaticMarkup(createElement(TopBar, {
    title: "Fixture",
    mode,
    libraryItems: [],
    selectedLibraryItemId: null,
    midi,
    scoreZoom: 100,
    scoreZoomMax: 150,
    scoreZoomPanelOpen: false,
    playbackBpm: 92,
    tempoPanelOpen: false,
    libraryPanelOpen: false,
    selectedInputName: null,
    midiPanelOpen: false,
    scoreZoomControlRef: controlRef,
    tempoControlRef: controlRef,
    libraryControlRef: controlRef,
    midiControlRef: controlRef,
    onToggleScoreZoomPanel: vi.fn(),
    onModeChange: vi.fn(),
    onToggleTempoPanel: vi.fn(),
    onToggleLibraryPanel: vi.fn(),
    onScoreZoomChange: vi.fn(),
    onPlaybackBpmChange: vi.fn(),
    onImportScore: vi.fn(),
    onToggleMidiPanel: vi.fn(),
    onOpenAskAi: vi.fn(),
    onSelectLibraryItem: vi.fn(),
    onSelectMidiInput: vi.fn(),
  }));
}

describe("TopBar", () => {
  it("keeps the import action named when compact CSS hides its text", () => {
    const container = document.createElement("div");
    container.innerHTML = topBarMarkup();

    expect(container.querySelector(".import-button")?.getAttribute("aria-label")).toBe("Import score");
  });

  it.each(["practice", "performance"] as const)(
    "places Ask AI immediately after GitHub in %s mode",
    (mode) => {
      const container = document.createElement("div");
      container.innerHTML = topBarMarkup(mode);
      const actions = container.querySelector(".topbar-external-actions");
      const items = Array.from(actions?.children ?? []);

      expect(items[0]?.classList.contains("github-link")).toBe(true);
      expect(items[1]?.classList.contains("ask-ai-button")).toBe(true);
      expect(items[1]?.getAttribute("aria-haspopup")).toBe("dialog");
    },
  );
});
