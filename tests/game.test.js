import { describe, expect, it } from "vitest";
import {
  GATE_RADIUS,
  MAX_STEP,
  PLAYER_IFRAMES,
  WAVE_GAP,
  advanceLevel,
  bossHealth,
  createGame,
  damageEnemy,
  damagePlayer,
  drainEvents,
  performCleave,
  performDash,
  performTalisman,
  performWhirl,
  step,
  waveLabel,
} from "../src/game.js";
import { TILE } from "../src/maps.js";
import { SKILLS, isReady } from "../src/skills.js";
import { BASE_STATS, itemByTier, playerStats } from "../src/equipment.js";
import { WALL_ROWS, frames, inputWith, makeGame, putEnemy, testLevel } from "./helpers.js";

describe("game setup", () => {
  it("places the player at the map start with a full kit ready", () => {
    const game = createGame({ seed: 1, levels: [testLevel()] });
    expect(game.phase).toBe("playing");
    expect(game.player).toMatchObject({ x: 176, y: 144, hp: BASE_STATS.maxHp, alive: true });
    expect(Object.values(game.player.cooldowns).every((v) => v === 0)).toBe(true);
    expect(game.player.equip).toEqual({ weapon: null, armor: null, charm: null });
  });

  it("queues the first wave instead of dumping every enemy at once", () => {
    const game = createGame({ seed: 1, levels: [testLevel({ waves: [{ spawns: [{ type: "xiaogui", count: 3 }] }] })] });
    expect(game.enemies).toHaveLength(0);
    expect(game.spawnQueue).toHaveLength(3);
    expect(new Set(game.spawnQueue.map((entry) => entry.at)).size).toBe(3);
    frames(game, inputWith(), 60);
    expect(game.enemies).toHaveLength(3);
  });

  it("refuses to build a level that does not exist", () => {
    expect(() => createGame({ levelIndex: 9, levels: [testLevel()] })).toThrow(/no level/);
  });
});

describe("free movement", () => {
  it("moves the player along the input vector", () => {
    const game = makeGame();
    const before = { ...game.player };
    frames(game, inputWith({ moveX: 1 }), 30);
    expect(game.player.x).toBeGreaterThan(before.x + 20);
    expect(game.player.y).toBeCloseTo(before.y, 1);
  });

  it("normalises diagonals so corner-running is not faster", () => {
    const straight = makeGame();
    frames(straight, inputWith({ moveX: 1 }), 30);
    const diagonal = makeGame();
    frames(diagonal, inputWith({ moveX: 1, moveY: -1 }), 30);
    const straightDist = straight.player.x - 176;
    const diagDist = Math.hypot(diagonal.player.x - 176, diagonal.player.y - 144);
    expect(diagDist).toBeCloseTo(straightDist, 0);
  });

  it("cannot walk through the temple wall", () => {
    const game = makeGame();
    frames(game, inputWith({ moveX: -1 }), 240);
    expect(game.player.x).toBeGreaterThan(32);
    expect(game.player.x).toBeLessThan(60);
  });

  it("faces the way it moves and keeps that facing when it stops", () => {
    const game = makeGame();
    frames(game, inputWith({ moveX: -1 }), 5);
    expect(Math.cos(game.player.facing)).toBeLessThan(0);
    frames(game, inputWith(), 5);
    expect(Math.cos(game.player.facing)).toBeLessThan(0);
  });

  it("dashes farther than walking and grants brief invulnerability", () => {
    const walking = makeGame();
    frames(walking, inputWith({ moveX: 1 }), 10);
    const dashing = makeGame();
    dashing.player.facing = 0;
    performDash(dashing);
    expect(dashing.player.invuln).toBeCloseTo(SKILLS.dash.invulnerable, 5);
    frames(dashing, inputWith(), 10);
    expect(dashing.player.x - 176).toBeGreaterThan(walking.player.x - 176);
    expect(isReady(dashing.player.cooldowns, "dash")).toBe(false);
  });
});

describe("斬 (cleave)", () => {
  it("hits what is in front of the swing", () => {
    const game = makeGame();
    game.player.facing = 0;
    const target = putEnemy(game, "xiaogui", 176 + 34, 144);
    const hits = performCleave(game);
    expect(hits).toBe(1);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("misses what is behind or out of reach", () => {
    const game = makeGame();
    game.player.facing = 0;
    const behind = putEnemy(game, "xiaogui", 176 - 40, 144);
    const far = putEnemy(game, "xiaogui", 176 + 140, 144);
    expect(performCleave(game)).toBe(0);
    expect(behind.hp).toBe(behind.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it("cleaves a whole cluster in one arc", () => {
    const game = makeGame();
    game.player.facing = 0;
    putEnemy(game, "xiaogui", 176 + 30, 144 - 12);
    putEnemy(game, "xiaogui", 176 + 34, 144);
    putEnemy(game, "xiaogui", 176 + 30, 144 + 12);
    expect(performCleave(game)).toBe(3);
  });

  it("respects its cooldown when the button is held", () => {
    const game = makeGame();
    game.player.facing = 0;
    const target = putEnemy(game, "yinbing", 176 + 30, 144);
    frames(game, inputWith({ primary: true }), 2);
    const afterFirst = target.hp;
    frames(game, inputWith({ primary: true }), 2);
    expect(target.hp).toBe(afterFirst);
    expect(isReady(game.player.cooldowns, "cleave")).toBe(false);
  });

  it("hits harder with a better blade", () => {
    const bare = makeGame();
    bare.player.facing = 0;
    const weak = putEnemy(bare, "jiangshi", 176 + 30, 144);
    performCleave(bare);
    const bareDamage = weak.maxHp - weak.hp;

    const armed = makeGame();
    armed.player.facing = 0;
    armed.player.equip.weapon = itemByTier("weapon", 5);
    const tough = putEnemy(armed, "jiangshi", 176 + 30, 144);
    performCleave(armed);
    expect(tough.maxHp - tough.hp).toBeGreaterThan(bareDamage);
  });

  it("reaches farther with a longer blade", () => {
    const game = makeGame();
    game.player.facing = 0;
    game.player.equip.weapon = itemByTier("weapon", 5);
    const stats = playerStats(game.player);
    const target = putEnemy(game, "xiaogui", 176 + stats.reach + 8, 144);
    expect(performCleave(game)).toBe(1);
  });
});

describe("旋斬／火符", () => {
  it("whirls into everything around the player, near only", () => {
    const game = makeGame();
    const near = putEnemy(game, "xiaogui", 176 - 40, 144);
    const alsoNear = putEnemy(game, "xiaogui", 176, 144 + 50);
    const far = putEnemy(game, "xiaogui", 176 + 200, 144);
    expect(performWhirl(game)).toBe(2);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(alsoNear.hp).toBeLessThan(alsoNear.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it("throws a talisman that flies out and blasts on impact", () => {
    const game = makeGame();
    game.player.facing = 0;
    const target = putEnemy(game, "jiangshi", 176 + 110, 144);
    performTalisman(game);
    expect(game.projectiles).toHaveLength(1);
    frames(game, inputWith(), 40);
    expect(game.projectiles).toHaveLength(0);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(game.stats.damageDealt).toBeGreaterThan(0);
  });

  it("splashes the blast onto neighbours", () => {
    const game = makeGame();
    game.player.facing = 0;
    const direct = putEnemy(game, "jiangshi", 176 + 100, 144);
    const splash = putEnemy(game, "jiangshi", 176 + 130, 144 + 30);
    performTalisman(game);
    frames(game, inputWith(), 40);
    expect(direct.hp).toBeLessThan(direct.maxHp);
    expect(splash.hp).toBeLessThan(splash.maxHp);
  });
});

describe("enemy behaviour", () => {
  it("chasers close the distance", () => {
    const game = makeGame();
    const chaser = putEnemy(game, "yinbing", 176 + 150, 144);
    const before = chaser.x - game.player.x;
    frames(game, inputWith(), 30);
    expect(chaser.x - game.player.x).toBeLessThan(before - 10);
  });

  it("chargers telegraph before they lunge", () => {
    const game = makeGame();
    const charger = putEnemy(game, "huogui", 176 + 120, 144);
    frames(game, inputWith(), 2);
    expect(charger.windUp).toBeGreaterThan(0);
    const heldPosition = charger.x;
    frames(game, inputWith(), 4);
    expect(Math.abs(charger.x - heldPosition)).toBeLessThan(6);
    frames(game, inputWith(), 40);
    expect(charger.x).toBeLessThan(heldPosition - 20);
  });

  it("shooters keep their distance and spit projectiles", () => {
    const game = makeGame();
    putEnemy(game, "yanmei", 176 + 150, 144);
    frames(game, inputWith(), 360);
    expect(game.stats.damageTaken).toBeGreaterThan(0);
  });

  it("winds up between contact hits instead of shredding on touch", () => {
    const game = makeGame();
    const enemy = putEnemy(game, "yinbing", 176 + 8, 144);
    expect(enemy.attackTimer).toBeGreaterThan(0);
    frames(game, inputWith(), 1);
    expect(game.player.hp).toBe(BASE_STATS.maxHp);
  });

  it("hurts the player on contact, then respects i-frames", () => {
    const game = makeGame();
    putEnemy(game, "yinbing", 176 + 8, 144).attackTimer = 0;
    frames(game, inputWith(), 1);
    const afterFirstHit = game.player.hp;
    expect(afterFirstHit).toBeLessThan(BASE_STATS.maxHp);
    expect(game.player.invuln).toBeCloseTo(PLAYER_IFRAMES, 2);
    frames(game, inputWith(), 4);
    expect(game.player.hp).toBe(afterFirstHit);
  });

  it("takes less damage with armor on", () => {
    const bare = makeGame();
    putEnemy(bare, "jiangshi", 176 + 6, 144).attackTimer = 0;
    frames(bare, inputWith(), 1);
    const bareLoss = BASE_STATS.maxHp - bare.player.hp;
    expect(bareLoss).toBeGreaterThan(0);

    const armored = makeGame();
    armored.player.equip.armor = itemByTier("armor", 5);
    putEnemy(armored, "jiangshi", 176 + 6, 144).attackTimer = 0;
    frames(armored, inputWith(), 1);
    expect(BASE_STATS.maxHp - armored.player.hp).toBeLessThan(bareLoss);
  });

  it("walks the flow field around a 供桌 row instead of grinding into it", () => {
    const game = makeGame({ levels: [testLevel({ rows: WALL_ROWS })] });
    const enemy = putEnemy(game, "yinbing", 4 * TILE + 16, 2 * TILE + 16);
    const startGap = Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y);
    frames(game, inputWith(), 660);
    const gap = Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y);
    expect(gap, `stalled ${startGap} -> ${gap}`).toBeLessThan(TILE * 1.5);
  });

  it("rebuilds the flow field on the player every tick", () => {
    const game = makeGame();
    frames(game, inputWith({ moveX: 1 }), 6);
    expect(game.flow.targetX).toBeCloseTo(game.player.x, 5);
    expect(game.flow.targetY).toBeCloseTo(game.player.y, 5);
  });

  it("keeps a charger from lunging at a wall it cannot see through", () => {
    const game = makeGame({ levels: [testLevel({ rows: WALL_ROWS })] });
    const charger = putEnemy(game, "huogui", 5 * TILE + 16, 2 * TILE + 16);
    frames(game, inputWith(), 8);
    expect(charger.windUp).toBe(0);
    expect(charger.chargeTimer).toBe(0);
    // Blocked line of sight means it walks the long way round instead.
    expect(Math.abs(charger.x - (5 * TILE + 16))).toBeGreaterThan(2);
  });

  it("stops enemies stacking on the exact same pixel", () => {
    const game = makeGame();
    const a = putEnemy(game, "xiaogui", 240, 144);
    const b = putEnemy(game, "xiaogui", 240, 144);
    frames(game, inputWith(), 5);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4);
  });
});

describe("bosses", () => {
  it("announces the boss and exposes its health for the HUD", () => {
    const game = makeGame();
    expect(bossHealth(game)).toBeNull();
    const boss = putEnemy(game, "niutou", 176, 80);
    const bar = bossHealth(game);
    expect(bar).toMatchObject({ name: "牛頭將", maxHp: boss.maxHp, ratio: 1 });
    damageEnemy(game, boss, 60);
    expect(bossHealth(game).ratio).toBeLessThan(1);
  });

  it("slams the ground and hurts a player standing inside the ring", () => {
    const game = makeGame();
    const boss = putEnemy(game, "guiwang", 176 + 30, 144);
    boss.slamTimer = 0;
    frames(game, inputWith(), 1);
    expect(game.events.map((e) => e.type)).toContain("slam");
    expect(game.player.hp).toBeLessThan(BASE_STATS.maxHp);
  });

  it("summons reinforcements on its own timer", () => {
    const game = makeGame();
    const boss = putEnemy(game, "heiwuchang", 176, 80);
    boss.summonTimer = 0;
    frames(game, inputWith(), 1);
    expect(game.enemies.length).toBeGreaterThan(1);
    expect(game.events.map((e) => e.type)).toContain("summon");
  });

  it("credits a big score and always drops loot when it dies", () => {
    const game = makeGame();
    const boss = putEnemy(game, "niutou", 176, 80);
    damageEnemy(game, boss, 9999);
    expect(game.enemies).toHaveLength(0);
    expect(game.kills).toBe(1);
    expect(game.score).toBeGreaterThanOrEqual(200);
    expect(game.drops).toHaveLength(1);
    expect(game.drops[0].item.slot).not.toBe("incense");
    expect(game.events.map((e) => e.type)).toContain("bossDown");
  });
});

describe("loot on the floor", () => {
  it("equips a dropped blade when the player walks over it", () => {
    const game = makeGame();
    game.drops.push({ x: 176, y: 144, item: itemByTier("weapon", 3), ttl: 10, radius: 12, bob: 0 });
    frames(game, inputWith(), 1);
    expect(game.player.equip.weapon.tier).toBe(3);
    expect(game.drops).toHaveLength(0);
    expect(game.events.map((e) => e.type)).toContain("equip");
  });

  it("melts a worse blade for score instead of downgrading", () => {
    const game = makeGame();
    game.player.equip.weapon = itemByTier("weapon", 4);
    game.player.hp = 70;
    game.drops.push({ x: 176, y: 144, item: itemByTier("weapon", 2), ttl: 10, radius: 12, bob: 0 });
    frames(game, inputWith(), 1);
    expect(game.player.equip.weapon.tier).toBe(4);
    expect(game.player.hp).toBeGreaterThan(70);
    expect(game.score).toBeGreaterThan(0);
  });

  it("expires loot that is left on the ground", () => {
    const game = makeGame();
    game.drops.push({ x: 40, y: 40, item: itemByTier("armor", 1), ttl: 0.02, radius: 12, bob: 0 });
    frames(game, inputWith(), 3);
    expect(game.drops).toHaveLength(0);
  });
});

describe("waves, gate and outcomes", () => {
  const twoWaves = testLevel({
    waves: [{ spawns: [{ type: "xiaogui", count: 1 }] }, { spawns: [{ type: "wugong", count: 1 }] }],
  });

  it("labels the current 陣", () => {
    const game = makeGame({ levels: [twoWaves] });
    expect(waveLabel(game)).toBe("第 1／2 陣");
  });

  it("waits out the wave gap before sending the next 陣", () => {
    const game = makeGame({ levels: [twoWaves] });
    frames(game, inputWith(), 1);
    expect(game.waveIndex).toBe(0);
    expect(game.waveGap).toBeCloseTo(WAVE_GAP, 2);
    frames(game, inputWith(), 30);
    expect(game.waveIndex).toBe(0);
    frames(game, inputWith(), 90);
    expect(game.waveIndex).toBe(1);
    expect(game.spawnQueue.length + game.enemies.length).toBeGreaterThan(0);
  });

  it("opens the gate only after the last 陣 is cleared", () => {
    const game = makeGame({ levels: [twoWaves] });
    expect(game.gateOpen).toBe(false);
    frames(game, inputWith(), 200);
    game.enemies = [];
    game.spawnQueue = [];
    frames(game, inputWith(), 2);
    expect(game.gateOpen).toBe(true);
    expect(game.events.map((e) => e.type)).toContain("gateOpen");
  });

  it("clears the 關 when the player reaches the open gate", () => {
    const game = makeGame({ levels: [testLevel(), testLevel({ id: "second" })] });
    game.gateOpen = true;
    game.player.x = game.map.gate.x;
    game.player.y = game.map.gate.y + GATE_RADIUS - 2;
    frames(game, inputWith(), 1);
    expect(game.phase).toBe("cleared");
    expect(game.events.map((e) => e.type)).toContain("levelClear");
  });

  it("does not open the gate on touch while enemies remain", () => {
    const game = makeGame({ levels: [testLevel(), testLevel({ id: "second" })] });
    putEnemy(game, "xiaogui", 60, 200);
    game.player.x = game.map.gate.x;
    game.player.y = game.map.gate.y;
    frames(game, inputWith(), 1);
    expect(game.phase).toBe("playing");
  });

  it("wins the run at the gate of the final 關", () => {
    const game = makeGame({ levels: [testLevel()] });
    game.gateOpen = true;
    game.player.x = game.map.gate.x;
    game.player.y = game.map.gate.y + 4;
    frames(game, inputWith(), 1);
    expect(game.phase).toBe("victory");
    expect(game.events.map((e) => e.type)).toContain("victory");
  });

  it("loses the run when HP hits zero, and then freezes the sim", () => {
    const game = makeGame();
    damagePlayer(game, 9999);
    expect(game.phase).toBe("defeat");
    expect(game.player.alive).toBe(false);
    expect(game.player.hp).toBe(0);
    expect(game.events.map((e) => e.type)).toContain("defeat");
    const frozen = game.time;
    frames(game, inputWith({ moveX: 1 }), 10);
    expect(game.time).toBe(frozen);
  });

  it("ignores damage while invulnerable", () => {
    const game = makeGame();
    damagePlayer(game, 10);
    const hp = game.player.hp;
    expect(damagePlayer(game, 10)).toBe(0);
    expect(game.player.hp).toBe(hp);
  });

  it("carries gear into the next 關 and grants a small heal", () => {
    const game = makeGame({ levels: [testLevel(), testLevel({ id: "second", name: "第二埕" })] });
    game.player.equip.weapon = itemByTier("weapon", 3);
    game.player.hp = 40;
    game.enemies = [putEnemy(game, "xiaogui", 60, 60)];
    advanceLevel(game);
    expect(game.levelIndex).toBe(1);
    expect(game.level.name).toBe("第二埕");
    expect(game.player.equip.weapon.tier).toBe(3);
    expect(game.player.hp).toBeGreaterThan(40);
    expect(game.enemies).toHaveLength(0);
    expect(game.gateOpen).toBe(false);
    expect(game.phase).toBe("playing");
  });

  it("wins instead of advancing past the last 關", () => {
    const game = makeGame({ levels: [testLevel()] });
    advanceLevel(game);
    expect(game.phase).toBe("victory");
  });
});

describe("simulation hygiene", () => {
  it("clamps a huge delta so a backgrounded tab cannot tunnel through walls", () => {
    const game = makeGame();
    step(game, inputWith({ moveX: 1 }), 30);
    expect(game.time).toBeCloseTo(MAX_STEP, 6);
    expect(game.player.x).toBeLessThan(200);
  });

  it("drains events so each cue is consumed once", () => {
    const game = makeGame();
    performWhirl(game);
    const first = drainEvents(game);
    expect(first.map((e) => e.type)).toContain("whirl");
    expect(drainEvents(game)).toEqual([]);
  });

  it("is deterministic for the same seed", () => {
    const run = (seed) => {
      const game = createGame({ seed, levels: [testLevel()] });
      frames(game, inputWith({ moveX: 1, primary: true }), 200);
      return { x: game.player.x, hp: game.player.hp, score: game.score, kills: game.kills };
    };
    expect(run(1234)).toEqual(run(1234));
  });

  it("counts damage dealt and taken for the結算 panel", () => {
    const game = makeGame();
    game.player.facing = 0;
    putEnemy(game, "xiaogui", 176 + 30, 144);
    performCleave(game);
    damagePlayer(game, 12);
    expect(game.stats.damageDealt).toBeGreaterThan(0);
    expect(game.stats.damageTaken).toBeGreaterThan(0);
  });
});
