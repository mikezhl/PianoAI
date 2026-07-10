import { Hand, NoteGroup, ParsedNote, PlaybackEvent, ScoreData, TICKS_PER_QUARTER } from "../types";
import { midiToName } from "./piano";

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"] as const;
const STEP_TO_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

const ACCIDENTAL_ALTERS: Record<string, number> = {
  "double-sharp": 2,
  sharp: 1,
  natural: 0,
  flat: -1,
  "flat-flat": -2,
  "double-flat": -2,
};

const SMUFL_ACCIDENTAL_ALTERS: Record<string, number> = {
  "\uE260": -1,
  "\uE261": 0,
  "\uE262": 1,
  "\uE263": 2,
  "\uE264": -2,
};

const ORNAMENT_NOTE_TICKS = TICKS_PER_QUARTER / 8;
const MIN_ORNAMENT_NOTE_TICKS = TICKS_PER_QUARTER / 24;

interface PitchInfo {
  step: string;
  alter: number;
  octave: number;
  midi: number;
}

interface OrnamentAccidental {
  alter: number;
  placement: "above" | "below";
  y: number;
  explicitPlacement: boolean;
}

interface PendingGraceNote {
  midi: number;
  hand: Hand;
  staff: number;
  voice: string;
}

interface ActiveTie {
  note: ParsedNote;
  pitch: PitchInfo;
  ornaments: Element | null;
  accidentals: OrnamentAccidental[];
  graceNotes: PendingGraceNote[];
}

function directChild(parent: Element, tagName: string): Element | null {
  return Array.from(parent.children).find((child) => child.localName === tagName) ?? null;
}

function directChildren(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === tagName);
}

function descendants(doc: Document, tagName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS("*", tagName));
}

function childText(parent: Element, tagName: string): string | null {
  return directChild(parent, tagName)?.textContent?.trim() ?? null;
}

function numberText(parent: Element, tagName: string, fallback: number): number {
  const raw = childText(parent, tagName);
  const parsed = raw == null ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function durationToTicks(rawDuration: number, divisions: number): number {
  if (divisions <= 0) {
    return 0;
  }

  return Math.round((rawDuration / divisions) * TICKS_PER_QUARTER);
}

function getNumericAttribute(element: Element, attribute: string): number | null {
  const value = element.getAttribute(attribute);
  if (value == null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberAttribute(element: Element, attribute: string, fallback: number): number {
  return getNumericAttribute(element, attribute) ?? fallback;
}

function normalizePitchAlter(alter: number): number {
  return Math.round(alter);
}

function pitchToInfo(note: Element): PitchInfo | null {
  const pitch = directChild(note, "pitch");
  if (!pitch) {
    return null;
  }

  const step = childText(pitch, "step");
  const octaveText = childText(pitch, "octave");
  if (!step || octaveText == null) {
    return null;
  }

  const octave = Number.parseInt(octaveText, 10);
  const alter = normalizePitchAlter(numberText(pitch, "alter", 0));
  if (!Number.isFinite(octave) || STEP_TO_SEMITONE[step] == null) {
    return null;
  }

  return {
    step,
    alter,
    octave,
    midi: (octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter,
  };
}

function pitchToMidi(note: Element): number | null {
  return pitchToInfo(note)?.midi ?? null;
}

function pitchInfoToMidi(pitch: Pick<PitchInfo, "step" | "alter" | "octave">): number {
  return (pitch.octave + 1) * 12 + STEP_TO_SEMITONE[pitch.step] + pitch.alter;
}

function pitchInfoToWrittenName(pitch: PitchInfo): string {
  const accidental = pitch.alter === 2
    ? "##"
    : pitch.alter === 1
      ? "#"
      : pitch.alter === -1
        ? "b"
        : pitch.alter === -2
          ? "bb"
          : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}

function hasTieType(note: Element, type: "start" | "stop"): boolean {
  const notations = directChild(note, "notations");
  const notationTies = notations ? directChildren(notations, "tied") : [];

  return [...directChildren(note, "tie"), ...notationTies].some((tie) => tie.getAttribute("type") === type);
}

function tieKey(midi: number, staff: number, voice: string): string {
  return `${staff}:${voice}:${midi}`;
}

function getHand(note: Element, midi: number, hasExplicitStaff: boolean): Hand {
  const staff = Number.parseInt(childText(note, "staff") ?? "", 10);
  if (staff === 2) {
    return "left";
  }

  if (staff === 1) {
    return "right";
  }

  return hasExplicitStaff ? "right" : midi < 60 ? "left" : "right";
}

interface MeasureTiming {
  durationTicks: number;
  timeSignature: {
    beats: number;
    beatType: number;
  };
}

function getMeasureTiming(measure: Element, previous: MeasureTiming): MeasureTiming {
  const attributes = directChild(measure, "attributes");
  const time = attributes ? directChild(attributes, "time") : null;
  if (!time) {
    return previous;
  }

  const beats = numberText(time, "beats", 4);
  const beatType = numberText(time, "beat-type", 4);
  return {
    durationTicks: Math.round(beats * (4 / beatType) * TICKS_PER_QUARTER),
    timeSignature: { beats, beatType },
  };
}

function titleFromFileName(fileName: string): string {
  const normalized = fileName.split(/[\\/]/).pop() ?? fileName;
  return normalized.replace(/\.(?:musicxml|mxl|xml)$/i, "");
}

function getTitle(fileName: string): string {
  return titleFromFileName(fileName) || "未命名谱子";
}

function directionWords(direction: Element): Element[] {
  return directChildren(direction, "direction-type").flatMap((directionType) => directChildren(directionType, "words"));
}

function getWordY(word: Element): number {
  return getNumericAttribute(word, "relative-y") ?? getNumericAttribute(word, "default-y") ?? 0;
}

function getWordPlacement(word: Element): "above" | "below" {
  const y = getWordY(word);
  if (y !== 0) {
    return y > 0 ? "above" : "below";
  }

  const direction = word.closest("direction");
  return direction?.getAttribute("placement") === "below" ? "below" : "above";
}

function getPendingOrnamentAccidentals(direction: Element): OrnamentAccidental[] {
  return directionWords(direction).flatMap((word) => {
    const text = word.textContent?.trim() ?? "";
    const alter = SMUFL_ACCIDENTAL_ALTERS[text];
    if (alter == null) {
      return [];
    }

    return [{
      alter,
      placement: getWordPlacement(word),
      y: getWordY(word),
      explicitPlacement: false,
    }];
  });
}

function getOrnaments(note: Element): Element | null {
  const notations = directChild(note, "notations");
  return notations ? directChild(notations, "ornaments") : null;
}

function normalizeAccidentalPlacements(accidentals: OrnamentAccidental[]): OrnamentAccidental[] {
  if (accidentals.length <= 1 || accidentals.every((accidental) => accidental.explicitPlacement)) {
    return accidentals;
  }

  const sorted = [...accidentals].sort((a, b) => a.y - b.y);
  return sorted.map((accidental, index) => ({
    ...accidental,
    placement: index === 0 ? "below" : index === sorted.length - 1 ? "above" : accidental.placement,
  }));
}

function getOrnamentAccidentals(note: Element, pending: OrnamentAccidental[]): OrnamentAccidental[] {
  const ornaments = getOrnaments(note);
  const marks = ornaments
    ? directChildren(ornaments, "accidental-mark").flatMap((mark) => {
        const text = mark.textContent?.trim() ?? "";
        const alter = ACCIDENTAL_ALTERS[text];
        if (alter == null) {
          return [];
        }

        const placement: "above" | "below" = mark.getAttribute("placement") === "below" ? "below" : "above";
        return [{
          alter,
          placement,
          y: placement === "below" ? -1 : 1,
          explicitPlacement: true,
        }];
      })
    : [];

  return normalizeAccidentalPlacements([...pending, ...marks]);
}

function getMarkedAuxiliaryAlter(accidentals: OrnamentAccidental[], placement: "above" | "below"): number | null {
  return accidentals.find((accidental) => accidental.placement === placement)?.alter ?? null;
}

function diatonicNeighborMidi(pitch: PitchInfo, direction: "above" | "below", alter: number): number {
  const stepIndex = STEP_TO_INDEX[pitch.step];
  const nextIndex = direction === "above" ? stepIndex + 1 : stepIndex - 1;
  const wrappedIndex = (nextIndex + STEP_NAMES.length) % STEP_NAMES.length;
  const octaveShift = nextIndex < 0 ? -1 : nextIndex >= STEP_NAMES.length ? 1 : 0;

  return pitchInfoToMidi({
    step: STEP_NAMES[wrappedIndex],
    alter,
    octave: pitch.octave + octaveShift,
  });
}

function trillStepInterval(element: Element | null): number {
  const trillStep = element?.getAttribute("trill-step");
  if (trillStep === "half") {
    return 1;
  }

  if (trillStep === "unison") {
    return 0;
  }

  return 2;
}

function auxiliaryMidi(
  pitch: PitchInfo,
  direction: "above" | "below",
  element: Element | null,
  accidentals: OrnamentAccidental[],
): number {
  const placement = direction === "above" ? "above" : "below";
  const markedAlter = getMarkedAuxiliaryAlter(accidentals, placement);
  if (markedAlter != null) {
    return diatonicNeighborMidi(pitch, direction, markedAlter);
  }

  const interval = trillStepInterval(element);
  return direction === "above" ? pitch.midi + interval : pitch.midi - interval;
}

function buildSequenceEvents(midis: number[], offsetTicks: number, availableTicks: number): PlaybackEvent[] {
  if (midis.length === 0) {
    return [];
  }

  const totalTicks = Math.max(MIN_ORNAMENT_NOTE_TICKS * midis.length, availableTicks);
  const noteTicks = Math.max(MIN_ORNAMENT_NOTE_TICKS, Math.floor(totalTicks / midis.length));

  return midis.map((midi, index) => ({
    midis: [midi],
    offsetTicks: offsetTicks + index * noteTicks,
    durationTicks: noteTicks,
  }));
}

function buildAlternatingEvents(
  mainMidi: number,
  auxiliaryMidiValue: number,
  element: Element,
  offsetTicks: number,
  availableTicks: number,
): PlaybackEvent[] {
  const requestedBeats = numberAttribute(element, "beats", 0);
  const count = Math.max(
    3,
    Math.min(12, requestedBeats > 0 ? Math.round(requestedBeats) : Math.round(availableTicks / ORNAMENT_NOTE_TICKS)),
  );
  const startNote = element.getAttribute("start-note");
  const startsWithAuxiliary = startNote === "upper" || startNote === "below";
  const sequence = Array.from({ length: count }, (_, index) =>
    (index % 2 === 0) === startsWithAuxiliary ? auxiliaryMidiValue : mainMidi,
  );

  return buildSequenceEvents(sequence, offsetTicks, availableTicks);
}

function buildOrnamentEvents(
  pitch: PitchInfo,
  durationTicks: number,
  offsetTicks: number,
  ornaments: Element | null,
  accidentals: OrnamentAccidental[],
): PlaybackEvent[] {
  if (!ornaments) {
    return [];
  }

  const availableTicks = Math.max(MIN_ORNAMENT_NOTE_TICKS, durationTicks - offsetTicks);
  const trill = directChild(ornaments, "trill-mark");
  if (trill) {
    return buildAlternatingEvents(
      pitch.midi,
      auxiliaryMidi(pitch, "above", trill, accidentals),
      trill,
      offsetTicks,
      availableTicks,
    );
  }

  const invertedMordent = directChild(ornaments, "inverted-mordent");
  if (invertedMordent) {
    return buildAlternatingEvents(
      pitch.midi,
      auxiliaryMidi(pitch, "above", invertedMordent, accidentals),
      invertedMordent,
      offsetTicks,
      Math.min(availableTicks, ORNAMENT_NOTE_TICKS * 3),
    );
  }

  const mordent = directChild(ornaments, "mordent");
  if (mordent) {
    return buildAlternatingEvents(
      pitch.midi,
      auxiliaryMidi(pitch, "below", mordent, accidentals),
      mordent,
      offsetTicks,
      Math.min(availableTicks, ORNAMENT_NOTE_TICKS * 3),
    );
  }

  const turn = directChild(ornaments, "turn");
  if (turn) {
    return buildSequenceEvents(
      [
        auxiliaryMidi(pitch, "above", turn, accidentals),
        pitch.midi,
        auxiliaryMidi(pitch, "below", turn, accidentals),
        pitch.midi,
      ],
      offsetTicks,
      Math.min(availableTicks, ORNAMENT_NOTE_TICKS * 4),
    );
  }

  const invertedTurn = directChild(ornaments, "inverted-turn");
  if (invertedTurn) {
    return buildSequenceEvents(
      [
        auxiliaryMidi(pitch, "below", invertedTurn, accidentals),
        pitch.midi,
        auxiliaryMidi(pitch, "above", invertedTurn, accidentals),
        pitch.midi,
      ],
      offsetTicks,
      Math.min(availableTicks, ORNAMENT_NOTE_TICKS * 4),
    );
  }

  return [];
}

function buildPlaybackEvents(
  pitch: PitchInfo,
  durationTicks: number,
  ornaments: Element | null,
  accidentals: OrnamentAccidental[],
  graceNotes: PendingGraceNote[],
): PlaybackEvent[] {
  const safeDurationTicks = Math.max(MIN_ORNAMENT_NOTE_TICKS, durationTicks || ORNAMENT_NOTE_TICKS);
  const graceNoteTicks = graceNotes.length > 0
    ? Math.max(MIN_ORNAMENT_NOTE_TICKS, Math.min(ORNAMENT_NOTE_TICKS, Math.floor(safeDurationTicks / (graceNotes.length + 1))))
    : 0;
  const graceEvents = graceNotes.map((grace, index) => ({
    midis: [grace.midi],
    offsetTicks: index * graceNoteTicks,
    durationTicks: graceNoteTicks,
  }));
  const mainOffsetTicks = graceNotes.length * graceNoteTicks;
  const ornamentEvents = buildOrnamentEvents(pitch, safeDurationTicks, mainOffsetTicks, ornaments, accidentals);

  if (ornamentEvents.length > 0) {
    return [...graceEvents, ...ornamentEvents];
  }

  return [
    ...graceEvents,
    {
      midis: [pitch.midi],
      offsetTicks: mainOffsetTicks,
      durationTicks: Math.max(MIN_ORNAMENT_NOTE_TICKS, safeDurationTicks - mainOffsetTicks),
    },
  ];
}

export function parseMusicXml(xml: string, fileName: string): ScoreData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = descendants(doc, "parsererror")[0];
  if (parserError) {
    throw new Error("MusicXML 文件格式无效");
  }

  const root = doc.documentElement;
  const parts = root?.localName === "score-partwise" ? directChildren(root, "part") : [];
  if (parts.length === 0) {
    throw new Error("没有找到可解析的乐谱声部");
  }

  const notes: ParsedNote[] = [];
  const measureDurations: number[] = [];
  const measureStarts: number[] = [];
  const measureTimeSignatures: ScoreData["measureTimeSignatures"] = [];
  let globalNoteIndex = 0;
  let explicitStaffCount = 0;

  for (const part of parts) {
    let divisions = 1;
    let fallbackTiming: MeasureTiming = {
      durationTicks: TICKS_PER_QUARTER * 4,
      timeSignature: { beats: 4, beatType: 4 },
    };
    let partMeasureStart = 0;
    const activeTies = new Map<string, ActiveTie>();

    directChildren(part, "measure").forEach((measure, measureIndex) => {
      const attributes = directChild(measure, "attributes");
      if (attributes) {
        divisions = numberText(attributes, "divisions", divisions);
      }

      fallbackTiming = getMeasureTiming(measure, fallbackTiming);
      measureStarts[measureIndex] = measureStarts[measureIndex] ?? partMeasureStart;
      measureTimeSignatures[measureIndex] = measureTimeSignatures[measureIndex] ?? fallbackTiming.timeSignature;

      let cursor = 0;
      let lastStart = 0;
      let maxCursor = 0;
      let hasTimedContent = false;
      let pendingGraceNotes: PendingGraceNote[] = [];
      let pendingOrnamentAccidentals: OrnamentAccidental[] = [];

      for (const child of Array.from(measure.children)) {
        if (child.localName === "backup") {
          cursor = Math.max(0, cursor - numberText(child, "duration", 0));
          continue;
        }

        if (child.localName === "forward") {
          const forwardDuration = numberText(child, "duration", 0);
          cursor += forwardDuration;
          maxCursor = Math.max(maxCursor, cursor);
          hasTimedContent = hasTimedContent || forwardDuration > 0;
          continue;
        }

        if (child.localName === "direction") {
          pendingOrnamentAccidentals.push(...getPendingOrnamentAccidentals(child));
          continue;
        }

        if (child.localName !== "note") {
          continue;
        }

        const isChord = directChild(child, "chord") != null;
        const rawDuration = numberText(child, "duration", 0);
        const durationTicks = durationToTicks(rawDuration, divisions);
        const start = isChord ? lastStart : cursor;
        const startTick = durationToTicks(start, divisions);
        const pitch = pitchToInfo(child);
        const midi = pitch?.midi ?? null;
        const isRest = directChild(child, "rest") != null;
        const isGrace = directChild(child, "grace") != null;
        const voice = childText(child, "voice") ?? "";
        const hasExplicitStaff = directChild(child, "staff") != null;
        if (hasExplicitStaff) {
          explicitStaffCount += 1;
        }

        if (midi != null && pitch && !isRest) {
          const hand = getHand(child, midi, hasExplicitStaff);
          const staff = Number.parseInt(childText(child, "staff") ?? (hand === "left" ? "2" : "1"), 10);
          if (isGrace) {
            pendingGraceNotes.push({ midi, hand, staff, voice });
            continue;
          }

          const isTieStop = hasTieType(child, "stop");
          const isTieStart = hasTieType(child, "start");
          const activeTieKey = tieKey(midi, staff, voice);
          const activeTie = activeTies.get(activeTieKey);

          if (isTieStop && activeTie) {
            pendingGraceNotes = pendingGraceNotes.filter((grace) => grace.staff !== staff || grace.voice !== voice);
            activeTie.note.durationTicks += durationTicks;
            activeTie.note.playbackEvents = buildPlaybackEvents(
              activeTie.pitch,
              activeTie.note.durationTicks,
              activeTie.ornaments,
              activeTie.accidentals,
              activeTie.graceNotes,
            );

            if (!isTieStart) {
              activeTies.delete(activeTieKey);
            }
          } else if (!isTieStop) {
            const ornaments = getOrnaments(child);
            const ornamentAccidentals = getOrnamentAccidentals(child, pendingOrnamentAccidentals);
            const graceNotes = pendingGraceNotes.filter((grace) => grace.staff === staff && grace.voice === voice);
            pendingGraceNotes = pendingGraceNotes.filter((grace) => grace.staff !== staff || grace.voice !== voice);
            const parsedNote: ParsedNote = {
              id: `n-${globalNoteIndex}`,
              midi,
              name: midiToName(midi),
              writtenName: pitchInfoToWrittenName(pitch),
              hand,
              staff,
              measureIndex,
              startTick,
              absoluteTick: partMeasureStart + startTick,
              durationTicks,
              playbackEvents: buildPlaybackEvents(pitch, durationTicks, ornaments, ornamentAccidentals, graceNotes),
            };

            notes.push(parsedNote);
            globalNoteIndex += 1;
            if (isTieStart) {
              activeTies.set(activeTieKey, {
                note: parsedNote,
                pitch,
                ornaments,
                accidentals: ornamentAccidentals,
                graceNotes,
              });
            }
          }
        }

        pendingOrnamentAccidentals = [];
        if (!isChord) {
          cursor += rawDuration;
          lastStart = start;
          maxCursor = Math.max(maxCursor, cursor);
          hasTimedContent = hasTimedContent || rawDuration > 0;
        }
      }

      const measureDuration = hasTimedContent ? durationToTicks(maxCursor, divisions) : fallbackTiming.durationTicks;
      measureDurations[measureIndex] = Math.max(measureDurations[measureIndex] ?? 0, measureDuration);
      partMeasureStart += measureDuration;
    });
  }

  const groupMap = new Map<string, NoteGroup>();
  for (const note of notes) {
    const key = `${note.absoluteTick}:${note.hand}`;
    const existing = groupMap.get(key);
    if (existing) {
      if (!existing.notes.some((candidate) => candidate.midi === note.midi)) {
        existing.notes.push(note);
      }
      existing.playbackEvents.push(...note.playbackEvents);
      existing.durationTicks = Math.max(existing.durationTicks, note.durationTicks);
    } else {
      groupMap.set(key, {
        id: `g-${groupMap.size}`,
        hand: note.hand,
        measureIndex: note.measureIndex,
        startTick: note.startTick,
        absoluteTick: note.absoluteTick,
        durationTicks: note.durationTicks,
        notes: [note],
        playbackEvents: [...note.playbackEvents],
      });
    }
  }

  for (const group of groupMap.values()) {
    group.playbackEvents.sort((a, b) => a.offsetTicks - b.offsetTicks);
  }

  const noteGroups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.absoluteTick !== b.absoluteTick) {
      return a.absoluteTick - b.absoluteTick;
    }
    return a.hand === "right" ? -1 : 1;
  });

  const hasLeftHand = noteGroups.some((group) => group.hand === "left");
  const hasRightHand = noteGroups.some((group) => group.hand === "right");
  const totalTicks = Math.max(
    ...noteGroups.map((group) => group.absoluteTick + group.durationTicks),
    measureDurations.reduce((sum, duration) => sum + duration, 0),
  );

  return {
    title: getTitle(fileName),
    xml,
    noteGroups,
    measureStarts,
    measureDurations,
    measureTimeSignatures,
    totalTicks,
    canSeparateHands: explicitStaffCount > 0 || (hasLeftHand && hasRightHand),
    hasLeftHand,
    hasRightHand,
  };
}

export function getStepTicks(score: ScoreData | null): number[] {
  if (!score) {
    return [];
  }

  return [...new Set(score.noteGroups.map((group) => group.absoluteTick))].sort((a, b) => a - b);
}

export function getGroupsAtTick(score: ScoreData | null, tick: number): NoteGroup[] {
  if (!score) {
    return [];
  }

  return score.noteGroups.filter((group) => group.absoluteTick === tick);
}

export function groupContainsAllPressed(group: NoteGroup, pressedNotes: number[]): boolean {
  return group.notes.every((note) => pressedNotes.includes(note.midi));
}

export function groupsContainAllPressed(groups: NoteGroup[], pressedNotes: number[]): boolean {
  return groups.length > 0 && groups.every((group) => groupContainsAllPressed(group, pressedNotes));
}
