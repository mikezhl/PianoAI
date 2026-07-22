const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface PianoKey {
  midi: number;
  name: string;
  isBlack: boolean;
  whiteIndex: number;
  leftPercent: number;
}

export function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function buildPianoKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  let whiteIndex = -1;
  const whiteCount = Array.from({ length: 88 }, (_, index) => index + 21).filter(
    (midi) => !isBlackKey(midi),
  ).length;

  for (let midi = 21; midi <= 108; midi += 1) {
    const black = isBlackKey(midi);
    if (!black) {
      whiteIndex += 1;
    }

    const leftPercent = black
      ? ((whiteIndex + 0.72) / whiteCount) * 100
      : (whiteIndex / whiteCount) * 100;

    keys.push({
      midi,
      name: midiToName(midi),
      isBlack: black,
      whiteIndex,
      leftPercent,
    });
  }

  return keys;
}

export function uniqueMidis(midis: number[]): number[] {
  return [...new Set(midis)].sort((a, b) => a - b);
}
