import { createInput } from "../src/game.js";
import { buildFlowField, flowDirection } from "../src/maps.js";
import { isReady } from "../src/skills.js";

export const DT = 1 / 60;

function nearestEnemy(game) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of game.enemies) {
    const dist = Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  return best ? { enemy: best, dist: bestDist } : null;
}

/**
 * A deliberately simple opponent-model bot: walk the flow field to the nearest 鬼,
 * keep it at blade range, swing on cooldown, pick up drops between waves, and head
 * for the 廟門 once the 陣 is broken. It uses the same pathing helper as the 鬼 so a
 * failed run means the level is unbeatable, not that the bot walked into a 香爐.
 */
export function createBot() {
  let field = null;

  return function botInput(game, input) {
    const player = game.player;
    input.primary = false;
    input.whirl = false;
    input.talisman = false;
    input.dash = false;

    let goalX = game.map.gate.x;
    let goalY = game.map.gate.y;
    let seeking = game.gateOpen;
    let retreat = null;

    const target = nearestEnemy(game);
    if (target) {
      const { enemy, dist } = target;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const len = dist || 1;
      input.aimX = dx / len;
      input.aimY = dy / len;

      const crowd = game.enemies.filter(
        (other) => Math.hypot(other.x - player.x, other.y - player.y) < 76,
      ).length;
      const loot = game.drops
        .map((drop) => ({ drop, dist: Math.hypot(drop.x - player.x, drop.y - player.y) }))
        .sort((a, b) => a.dist - b.dist)[0];

      // Hit and run: only close in when the blade is off cooldown, otherwise back
      // out of the 鬼's reach — standing in melee and trading is how a bot dies.
      const bladeReady = isReady(player.cooldowns, "cleave");
      const lunging = enemy.windUp > 0 || enemy.chargeTimer > 0;
      const backOff =
        dist < 30 ||
        (player.hp < 55 && dist < 60) ||
        (!bladeReady && dist < 62) ||
        (lunging && dist < 90);

      if (backOff) {
        retreat = { x: -dx / len, y: -dy / len };
      } else if (loot && dist > 70) {
        goalX = loot.drop.x;
        goalY = loot.drop.y;
      } else if (dist > 44) {
        goalX = enemy.x;
        goalY = enemy.y;
      } else {
        retreat = { x: 0, y: 0 };
      }
      seeking = true;

      input.primary = dist < 56;
      input.whirl = crowd >= 2 && dist < 70;
      input.talisman = dist > 70 || crowd >= 3;
      input.dash = (player.hp < 55 && dist < 46) || (lunging && dist < 70);
    }

    if (retreat) {
      input.moveX = retreat.x;
      input.moveY = retreat.y;
    } else if (!seeking) {
      input.moveX = 0;
      input.moveY = 0;
    } else {
      field = buildFlowField(game.map, goalX, goalY, field);
      const hint = flowDirection(field, player.x, player.y);
      if (hint) {
        input.moveX = hint.x;
        input.moveY = hint.y;
      } else {
        const dx = goalX - player.x;
        const dy = goalY - player.y;
        const len = Math.hypot(dx, dy) || 1;
        input.moveX = dx / len;
        input.moveY = dy / len;
      }
      if (!target) {
        input.aimX = input.moveX || 1;
        input.aimY = input.moveY;
      }
    }
    return input;
  };
}

/** Run a full campaign headlessly; returns the terminal snapshot. */
export function runCampaign(game, { advanceLevel, step, limit = 3000 } = {}) {
  const input = createInput();
  const bot = createBot();
  let elapsed = 0;
  let cleared = 0;
  while (game.phase !== "victory" && game.phase !== "defeat" && elapsed < limit) {
    if (game.phase === "cleared") {
      cleared += 1;
      advanceLevel(game);
      continue;
    }
    bot(game, input);
    step(game, input, DT);
    elapsed += DT;
  }
  return { cleared, elapsed };
}
