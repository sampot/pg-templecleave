import { describe, expect, it } from "vitest";
import {
  ARMORS,
  BASE_STATS,
  CHARMS,
  INCENSE,
  MELT_HEAL,
  WEAPONS,
  applyPickup,
  cooldownScale,
  damageTaken,
  itemByTier,
  playerStats,
  refreshVitals,
  rollDrop,
} from "../src/equipment.js";
import { createRng } from "../src/rng.js";

function barePlayer(overrides = {}) {
  return {
    hp: 100,
    maxHp: 100,
    equip: { weapon: null, armor: null, charm: null },
    ...overrides,
  };
}

describe("loot tables", () => {
  it("has five ascending tiers per slot", () => {
    for (const table of [WEAPONS, ARMORS, CHARMS]) {
      expect(table).toHaveLength(5);
      expect(table.map((item) => item.tier)).toEqual([1, 2, 3, 4, 5]);
    }
    expect(WEAPONS.at(-1).damage).toBeGreaterThan(WEAPONS[0].damage);
    expect(ARMORS.at(-1).resist).toBeGreaterThan(ARMORS[0].resist);
    expect(CHARMS.at(-1).haste).toBeGreaterThan(CHARMS[0].haste);
  });

  it("clamps tier lookups into range", () => {
    expect(itemByTier("weapon", 0).tier).toBe(1);
    expect(itemByTier("weapon", 99).tier).toBe(5);
    expect(() => itemByTier("hat", 1)).toThrow(/unknown loot slot/);
  });
});

describe("armour vitality", () => {
  it("scales the HP pool with armour tier", () => {
    expect(playerStats(barePlayer()).maxHp).toBe(BASE_STATS.maxHp);
    const tiers = ARMORS.map(
      (armor) =>
        playerStats(barePlayer({ equip: { weapon: null, armor, charm: null } })).maxHp,
    );
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers[0]).toBeGreaterThan(BASE_STATS.maxHp);
  });

  it("hands the extra points over as healing when 甲 is equipped", () => {
    const player = barePlayer({ hp: 40, maxHp: BASE_STATS.maxHp });
    const armor = itemByTier("armor", 3);
    const result = applyPickup(player, armor);
    expect(result.outcome).toBe("equipped");
    expect(player.maxHp).toBe(BASE_STATS.maxHp + armor.bonusHp);
    expect(player.hp).toBe(40 + armor.bonusHp);
    expect(result.healed).toBe(armor.bonusHp);
  });

  it("never pushes HP past the new cap and never takes points away", () => {
    const player = barePlayer({ hp: 100, maxHp: BASE_STATS.maxHp });
    applyPickup(player, itemByTier("armor", 5));
    expect(player.hp).toBeLessThanOrEqual(player.maxHp);
    const full = barePlayer({ hp: BASE_STATS.maxHp, maxHp: BASE_STATS.maxHp });
    applyPickup(full, itemByTier("armor", 1));
    expect(full.hp).toBe(BASE_STATS.maxHp + itemByTier("armor", 1).bonusHp);
    const gained = refreshVitals(full);
    expect(gained).toBe(0);
    expect(full.hp).toBe(full.maxHp);
  });
});

describe("playerStats", () => {
  it("falls back to base numbers with no gear", () => {
    const stats = playerStats(barePlayer());
    expect(stats.damage).toBe(BASE_STATS.damage);
    expect(stats.resist).toBe(0);
    expect(stats.haste).toBe(0);
  });

  it("adds weapon damage and reach, and applies weight to speed", () => {
    const heavy = barePlayer({ equip: { weapon: itemByTier("weapon", 5), armor: null, charm: null } });
    const stats = playerStats(heavy);
    expect(stats.damage).toBe(BASE_STATS.damage + 27);
    expect(stats.reach).toBe(BASE_STATS.reach + 12);
    expect(stats.moveSpeed).toBeLessThan(BASE_STATS.moveSpeed);
  });

  it("caps resist and haste so late gear cannot trivialise the run", () => {
    const stats = playerStats(
      barePlayer({
        equip: {
          weapon: null,
          armor: { ...itemByTier("armor", 5), resist: 5 },
          charm: { ...itemByTier("charm", 5), haste: 5 },
        },
      }),
    );
    expect(stats.resist).toBe(0.6);
    expect(stats.haste).toBe(0.45);
  });
});

describe("damage mitigation", () => {
  it("reduces incoming damage by armor resist", () => {
    const player = barePlayer({ equip: { weapon: null, armor: itemByTier("armor", 3), charm: null } });
    expect(damageTaken(barePlayer(), 20)).toBe(20);
    expect(damageTaken(player, 20)).toBe(16);
  });

  it("never fully negates a hit", () => {
    const player = barePlayer({
      equip: { weapon: null, armor: { ...itemByTier("armor", 5), resist: 0.6 }, charm: null },
    });
    expect(damageTaken(player, 1)).toBe(1);
  });

  it("turns charm haste into a cooldown scale below one", () => {
    expect(cooldownScale(barePlayer())).toBe(1);
    const hasty = barePlayer({ equip: { weapon: null, armor: null, charm: itemByTier("charm", 5) } });
    expect(cooldownScale(hasty)).toBeCloseTo(0.68, 5);
  });
});

describe("applyPickup", () => {
  it("equips an empty slot", () => {
    const player = barePlayer();
    const result = applyPickup(player, itemByTier("weapon", 2));
    expect(result.outcome).toBe("equipped");
    expect(player.equip.weapon.id).toBe("tiedao");
  });

  it("replaces a strictly worse item in the same slot", () => {
    const player = barePlayer({ equip: { weapon: itemByTier("weapon", 2), armor: null, charm: null } });
    const result = applyPickup(player, itemByTier("weapon", 4));
    expect(result.outcome).toBe("equipped");
    expect(result.replaced.tier).toBe(2);
    expect(player.equip.weapon.tier).toBe(4);
  });

  it("melts an equal or worse item for a small heal and score", () => {
    const player = barePlayer({ hp: 60, equip: { weapon: itemByTier("weapon", 4), armor: null, charm: null } });
    const result = applyPickup(player, itemByTier("weapon", 3));
    expect(result.outcome).toBe("melted");
    expect(player.equip.weapon.tier).toBe(4);
    expect(player.hp).toBe(60 + MELT_HEAL);
    expect(result.score).toBeGreaterThan(0);
  });

  it("heals from incense without touching gear", () => {
    const player = barePlayer({ hp: 50 });
    const result = applyPickup(player, { ...INCENSE });
    expect(result.outcome).toBe("healed");
    expect(player.hp).toBe(50 + INCENSE.heal);
    expect(player.equip.weapon).toBeNull();
  });

  it("never heals above max hp", () => {
    const player = barePlayer({ hp: 96 });
    applyPickup(player, { ...INCENSE });
    expect(player.hp).toBe(100);
  });
});

describe("rollDrop", () => {
  it("is deterministic for a given seed", () => {
    const a = Array.from({ length: 6 }, (_, i) => rollDrop(createRng(11), { levelIndex: i }).id);
    const b = Array.from({ length: 6 }, (_, i) => rollDrop(createRng(11), { levelIndex: i }).id);
    expect(a).toEqual(b);
  });

  it("never gives a boss plain incense and biases higher tiers", () => {
    const rng = createRng(3);
    const bossDrops = Array.from({ length: 40 }, () => rollDrop(rng, { levelIndex: 3, boss: true }));
    expect(bossDrops.every((item) => item.slot !== "incense")).toBe(true);
    expect(Math.min(...bossDrops.map((item) => item.tier))).toBeGreaterThanOrEqual(5);
  });

  it("keeps early levels on low tiers", () => {
    const rng = createRng(5);
    const gear = Array.from({ length: 60 }, () => rollDrop(rng, { levelIndex: 0 })).filter(
      (item) => item.slot !== "incense",
    );
    expect(gear.length).toBeGreaterThan(0);
    expect(Math.max(...gear.map((item) => item.tier))).toBeLessThanOrEqual(2);
  });
});
