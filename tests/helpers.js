import { createGame, createInput, step } from "../src/game.js";
import { spawnEnemy } from "../src/enemies.js";

/** Small arena used by the rule tests: 11x7 tiles, gate in the top wall. */
export const TEST_ROWS = [
  "####G######",
  "#.........#",
  "#.1.....2.#",
  "#.........#",
  "#....P....#",
  "#.........#",
  "###########",
];

/** Same arena split by a 供桌 row with one doorway on each side. */
export const WALL_ROWS = [
  "####G######",
  "#.........#",
  "#...1.....#",
  "#.TTTTTTT.#",
  "#....P....#",
  "#.........#",
  "###########",
];

export function testLevel(overrides = {}) {
  return {
    id: "test",
    name: "測試埕",
    music: "battle",
    tuning: { hpScale: 1, damageScale: 1, speedScale: 1 },
    rows: TEST_ROWS,
    waves: [{ spawns: [{ type: "xiaogui", count: 1 }] }],
    ...overrides,
  };
}

/** A game with the spawn queue drained so tests control the board exactly. */
export function makeGame({ levels = [testLevel()], seed = 7, levelIndex = 0 } = {}) {
  const game = createGame({ seed, levels, levelIndex });
  game.spawnQueue = [];
  game.enemies = [];
  game.events = [];
  return game;
}

export function putEnemy(game, type, x, y, tuning = {}) {
  const enemy = spawnEnemy(type, x, y, { uid: game.nextUid++, ...tuning });
  game.enemies.push(enemy);
  return enemy;
}

export function frames(game, input = createInput(), count = 1, dt = 1 / 60) {
  for (let i = 0; i < count; i += 1) step(game, input, dt);
  return game;
}

export function inputWith(overrides = {}) {
  return { ...createInput(), ...overrides };
}

export function eventTypes(game) {
  return game.events.map((event) => event.type);
}
