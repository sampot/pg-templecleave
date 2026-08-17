/** SFX pools: several variants get picked at random so combat does not machine-gun. */
export const SFX_POOLS = {
  slash: ["slash-a", "slash-b"],
  hit: ["hit-a", "hit-b"],
  whirl: ["whirl"],
  talisman: ["talisman"],
  dash: ["dash"],
  hurt: ["hurt"],
  down: ["enemy-down"],
  boss: ["boss"],
  equip: ["equip"],
  pickup: ["pickup"],
  gate: ["gate"],
  ui: ["ui"],
  clear: ["jingle-clear"],
  win: ["jingle-win"],
  lose: ["jingle-lose"],
};

const EVENT_SFX = {
  cleave: "slash",
  whirl: "whirl",
  talisman: "talisman",
  blast: "hit",
  dash: "dash",
  charge: "dash",
  hit: "hit",
  hurt: "hurt",
  enemyDown: "down",
  bossSpawn: "boss",
  bossDown: "boss",
  slam: "talisman",
  summon: "ui",
  equip: "equip",
  pickup: "pickup",
  gateOpen: "gate",
  waveStart: "ui",
  waveClear: "ui",
  levelClear: "clear",
  victory: "win",
  defeat: "lose",
};

/** Pure mapping from a simulation event to a sound pool name (or null). */
export function eventToSfx(event) {
  if (!event || typeof event.type !== "string") return null;
  if (event.type === "enemyDown" && event.boss) return null;
  return EVENT_SFX[event.type] ?? null;
}

export const MUSIC_TRACKS = {
  plaza: "./assets/music/plaza.ogg",
  battle: "./assets/music/battle.ogg",
  boss: "./assets/music/boss.ogg",
};

const ALL_SFX = [...new Set(Object.values(SFX_POOLS).flat())];

export function createAudio({ base = "./assets/sfx", enabled = true } = {}) {
  const buffers = new Map();
  const lastPlayed = new Map();
  let ctx = null;
  let master = null;
  let musicEl = null;
  let musicName = null;
  let muted = !enabled;
  let suspended = false;
  let loading = null;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    return ctx;
  }

  async function loadAll() {
    if (loading) return loading;
    const context = ensureContext();
    if (!context) return null;
    loading = Promise.all(
      ALL_SFX.map(async (name) => {
        try {
          const res = await fetch(`${base}/${name}.ogg`);
          const data = await res.arrayBuffer();
          buffers.set(name, await context.decodeAudioData(data));
        } catch {
          /* a missing sound must never break the run */
        }
      }),
    );
    return loading;
  }

  /** Must be called from a user gesture (browsers block autoplay otherwise). */
  async function unlock() {
    const context = ensureContext();
    if (!context) return false;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    await loadAll();
    return true;
  }

  function play(pool, { volume = 1, rate = 1 } = {}) {
    if (muted || suspended || !ctx || !master) return false;
    const names = SFX_POOLS[pool];
    if (!names) return false;
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(pool) ?? -1) < 0.045) return false;
    lastPlayed.set(pool, now);
    const name = names[Math.floor(Math.random() * names.length)];
    const buffer = buffers.get(name);
    if (!buffer) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(master);
    src.start();
    return true;
  }

  function playEvents(events) {
    let played = 0;
    for (const event of events) {
      const pool = eventToSfx(event);
      if (pool && play(pool)) played += 1;
    }
    return played;
  }

  function music(name, { volume = 0.34 } = {}) {
    const url = MUSIC_TRACKS[name];
    if (!url || typeof Audio !== "function") return false;
    if (musicName === name && musicEl) {
      musicEl.volume = muted ? 0 : volume;
      return true;
    }
    if (musicEl) {
      musicEl.pause();
      musicEl.src = "";
    }
    musicEl = new Audio(url);
    musicEl.loop = true;
    musicEl.volume = muted ? 0 : volume;
    musicName = name;
    if (!suspended && !muted) musicEl.play().catch(() => {});
    return true;
  }

  function stopMusic() {
    if (musicEl) musicEl.pause();
    musicName = null;
  }

  function suspend() {
    suspended = true;
    if (musicEl) musicEl.pause();
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function resume() {
    suspended = false;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    if (musicEl && !muted) musicEl.play().catch(() => {});
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (musicEl) {
      musicEl.volume = muted ? 0 : 0.34;
      if (muted) musicEl.pause();
      else if (!suspended) musicEl.play().catch(() => {});
    }
    return muted;
  }

  return {
    unlock,
    play,
    playEvents,
    music,
    stopMusic,
    suspend,
    resume,
    setMuted,
    get muted() {
      return muted;
    },
    get suspended() {
      return suspended;
    },
    get track() {
      return musicName;
    },
  };
}
