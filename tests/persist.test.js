import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROGRESS,
  PROGRESS_KEY,
  createStore,
  mergeProgress,
  parseProgress,
} from "../src/persist.js";

describe("parseProgress", () => {
  it("defaults when the key is missing or junk", () => {
    expect(parseProgress(null)).toEqual(DEFAULT_PROGRESS);
    expect(parseProgress("not json")).toEqual(DEFAULT_PROGRESS);
    expect(parseProgress("[1,2]")).toEqual(DEFAULT_PROGRESS);
  });

  it("coerces stored numbers and drops negatives", () => {
    expect(parseProgress('{"bestLevel":"3","bestScore":-9,"runs":2.7}')).toEqual({
      bestLevel: 3,
      bestScore: 0,
      runs: 2,
      wins: 0,
      bestKills: 0,
    });
  });
});

describe("mergeProgress", () => {
  it("keeps the best numbers and counts the run", () => {
    const first = mergeProgress(DEFAULT_PROGRESS, { levelReached: 3, score: 500, kills: 40 });
    expect(first).toEqual({ bestLevel: 3, bestScore: 500, bestKills: 40, runs: 1, wins: 0 });
    const second = mergeProgress(first, { levelReached: 2, score: 900, kills: 20 });
    expect(second).toMatchObject({ bestLevel: 3, bestScore: 900, bestKills: 40, runs: 2 });
  });

  it("tallies wins separately", () => {
    const won = mergeProgress(DEFAULT_PROGRESS, { levelReached: 5, score: 1, won: true });
    expect(won.wins).toBe(1);
    expect(mergeProgress(won, { levelReached: 1, score: 1 }).wins).toBe(1);
  });

  it("can record a run without counting it", () => {
    expect(mergeProgress(DEFAULT_PROGRESS, { score: 10, counted: false }).runs).toBe(0);
  });
});

describe("createStore", () => {
  it("prefers PG.kv when the shell injected it", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const pg = { ready: Promise.resolve(), kv: { get: vi.fn().mockResolvedValue(null), put } };
    const fetchImpl = vi.fn();
    const store = createStore({ pg, fetchImpl });
    expect(await store.ready()).toBe("kv");
    await store.saveProgress({ bestScore: 5 });
    expect(put).toHaveBeenCalledWith(PROGRESS_KEY, JSON.stringify({ bestScore: 5 }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the default /api/kv route with no PG", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"bestScore":42}',
    });
    const store = createStore({ pg: undefined, fetchImpl });
    expect(await store.ready()).toBe("api");
    const progress = await store.loadProgress();
    expect(fetchImpl).toHaveBeenCalledWith(`/api/kv/${encodeURIComponent(PROGRESS_KEY)}`);
    expect(progress.bestScore).toBe(42);
  });

  it("treats 404 as an empty save", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    const store = createStore({ pg: undefined, fetchImpl });
    await store.ready();
    expect(await store.loadProgress()).toEqual(DEFAULT_PROGRESS);
  });

  it("reports platform errors instead of throwing, and keeps playing", async () => {
    const onError = vi.fn();
    const pg = {
      ready: Promise.resolve(),
      kv: {
        get: vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { code: "functions_no_leader" })),
        put: vi.fn().mockRejectedValue(new Error("nope")),
      },
    };
    const store = createStore({ pg, fetchImpl: null, onError });
    await store.ready();
    expect(await store.loadProgress()).toEqual(DEFAULT_PROGRESS);
    expect(await store.saveProgress({ bestScore: 1 })).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it("still remembers values in memory when every backend is gone", async () => {
    const store = createStore({ pg: undefined, fetchImpl: null });
    expect(await store.ready()).toBe("memory");
    await store.saveProgress({ bestScore: 7, bestLevel: 2 });
    expect((await store.loadProgress()).bestScore).toBe(7);
  });
});
