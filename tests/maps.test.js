import { describe, expect, it } from "vitest";
import {
  TILE,
  buildFlowField,
  flowDirection,
  hasLineOfSight,
  isBlocked,
  isSolidChar,
  mapPixelSize,
  moveCircle,
  parseMap,
  tileAt,
} from "../src/maps.js";
import { TEST_ROWS } from "./helpers.js";

const map = parseMap(TEST_ROWS);
const centre = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

describe("parseMap", () => {
  it("reads size, start, gate and spawn points", () => {
    expect(map.width).toBe(11);
    expect(map.height).toBe(7);
    expect(map.start).toMatchObject({ col: 5, row: 4, x: 5 * TILE + 16, y: 4 * TILE + 16 });
    expect(map.gate).toMatchObject({ col: 4, row: 0 });
    expect(map.spawns).toHaveLength(2);
    expect(map.spawns.map((s) => s.group)).toEqual([1, 2]);
  });

  it("aims a multi-tile 廟門 at its middle and keeps every gate tile", () => {
    const wide = parseMap(["##GG##", "#....#", "#.1P.#", "######"]);
    expect(wide.gate.tiles.map((t) => t.col)).toEqual([2, 3]);
    expect(wide.gate.x).toBe(3 * TILE);
    expect(wide.gate.y).toBe(TILE / 2);
    expect(map.gate.tiles).toHaveLength(1);
  });

  it("rejects maps that are missing required markers", () => {
    expect(() => parseMap(["###", "#.#", "###"])).toThrow(/player start/);
    expect(() => parseMap(["#P#", "#.#", "###"])).toThrow(/exit gate/);
    expect(() => parseMap(["#PG", "#.#", "###"])).toThrow(/spawn/);
  });

  it("classifies solid tiles", () => {
    expect(["#", "T", "L", "o"].every(isSolidChar)).toBe(true);
    expect([".", ",", "G", "P", "1"].some(isSolidChar)).toBe(false);
  });

  it("treats out-of-bounds as wall", () => {
    expect(tileAt(map, -1, 0)).toBe("#");
    expect(tileAt(map, 99, 99)).toBe("#");
    expect(isBlocked(map, -5, -5)).toBe(true);
  });
});

describe("moveCircle", () => {
  it("moves freely across open floor", () => {
    const result = moveCircle(map, 176, 144, 12, -8, 11);
    expect(result).toMatchObject({ x: 188, y: 136, hitX: false, hitY: false });
  });

  it("stops at a wall and reports the blocked axis", () => {
    const result = moveCircle(map, 48, 144, -200, 0, 11);
    expect(result.hitX).toBe(true);
    expect(result.hitY).toBe(false);
    expect(result.x).toBeGreaterThanOrEqual(TILE + 11);
  });

  it("slides along a wall instead of sticking", () => {
    const result = moveCircle(map, 48, 144, -200, 30, 11);
    expect(result.hitX).toBe(true);
    expect(result.y).toBeCloseTo(174, 1);
  });

  it("lets the player into the gate throat but not out of the map", () => {
    const stepped = moveCircle(map, map.gate.x, 48, 0, -40, 11);
    expect(stepped.hitY).toBe(true);
    expect(stepped.y).toBeCloseTo(11, 1);
    expect(Math.abs(stepped.y - map.gate.y)).toBeLessThan(24);
  });

  it("does not let a neighbouring column walk through the wall row", () => {
    const result = moveCircle(map, map.gate.x + TILE, 48, 0, -40, 11);
    expect(result.hitY).toBe(true);
    expect(result.y).toBeCloseTo(TILE + 11, 1);
  });

  it("blocks a sideways step out of the gate throat", () => {
    const result = moveCircle(map, map.gate.x, 12, -30, 0, 11);
    expect(result.hitX).toBe(true);
  });
});

describe("line of sight", () => {
  it("sees across open floor", () => {
    expect(hasLineOfSight(map, 48, 48, 300, 48)).toBe(true);
  });

  it("is blocked by a wall", () => {
    expect(hasLineOfSight(map, 48, 48, 48, -40)).toBe(false);
  });
});

describe("flow field", () => {
  const pillar = parseMap([
    "#####G####",
    "#........#",
    "#..####..#",
    "#..#1.#..#",
    "#..####..#",
    "#........#",
    "#...P....#",
    "##########",
  ]);

  it("counts tile steps from the target and marks walls unreachable", () => {
    const from = centre(4, 6);
    const field = buildFlowField(pillar, from.x, from.y);
    const at = (col, row) => field.dist[row * field.width + col];
    expect(at(4, 6)).toBe(0);
    expect(at(5, 6)).toBe(1);
    expect(at(3, 2)).toBe(-1);
    // The 1 spawn sits inside a sealed box, so no route exists.
    expect(at(4, 3)).toBe(-1);
  });

  it("routes around a block instead of pointing into it", () => {
    const target = centre(4, 1);
    const field = buildFlowField(pillar, target.x, target.y);
    const from = centre(4, 5);
    const hint = flowDirection(field, from.x, from.y);
    // Straight up is walled: the hint must have a sideways component.
    expect(hint).toBeTruthy();
    expect(Math.abs(hint.x)).toBeGreaterThan(0.5);
    expect(Math.hypot(hint.x, hint.y)).toBeCloseTo(1, 5);
  });

  it("walks the whole route without getting stuck", () => {
    const target = centre(4, 1);
    const field = buildFlowField(pillar, target.x, target.y);
    let { x, y } = centre(4, 5);
    let guard = 0;
    while (Math.hypot(target.x - x, target.y - y) > TILE && guard < 200) {
      const hint = flowDirection(field, x, y);
      expect(hint, `stalled at ${x},${y}`).toBeTruthy();
      const moved = moveCircle(pillar, x, y, hint.x * 4, hint.y * 4, 10);
      x = moved.x;
      y = moved.y;
      guard += 1;
    }
    expect(guard).toBeLessThan(200);
  });

  it("gives no hint on the target tile, off the map, or from a sealed pocket", () => {
    const target = centre(4, 6);
    const field = buildFlowField(pillar, target.x, target.y);
    expect(flowDirection(field, target.x, target.y)).toBeNull();
    expect(flowDirection(field, -50, -50)).toBeNull();
    const sealed = centre(4, 3);
    expect(flowDirection(field, sealed.x, sealed.y)).toBeNull();
  });

  it("reuses its buffers when the map size is unchanged", () => {
    const first = buildFlowField(pillar, 100, 100);
    const second = buildFlowField(pillar, 140, 100, first);
    expect(second.dist).toBe(first.dist);
    expect(second.targetX).toBe(140);
  });
});

it("reports pixel size", () => {
  expect(mapPixelSize(map)).toEqual({ width: 11 * TILE, height: 7 * TILE });
});
