import { createRng } from "./rng.js";
import { circlesOverlap, clamp, inArc, normalizeInput } from "./geometry.js";
import {
  TILE,
  buildFlowField,
  flowDirection,
  hasLineOfSight,
  isBlocked,
  moveCircle,
  parseMap,
} from "./maps.js";
import { LEVELS } from "./levels.js";
import { spawnEnemy } from "./enemies.js";
import {
  BASE_STATS,
  applyPickup,
  damageTaken,
  playerStats,
  rollDrop,
} from "./equipment.js";
import { SKILLS, createCooldowns, isReady, startCooldown, tickCooldowns } from "./skills.js";

export const WAVE_GAP = 1.5;
export const SPAWN_STAGGER = 0.32;
export const PLAYER_IFRAMES = 0.5;
export const DROP_LIFETIME = 24;
export const GATE_RADIUS = 24;
export const HEAL_ON_CLEAR = 45;
export const HEAL_ON_WAVE = 8;
export const MAX_STEP = 1 / 30;

export function createInput() {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    primary: false,
    whirl: false,
    talisman: false,
    dash: false,
  };
}

export function resetInput(input) {
  input.moveX = 0;
  input.moveY = 0;
  input.aimX = 0;
  input.aimY = 0;
  input.primary = false;
  input.whirl = false;
  input.talisman = false;
  input.dash = false;
  return input;
}

function createPlayer(map) {
  return {
    x: map.start.x,
    y: map.start.y,
    vx: 0,
    vy: 0,
    radius: 11,
    hp: BASE_STATS.maxHp,
    maxHp: BASE_STATS.maxHp,
    facing: -Math.PI / 2,
    moving: false,
    cooldowns: createCooldowns(),
    equip: { weapon: null, armor: null, charm: null },
    invuln: 0,
    dashTime: 0,
    dashX: 0,
    dashY: 0,
    swingTime: 0,
    hurtFlash: 0,
    alive: true,
  };
}

export function createGame({ seed = 1, levelIndex = 0, levels = LEVELS } = {}) {
  const level = levels[levelIndex];
  if (!level) throw new Error(`no level at index ${levelIndex}`);
  const map = parseMap(level.rows);
  const game = {
    seed,
    rng: createRng(seed),
    levels,
    levelIndex,
    level,
    map,
    flow: null,
    phase: "playing",
    player: createPlayer(map),
    enemies: [],
    projectiles: [],
    drops: [],
    effects: [],
    events: [],
    waveIndex: 0,
    waveTime: 0,
    waveGap: 0,
    spawnQueue: [],
    bossAlive: false,
    gateOpen: false,
    score: 0,
    kills: 0,
    time: 0,
    nextUid: 1,
    stats: { damageDealt: 0, damageTaken: 0, pickups: 0, waves: 0 },
  };
  beginWave(game, 0);
  return game;
}

/** Reuse the player (gear + HP) when walking through the gate into the next 關. */
export function advanceLevel(game) {
  const nextIndex = game.levelIndex + 1;
  if (nextIndex >= game.levels.length) {
    game.phase = "victory";
    return game;
  }
  const level = game.levels[nextIndex];
  const map = parseMap(level.rows);
  const carried = game.player;
  game.levelIndex = nextIndex;
  game.level = level;
  game.map = map;
  game.flow = null;
  game.player = {
    ...carried,
    x: map.start.x,
    y: map.start.y,
    vx: 0,
    vy: 0,
    hp: Math.min(carried.maxHp, carried.hp + HEAL_ON_CLEAR),
    facing: -Math.PI / 2,
    invuln: 0,
    dashTime: 0,
    swingTime: 0,
    hurtFlash: 0,
    cooldowns: createCooldowns(),
  };
  game.enemies = [];
  game.projectiles = [];
  game.drops = [];
  game.effects = [];
  game.waveIndex = 0;
  game.waveTime = 0;
  game.waveGap = 0;
  game.spawnQueue = [];
  game.bossAlive = false;
  game.gateOpen = false;
  game.phase = "playing";
  beginWave(game, 0);
  return game;
}

function pushEvent(game, type, data = {}) {
  game.events.push({ type, ...data });
}

function addEffect(game, effect) {
  game.effects.push({ ttl: 0.3, life: effect.ttl ?? 0.3, ...effect });
}

function floatText(game, x, y, text, color = "#ffe9a8") {
  addEffect(game, { kind: "text", x, y, text, color, ttl: 1, life: 1 });
}

export function currentWave(game) {
  return game.level.waves[game.waveIndex] ?? null;
}

export function beginWave(game, index) {
  game.waveIndex = index;
  game.waveTime = 0;
  game.spawnQueue = [];
  const wave = game.level.waves[index];
  if (!wave) return game;
  const spawnPoints = game.map.spawns;
  let order = 0;
  if (wave.boss) {
    const point = spawnPoints[Math.floor(game.rng() * spawnPoints.length)];
    game.spawnQueue.push({ type: wave.boss, at: 0.35, x: point.x, y: point.y, boss: true });
    game.bossAlive = true;
  }
  for (const group of wave.spawns ?? []) {
    for (let i = 0; i < group.count; i += 1) {
      const point = spawnPoints[(order + i) % spawnPoints.length];
      game.spawnQueue.push({
        type: group.type,
        at: 0.2 + order * SPAWN_STAGGER + i * SPAWN_STAGGER,
        x: point.x,
        y: point.y,
      });
    }
    order += 1;
  }
  pushEvent(game, "waveStart", { index, boss: Boolean(wave.boss) });
  return game;
}

function jitterAround(game, x, y, spread = 12) {
  const jx = x + (game.rng() * 2 - 1) * spread;
  const jy = y + (game.rng() * 2 - 1) * spread;
  return isBlocked(game.map, jx, jy) ? { x, y } : { x: jx, y: jy };
}

function addEnemy(game, type, x, y) {
  const enemy = spawnEnemy(type, x, y, { ...game.level.tuning, uid: game.nextUid++ });
  game.enemies.push(enemy);
  addEffect(game, { kind: "spawn", x, y, ttl: 0.45, life: 0.45 });
  if (enemy.boss) pushEvent(game, "bossSpawn", { name: enemy.name });
  return enemy;
}

function updateSpawns(game, dt) {
  game.waveTime += dt;
  const due = [];
  game.spawnQueue = game.spawnQueue.filter((entry) => {
    if (entry.at <= game.waveTime) {
      due.push(entry);
      return false;
    }
    return true;
  });
  for (const entry of due) {
    const spot = jitterAround(game, entry.x, entry.y, entry.boss ? 0 : 14);
    addEnemy(game, entry.type, spot.x, spot.y);
  }
}

function updateWaveProgress(game, dt) {
  if (game.gateOpen) return;
  if (game.waveGap > 0) {
    game.waveGap = Math.max(0, game.waveGap - dt);
    if (game.waveGap === 0) beginWave(game, game.waveIndex + 1);
    return;
  }
  if (game.spawnQueue.length > 0 || game.enemies.length > 0) return;
  game.stats.waves += 1;
  if (game.waveIndex >= game.level.waves.length - 1) {
    game.gateOpen = true;
    pushEvent(game, "gateOpen");
    floatText(game, game.map.gate.x, game.map.gate.y + TILE, "廟門開");
    return;
  }
  pushEvent(game, "waveClear", { index: game.waveIndex });
  const player = game.player;
  const healed = Math.min(player.maxHp, player.hp + HEAL_ON_WAVE) - player.hp;
  player.hp += healed;
  if (healed > 0) floatText(game, player.x, player.y - 18, `+${Math.round(healed)} 命`, "#9dffa8");
  game.waveGap = WAVE_GAP;
}

export function damagePlayer(game, raw, source = "enemy") {
  const player = game.player;
  if (!player.alive || player.invuln > 0) return 0;
  const dealt = damageTaken(player, raw);
  player.hp -= dealt;
  player.invuln = PLAYER_IFRAMES;
  player.hurtFlash = 0.3;
  game.stats.damageTaken += dealt;
  pushEvent(game, "hurt", { amount: dealt, source });
  floatText(game, player.x, player.y - 16, `-${dealt}`, "#ff8f7a");
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    game.phase = "defeat";
    pushEvent(game, "defeat");
  }
  return dealt;
}

export function damageEnemy(game, enemy, raw, knockback = 0, fromX = null, fromY = null) {
  const amount = Math.max(1, Math.round(raw));
  enemy.hp -= amount;
  enemy.hurtFlash = 0.18;
  game.stats.damageDealt += amount;
  if (knockback > 0) {
    const ox = fromX ?? game.player.x;
    const oy = fromY ?? game.player.y;
    const dx = enemy.x - ox;
    const dy = enemy.y - oy;
    const len = Math.hypot(dx, dy) || 1;
    enemy.vx += (dx / len) * knockback;
    enemy.vy += (dy / len) * knockback;
  }
  addEffect(game, { kind: "spark", x: enemy.x, y: enemy.y, ttl: 0.22, life: 0.22 });
  if (enemy.hp <= 0) killEnemy(game, enemy);
  return amount;
}

export function killEnemy(game, enemy) {
  const index = game.enemies.indexOf(enemy);
  if (index >= 0) game.enemies.splice(index, 1);
  game.kills += 1;
  game.score += enemy.score;
  if (enemy.boss) {
    game.bossAlive = false;
    pushEvent(game, "bossDown", { name: enemy.name });
    addEffect(game, { kind: "blast", x: enemy.x, y: enemy.y, radius: 90, ttl: 0.6, life: 0.6 });
  }
  pushEvent(game, "enemyDown", { type: enemy.type, boss: enemy.boss });
  addEffect(game, { kind: "poof", x: enemy.x, y: enemy.y, ttl: 0.35, life: 0.35 });
  if (game.rng() < enemy.dropChance) {
    const item = rollDrop(game.rng, { levelIndex: game.levelIndex, boss: enemy.boss });
    game.drops.push({
      x: enemy.x,
      y: enemy.y,
      item,
      ttl: DROP_LIFETIME,
      radius: 12,
      bob: game.rng() * Math.PI * 2,
    });
  }
  return enemy;
}

function faceFrom(input, player) {
  const aim = normalizeInput(input.aimX, input.aimY, 0.2);
  if (aim.magnitude > 0) return Math.atan2(aim.y, aim.x);
  const move = normalizeInput(input.moveX, input.moveY, 0.2);
  if (move.magnitude > 0) return Math.atan2(move.y, move.x);
  return player.facing;
}

export function performCleave(game) {
  const player = game.player;
  const stats = playerStats(player);
  const skill = SKILLS.cleave;
  const range = stats.reach + player.radius;
  startCooldown(player, "cleave");
  player.swingTime = 0.18;
  addEffect(game, {
    kind: "arc",
    x: player.x,
    y: player.y,
    facing: player.facing,
    halfAngle: skill.halfAngle,
    range,
    ttl: 0.18,
    life: 0.18,
  });
  pushEvent(game, "cleave");
  let hits = 0;
  for (const enemy of [...game.enemies]) {
    if (!inArc(player, player.facing, skill.halfAngle, range, enemy)) continue;
    damageEnemy(game, enemy, stats.damage * skill.damageMul, skill.knockback);
    hits += 1;
  }
  if (hits > 0) pushEvent(game, "hit", { hits });
  return hits;
}

export function performWhirl(game) {
  const player = game.player;
  const stats = playerStats(player);
  const skill = SKILLS.whirl;
  startCooldown(player, "whirl");
  player.swingTime = 0.28;
  addEffect(game, { kind: "whirl", x: player.x, y: player.y, radius: skill.radius, ttl: 0.36, life: 0.36 });
  pushEvent(game, "whirl");
  let hits = 0;
  for (const enemy of [...game.enemies]) {
    if (!circlesOverlap(player.x, player.y, skill.radius, enemy.x, enemy.y, enemy.radius)) continue;
    damageEnemy(game, enemy, stats.damage * skill.damageMul, skill.knockback);
    hits += 1;
  }
  if (hits > 0) pushEvent(game, "hit", { hits });
  return hits;
}

export function performTalisman(game) {
  const player = game.player;
  const stats = playerStats(player);
  const skill = SKILLS.talisman;
  startCooldown(player, "talisman");
  game.projectiles.push({
    owner: "player",
    kind: "talisman",
    x: player.x + Math.cos(player.facing) * (player.radius + 6),
    y: player.y + Math.sin(player.facing) * (player.radius + 6),
    vx: Math.cos(player.facing) * skill.projectileSpeed,
    vy: Math.sin(player.facing) * skill.projectileSpeed,
    radius: 7,
    damage: stats.damage * skill.damageMul + stats.power,
    life: skill.projectileLife,
    spin: 0,
  });
  pushEvent(game, "talisman");
  return game.projectiles[game.projectiles.length - 1];
}

export function performDash(game) {
  const player = game.player;
  const skill = SKILLS.dash;
  startCooldown(player, "dash");
  player.dashTime = skill.duration;
  player.dashX = Math.cos(player.facing);
  player.dashY = Math.sin(player.facing);
  player.invuln = Math.max(player.invuln, skill.invulnerable);
  addEffect(game, { kind: "dash", x: player.x, y: player.y, facing: player.facing, ttl: 0.24, life: 0.24 });
  pushEvent(game, "dash");
  return player;
}

function explodeTalisman(game, projectile) {
  const skill = SKILLS.talisman;
  addEffect(game, {
    kind: "blast",
    x: projectile.x,
    y: projectile.y,
    radius: skill.blastRadius,
    ttl: 0.36,
    life: 0.36,
  });
  pushEvent(game, "blast");
  let hits = 0;
  for (const enemy of [...game.enemies]) {
    if (!circlesOverlap(projectile.x, projectile.y, skill.blastRadius, enemy.x, enemy.y, enemy.radius)) continue;
    damageEnemy(game, enemy, projectile.damage, skill.knockback, projectile.x, projectile.y);
    hits += 1;
  }
  return hits;
}

function updatePlayer(game, input, dt) {
  const player = game.player;
  if (!player.alive) return;
  const stats = playerStats(player);
  tickCooldowns(player.cooldowns, dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.hurtFlash = Math.max(0, player.hurtFlash - dt);
  player.swingTime = Math.max(0, player.swingTime - dt);

  player.facing = faceFrom(input, player);

  if (player.dashTime > 0) {
    player.dashTime = Math.max(0, player.dashTime - dt);
    player.vx = player.dashX * SKILLS.dash.speed;
    player.vy = player.dashY * SKILLS.dash.speed;
  } else {
    const move = normalizeInput(input.moveX, input.moveY, 0.15);
    player.vx = move.x * stats.moveSpeed;
    player.vy = move.y * stats.moveSpeed;
    player.moving = move.magnitude > 0;
  }

  const moved = moveCircle(game.map, player.x, player.y, player.vx * dt, player.vy * dt, player.radius);
  player.x = moved.x;
  player.y = moved.y;
  if (moved.hitX) player.vx = 0;
  if (moved.hitY) player.vy = 0;

  if (input.primary && isReady(player.cooldowns, "cleave")) performCleave(game);
  if (input.whirl && isReady(player.cooldowns, "whirl")) performWhirl(game);
  if (input.talisman && isReady(player.cooldowns, "talisman")) performTalisman(game);
  if (input.dash && isReady(player.cooldowns, "dash") && player.dashTime <= 0) performDash(game);
}

function moveEnemy(game, enemy, dx, dy, speed, dt) {
  const len = Math.hypot(dx, dy) || 1;
  const stepX = ((dx / len) * speed + enemy.vx) * dt;
  const stepY = ((dy / len) * speed + enemy.vy) * dt;
  const moved = moveCircle(game.map, enemy.x, enemy.y, stepX, stepY, enemy.radius);
  enemy.x = moved.x;
  enemy.y = moved.y;
  if (moved.hitX) enemy.vx = 0;
  if (moved.hitY) enemy.vy = 0;
  if (Math.abs(dx) > 0.5) enemy.facing = dx > 0 ? 1 : -1;
}

export const AVOID_TIME = 0.5;

/**
 * Chase along the flow field when the straight line is walled off, and fall back
 * to a short blind sidestep only when even that stalls (two 鬼 shoving each other
 * in a doorway). Without this the last 鬼 of a 陣 could wedge behind a 香爐 and the
 * wave would never end.
 */
function steer(game, enemy, dx, dy, speed, dt) {
  enemy.avoidTimer = Math.max(0, enemy.avoidTimer - dt);
  let ax = dx;
  let ay = dy;

  if (enemy.avoidTimer > 0) {
    const len = Math.hypot(dx, dy) || 1;
    ax = (-dy / len) * enemy.avoidSign;
    ay = (dx / len) * enemy.avoidSign;
  } else if (game.flow && !hasLineOfSight(game.map, enemy.x, enemy.y, game.flow.targetX, game.flow.targetY)) {
    const hint = flowDirection(game.flow, enemy.x, enemy.y);
    // The field points at the player; a retreating 鬼 wants the opposite tile.
    const towards = dx * (game.flow.targetX - enemy.x) + dy * (game.flow.targetY - enemy.y) >= 0;
    if (hint) {
      ax = towards ? hint.x : -hint.x;
      ay = towards ? hint.y : -hint.y;
    }
  }

  const fromX = enemy.x;
  const fromY = enemy.y;
  const moved = moveEnemy(game, enemy, ax, ay, speed, dt);
  if (Math.hypot(enemy.x - fromX, enemy.y - fromY) < speed * dt * 0.35) {
    if (enemy.avoidTimer === 0) enemy.avoidSign = -enemy.avoidSign;
    enemy.avoidTimer = AVOID_TIME;
  }
  return moved;
}

function enemyShoot(game, enemy, dx, dy) {
  const spec = enemy.projectile;
  const len = Math.hypot(dx, dy) || 1;
  game.projectiles.push({
    owner: "enemy",
    kind: spec.kind,
    x: enemy.x + (dx / len) * (enemy.radius + 4),
    y: enemy.y + (dy / len) * (enemy.radius + 4),
    vx: (dx / len) * spec.speed,
    vy: (dy / len) * spec.speed,
    radius: spec.radius,
    damage: spec.damage * (game.level.tuning?.damageScale ?? 1),
    life: spec.life,
    spin: 0,
  });
  pushEvent(game, "enemyShoot", { type: enemy.type });
}

function bossBehaviour(game, enemy, dist, dt) {
  enemy.slamTimer = Math.max(0, enemy.slamTimer - dt);
  enemy.summonTimer = Math.max(0, enemy.summonTimer - dt);
  if (enemy.slamCooldown > 0 && enemy.slamTimer === 0 && dist < enemy.slamRadius * 1.15) {
    enemy.slamTimer = enemy.slamCooldown;
    addEffect(game, {
      kind: "slam",
      x: enemy.x,
      y: enemy.y,
      radius: enemy.slamRadius,
      ttl: 0.45,
      life: 0.45,
    });
    pushEvent(game, "slam", { name: enemy.name });
    if (dist <= enemy.slamRadius) damagePlayer(game, enemy.slamDamage, "slam");
  }
  if (enemy.summons && enemy.summonCooldown > 0 && enemy.summonTimer === 0) {
    enemy.summonTimer = enemy.summonCooldown;
    for (let i = 0; i < enemy.summonCount; i += 1) {
      const type = enemy.summons[Math.floor(game.rng() * enemy.summons.length)];
      const angle = game.rng() * Math.PI * 2;
      const radius = 34 + game.rng() * 18;
      const x = enemy.x + Math.cos(angle) * radius;
      const y = enemy.y + Math.sin(angle) * radius;
      if (isBlocked(game.map, x, y)) continue;
      addEnemy(game, type, x, y);
    }
    pushEvent(game, "summon", { name: enemy.name });
  }
}

function updateEnemies(game, dt) {
  const player = game.player;
  for (const enemy of [...game.enemies]) {
    enemy.hurtFlash = Math.max(0, enemy.hurtFlash - dt);
    enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
    const decay = Math.exp(-dt * 7);
    enemy.vx *= decay;
    enemy.vy *= decay;

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy);

    if (enemy.boss) bossBehaviour(game, enemy, dist, dt);

    if (enemy.behavior === "charger") {
      enemy.chargeRest = Math.max(0, enemy.chargeRest - dt);
      if (enemy.chargeTimer > 0) {
        enemy.chargeTimer = Math.max(0, enemy.chargeTimer - dt);
        const fromX = enemy.x;
        const fromY = enemy.y;
        moveEnemy(game, enemy, enemy.dashX ?? dx, enemy.dashY ?? dy, enemy.chargeSpeed, dt);
        // A charge into a pillar must not loop forever: bail out and walk around.
        if (Math.hypot(enemy.x - fromX, enemy.y - fromY) < enemy.chargeSpeed * dt * 0.35) {
          enemy.chargeTimer = 0;
          enemy.chargeRest = 0.7;
          enemy.avoidTimer = AVOID_TIME;
        }
      } else if (enemy.windUp > 0) {
        enemy.windUp = Math.max(0, enemy.windUp - dt);
        if (enemy.windUp === 0) {
          enemy.chargeTimer = 0.34;
          const len = dist || 1;
          enemy.dashX = dx / len;
          enemy.dashY = dy / len;
          pushEvent(game, "charge", { type: enemy.type });
        }
        moveEnemy(game, enemy, dx, dy, enemy.speed * 0.15, dt);
      } else if (
        enemy.chargeRest === 0 &&
        dist < enemy.chargeRange &&
        dist > enemy.radius + player.radius + 6 &&
        hasLineOfSight(game.map, enemy.x, enemy.y, player.x, player.y)
      ) {
        enemy.windUp = 0.42;
      } else {
        steer(game, enemy, dx, dy, enemy.speed, dt);
      }
    } else if (enemy.behavior === "shooter") {
      const prefer = enemy.preferredRange;
      if (dist > prefer) steer(game, enemy, dx, dy, enemy.speed, dt);
      else if (dist < prefer * 0.66) steer(game, enemy, -dx, -dy, enemy.speed * 0.85, dt);
      else steer(game, enemy, -dy, dx, enemy.speed * 0.5, dt);
      if (
        enemy.attackTimer === 0 &&
        enemy.projectile &&
        hasLineOfSight(game.map, enemy.x, enemy.y, player.x, player.y)
      ) {
        enemy.attackTimer = enemy.attackCooldown;
        enemyShoot(game, enemy, dx, dy);
      }
    } else {
      steer(game, enemy, dx, dy, enemy.speed, dt);
    }

    if (
      player.alive &&
      enemy.attackTimer === 0 &&
      circlesOverlap(enemy.x, enemy.y, enemy.radius, player.x, player.y, player.radius)
    ) {
      enemy.attackTimer = enemy.attackCooldown;
      damagePlayer(game, enemy.damage, enemy.type);
      const len = dist || 1;
      enemy.vx -= (dx / len) * 90;
      enemy.vy -= (dy / len) * 90;
    }
  }
  separateEnemies(game);
}

function separateEnemies(game) {
  const list = game.enemies;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.radius + b.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= min * min) continue;
      // Exactly coincident spawns get a deterministic nudge instead of fusing.
      const coincident = distSq < 1e-6;
      const dist = coincident ? 0 : Math.sqrt(distSq);
      const angle = i * 1.7 + j * 0.9;
      const nx = coincident ? Math.cos(angle) : dx / dist;
      const ny = coincident ? Math.sin(angle) : dy / dist;
      const push = (min - dist) / 2;
      const aw = a.boss ? 0.25 : 1;
      const bw = b.boss ? 0.25 : 1;
      a.x -= nx * push * aw;
      a.y -= ny * push * aw;
      b.x += nx * push * bw;
      b.y += ny * push * bw;
    }
  }
}

function updateProjectiles(game, dt) {
  const player = game.player;
  const remaining = [];
  for (const p of game.projectiles) {
    p.life -= dt;
    p.spin += dt * 12;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const hitWall = isBlocked(game.map, p.x, p.y);
    if (p.owner === "player") {
      const hitEnemy = game.enemies.find((e) =>
        circlesOverlap(p.x, p.y, p.radius, e.x, e.y, e.radius),
      );
      if (hitEnemy || hitWall || p.life <= 0) {
        explodeTalisman(game, p);
        continue;
      }
    } else {
      if (
        player.alive &&
        player.invuln <= 0 &&
        circlesOverlap(p.x, p.y, p.radius, player.x, player.y, player.radius)
      ) {
        damagePlayer(game, p.damage, p.kind);
        continue;
      }
      if (hitWall || p.life <= 0) continue;
    }
    remaining.push(p);
  }
  game.projectiles = remaining;
}

function updateDrops(game, dt) {
  const player = game.player;
  const remaining = [];
  for (const drop of game.drops) {
    drop.ttl -= dt;
    if (drop.ttl <= 0) continue;
    if (
      player.alive &&
      circlesOverlap(drop.x, drop.y, drop.radius, player.x, player.y, player.radius)
    ) {
      const result = applyPickup(player, drop.item);
      game.stats.pickups += 1;
      if (result.outcome === "equipped") {
        game.score += 20;
        pushEvent(game, "equip", { item: drop.item });
        floatText(game, drop.x, drop.y, `裝備 ${drop.item.name}`, "#a8e6ff");
      } else if (result.outcome === "healed") {
        pushEvent(game, "pickup", { item: drop.item });
        floatText(game, drop.x, drop.y, `+${result.healed} 命`, "#9dffa8");
      } else {
        game.score += result.score ?? 0;
        pushEvent(game, "pickup", { item: drop.item });
        floatText(game, drop.x, drop.y, `熔 ${drop.item.name}`, "#ffd9a0");
      }
      continue;
    }
    remaining.push(drop);
  }
  game.drops = remaining;
}

function updateEffects(game, dt) {
  const remaining = [];
  for (const effect of game.effects) {
    effect.ttl -= dt;
    if (effect.ttl > 0) remaining.push(effect);
  }
  game.effects = remaining;
}

function checkGate(game) {
  if (!game.gateOpen || !game.player.alive) return;
  const gate = game.map.gate;
  if (Math.hypot(game.player.x - gate.x, game.player.y - gate.y) > GATE_RADIUS) return;
  if (game.levelIndex >= game.levels.length - 1) {
    game.phase = "victory";
    pushEvent(game, "victory");
  } else {
    game.phase = "cleared";
    pushEvent(game, "levelClear", { levelIndex: game.levelIndex });
  }
}

/** One simulation tick. `dt` is clamped so a long background pause cannot tunnel. */
export function step(game, input, dt) {
  if (game.phase !== "playing") return game;
  const delta = clamp(dt, 0, MAX_STEP);
  game.time += delta;
  updatePlayer(game, input, delta);
  updateSpawns(game, delta);
  game.flow = buildFlowField(game.map, game.player.x, game.player.y, game.flow);
  updateEnemies(game, delta);
  updateProjectiles(game, delta);
  updateDrops(game, delta);
  updateEffects(game, delta);
  if (game.phase === "playing") updateWaveProgress(game, delta);
  if (game.phase === "playing") checkGate(game);
  return game;
}

export function drainEvents(game) {
  const events = game.events;
  game.events = [];
  return events;
}

export function waveLabel(game) {
  const total = game.level.waves.length;
  const shown = Math.min(total, game.waveIndex + 1);
  return `第 ${shown}／${total} 陣`;
}

export function bossHealth(game) {
  const boss = game.enemies.find((e) => e.boss);
  if (!boss) return null;
  return { name: boss.name, hp: boss.hp, maxHp: boss.maxHp, ratio: boss.hp / boss.maxHp };
}
