import { describe, expect, it } from "vitest";
import { advanceLevel, createGame, createInput, step } from "../src/game.js";
import { LEVELS } from "../src/levels.js";
import { createBot, DT, runCampaign } from "./bot.js";

describe("playthrough", () => {
  it("第一關 is clearable by a simple bot (win condition is reachable)", () => {
    const game = createGame({ seed: 20260817, levels: LEVELS });
    const input = createInput();
    const bot = createBot();
    let elapsed = 0;
    while (game.phase === "playing" && elapsed < 300) {
      bot(game, input);
      step(game, input, DT);
      elapsed += DT;
    }
    expect(game.phase, `bot ended at hp ${game.player.hp} after ${elapsed.toFixed(1)}s`).toBe(
      "cleared",
    );
    expect(game.gateOpen).toBe(true);
    expect(game.kills).toBeGreaterThan(8);
    expect(game.score).toBeGreaterThan(200);
    expect(game.player.hp).toBeGreaterThan(0);
    expect(game.stats.waves).toBe(LEVELS[0].waves.length);
  });

  it("picks up gear along the way so builds actually happen", () => {
    const game = createGame({ seed: 4242, levels: LEVELS });
    const input = createInput();
    const bot = createBot();
    let elapsed = 0;
    while (game.phase === "playing" && elapsed < 300) {
      bot(game, input);
      step(game, input, DT);
      elapsed += DT;
    }
    expect(game.stats.pickups).toBeGreaterThan(0);
    const equipped = Object.values(game.player.equip).filter(Boolean);
    expect(equipped.length).toBeGreaterThan(0);
  });

  it("kills a player who never fights back (lose condition is reachable)", () => {
    const game = createGame({ seed: 99, levels: LEVELS });
    const idle = createInput();
    let elapsed = 0;
    while (game.phase === "playing" && elapsed < 300) {
      step(game, idle, DT);
      elapsed += DT;
    }
    expect(game.phase).toBe("defeat");
    expect(game.player.hp).toBe(0);
    expect(game.player.alive).toBe(false);
  });

  it("runs the whole five-關 campaign without wedging", () => {
    const game = createGame({ seed: 777, levels: LEVELS });
    const { cleared } = runCampaign(game, { advanceLevel, step });
    expect(["victory", "defeat"]).toContain(game.phase);
    expect(cleared).toBeGreaterThanOrEqual(2);
    expect(game.levelIndex).toBeGreaterThanOrEqual(2);
  });

  it("never stalls: every seed reaches a win or a loss, no infinite 陣", () => {
    for (const seed of [1, 42, 99, 555, 8888, 2468, 31337]) {
      const game = createGame({ seed, levels: LEVELS });
      const { elapsed } = runCampaign(game, { advanceLevel, step, limit: 1500 });
      expect(["victory", "defeat"], `seed ${seed} stalled in ${game.level.id}`).toContain(
        game.phase,
      );
      expect(elapsed).toBeLessThan(1500);
    }
  });
});
