import { describe, expect, it } from "vitest";
import {
  SKILLS,
  SKILL_ORDER,
  cooldownFor,
  cooldownFraction,
  createCooldowns,
  isReady,
  startCooldown,
  tickCooldowns,
} from "../src/skills.js";
import { itemByTier } from "../src/equipment.js";

function player(charm = null) {
  return { cooldowns: createCooldowns(), equip: { weapon: null, armor: null, charm } };
}

describe("skill table", () => {
  it("exposes the four kit slots in HUD order", () => {
    expect(SKILL_ORDER).toEqual(["cleave", "whirl", "talisman", "dash"]);
    for (const id of SKILL_ORDER) {
      expect(SKILLS[id].name, id).toBeTruthy();
      expect(SKILLS[id].cooldown, id).toBeGreaterThan(0);
    }
  });

  it("keeps the basic swing far cheaper than the specials", () => {
    expect(SKILLS.cleave.cooldown).toBeLessThan(SKILLS.whirl.cooldown);
    expect(SKILLS.cleave.cooldown).toBeLessThan(SKILLS.talisman.cooldown);
  });

  it("starts every cooldown ready", () => {
    const cooldowns = createCooldowns();
    expect(Object.values(cooldowns).every((value) => value === 0)).toBe(true);
    expect(SKILL_ORDER.every((id) => isReady(cooldowns, id))).toBe(true);
  });
});

describe("cooldown bookkeeping", () => {
  it("blocks a skill until its timer drains", () => {
    const hero = player();
    startCooldown(hero, "whirl");
    expect(isReady(hero.cooldowns, "whirl")).toBe(false);
    tickCooldowns(hero.cooldowns, SKILLS.whirl.cooldown - 0.1);
    expect(isReady(hero.cooldowns, "whirl")).toBe(false);
    tickCooldowns(hero.cooldowns, 0.2);
    expect(isReady(hero.cooldowns, "whirl")).toBe(true);
  });

  it("never ticks below zero", () => {
    const cooldowns = createCooldowns();
    cooldowns.dash = 0.2;
    tickCooldowns(cooldowns, 10);
    expect(cooldowns.dash).toBe(0);
  });

  it("shortens cooldowns with charm haste but keeps a floor", () => {
    const plain = cooldownFor(player(), "whirl");
    const hasted = cooldownFor(player(itemByTier("charm", 5)), "whirl");
    expect(hasted).toBeLessThan(plain);
    expect(hasted).toBeCloseTo(SKILLS.whirl.cooldown * 0.68, 5);
    const absurd = cooldownFor(player({ ...itemByTier("charm", 5), haste: 0.45 }), "cleave");
    expect(absurd).toBeGreaterThanOrEqual(0.12);
  });

  it("reports a 0..1 fraction for the HUD sweep", () => {
    const hero = player();
    expect(cooldownFraction(hero, "talisman")).toBe(0);
    startCooldown(hero, "talisman");
    expect(cooldownFraction(hero, "talisman")).toBeCloseTo(1, 5);
    tickCooldowns(hero.cooldowns, SKILLS.talisman.cooldown / 2);
    expect(cooldownFraction(hero, "talisman")).toBeCloseTo(0.5, 2);
  });

  it("rejects unknown skill ids", () => {
    expect(() => cooldownFor(player(), "fireball")).toThrow(/unknown skill/);
  });
});
