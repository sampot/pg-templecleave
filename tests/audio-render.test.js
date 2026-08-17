import { describe, expect, it } from "vitest";
import { MUSIC_TRACKS, SFX_POOLS, eventToSfx } from "../src/audio.js";
import {
  MAX_CANVAS_PIXELS,
  PLAYER_SPRITE,
  backingScale,
  computeCamera,
  iconForItem,
  spriteRect,
  zoomFor,
} from "../src/render.js";
import { itemByTier } from "../src/equipment.js";
import { TILE, parseMap } from "../src/maps.js";
import { LEVELS } from "../src/levels.js";
import { BOSS_TYPES, ENEMY_TYPES } from "../src/enemies.js";
import { TEST_ROWS } from "./helpers.js";

describe("event → sfx mapping", () => {
  it("maps combat and outcome events onto real pools", () => {
    const cases = {
      cleave: "slash",
      hit: "hit",
      hurt: "hurt",
      whirl: "whirl",
      talisman: "talisman",
      dash: "dash",
      gateOpen: "gate",
      levelClear: "clear",
      victory: "win",
      defeat: "lose",
      bossSpawn: "boss",
    };
    for (const [type, pool] of Object.entries(cases)) {
      expect(eventToSfx({ type }), type).toBe(pool);
      expect(SFX_POOLS[pool], pool).toBeTruthy();
    }
  });

  it("lets the boss death stinger cover the boss kill", () => {
    expect(eventToSfx({ type: "enemyDown", boss: true })).toBeNull();
    expect(eventToSfx({ type: "enemyDown", boss: false })).toBe("down");
  });

  it("ignores unknown or malformed events", () => {
    expect(eventToSfx({ type: "nope" })).toBeNull();
    expect(eventToSfx(null)).toBeNull();
    expect(eventToSfx({})).toBeNull();
  });

  it("names one music track per level plus the plaza theme", () => {
    expect(Object.keys(MUSIC_TRACKS)).toContain("plaza");
    for (const level of LEVELS) {
      expect(MUSIC_TRACKS[level.music], level.id).toBeTruthy();
    }
  });
});

describe("sprite sheet lookup", () => {
  it("indexes the 10-wide 16px creature sheet", () => {
    expect(spriteRect(0)).toEqual({ sx: 0, sy: 0, sw: 16, sh: 16 });
    expect(spriteRect(10)).toEqual({ sx: 0, sy: 16, sw: 16, sh: 16 });
    expect(spriteRect(38)).toEqual({ sx: 128, sy: 48, sw: 16, sh: 16 });
  });

  it("keeps every referenced sprite inside the 180-tile sheet", () => {
    const ids = [...Object.values(ENEMY_TYPES), ...Object.values(BOSS_TYPES)].map((t) => t.sprite);
    for (const index of [...ids, PLAYER_SPRITE]) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(180);
    }
  });

  it("picks an icon per equipment slot", () => {
    expect(iconForItem(itemByTier("weapon", 1))).toBe("sword");
    expect(iconForItem(itemByTier("armor", 1))).toBe("shield");
    expect(iconForItem(itemByTier("charm", 1))).toBe("fire");
    expect(iconForItem({ slot: "incense" })).toBe("suit_hearts");
    expect(iconForItem(null)).toBe("sword");
  });
});

describe("camera", () => {
  const map = parseMap(TEST_ROWS);

  it("centres a map smaller than the viewport", () => {
    const cam = computeCamera(map, { x: 100, y: 100 }, 800, 800);
    expect(cam.x).toBeLessThan(0);
    expect(cam.y).toBeLessThan(0);
  });

  it("follows the player without showing outside the map", () => {
    const cam = computeCamera(map, { x: 176, y: 144 }, 160, 128);
    expect(cam.x).toBeCloseTo(96, 5);
    expect(cam.y).toBeCloseTo(80, 5);
    const clampedTopLeft = computeCamera(map, { x: 0, y: 0 }, 160, 128);
    expect(clampedTopLeft).toMatchObject({ x: 0, y: 0 });
    const clampedBottomRight = computeCamera(map, { x: 9999, y: 9999 }, 160, 128);
    expect(clampedBottomRight.x).toBeCloseTo(map.width * TILE - 160, 5);
    expect(clampedBottomRight.y).toBeCloseTo(map.height * TILE - 128, 5);
  });

  it("caps the backing store so a wall-sized window stays affordable", () => {
    expect(backingScale(390, 700, 3)).toBe(2);
    const wide = backingScale(1400, 900, 2);
    expect(wide).toBeLessThan(2);
    expect(1400 * 900 * wide * wide).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    // Never drop below one device pixel per CSS pixel, even on a huge window.
    expect(backingScale(2765, 1555, 2)).toBe(1);
  });

  it("zooms in on narrow phone viewports and clamps on huge ones", () => {
    const phone = zoomFor(390, 680);
    const desktop = zoomFor(1600, 1200);
    expect(phone).toBeGreaterThan(0.75);
    expect(phone).toBeLessThan(desktop);
    expect(zoomFor(4000, 4000)).toBeLessThanOrEqual(2.2);
    expect(zoomFor(200, 200)).toBeGreaterThanOrEqual(0.75);
  });
});