import { describe, expect, it } from "vitest";
import { LEVELS, LEVEL_COUNT, bossOf, getLevel, totalWaves } from "../src/levels.js";
import { isSolidChar, parseMap } from "../src/maps.js";
import { BOSS_TYPES, ENEMY_TYPES, getEnemyType } from "../src/enemies.js";

describe("level table", () => {
  it("ships five escalating 關", () => {
    expect(LEVEL_COUNT).toBe(5);
    expect(LEVELS.map((l) => l.id)).toEqual([
      "miaocheng",
      "xianglu",
      "xitai",
      "jinlu",
      "miaomen",
    ]);
  });

  it("keeps every map rectangular", () => {
    for (const level of LEVELS) {
      const widths = new Set(level.rows.map((row) => row.length));
      expect(widths.size, `${level.id} rows must share one width`).toBe(1);
    }
  });

  it("parses every map with a start, a gate and spawn points", () => {
    for (const level of LEVELS) {
      const map = parseMap(level.rows);
      expect(map.start, level.id).toBeTruthy();
      expect(map.gate, level.id).toBeTruthy();
      expect(map.spawns.length, level.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("leaves no walled-off floor: gate and spawns are reachable from the start", () => {
    for (const level of LEVELS) {
      const map = parseMap(level.rows);
      const seen = new Set();
      const key = (col, row) => `${col},${row}`;
      const stack = [[map.start.col, map.start.row]];
      seen.add(key(map.start.col, map.start.row));
      while (stack.length) {
        const [col, row] = stack.pop();
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= map.width || nr >= map.height) continue;
          if (isSolidChar(map.grid[nr][nc])) continue;
          if (seen.has(key(nc, nr))) continue;
          seen.add(key(nc, nr));
          stack.push([nc, nr]);
        }
      }
      expect(seen.has(key(map.gate.col, map.gate.row)), `${level.id} gate`).toBe(true);
      for (const spawn of map.spawns) {
        expect(seen.has(key(spawn.col, spawn.row)), `${level.id} spawn ${spawn.group}`).toBe(true);
      }
      let open = 0;
      for (let row = 0; row < map.height; row += 1) {
        for (let col = 0; col < map.width; col += 1) {
          if (!isSolidChar(map.grid[row][col])) open += 1;
        }
      }
      expect(seen.size, `${level.id} isolated pockets`).toBe(open);
    }
  });

  it("keeps the 廟門 approach clear so the exit is always walkable", () => {
    for (const level of LEVELS) {
      const map = parseMap(level.rows);
      for (const tile of map.gate.tiles) {
        for (let row = tile.row + 1; row < map.height - 1; row += 1) {
          expect(
            isSolidChar(map.grid[row][tile.col]),
            `${level.id} blocks the gate lane at ${tile.col},${row}`,
          ).toBe(false);
        }
      }
    }
  });

  it("ends every 關 with exactly one boss wave", () => {
    for (const level of LEVELS) {
      const bossWaves = level.waves.filter((wave) => wave.boss);
      expect(bossWaves.length, level.id).toBe(1);
      expect(level.waves.at(-1).boss, `${level.id} boss must be last`).toBeTruthy();
      expect(BOSS_TYPES[bossOf(level)], level.id).toBeTruthy();
    }
  });

  it("only references known enemy ids", () => {
    for (const level of LEVELS) {
      for (const wave of level.waves) {
        for (const group of wave.spawns ?? []) {
          expect(ENEMY_TYPES[group.type], `${level.id}/${group.type}`).toBeTruthy();
          expect(group.count).toBeGreaterThan(0);
        }
      }
    }
  });

  it("escalates wave count and enemy tuning", () => {
    const waveCounts = LEVELS.map(totalWaves);
    expect(waveCounts[0]).toBeLessThan(waveCounts.at(-1));
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i].tuning.hpScale).toBeGreaterThan(LEVELS[i - 1].tuning.hpScale);
      expect(LEVELS[i].tuning.damageScale).toBeGreaterThan(LEVELS[i - 1].tuning.damageScale);
    }
    const bossHp = LEVELS.map((l) => BOSS_TYPES[bossOf(l)].hp);
    for (let i = 1; i < bossHp.length; i += 1) {
      expect(bossHp[i]).toBeGreaterThan(bossHp[i - 1]);
    }
  });

  it("throws for a level index that does not exist", () => {
    expect(() => getLevel(99)).toThrow(/no level/);
  });
});

describe("enemy archetypes", () => {
  it("covers chase, charger and shooter behaviours", () => {
    const behaviours = new Set(Object.values(ENEMY_TYPES).map((t) => t.behavior));
    expect(behaviours).toEqual(new Set(["chase", "charger", "shooter"]));
  });

  it("gives every shooter a projectile spec", () => {
    for (const type of [...Object.values(ENEMY_TYPES), ...Object.values(BOSS_TYPES)]) {
      if (type.behavior !== "shooter") continue;
      expect(type.projectile, type.id).toMatchObject({ speed: expect.any(Number) });
    }
  });

  it("gives every boss a slam and a summon list", () => {
    for (const boss of Object.values(BOSS_TYPES)) {
      expect(boss.slamRadius, boss.id).toBeGreaterThan(0);
      expect(boss.summons.length, boss.id).toBeGreaterThan(0);
      for (const summon of boss.summons) expect(ENEMY_TYPES[summon], summon).toBeTruthy();
    }
  });

  it("rejects unknown enemy ids", () => {
    expect(() => getEnemyType("nope")).toThrow(/unknown enemy/);
  });
});
