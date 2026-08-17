export const PROGRESS_KEY = "templecleave:progress";

export const DEFAULT_PROGRESS = {
  bestLevel: 0,
  bestScore: 0,
  runs: 0,
  wins: 0,
  bestKills: 0,
};

export function parseProgress(raw) {
  if (!raw) return { ...DEFAULT_PROGRESS };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PROGRESS };
    const num = (value, fallback = 0) =>
      Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
    return {
      bestLevel: num(parsed.bestLevel),
      bestScore: num(parsed.bestScore),
      runs: num(parsed.runs),
      wins: num(parsed.wins),
      bestKills: num(parsed.bestKills),
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

/** Fold one finished run into the stored progress. Pure so it is easy to test. */
export function mergeProgress(progress, run = {}) {
  const base = parseProgress(progress);
  const levelReached = Math.max(0, Math.floor(run.levelReached ?? 0));
  const score = Math.max(0, Math.floor(run.score ?? 0));
  const kills = Math.max(0, Math.floor(run.kills ?? 0));
  return {
    bestLevel: Math.max(base.bestLevel, levelReached),
    bestScore: Math.max(base.bestScore, score),
    bestKills: Math.max(base.bestKills, kills),
    runs: base.runs + (run.counted === false ? 0 : 1),
    wins: base.wins + (run.won ? 1 : 0),
  };
}

/**
 * Persistence goes through `PG.kv` when the shell injected it, falls back to the
 * host default `/api/kv/<key>` route, and finally to memory so a run never
 * blocks on storage. Never uses localStorage as the authority.
 */
export function createStore({ pg = globalThis.PG, fetchImpl, onError } = {}) {
  // `fetchImpl: null` explicitly disables the /api fallback (used by tests).
  const doFetch =
    fetchImpl === undefined ? (typeof fetch === "function" ? fetch.bind(globalThis) : null) : fetchImpl;
  const memory = new Map();
  let mode = "memory";

  const report = (error) => {
    if (typeof onError === "function") onError(error);
  };

  async function ready() {
    if (pg?.ready) {
      try {
        await pg.ready;
      } catch (error) {
        report(error);
      }
    }
    mode = pg?.kv ? "kv" : doFetch ? "api" : "memory";
    return mode;
  }

  async function get(key) {
    if (pg?.kv) {
      try {
        return await pg.kv.get(key);
      } catch (error) {
        report(error);
      }
    }
    if (doFetch) {
      try {
        const res = await doFetch(`/api/kv/${encodeURIComponent(key)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`kv get failed: ${res.status}`);
        return await res.text();
      } catch (error) {
        report(error);
      }
    }
    return memory.get(key) ?? null;
  }

  async function put(key, value) {
    memory.set(key, value);
    if (pg?.kv) {
      try {
        await pg.kv.put(key, value);
        return true;
      } catch (error) {
        report(error);
      }
    }
    if (doFetch) {
      try {
        const res = await doFetch(`/api/kv/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: value,
        });
        if (!res.ok) throw new Error(`kv put failed: ${res.status}`);
        return true;
      } catch (error) {
        report(error);
      }
    }
    return false;
  }

  return {
    ready,
    get,
    put,
    get mode() {
      return mode;
    },
    async loadProgress() {
      return parseProgress(await get(PROGRESS_KEY));
    },
    async saveProgress(progress) {
      return put(PROGRESS_KEY, JSON.stringify(progress));
    },
  };
}
