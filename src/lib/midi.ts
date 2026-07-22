import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MidiInputInfo, MidiState } from "../types";
import type { RawMidiEvent } from "../types";

type MidiAccessLike = {
  inputs: {
    values: () => IterableIterator<MidiInputLike>;
    get: (id: string) => MidiInputLike | undefined;
  };
  onstatechange: (() => void) | null;
};

type MidiInputLike = {
  id: string;
  name?: string;
  state?: string;
  onmidimessage: ((event: {
    data: Uint8Array | number[];
    timeStamp?: number;
    receivedTime?: number;
  }) => void) | null;
};

export type MidiRawMessageListener = (event: RawMidiEvent) => void;

const initialStatus = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported";

interface PressedMidiNoteState {
  deviceId: string;
  channel: number;
  pitch: number;
  occurrences: number;
}

function pressedNoteKey(deviceId: string, channel: number, pitch: number): string {
  return `${deviceId}\u0000${channel}\u0000${pitch}`;
}

export class MidiPressedNoteTracker {
  private readonly notes = new Map<string, PressedMidiNoteState>();

  process(event: RawMidiEvent): boolean {
    const command = event.status & 0xf0;
    const isNoteOn = command === 0x90 && event.data2 > 0;
    const isNoteOff = command === 0x80 || (command === 0x90 && event.data2 === 0);
    if (isNoteOn) {
      const key = pressedNoteKey(event.deviceId, event.channel, event.data1);
      const current = this.notes.get(key);
      this.notes.set(key, {
        deviceId: event.deviceId,
        channel: event.channel,
        pitch: event.data1,
        occurrences: (current?.occurrences ?? 0) + 1,
      });
      return true;
    }
    if (isNoteOff) {
      const key = pressedNoteKey(event.deviceId, event.channel, event.data1);
      const current = this.notes.get(key);
      if (current && current.occurrences > 1) {
        this.notes.set(key, { ...current, occurrences: current.occurrences - 1 });
      } else {
        this.notes.delete(key);
      }
      return true;
    }
    if (command === 0xb0 && (event.data1 === 120 || event.data1 === 123)) {
      this.releaseChannel(event.deviceId, event.channel);
      return true;
    }
    return false;
  }

  releaseChannel(deviceId: string, channel: number): void {
    for (const [key, note] of this.notes) {
      if (note.deviceId === deviceId && note.channel === channel) {
        this.notes.delete(key);
      }
    }
  }

  releaseDevice(deviceId: string): void {
    for (const [key, note] of this.notes) {
      if (note.deviceId === deviceId) {
        this.notes.delete(key);
      }
    }
  }

  activeChannels(deviceId: string): number[] {
    return [...new Set(Array.from(this.notes.values())
      .filter((note) => note.deviceId === deviceId)
      .map((note) => note.channel))].sort((left, right) => left - right);
  }

  pressedPitches(): number[] {
    return [...new Set(Array.from(this.notes.values()).map((note) => note.pitch))]
      .sort((left, right) => left - right);
  }

  clear(): void {
    this.notes.clear();
  }
}

export function buildDeviceAllNotesOffEvents(
  deviceId: string,
  channels: Iterable<number>,
  timeUs: number,
): RawMidiEvent[] {
  return [...new Set(channels)].sort((left, right) => left - right).map((channel) => ({
    timeUs,
    status: 0xb0 | channel,
    data1: 123,
    data2: 0,
    channel,
    deviceId,
  }));
}

export function useMidi() {
  const accessRef = useRef<MidiAccessLike | null>(null);
  const pressedTrackerRef = useRef(new MidiPressedNoteTracker());
  const touchedChannelsRef = useRef<Map<string, Set<number>>>(new Map());
  const connectedInputIdsRef = useRef<Set<string>>(new Set());
  const attachedInputIdRef = useRef<string | null>(null);
  const rawMessageListenersRef = useRef<Set<MidiRawMessageListener>>(new Set());
  const [state, setState] = useState<MidiState>({
    status: initialStatus,
    inputs: [],
    selectedInputId: null,
    pressedNotes: [],
    eventId: 0,
    error: null,
  });

  const publishPressedNotes = useCallback(() => {
    setState((current) => ({
      ...current,
      pressedNotes: pressedTrackerRef.current.pressedPitches(),
      eventId: current.eventId + 1,
    }));
  }, []);

  const emitRawEvent = useCallback((event: RawMidiEvent) => {
    rawMessageListenersRef.current.forEach((listener) => listener(event));
  }, []);

  const closeDevice = useCallback((deviceId: string, timeUs: number) => {
    const channels = new Set([
      ...(touchedChannelsRef.current.get(deviceId) ?? []),
      ...pressedTrackerRef.current.activeChannels(deviceId),
    ]);
    for (const event of buildDeviceAllNotesOffEvents(deviceId, channels, timeUs)) {
      emitRawEvent(event);
      pressedTrackerRef.current.process(event);
    }
    touchedChannelsRef.current.delete(deviceId);
    pressedTrackerRef.current.releaseDevice(deviceId);
    publishPressedNotes();
  }, [emitRawEvent, publishPressedNotes]);

  const updateInputs = useCallback(() => {
    const access = accessRef.current;
    if (!access) {
      return;
    }

    const inputPorts = Array.from(access.inputs.values());
    const connectedInputIds = new Set(inputPorts.map((input) => input.id));
    const disconnectedInputIds = [...connectedInputIdsRef.current]
      .filter((inputId) => !connectedInputIds.has(inputId));
    const disconnectedAtUs = Math.round(performance.now() * 1000);
    disconnectedInputIds.forEach((inputId) => closeDevice(inputId, disconnectedAtUs));
    if (attachedInputIdRef.current && disconnectedInputIds.includes(attachedInputIdRef.current)) {
      attachedInputIdRef.current = null;
    }
    connectedInputIdsRef.current = connectedInputIds;

    const inputs: MidiInputInfo[] = inputPorts.map((input) => ({
      id: input.id,
      name: input.name || "MIDI 输入",
    }));

    setState((current) => {
      const selectedInputId = current.selectedInputId && connectedInputIds.has(current.selectedInputId)
        ? current.selectedInputId
        : inputs[0]?.id ?? null;
      return {
        ...current,
        inputs,
        status: selectedInputId ? "connected" : "ready",
        selectedInputId,
      };
    });
  }, [closeDevice]);

  const attachInput = useCallback(
    (inputId: string | null) => {
      const access = accessRef.current;
      if (!access) {
        return;
      }

      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }

      const attachedInputId = attachedInputIdRef.current;
      if (attachedInputId && attachedInputId !== inputId) {
        closeDevice(attachedInputId, Math.round(performance.now() * 1000));
      }
      attachedInputIdRef.current = null;

      if (!inputId) {
        return;
      }

      const input = access.inputs.get(inputId);
      if (!input) {
        return;
      }
      attachedInputIdRef.current = inputId;

      input.onmidimessage = (event) => {
        const [status, note, velocity = 0] = Array.from(event.data);
        const eventTimeMs = event.receivedTime ?? event.timeStamp ?? performance.now();
        const rawEvent: RawMidiEvent = {
          timeUs: Math.round(eventTimeMs * 1000),
          status,
          data1: note ?? 0,
          data2: velocity,
          channel: status & 0x0f,
          deviceId: input.id,
        };
        const touchedChannels = touchedChannelsRef.current.get(input.id) ?? new Set<number>();
        touchedChannels.add(rawEvent.channel);
        touchedChannelsRef.current.set(input.id, touchedChannels);
        emitRawEvent(rawEvent);
        if (pressedTrackerRef.current.process(rawEvent)) {
          publishPressedNotes();
        }
      };
    },
    [closeDevice, emitRawEvent, publishPressedNotes],
  );

  const requestAccess = useCallback(async () => {
    if (!("requestMIDIAccess" in navigator)) {
      setState((current) => ({ ...current, status: "unsupported", error: "当前浏览器不支持 MIDI" }));
      return;
    }

    setState((current) => ({ ...current, status: "requesting", error: null }));

    try {
      const access = (await (
        navigator as Navigator & {
          requestMIDIAccess: () => Promise<unknown>;
        }
      ).requestMIDIAccess()) as MidiAccessLike;
      accessRef.current = access;
      connectedInputIdsRef.current = new Set();
      access.onstatechange = updateInputs;
      updateInputs();
    } catch {
      setState((current) => ({ ...current, status: "error", error: "无法获取 MIDI 权限" }));
    }
  }, [updateInputs]);

  const selectInput = useCallback(
    (inputId: string) => {
      setState((current) => ({
        ...current,
        selectedInputId: inputId,
        status: "connected",
      }));
      attachInput(inputId);
    },
    [attachInput],
  );

  useEffect(() => {
    attachInput(state.selectedInputId);
  }, [attachInput, state.selectedInputId]);

  useEffect(() => {
    const touchedChannels = touchedChannelsRef.current;
    const pressedTracker = pressedTrackerRef.current;
    return () => {
      const access = accessRef.current;
      if (!access) {
        return;
      }

      access.onstatechange = null;
      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }
      attachedInputIdRef.current = null;
      connectedInputIdsRef.current.clear();
      touchedChannels.clear();
      pressedTracker.clear();
    };
  }, []);

  const selectedInputName = useMemo(
    () => state.inputs.find((input) => input.id === state.selectedInputId)?.name ?? null,
    [state.inputs, state.selectedInputId],
  );

  const subscribeRawMessages = useCallback((listener: MidiRawMessageListener) => {
    rawMessageListenersRef.current.add(listener);
    return () => rawMessageListenersRef.current.delete(listener);
  }, []);

  return {
    midi: state,
    selectedInputName,
    requestAccess,
    selectInput,
    subscribeRawMessages,
  };
}
