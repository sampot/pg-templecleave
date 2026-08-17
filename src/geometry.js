export const TAU = Math.PI * 2;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function length(x, y) {
  return Math.hypot(x, y);
}

/** Clamp a raw stick/keyboard vector to the unit circle and apply a dead zone. */
export function normalizeInput(x, y, deadZone = 0.15) {
  const len = Math.hypot(x, y);
  if (len <= deadZone) return { x: 0, y: 0, magnitude: 0 };
  const capped = Math.min(len, 1);
  const scaled = (capped - deadZone) / (1 - deadZone);
  return { x: (x / len) * scaled, y: (y / len) * scaled, magnitude: scaled };
}

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Cone hit test used by the cleave attack: the target circle counts as hit when
 * it is inside `range` and its centre (or its nearest edge) falls in the arc.
 */
export function inArc(origin, facing, halfAngle, range, target) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  const reach = range + (target.r || 0);
  if (dist > reach) return false;
  if (dist < 1e-6) return true;
  const slack = Math.asin(clamp((target.r || 0) / Math.max(dist, 1e-6), 0, 1));
  return Math.abs(angleDelta(facing, Math.atan2(dy, dx))) <= halfAngle + slack;
}

/** Move `value` toward `target` by at most `maxDelta`. */
export function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}
