import { describe, expect, it } from "vitest";
import {
  LATCH_TIME,
  STICK_RADIUS,
  composeInput,
  createLatches,
  keyboardActions,
  keyboardVector,
  latchAction,
  latchKey,
  stickKnob,
  stickVector,
  tickLatches,
} from "../src/input.js";
import { createInput, resetInput } from "../src/game.js";

describe("keyboard mapping", () => {
  it("maps WASD and arrows to the same axes", () => {
    expect(keyboardVector(new Set(["KeyW"]))).toEqual({ x: 0, y: -1 });
    expect(keyboardVector(new Set(["ArrowUp"]))).toEqual({ x: 0, y: -1 });
    expect(keyboardVector(new Set(["KeyD", "KeyS"]))).toEqual({ x: 1, y: 1 });
  });

  it("cancels opposing keys", () => {
    expect(keyboardVector(new Set(["KeyA", "KeyD"]))).toEqual({ x: 0, y: 0 });
  });

  it("maps action keys, with space aliasing the swing", () => {
    expect(keyboardActions(new Set(["Space"])).primary).toBe(true);
    expect(keyboardActions(new Set(["KeyJ"])).primary).toBe(true);
    expect(keyboardActions(new Set(["KeyK"])).whirl).toBe(true);
    expect(keyboardActions(new Set(["KeyL"])).talisman).toBe(true);
    expect(keyboardActions(new Set(["ShiftRight"])).dash).toBe(true);
    expect(keyboardActions(new Set(["KeyZ"]))).toEqual({
      primary: false,
      whirl: false,
      talisman: false,
      dash: false,
    });
  });
});

describe("floating analog stick", () => {
  const origin = { x: 100, y: 100 };

  it("reads the drag as a unit-circle vector from the touch-down point", () => {
    const vec = stickVector(origin, { x: 100 + STICK_RADIUS, y: 100 });
    expect(vec.x).toBeCloseTo(1, 5);
    expect(vec.y).toBeCloseTo(0, 5);
    expect(vec.magnitude).toBeCloseTo(1, 5);
  });

  it("ignores a thumb twitch inside the dead zone", () => {
    expect(stickVector(origin, { x: 104, y: 100 }).magnitude).toBe(0);
  });

  it("supports diagonals without exceeding full deflection", () => {
    const vec = stickVector(origin, { x: 100 + STICK_RADIUS, y: 100 + STICK_RADIUS });
    expect(Math.hypot(vec.x, vec.y)).toBeLessThanOrEqual(1.0001);
    expect(vec.x).toBeCloseTo(vec.y, 6);
  });

  it("clamps the drawn knob to the ring", () => {
    const far = stickKnob(origin, { x: 400, y: 100 });
    expect(far.x - origin.x).toBeCloseTo(STICK_RADIUS, 5);
    const near = stickKnob(origin, { x: 120, y: 100 });
    expect(near.x).toBe(120);
  });
});

describe("action latches", () => {
  it("keeps a tap alive long enough for the fixed step to see it", () => {
    const latches = createLatches();
    latchKey(latches, "KeyJ");
    expect(latches.primary).toBe(LATCH_TIME);
    const input = createInput();
    composeInput(input, { pressed: new Set(), latched: latches });
    expect(input.primary).toBe(true);
  });

  it("expires so a tap does not become a hold", () => {
    const latches = createLatches();
    latchAction(latches, "whirl");
    tickLatches(latches, LATCH_TIME + 0.01);
    expect(latches.whirl).toBe(0);
    const input = createInput();
    composeInput(input, { latched: latches });
    expect(input.whirl).toBe(false);
  });

  it("ignores keys and actions that are not bound", () => {
    const latches = createLatches();
    latchKey(latches, "KeyQ");
    latchAction(latches, "teleport");
    expect(latches).toEqual({ primary: 0, whirl: 0, talisman: 0, dash: 0 });
  });

  it("never ticks below zero", () => {
    const latches = createLatches();
    latchAction(latches, "dash");
    tickLatches(latches, 99);
    expect(latches.dash).toBe(0);
  });
});

describe("composeInput", () => {
  it("lets the stick win over the keyboard for movement", () => {
    const input = createInput();
    composeInput(input, {
      pressed: new Set(["KeyA"]),
      stick: { x: 1, y: 0, magnitude: 1 },
    });
    expect(input.moveX).toBeCloseTo(1, 5);
  });

  it("falls back to the keyboard when no stick pointer is down", () => {
    const input = createInput();
    composeInput(input, { pressed: new Set(["KeyA"]), stick: null });
    expect(input.moveX).toBeCloseTo(-1, 5);
  });

  it("aims along movement by default and along the pointer when given", () => {
    const input = createInput();
    composeInput(input, { pressed: new Set(["KeyS"]) });
    expect(input.aimY).toBeCloseTo(1, 5);
    composeInput(input, { pressed: new Set(["KeyS"]), aim: { x: -10, y: 0 } });
    expect(input.aimX).toBeCloseTo(-1, 5);
    expect(input.aimY).toBeCloseTo(0, 5);
  });

  it("ors keyboard and on-screen buttons", () => {
    const input = createInput();
    composeInput(input, { touchActions: { whirl: true } });
    expect(input.whirl).toBe(true);
    composeInput(input, { pressed: new Set(["KeyK"]), touchActions: {} });
    expect(input.whirl).toBe(true);
    composeInput(input, {});
    expect(input.whirl).toBe(false);
  });

  it("resetInput drops every held axis and button (lifecycle §3.5)", () => {
    const input = createInput();
    composeInput(input, {
      pressed: new Set(["KeyW", "KeyJ", "ShiftLeft"]),
      stick: { x: 1, y: 1, magnitude: 1 },
      touchActions: { talisman: true },
    });
    expect(input.primary).toBe(true);
    resetInput(input);
    expect(input).toEqual({
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      primary: false,
      whirl: false,
      talisman: false,
      dash: false,
    });
  });
});
