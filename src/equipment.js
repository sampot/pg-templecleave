export const BASE_STATS = {
  maxHp: 140,
  damage: 15,
  reach: 40,
  moveSpeed: 122,
  resist: 0,
  haste: 0,
  power: 0,
};

/** Melting a duplicate/worse drop refunds a little HP and score instead. */
export const MELT_HEAL = 6;
export const MELT_SCORE = 12;

export const WEAPONS = [
  { slot: "weapon", id: "taomu", name: "桃木刀", tier: 1, damage: 4, reach: 2, speedMod: 4 },
  { slot: "weapon", id: "tiedao", name: "鐵刀", tier: 2, damage: 8, reach: 4, speedMod: 0 },
  { slot: "weapon", id: "qingfeng", name: "青鋒刀", tier: 3, damage: 13, reach: 6, speedMod: -2 },
  { slot: "weapon", id: "qixing", name: "七星刀", tier: 4, damage: 19, reach: 9, speedMod: -4 },
  { slot: "weapon", id: "zhanxie", name: "斬邪刀", tier: 5, damage: 27, reach: 12, speedMod: -6 },
];

export const ARMORS = [
  { slot: "armor", id: "buyi", name: "布衣", tier: 1, resist: 0.06, bonusHp: 10, speedMod: 2 },
  { slot: "armor", id: "tengjia", name: "藤甲", tier: 2, resist: 0.12, bonusHp: 22, speedMod: 0 },
  { slot: "armor", id: "tiejia", name: "鐵甲", tier: 3, resist: 0.2, bonusHp: 36, speedMod: -3 },
  { slot: "armor", id: "shenjiang", name: "神將甲", tier: 4, resist: 0.28, bonusHp: 52, speedMod: -5 },
  { slot: "armor", id: "jinguang", name: "金光甲", tier: 5, resist: 0.36, bonusHp: 70, speedMod: -6 },
];

export const CHARMS = [
  { slot: "charm", id: "jingxin", name: "淨心符", tier: 1, haste: 0.06, power: 2 },
  { slot: "charm", id: "xunlei", name: "迅雷符", tier: 2, haste: 0.12, power: 4 },
  { slot: "charm", id: "hude", name: "火德符", tier: 3, haste: 0.18, power: 8 },
  { slot: "charm", id: "xuantian", name: "玄天符", tier: 4, haste: 0.25, power: 13 },
  { slot: "charm", id: "beidou", name: "北斗符", tier: 5, haste: 0.32, power: 19 },
];

export const INCENSE = { slot: "incense", id: "xianghuo", name: "香火", tier: 0, heal: 34 };

export const LOOT_TABLES = { weapon: WEAPONS, armor: ARMORS, charm: CHARMS };

export function itemByTier(slot, tier) {
  const table = LOOT_TABLES[slot];
  if (!table) throw new Error(`unknown loot slot: ${slot}`);
  const clamped = Math.max(1, Math.min(table.length, Math.round(tier)));
  return table[clamped - 1];
}

/**
 * Pick a drop for a defeated enemy. Deeper levels bias toward higher tiers and
 * bosses always yield gear (never plain incense).
 */
export function rollDrop(rng, { levelIndex = 0, boss = false } = {}) {
  const roll = rng();
  if (!boss && roll < 0.3) return { ...INCENSE };
  const slotRoll = rng();
  const slot = slotRoll < 0.4 ? "weapon" : slotRoll < 0.72 ? "armor" : "charm";
  const base = boss ? levelIndex + 2 : levelIndex + 1;
  const jitter = rng() < 0.32 ? 1 : 0;
  return { ...itemByTier(slot, base + jitter) };
}

export function playerStats(player) {
  const equip = player.equip || {};
  const weapon = equip.weapon;
  const armor = equip.armor;
  const charm = equip.charm;
  return {
    maxHp: BASE_STATS.maxHp + (armor?.bonusHp ?? 0),
    damage: BASE_STATS.damage + (weapon?.damage ?? 0),
    reach: BASE_STATS.reach + (weapon?.reach ?? 0),
    moveSpeed: BASE_STATS.moveSpeed + (weapon?.speedMod ?? 0) + (armor?.speedMod ?? 0),
    resist: Math.min(0.6, armor?.resist ?? 0),
    haste: Math.min(0.45, charm?.haste ?? 0),
    power: charm?.power ?? 0,
  };
}

export function cooldownScale(player) {
  return 1 - playerStats(player).haste;
}

export function damageTaken(player, raw) {
  const { resist } = playerStats(player);
  return Math.max(1, Math.round(raw * (1 - resist)));
}

/**
 * 甲 also adds 體: re-derive the HP pool after a gear change and hand the extra
 * points over as healing, so upgrading armour mid-陣 is felt immediately.
 */
export function refreshVitals(player) {
  const { maxHp } = playerStats(player);
  const gained = Math.max(0, maxHp - player.maxHp);
  player.maxHp = maxHp;
  player.hp = Math.min(maxHp, player.hp + gained);
  return gained;
}

/**
 * Apply a pickup. Gear only replaces a strictly lower tier in the same slot;
 * anything else is melted down for a small heal plus score.
 */
export function applyPickup(player, item) {
  if (item.slot === "incense") {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + item.heal);
    return { outcome: "healed", healed: player.hp - before, item };
  }
  const current = player.equip[item.slot];
  if (!current || item.tier > current.tier) {
    player.equip[item.slot] = { ...item };
    const gained = refreshVitals(player);
    return { outcome: "equipped", replaced: current || null, item, healed: gained };
  }
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + MELT_HEAL);
  return { outcome: "melted", healed: player.hp - before, score: MELT_SCORE, item };
}
