import {
  advanceLevel,
  bossHealth,
  createGame,
  createInput,
  drainEvents,
  resetInput,
  step,
  waveLabel,
} from "./src/game.js";
import { LEVELS } from "./src/levels.js";
import { cooldownFraction } from "./src/skills.js";
import {
  composeInput,
  createLatches,
  latchAction,
  latchKey,
  stickKnob,
  stickVector,
  tickLatches,
} from "./src/input.js";
import { createRenderer, iconForItem, loadImage } from "./src/render.js";
import { createAudio } from "./src/audio.js";
import { createStore, mergeProgress } from "./src/persist.js";
import { playerStats } from "./src/equipment.js";

const FIXED_STEP = 1 / 60;
const ICON_NAMES = [
  "sword",
  "shield",
  "fire",
  "arrow_rotate",
  "suit_hearts",
  "flask_full",
  "crown_a",
  "structure_gate",
  "skull",
  "award",
  "hourglass",
  "campfire",
];

const el = (id) => document.getElementById(id);
const dom = {
  stage: el("stage"),
  hpFill: el("hp-fill"),
  hpText: el("hp-text"),
  levelName: el("level-name"),
  waveLabel: el("wave-label"),
  scoreLabel: el("score-label"),
  bossBar: el("boss-bar"),
  bossName: el("boss-name"),
  bossFill: el("boss-fill"),
  gearStrip: el("gear-strip"),
  toasts: el("toasts"),
  stickZone: el("stick-zone"),
  stick: el("stick"),
  stickKnob: el("stick-knob"),
  actionPad: el("action-pad"),
  panel: el("panel"),
  panelTitle: el("panel-title"),
  panelSub: el("panel-sub"),
  panelStats: el("panel-stats"),
  panelActions: el("panel-actions"),
  btnPause: el("btn-pause"),
  btnMute: el("btn-mute"),
};

const input = createInput();
const pressed = new Set();
const touchActions = { primary: false, whirl: false, talisman: false, dash: false };
const latches = createLatches();
let stick = null;
let stickPointer = null;
let mouseAim = null;
let lastView = null;

const images = {};
const audio = createAudio();
let renderer = null;
let store = null;
let progress = { bestLevel: 0, bestScore: 0, runs: 0, wins: 0, bestKills: 0 };
let game = createGame({ seed: Date.now() % 100000, levels: LEVELS });
let screen = "title";
let rafId = 0;
let lastTime = 0;
let accumulator = 0;
let runCounted = false;

/* ------------------------------------------------------------------ toasts */

function toast(text, ttl = 2600) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = text;
  dom.toasts.append(node);
  setTimeout(() => node.remove(), ttl);
}

/* ------------------------------------------------------------------- input */

function clearHeldInput() {
  pressed.clear();
  stick = null;
  stickPointer = null;
  mouseAim = null;
  dom.stick.hidden = true;
  for (const key of Object.keys(touchActions)) touchActions[key] = false;
  for (const key of Object.keys(latches)) latches[key] = 0;
  resetInput(input);
}

/** Desktop nicety: the mouse aims the blade and left-click swings it. */
function bindMouseAim() {
  const stage = dom.stage;
  stage.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !lastView) return;
    const rect = stage.getBoundingClientRect();
    const wx = lastView.cam.x + (event.clientX - rect.left) / lastView.zoom;
    const wy = lastView.cam.y + (event.clientY - rect.top) / lastView.zoom;
    const dx = wx - game.player.x;
    const dy = wy - game.player.y;
    mouseAim = Math.hypot(dx, dy) > 6 ? { x: dx, y: dy } : mouseAim;
  });
  stage.addEventListener("pointerleave", () => {
    mouseAim = null;
  });
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    audio.unlock();
    touchActions.primary = true;
  });
  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") touchActions.primary = false;
  });
}

function bindKeyboard() {
  const blocked = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
  ]);
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (blocked.has(event.code)) event.preventDefault();
    if (event.code === "Escape" || event.code === "KeyP") {
      togglePause();
      return;
    }
    if (event.code === "Enter" && screen !== "playing") {
      const primaryButton = dom.panelActions.querySelector("button");
      if (primaryButton) primaryButton.click();
      return;
    }
    pressed.add(event.code);
    latchKey(latches, event.code);
  });
  window.addEventListener("keyup", (event) => pressed.delete(event.code));
}

/** Capture keeps the drag alive outside the zone; a refusal must not break input. */
function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // Some pointer sources refuse capture; the window-level release still fires.
  }
}

function bindStick() {
  const zone = dom.stickZone;
  zone.addEventListener("pointerdown", (event) => {
    if (screen !== "playing") return;
    stickPointer = event.pointerId;
    const rect = zone.getBoundingClientRect();
    stick = {
      origin: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      x: 0,
      y: 0,
      magnitude: 0,
    };
    dom.stick.hidden = false;
    dom.stick.style.left = `${stick.origin.x}px`;
    dom.stick.style.top = `${stick.origin.y}px`;
    dom.stickKnob.style.left = "52px";
    dom.stickKnob.style.top = "52px";
    capturePointer(zone, event.pointerId);
    event.preventDefault();
  });
  zone.addEventListener("pointermove", (event) => {
    if (!stick || event.pointerId !== stickPointer) return;
    const rect = zone.getBoundingClientRect();
    stick.point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const vec = stickVector(stick.origin, stick.point);
    stick.x = vec.x;
    stick.y = vec.y;
    stick.magnitude = vec.magnitude;
    const knob = stickKnob(stick.origin, stick.point);
    dom.stickKnob.style.left = `${knob.x - stick.origin.x + 52}px`;
    dom.stickKnob.style.top = `${knob.y - stick.origin.y + 52}px`;
  });
  const release = (event) => {
    if (event.pointerId !== stickPointer) return;
    stick = null;
    stickPointer = null;
    dom.stick.hidden = true;
  };
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);
  zone.addEventListener("lostpointercapture", release);
  // A finger that lifts off-zone (or a pointer that never got captured) must
  // still drop the stick, otherwise the 玩家 keeps walking with nobody touching.
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

function bindActionPad() {
  for (const button of dom.actionPad.querySelectorAll("[data-skill]")) {
    const skill = button.dataset.skill;
    button.addEventListener("pointerdown", (event) => {
      touchActions[skill] = true;
      latchAction(latches, skill);
      capturePointer(button, event.pointerId);
      audio.unlock();
      event.preventDefault();
    });
    const up = () => {
      touchActions[skill] = false;
    };
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }
}

/* -------------------------------------------------------------------- HUD */

function setBar(node, ratio) {
  node.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
}

function renderGear() {
  const equip = game.player.equip;
  const rows = [];
  for (const slot of ["weapon", "armor", "charm"]) {
    const item = equip[slot];
    if (!item) continue;
    rows.push(
      `<li><img alt="" src="./assets/icons/${iconForItem(item)}.png" />${item.name}<span> ${"★".repeat(item.tier)}</span></li>`,
    );
  }
  dom.gearStrip.innerHTML = rows.join("");
}

let gearSignature = "";

function updateHud() {
  const player = game.player;
  setBar(dom.hpFill, player.hp / player.maxHp);
  dom.hpText.textContent = `${Math.max(0, Math.ceil(player.hp))}／${player.maxHp}`;
  dom.levelName.textContent = `第${game.levelIndex + 1}關 ${game.level.name}`;
  dom.waveLabel.textContent = game.gateOpen ? "陣破，往廟門" : waveLabel(game);
  dom.scoreLabel.textContent = `分 ${game.score}`;

  const boss = bossHealth(game);
  dom.bossBar.hidden = !boss;
  if (boss) {
    dom.bossName.textContent = boss.name;
    setBar(dom.bossFill, boss.ratio);
  }

  for (const button of dom.actionPad.querySelectorAll("[data-skill]")) {
    const fraction = cooldownFraction(player, button.dataset.skill);
    button.querySelector("i").style.transform = `scaleY(${fraction})`;
  }

  const signature = ["weapon", "armor", "charm"]
    .map((slot) => player.equip[slot]?.id ?? "-")
    .join("|");
  if (signature !== gearSignature) {
    gearSignature = signature;
    renderGear();
  }
}

/* ----------------------------------------------------------------- panels */

function statRow(stats) {
  return Object.entries(stats)
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join("");
}

function showPanel({ title, sub, stats = {}, actions = [], help = false }) {
  dom.panelTitle.textContent = title;
  dom.panelSub.innerHTML = sub ?? "";
  dom.panelStats.innerHTML = statRow(stats);
  dom.panelActions.innerHTML = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.ghost) button.className = "ghost";
    button.addEventListener("click", () => {
      audio.unlock();
      audio.play("ui");
      action.run();
    });
    dom.panelActions.append(button);
  }
  if (help) {
    const note = document.createElement("p");
    note.className = "help-keys";
    note.innerHTML =
      "鍵盤：WASD／方向鍵移動 · J／空白＝斬 · K＝旋斬 · L＝火符 · Shift＝疾步 · Esc＝暫停<br />手機：左下拖曳＝搖桿（按哪就以哪為圓心）· 右下四鈕＝技能";
    dom.panelActions.append(note);
  }
  dom.panel.hidden = false;
}

function hidePanel() {
  dom.panel.hidden = true;
}

function progressStats() {
  return {
    最遠關卡: progress.bestLevel > 0 ? `第 ${progress.bestLevel} 關` : "尚未開張",
    最高分: progress.bestScore,
    出陣次數: progress.runs,
    收陣次數: progress.wins,
  };
}

function showTitle() {
  screen = "title";
  clearHeldInput();
  audio.music("plaza");
  showPanel({
    title: "廟口斬陣",
    sub: "夜裡廟埕起了陰陣。持刀踏陣，斬盡五關的鬼兵與坐鎮頭目。",
    stats: progressStats(),
    actions: [{ label: "起陣（開打）", run: startRun }],
    help: true,
  });
}

function showPause() {
  screen = "paused";
  clearHeldInput();
  audio.suspend();
  showPanel({
    title: "暫停",
    sub: `${game.level.name} · ${waveLabel(game)}`,
    stats: { 分數: game.score, 斬殺: game.kills, 命: `${Math.ceil(game.player.hp)}／${game.player.maxHp}` },
    actions: [
      { label: "繼續", run: resumePlay },
      { label: "重新開始", ghost: true, run: confirmRestart },
    ],
  });
}

function confirmRestart() {
  showPanel({
    title: "重新開始？",
    sub: "本局進度會作廢，從第 1 關重來。",
    stats: { 目前關卡: `第 ${game.levelIndex + 1} 關`, 分數: game.score },
    actions: [
      { label: "確定重來", run: startRun },
      { label: "取消", ghost: true, run: showPause },
    ],
  });
}

function runStats() {
  const stats = playerStats(game.player);
  return {
    分數: game.score,
    斬殺: game.kills,
    到達關卡: `第 ${game.levelIndex + 1} 關`,
    刀傷: stats.damage,
    減傷: `${Math.round(stats.resist * 100)}%`,
  };
}

function showLevelClear() {
  screen = "cleared";
  clearHeldInput();
  showPanel({
    title: `第${game.levelIndex + 1}關 收陣`,
    sub: `${game.level.name} 已淨。下一關：${LEVELS[game.levelIndex + 1]?.name ?? ""}`,
    stats: runStats(),
    actions: [{ label: "進廟門（下一關）", run: nextLevel }],
  });
}

function showVictory() {
  screen = "victory";
  clearHeldInput();
  audio.music("plaza");
  showPanel({
    title: "全陣已破",
    sub: "五關鬼兵盡斬，廟口大煞伏誅。香案重開。",
    stats: { ...runStats(), 最高分: progress.bestScore },
    actions: [{ label: "再走一遍", run: startRun }],
  });
}

function showDefeat() {
  screen = "defeat";
  clearHeldInput();
  audio.music("plaza");
  showPanel({
    title: "倒在陣中",
    sub: "命燈熄了。收香再起。",
    stats: { ...runStats(), 最高分: progress.bestScore },
    actions: [{ label: "再來一局", run: startRun }],
  });
}

/* ------------------------------------------------------------- run control */

async function saveRun({ won }) {
  if (runCounted) return;
  runCounted = true;
  progress = mergeProgress(progress, {
    levelReached: game.levelIndex + 1,
    score: game.score,
    kills: game.kills,
    won,
  });
  const ok = await store.saveProgress(progress);
  if (!ok) toast("進度同步失敗，本局成績仍算數");
}

function startRun() {
  game = createGame({ seed: Math.floor(Math.random() * 1e6), levels: LEVELS });
  runCounted = false;
  gearSignature = "";
  renderer.setMap(game.map, game.level.id);
  resumePlay();
}

function resumePlay() {
  screen = "playing";
  hidePanel();
  clearHeldInput();
  audio.unlock();
  audio.resume();
  audio.music(game.level.music ?? "battle");
  lastTime = performance.now();
  accumulator = 0;
  startLoop();
}

function nextLevel() {
  advanceLevel(game);
  if (game.phase === "victory") {
    saveRun({ won: true });
    showVictory();
    return;
  }
  renderer.setMap(game.map, game.level.id);
  gearSignature = "";
  resumePlay();
}

function togglePause() {
  if (screen === "playing") showPause();
  else if (screen === "paused") resumePlay();
}

/* -------------------------------------------------------------- main loop */

function handleEvents() {
  for (const event of drainEvents(game)) {
    switch (event.type) {
      case "bossSpawn":
        toast(`${event.name} 入陣`);
        renderer.addShake(7);
        audio.music("boss");
        break;
      case "bossDown":
        toast(`${event.name} 伏誅`);
        renderer.addShake(9);
        break;
      case "slam":
        renderer.addShake(5);
        break;
      case "hurt":
        renderer.addShake(3);
        break;
      case "blast":
        renderer.addShake(4);
        break;
      case "gateOpen":
        toast("陣破！廟門已開，往上方走");
        break;
      case "equip":
        toast(`換上 ${event.item.name}`);
        break;
      default:
        break;
    }
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const delta = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;

  if (screen === "playing") {
    composeInput(input, { pressed, stick, touchActions, latched: latches, aim: mouseAim });
    tickLatches(latches, delta);
    accumulator += delta;
    let guard = 0;
    while (accumulator >= FIXED_STEP && guard < 8) {
      step(game, input, FIXED_STEP);
      accumulator -= FIXED_STEP;
      guard += 1;
    }
    if (accumulator > FIXED_STEP * 8) accumulator = 0;
    const events = game.events.slice();
    audio.playEvents(events);
    handleEvents();

    if (game.phase === "defeat") {
      saveRun({ won: false });
      stopLoop();
      showDefeat();
    } else if (game.phase === "cleared") {
      stopLoop();
      showLevelClear();
    } else if (game.phase === "victory") {
      saveRun({ won: true });
      stopLoop();
      showVictory();
    }
  }

  lastView = renderer.draw(game, delta);
  updateHud();
}

function startLoop() {
  if (rafId) return;
  lastTime = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/* -------------------------------------------------------------- lifecycle */

function suspendAll() {
  clearHeldInput();
  audio.suspend();
  stopLoop();
  if (screen === "playing") showPause();
}

function bindLifecycle() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspendAll();
    else if (screen !== "playing") {
      // 回到前景時不自動續跑：等玩家按「繼續」，避免帶著舊按住狀態開打
      startLoop();
    }
  });
  window.addEventListener("pagehide", suspendAll);
  window.addEventListener("blur", () => {
    clearHeldInput();
    if (screen === "playing") showPause();
  });
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  bindKeyboard();
  bindStick();
  bindActionPad();
  bindMouseAim();
  bindLifecycle();

  dom.btnPause.addEventListener("click", () => {
    audio.unlock();
    togglePause();
  });
  dom.btnMute.addEventListener("click", () => {
    const muted = audio.setMuted(!audio.muted);
    dom.btnMute.setAttribute("aria-pressed", String(muted));
    dom.btnMute.textContent = muted ? "♪̸" : "♪";
  });

  const pg = globalThis.PG;
  store = createStore({ pg, onError: () => toast("存檔服務忙線，稍後再試") });
  await store.ready();
  try {
    progress = await store.loadProgress();
  } catch {
    toast("讀取進度失敗，先以新局開始");
  }

  const [creatures, ...icons] = await Promise.all([
    loadImage("./assets/sprites/creatures.png").catch(() => null),
    ...ICON_NAMES.map((name) => loadImage(`./assets/icons/${name}.png`).catch(() => null)),
  ]);
  images.creatures = creatures;
  ICON_NAMES.forEach((name, index) => {
    images[name] = icons[index];
  });

  renderer = createRenderer(dom.stage, images);
  renderer.setMap(game.map, game.level.id);
  showTitle();
  startLoop();
}

boot();
