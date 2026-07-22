import { useMemo } from "react";
import { buildPianoKeys, uniqueMidis } from "../lib/piano";

interface PianoKeyboardProps {
  targetNotes: number[];
  pressedNotes: number[];
  onKeyPress: (midi: number) => void;
  onKeyRelease: (midi: number) => void;
}

const keys = buildPianoKeys();
const whiteKeys = keys.filter((key) => !key.isBlack);
const blackKeys = keys.filter((key) => key.isBlack);
const whiteWidth = 100 / whiteKeys.length;

function getKeyClasses(midi: number, targetSet: Set<number>, pressedSet: Set<number>): string {
  const target = targetSet.has(midi);
  const pressed = pressedSet.has(midi);

  return [
    target ? "key-target" : "",
    pressed ? "key-pressed" : "",
    target && pressed ? "key-correct" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function PianoKeyboard({ targetNotes, pressedNotes, onKeyPress, onKeyRelease }: PianoKeyboardProps) {
  const targetSet = useMemo(() => new Set(targetNotes), [targetNotes]);
  const pressedSet = useMemo(() => new Set(pressedNotes), [pressedNotes]);
  const labels = useMemo(() => new Set(uniqueMidis(targetNotes)), [targetNotes]);

  return (
    <section className="keyboard-shell" aria-label="钢琴键盘">
      <div className="keyboard">
        <div className="white-key-row">
          {whiteKeys.map((key) => {
            const stateClass = getKeyClasses(key.midi, targetSet, pressedSet);

            return (
              <button
                type="button"
                key={key.midi}
                className={`piano-key white-key ${stateClass}`}
                style={{ width: `${whiteWidth}%` }}
                tabIndex={-1}
                aria-label={key.name}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onKeyPress(key.midi);
                }}
                onPointerUp={() => onKeyRelease(key.midi)}
                onPointerCancel={() => onKeyRelease(key.midi)}
                onLostPointerCapture={() => onKeyRelease(key.midi)}
              >
                {labels.has(key.midi) ? <span>{key.name}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="black-key-row">
          {blackKeys.map((key) => {
            const stateClass = getKeyClasses(key.midi, targetSet, pressedSet);

            return (
              <button
                type="button"
                key={key.midi}
                className={`piano-key black-key ${stateClass}`}
                style={{
                  left: `${key.leftPercent}%`,
                  width: `${whiteWidth * 0.64}%`,
                }}
                tabIndex={-1}
                aria-label={key.name}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onKeyPress(key.midi);
                }}
                onPointerUp={() => onKeyRelease(key.midi)}
                onPointerCancel={() => onKeyRelease(key.midi)}
                onLostPointerCapture={() => onKeyRelease(key.midi)}
              >
                {labels.has(key.midi) ? <span>{key.name}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
