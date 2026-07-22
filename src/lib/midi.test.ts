import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawMidiEvent } from "../types";
import { buildDeviceAllNotesOffEvents, MidiPressedNoteTracker, useMidi } from "./midi";

const originalMidiAccessDescriptor = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");

afterEach(() => {
  if (originalMidiAccessDescriptor) {
    Object.defineProperty(navigator, "requestMIDIAccess", originalMidiAccessDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "requestMIDIAccess");
  }
});

function event(status: number, pitch: number, velocity: number, deviceId = "device"): RawMidiEvent {
  return {
    timeUs: 1_000,
    status,
    data1: pitch,
    data2: velocity,
    channel: status & 0x0f,
    deviceId,
  };
}

describe("MIDI pressed-note occurrence tracking", () => {
  it("keeps a repeated same-channel pitch pressed until both occurrences end", () => {
    const tracker = new MidiPressedNoteTracker();
    tracker.process(event(0x90, 60, 90));
    tracker.process(event(0x90, 60, 80));
    tracker.process(event(0x80, 60, 0));
    expect(tracker.pressedPitches()).toEqual([60]);
    tracker.process(event(0x80, 60, 0));
    expect(tracker.pressedPitches()).toEqual([]);
  });

  it("keeps equal pitches on different channels independent", () => {
    const tracker = new MidiPressedNoteTracker();
    tracker.process(event(0x90, 60, 90));
    tracker.process(event(0x91, 60, 80));
    tracker.process(event(0x80, 60, 0));
    expect(tracker.pressedPitches()).toEqual([60]);
    tracker.process(event(0x81, 60, 0));
    expect(tracker.pressedPitches()).toEqual([]);
  });

  it("builds deterministic channel-scoped all-notes-off evidence on disconnect", () => {
    expect(buildDeviceAllNotesOffEvents("device", [2, 0, 2], 9_000)).toEqual([
      { timeUs: 9_000, status: 0xb0, data1: 123, data2: 0, channel: 0, deviceId: "device" },
      { timeUs: 9_000, status: 0xb2, data1: 123, data2: 0, channel: 2, deviceId: "device" },
    ]);
  });

  it("emits all-notes-off at the device disconnect time instead of session end", async () => {
    const input = {
      id: "device",
      name: "Piano",
      onmidimessage: null as ((event: { data: number[]; timeStamp?: number }) => void) | null,
    };
    const inputs = new Map([[input.id, input]]);
    const access = {
      inputs: {
        values: () => inputs.values(),
        get: (id: string) => inputs.get(id),
      },
      onstatechange: null as (() => void) | null,
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: vi.fn(async () => access),
    });

    let midiApi: ReturnType<typeof useMidi> | null = null;
    function Harness() {
      midiApi = useMidi();
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
    const captured: RawMidiEvent[] = [];
    const unsubscribe = midiApi!.subscribeRawMessages((rawEvent) => captured.push(rawEvent));

    await act(async () => {
      await midiApi!.requestAccess();
    });
    await act(async () => {
      input.onmidimessage?.({ data: [0x92, 60, 90], timeStamp: 1 });
    });
    expect(midiApi!.midi.pressedNotes).toEqual([60]);

    await act(async () => {
      inputs.delete(input.id);
      access.onstatechange?.();
    });
    expect(captured.at(-1)).toMatchObject({
      status: 0xb2,
      data1: 123,
      data2: 0,
      channel: 2,
      deviceId: "device",
    });
    expect(midiApi!.midi.pressedNotes).toEqual([]);

    unsubscribe();
    await act(async () => root.unmount());
  });
});
