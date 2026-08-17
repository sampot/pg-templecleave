import { describe, expect, it } from "vitest";
import {
  angleDelta,
  approach,
  circlesOverlap,
  clamp,
  inArc,
  normalizeInput,
} from "../src/geometry.js";

describe("normalizeInput", () => {
  it("zeroes anything inside the dead zone", () => {
    expect(normalizeInput(0.1, 0, 0.15)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(normalizeInput(0, 0, 0.15).magnitude).toBe(0);
  });

  it("caps diagonal input to the unit circle", () => {
    const vec = normalizeInput(1, 1, 0);
    expect(Math.hypot(vec.x, vec.y)).toBeCloseTo(1, 5);
    expect(vec.x).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("rescales past the dead zone so full deflection is still 1", () => {
    expect(normalizeInput(1, 0, 0.2).x).toBeCloseTo(1, 5);
    expect(normalizeInput(0.6, 0, 0.2).x).toBeCloseTo(0.5, 5);
  });
});

describe("inArc", () => {
  const origin = { x: 100, y: 100 };

  it("hits a target inside the cone", () => {
    expect(inArc(origin, 0, 1, 50, { x: 140, y: 100, r: 8 })).toBe(true);
  });

  it("misses a target behind the swing", () => {
    expect(inArc(origin, 0, 1, 50, { x: 60, y: 100, r: 8 })).toBe(false);
  });

  it("misses a target beyond reach", () => {
    expect(inArc(origin, 0, 1, 50, { x: 200, y: 100, r: 8 })).toBe(false);
  });

  it("gives fat targets some angular slack", () => {
    const narrow = inArc(origin, 0, 0.2, 60, { x: 130, y: 118, r: 2 });
    const fat = inArc(origin, 0, 0.2, 60, { x: 130, y: 118, r: 18 });
    expect(narrow).toBe(false);
    expect(fat).toBe(true);
  });
});

describe("misc helpers", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("overlaps circles by radius sum", () => {
    expect(circlesOverlap(0, 0, 5, 9, 0, 5)).toBe(true);
    expect(circlesOverlap(0, 0, 5, 11, 0, 5)).toBe(false);
  });

  it("returns the shortest angle difference", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(angleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(angleDelta(0, Math.PI * 1.9))).toBeCloseTo(Math.PI * 0.1, 6);
  });

  it("approaches a target without overshooting", () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(0, 2, 3)).toBe(2);
    expect(approach(10, 0, 3)).toBe(7);
  });
});
