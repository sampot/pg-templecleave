import { normalizeInput } from "./geometry.js";

export const STICK_RADIUS = 52;
export const STICK_DEAD_ZONE = 0.16;

/** Keyboard → move vector. WASD、方向鍵、注音排列的 ㄨㄗ… 都用實體 code。 */
export const MOVE_KEYS = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
};

export const ACTION_KEYS = {
  KeyJ: "primary",
  Space: "primary",
  KeyK: "whirl",
  KeyL: "talisman",
  ShiftLeft: "dash",
  ShiftRight: "dash",
};

export function keyboardVector(pressed) {
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const delta = MOVE_KEYS[code];
    if (!delta) continue;
    x += delta[0];
    y += delta[1];
  }
  return { x, y };
}

/** How long a tapped action key stays "pressed" for the simulation. */
export const LATCH_TIME = 0.12;

export function createLatches() {
  return { primary: 0, whirl: 0, talisman: 0, dash: 0 };
}

/**
 * A tap that starts and ends between two frames would otherwise be invisible to
 * the fixed-step simulation, so每個動作鍵按下時 latch 一小段時間。
 */
export function latchAction(latches, action, duration = LATCH_TIME) {
  if (!(action in latches)) return latches;
  latches[action] = Math.max(latches[action], duration);
  return latches;
}

export function latchKey(latches, code, duration = LATCH_TIME) {
  const action = ACTION_KEYS[code];
  if (action) latchAction(latches, action, duration);
  return latches;
}

export function tickLatches(latches, dt) {
  for (const key of Object.keys(latches)) {
    latches[key] = Math.max(0, latches[key] - dt);
  }
  return latches;
}

export function keyboardActions(pressed) {
  const actions = { primary: false, whirl: false, talisman: false, dash: false };
  for (const code of pressed) {
    const action = ACTION_KEYS[code];
    if (action) actions[action] = true;
  }
  return actions;
}

/**
 * Floating analog stick: the pointer-down point becomes the centre, so the
 * thumb never has to find a fixed puck. Returns a unit-circle vector.
 */
export function stickVector(origin, point, radius = STICK_RADIUS) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const raw = normalizeInput(dx / radius, dy / radius, STICK_DEAD_ZONE);
  return { x: raw.x, y: raw.y, magnitude: raw.magnitude };
}

/** Where to draw the stick knob (clamped inside the ring). */
export function stickKnob(origin, point, radius = STICK_RADIUS) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: origin.x + dx, y: origin.y + dy };
  return { x: origin.x + (dx / len) * radius, y: origin.y + (dy / len) * radius };
}

/**
 * Merge keyboard state and touch state into the single input contract the
 * simulation reads. Touch wins for movement while a stick pointer is active.
 */
export function composeInput(
  input,
  { pressed = new Set(), stick = null, touchActions = {}, latched = null, aim = null } = {},
) {
  const keys = keyboardVector(pressed);
  const keyMove = normalizeInput(keys.x, keys.y, 0);
  if (stick && stick.magnitude > 0) {
    input.moveX = stick.x;
    input.moveY = stick.y;
  } else {
    input.moveX = keyMove.x;
    input.moveY = keyMove.y;
  }
  if (aim) {
    const pointed = normalizeInput(aim.x, aim.y, 0);
    input.aimX = pointed.x;
    input.aimY = pointed.y;
  } else {
    input.aimX = input.moveX;
    input.aimY = input.moveY;
  }
  const acts = keyboardActions(pressed);
  const held = (action) =>
    Boolean(acts[action] || touchActions[action] || (latched ? latched[action] > 0 : false));
  input.primary = held("primary");
  input.whirl = held("whirl");
  input.talisman = held("talisman");
  input.dash = held("dash");
  return input;
}
