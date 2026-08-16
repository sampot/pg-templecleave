/** pg-templecleave — 廟口斬陣 (砍殺／ARPG) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1 } = {}) {
  return { seed, room: 1, hp: 30, atk: 5, skillCd: 0, gold: 0, loot: [], foes: 4, outcome: "playing", msg: "斬擊／技能清房。" };
}
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return s.skillCd <= 0 ? ["slash", "skill", "potion"] : ["slash", "potion"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const rnd = mulberry32(s.seed + s.room * 13 + s.foes);
  if (s.skillCd > 0) s.skillCd--;
  if (action === "potion") {
    s.hp = clamp(s.hp + 12, 0, 40);
    s.msg = "喝下金紙符水";
  } else if (action === "skill") {
    s.skillCd = 3;
    const dmg = s.atk * 3;
    s.foes = clamp(s.foes - 2, 0, 99);
    s.msg = `迴旋斬清退（${dmg}）`;
  } else {
    s.foes = clamp(s.foes - 1, 0, 99);
    s.msg = "普通斬擊";
  }
  if (s.foes > 0 && rnd() < 0.5) {
    s.hp -= 3 + s.room;
    s.msg += " · 被擊中";
  }
  if (s.hp <= 0) s.outcome = "lost";
  else if (s.foes <= 0) {
    s.gold += 10 + s.room * 5;
    if (rnd() < 0.5) { s.loot.push("符紙+" + s.room); s.atk++; }
    if (s.room >= 5) { s.outcome = "won"; s.msg = "廟口陣破！"; }
    else { s.room++; s.foes = 3 + s.room; s.msg = `進入第 ${s.room} 房`; }
  }
  return s;
}
export function summarize(s) {
  return { room: s.room, hp: s.hp, atk: s.atk, foes: s.foes, gold: s.gold, skillCd: s.skillCd, loot: s.loot, msg: s.msg, outcome: s.outcome };
}
export function getOutcome(s) { return s.outcome; }

