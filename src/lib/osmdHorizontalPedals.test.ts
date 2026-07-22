import { describe, expect, it } from "vitest";
import { installHorizontalPedalLayoutFix } from "./osmdHorizontalPedals";

class FakeCalculator {
  rules = { RenderSingleHorizontalStaffline: true };

  calculatePedalSkyBottomLine(_start: unknown, _end: unknown, _pedal: unknown, staffLine: FakeStaffLine) {
    const outline = staffLine.SkyBottomLineCalculator;
    const next = outline.getBottomLineMaxInRange(0, 1) + 2;
    outline.mBottomLine = outline.mBottomLine.map(() => next);
  }
}

class FakeStaffLine {
  Pedals: unknown[] = [];
  SkyBottomLineCalculator = {
    mBottomLine: [5, 5],
    SamplingUnit: 1,
    getBottomLineMaxInRange: (start: number, end: number) => {
      const values = this.SkyBottomLineCalculator.mBottomLine.slice(Math.floor(start), Math.ceil(end) + 1);
      return Math.max(...values);
    },
  };
}

describe("installHorizontalPedalLayoutFix", () => {
  it("merges sequential horizontal pedal extents without cumulative descent", () => {
    installHorizontalPedalLayoutFix(FakeCalculator);
    const calculator = new FakeCalculator();
    const staffLine = new FakeStaffLine();

    calculator.calculatePedalSkyBottomLine(null, null, null, staffLine);
    staffLine.Pedals.push({});
    calculator.calculatePedalSkyBottomLine(null, null, null, staffLine);
    staffLine.Pedals.push({});
    calculator.calculatePedalSkyBottomLine(null, null, null, staffLine);

    expect(staffLine.SkyBottomLineCalculator.mBottomLine).toEqual([7, 7]);
  });

  it("does not alter OSMD's vertical-system calculation", () => {
    installHorizontalPedalLayoutFix(FakeCalculator);
    const calculator = new FakeCalculator();
    calculator.rules.RenderSingleHorizontalStaffline = false;
    const staffLine = new FakeStaffLine();

    calculator.calculatePedalSkyBottomLine(null, null, null, staffLine);
    staffLine.Pedals.push({});
    calculator.calculatePedalSkyBottomLine(null, null, null, staffLine);

    expect(staffLine.SkyBottomLineCalculator.mBottomLine).toEqual([9, 9]);
  });
});
