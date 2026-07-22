interface SkyBottomLineCalculatorLike {
  mBottomLine: number[];
  SamplingUnit: number;
  getBottomLineMaxInRange: (start: number, end: number) => number;
}

interface StaffLineLike {
  Pedals: unknown[];
  SkyBottomLineCalculator: SkyBottomLineCalculatorLike;
}

interface HorizontalPedalCalculatorLike {
  rules: { RenderSingleHorizontalStaffline: boolean };
  calculatePedalSkyBottomLine: (...args: unknown[]) => unknown;
}

interface CalculatorConstructorLike {
  prototype: object;
}

interface StaffLinePedalState {
  baseBottomLine: number[];
}

const installedPrototypes = new WeakSet<object>();

/**
 * OSMD lays every pedal segment on one StaffLine in horizontal mode. Its normal
 * per-system algorithm then treats the preceding segment as a new obstacle, so
 * a long chain descends once per change. Reusing the pre-pedal bottom line for
 * each segment preserves collision clearance while merging the resulting
 * extents instead of feeding pedal output back into the next calculation.
 */
export function installHorizontalPedalLayoutFix(Calculator: CalculatorConstructorLike): void {
  const prototype = Calculator.prototype as HorizontalPedalCalculatorLike;
  if (installedPrototypes.has(prototype)) {
    return;
  }

  const original = prototype.calculatePedalSkyBottomLine;
  const stateByStaffLine = new WeakMap<object, StaffLinePedalState>();

  prototype.calculatePedalSkyBottomLine = function patchedHorizontalPedalLayout(
    this: HorizontalPedalCalculatorLike,
    ...args: unknown[]
  ) {
    const parentStaffLine = args[3] as StaffLineLike;
    if (!this.rules.RenderSingleHorizontalStaffline) {
      return original.apply(this, args);
    }

    const outline = parentStaffLine.SkyBottomLineCalculator;
    let state = stateByStaffLine.get(parentStaffLine);
    if (!state || parentStaffLine.Pedals.length === 0) {
      state = {
        baseBottomLine: [...outline.mBottomLine],
      };
      stateByStaffLine.set(parentStaffLine, state);
    }

    const regularBottomLineQuery = outline.getBottomLineMaxInRange;
    outline.getBottomLineMaxInRange = (start, end) => {
      const firstIndex = Math.max(0, Math.floor(start * outline.SamplingUnit));
      const lastIndex = Math.min(state.baseBottomLine.length - 1, Math.ceil(end * outline.SamplingUnit));
      let maximum = Number.NEGATIVE_INFINITY;
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        maximum = Math.max(maximum, state.baseBottomLine[index]);
      }
      return maximum;
    };

    try {
      return original.apply(this, args);
    } finally {
      outline.getBottomLineMaxInRange = regularBottomLineQuery;
    }
  };

  installedPrototypes.add(prototype);
}
