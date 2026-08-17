import { cooldownScale } from "./equipment.js";

export const SKILLS = {
  cleave: {
    id: "cleave",
    name: "斬",
    hint: "J / 空白",
    icon: "sword",
    cooldown: 0.38,
    halfAngle: 1.05,
    damageMul: 1,
    knockback: 190,
  },
  whirl: {
    id: "whirl",
    name: "旋斬",
    hint: "K",
    icon: "arrow_rotate",
    cooldown: 6,
    radius: 82,
    damageMul: 1.25,
    knockback: 300,
  },
  talisman: {
    id: "talisman",
    name: "火符",
    hint: "L",
    icon: "fire",
    cooldown: 4.5,
    projectileSpeed: 300,
    projectileLife: 1.5,
    blastRadius: 62,
    damageMul: 1.7,
    knockback: 240,
  },
  dash: {
    id: "dash",
    name: "疾步",
    hint: "Shift",
    icon: "campfire",
    cooldown: 2.2,
    duration: 0.16,
    speed: 470,
    invulnerable: 0.3,
  },
};

export const SKILL_ORDER = ["cleave", "whirl", "talisman", "dash"];

export function createCooldowns() {
  return { cleave: 0, whirl: 0, talisman: 0, dash: 0 };
}

/** Tick every cooldown down by `dt`, clamped at zero. */
export function tickCooldowns(cooldowns, dt) {
  for (const key of Object.keys(cooldowns)) {
    cooldowns[key] = Math.max(0, cooldowns[key] - dt);
  }
  return cooldowns;
}

export function isReady(cooldowns, id) {
  return (cooldowns[id] ?? 0) <= 0;
}

/** Charm haste shortens every cooldown; `cleave` keeps a small floor. */
export function cooldownFor(player, id) {
  const skill = SKILLS[id];
  if (!skill) throw new Error(`unknown skill: ${id}`);
  return Math.max(0.12, skill.cooldown * cooldownScale(player));
}

export function startCooldown(player, id) {
  player.cooldowns[id] = cooldownFor(player, id);
  return player.cooldowns[id];
}

/** 0..1 fraction remaining, for the HUD cooldown sweep. */
export function cooldownFraction(player, id) {
  const full = cooldownFor(player, id);
  if (full <= 0) return 0;
  return Math.min(1, Math.max(0, (player.cooldowns[id] ?? 0) / full));
}
