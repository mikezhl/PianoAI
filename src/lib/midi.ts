import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MidiInputInfo, MidiState } from "../types";

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
  onmidimessage: ((event: { data: Uint8Array | number[] }) => void) | null;
};

const initialStatus = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported";

export function useMidi() {
  const accessRef = useRef<MidiAccessLike | null>(null);
  const pressedRef = useRef<Set<number>>(new Set());
  const [state, setState] = useState<MidiState>({
    status: initialStatus,
    inputs: [],
    selectedInputId: null,
    pressedNotes: [],
    eventId: 0,
    error: null,
  });

  const clearPressedNotes = useCallback(() => {
    if (pressedRef.current.size === 0) {
      return;
    }

    pressedRef.current = new Set();
    setState((current) => ({
      ...current,
      pressedNotes: [],
      eventId: current.eventId + 1,
    }));
  }, []);

  const updateInputs = useCallback(() => {
    const access = accessRef.current;
    if (!access) {
      return;
    }

    const inputs: MidiInputInfo[] = Array.from(access.inputs.values()).map((input) => ({
      id: input.id,
      name: input.name || "MIDI 输入",
    }));

    setState((current) => ({
      ...current,
      inputs,
      status: inputs.length > 0 ? (current.selectedInputId ? "connected" : "ready") : "ready",
      selectedInputId:
        current.selectedInputId && inputs.some((input) => input.id === current.selectedInputId)
          ? current.selectedInputId
          : inputs[0]?.id ?? null,
    }));
  }, []);

  const attachInput = useCallback(
    (inputId: string | null) => {
      const access = accessRef.current;
      if (!access) {
        return;
      }

      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }
      clearPressedNotes();

      if (!inputId) {
        return;
      }

      const input = access.inputs.get(inputId);
      if (!input) {
        return;
      }

      input.onmidimessage = (event) => {
        const [status, note, velocity = 0] = Array.from(event.data);
        const command = status & 0xf0;
        const isNoteOn = command === 0x90 && velocity > 0;
        const isNoteOff = command === 0x80 || (command === 0x90 && velocity === 0);

        if (!isNoteOn && !isNoteOff) {
          return;
        }

        const next = new Set(pressedRef.current);
        if (isNoteOn) {
          next.add(note);
        } else {
          next.delete(note);
        }

        pressedRef.current = next;
        setState((current) => ({
          ...current,
          pressedNotes: Array.from(next).sort((a, b) => a - b),
          eventId: current.eventId + 1,
        }));
      };
    },
    [clearPressedNotes],
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
    return () => {
      const access = accessRef.current;
      if (!access) {
        return;
      }

      access.onstatechange = null;
      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }
      pressedRef.current = new Set();
    };
  }, []);

  const selectedInputName = useMemo(
    () => state.inputs.find((input) => input.id === state.selectedInputId)?.name ?? null,
    [state.inputs, state.selectedInputId],
  );

  return {
    midi: state,
    selectedInputName,
    requestAccess,
    selectInput,
  };
}
