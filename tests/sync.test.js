/**
 * Sync (§12).
 *
 * A fake server stands in for the Worker — its contract is pinned by
 * `scripts/api-tests.sh` against the real thing, so what matters here is the client's
 * orchestration: push before pull, union semantics, cursors, and two devices converging.
 */
import { describe, expect, it, vi } from 'vitest';
import { config } from '../config/app.config.js';
import { createDeck } from '../app/src/engine/deck.js';
import { mergeEvents } from '../app/src/engine/events.js';
import { rebuildFromEvents, stateHash } from '../app/src/engine/replay.js';
import { chunk, httpApi, syncNow } from '../app/src/sync/client.js';

const BATCH = config.auth.syncBatchMax;

/** An in-memory stand-in for the Worker, with the same cursor rules (§11). */
function fakeServer() {
  const events = [];
  const words = new Map();
  let clock = 1000;

  return {
    events,
    words,
    api: {
      me: async () => ({ user: { id: 'u1' }, cursor: events.at(-1)?.received_at ?? 0 }),
      pushEvents: async (batch) => {
        expect(batch.length).toBeLessThanOrEqual(BATCH);
        for (const event of batch) {
          // INSERT OR IGNORE: the same id twice is one event.
          if (events.some((e) => e.id === event.id)) continue;
          events.push({ ...event, received_at: ++clock });
        }
        return { cursor: events.at(-1)?.received_at ?? 0 };
      },
      pullEvents: async (since) => {
        const after = events.filter((e) => e.received_at > (since ?? 0));
        const page = after.slice(0, BATCH);
        return {
          events: page.map(({ received_at, ...event }) => event),
          cursor: page.at(-1)?.received_at ?? since ?? 0,
          more: after.length > BATCH,
        };
      },
      pushWords: async (batch) => {
        for (const word of batch) {
          const held = words.get(word.id);
          if (!held || (word.updatedAt ?? 0) > (held.updatedAt ?? 0)) words.set(word.id, word);
        }
        return { stored: batch.length };
      },
      pullWords: async (since) => {
        const after = [...words.values()].filter((w) => (w.updatedAt ?? 0) > (since ?? 0));
        after.sort((a, b) => a.updatedAt - b.updatedAt);
        const page = after.slice(0, BATCH);
        return { words: page, cursor: page.at(-1)?.updatedAt ?? since ?? 0, more: after.length > BATCH };
      },
    },
  };
}

/** A device: local storage plus the state a real store would keep. */
function device(words = []) {
  const deck = createDeck({ words });
  const state = {
    deck,
    events: [],
    customWords: new Map(),
    cursor: 0,
    wordCursor: 0,
    rebuilds: 0,
    states: new Map(),
  };

  const local = {
    unsyncedEvents: async () => state.events.filter((e) => e.synced === 0).map(({ synced, ...e }) => e),
    markSynced: async (ids) => {
      const known = new Set(ids);
      for (const event of state.events) if (known.has(event.id)) event.synced = 1;
    },
    addRemoteEvents: async (incoming) => {
      const known = new Set(state.events.map((e) => e.id));
      const fresh = incoming.filter((e) => !known.has(e.id)).map((e) => ({ ...e, synced: 1 }));
      state.events = mergeEvents(state.events, fresh);
      return fresh.length;
    },
    cursor: async () => state.cursor,
    setCursor: async (value) => {
      state.cursor = value;
    },
    wordCursor: async () => state.wordCursor,
    setWordCursor: async (value) => {
      state.wordCursor = value;
    },
    localWords: async () => [...state.customWords.values()],
    mergeWords: async (incoming) => {
      let merged = 0;
      for (const word of incoming) {
        const held = state.customWords.get(word.id);
        if (!held || (word.updatedAt ?? 0) > (held.updatedAt ?? 0)) {
          state.customWords.set(word.id, word);
          merged += 1;
        }
      }
      return merged;
    },
    rebuild: async () => {
      state.rebuilds += 1;
      state.deck = createDeck({ words }, [...state.customWords.values()]);
      state.states = rebuildFromEvents(state.deck, state.events).states;
    },
  };

  /** Record a review the way the store would: unsynced until proven otherwise. */
  const review = (id, cardId, rating, ts) => {
    state.events.push({ id, cardId, rating, ts, synced: 0 });
    state.states = rebuildFromEvents(state.deck, state.events).states;
  };

  return { state, local, review };
}

const word = (id) => ({ id, simp: id, pinyin: 'yī', pinyinNum: 'yi1', defs: ['one'], band: 1, sentences: [] });

describe('batching', () => {
  it('never exceeds SYNC_BATCH_MAX', () => {
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [4]]);
    expect(chunk(Array.from({ length: BATCH + 1 }, (_, i) => i)).map((b) => b.length)).toEqual([
      BATCH,
      1,
    ]);
  });
});

describe('one device', () => {
  it('does nothing useful when signed out', async () => {
    const d = device([word('w1')]);
    const api = { me: async () => ({}) };
    const result = await syncNow(d.local, api);
    expect(result).toMatchObject({ ok: false, reason: 'signed_out', pushed: 0, pulled: 0 });
  });

  it('pushes the local log and marks it synced', async () => {
    const server = fakeServer();
    const d = device([word('w1')]);
    d.review('e1', 'w1#REC', 3, 1000);
    d.review('e2', 'w1#REC', 4, 2000);

    const result = await syncNow(d.local, server.api);
    expect(result.pushed).toBe(2);
    expect(server.events).toHaveLength(2);
    expect(await d.local.unsyncedEvents()).toEqual([]);

    // A second run has nothing to say.
    const again = await syncNow(d.local, server.api);
    expect(again).toMatchObject({ pushed: 0, pulled: 0 });
    expect(server.events).toHaveLength(2);
  });

  it('is idempotent: syncing twice never duplicates an event', async () => {
    const server = fakeServer();
    const d = device([word('w1')]);
    d.review('e1', 'w1#REC', 3, 1000);

    await syncNow(d.local, server.api);
    await syncNow(d.local, server.api);
    await syncNow(d.local, server.api);

    expect(server.events).toHaveLength(1);
    expect(d.state.events).toHaveLength(1);
  });

  it('walks the cursor across pages until the server says it is done', async () => {
    const server = fakeServer();
    const seeder = device([word('w1')]);
    for (let i = 0; i < BATCH + 5; i++) seeder.review(`s${i}`, 'w1#REC', 3, 1000 + i);
    await syncNow(seeder.local, server.api);

    const fresh = device([word('w1')]);
    const pulls = vi.spyOn(server.api, 'pullEvents');
    const result = await syncNow(fresh.local, server.api);

    expect(result.pulled).toBe(BATCH + 5);
    expect(pulls.mock.calls.length).toBeGreaterThan(1);
    expect(fresh.state.events).toHaveLength(BATCH + 5);
  });

  it('rebuilds once, and only when something arrived', async () => {
    const server = fakeServer();
    const d = device([word('w1')]);
    d.review('e1', 'w1#REC', 3, 1000);

    await syncNow(d.local, server.api);
    expect(d.state.rebuilds).toBe(0); // pushing changes nothing locally

    const other = device([word('w1')]);
    await syncNow(other.local, server.api);
    expect(other.state.rebuilds).toBe(1);
  });
});

describe('two devices (§12 acceptance)', () => {
  const words = [word('w1'), word('w2')];

  it('converges on identical state, hash for hash', async () => {
    const server = fakeServer();
    const a = device(words);
    const b = device(words);

    a.review('a1', 'w1#REC', 3, Date.UTC(2026, 6, 21, 9));
    a.review('a2', 'w2#REC', 4, Date.UTC(2026, 6, 21, 10));
    await syncNow(a.local, server.api);

    b.review('b1', 'w1#REC', 2, Date.UTC(2026, 6, 21, 11));
    await syncNow(b.local, server.api);
    // A has not yet seen B's review; a second pass closes the loop.
    await syncNow(a.local, server.api);

    expect(a.state.events.map((e) => e.id).sort()).toEqual(['a1', 'a2', 'b1']);
    expect(b.state.events.map((e) => e.id).sort()).toEqual(['a1', 'a2', 'b1']);

    const hashA = stateHash(rebuildFromEvents(a.state.deck, a.state.events).states);
    const hashB = stateHash(rebuildFromEvents(b.state.deck, b.state.events).states);
    expect(hashA).toBe(hashB);
  });

  it('converges regardless of which device syncs first', async () => {
    const run = async (firstIsA) => {
      const server = fakeServer();
      const a = device(words);
      const b = device(words);
      a.review('a1', 'w1#REC', 3, 5000);
      b.review('b1', 'w1#REC', 1, 6000);

      const [first, second] = firstIsA ? [a, b] : [b, a];
      await syncNow(first.local, server.api);
      await syncNow(second.local, server.api);
      await syncNow(first.local, server.api);

      return stateHash(rebuildFromEvents(a.state.deck, a.state.events).states);
    };

    expect(await run(true)).toBe(await run(false));
  });

  it('propagates a custom word and its tombstone', async () => {
    const server = fakeServer();
    const a = device(words);
    const b = device(words);

    a.state.customWords.set('c1', { id: 'c1', simp: '咖啡', defs: ['coffee'], updatedAt: 1000, deleted: false });
    await syncNow(a.local, server.api);
    await syncNow(b.local, server.api);
    expect(b.state.customWords.get('c1').simp).toBe('咖啡');

    // Removing it on A is a write, not a delete — so it travels.
    a.state.customWords.set('c1', { id: 'c1', updatedAt: 2000, deleted: true });
    await syncNow(a.local, server.api);
    await syncNow(b.local, server.api);
    expect(b.state.customWords.get('c1').deleted).toBe(true);
  });

  it('keeps the newer edit when both devices touched a word', async () => {
    const server = fakeServer();
    const a = device(words);
    const b = device(words);

    a.state.customWords.set('c1', { id: 'c1', defs: ['older'], updatedAt: 1000 });
    b.state.customWords.set('c1', { id: 'c1', defs: ['newer'], updatedAt: 2000 });

    await syncNow(a.local, server.api);
    await syncNow(b.local, server.api);
    await syncNow(a.local, server.api);

    expect(a.state.customWords.get('c1').defs).toEqual(['newer']);
    expect(b.state.customWords.get('c1').defs).toEqual(['newer']);
  });
});

describe('guest to account migration (§12)', () => {
  it('is the same code path — a guest log is just an unsynced log', async () => {
    const server = fakeServer();
    // A guest studies for a while with no account at all.
    const guest = device([word('w1'), word('w2')]);
    for (let i = 0; i < 25; i++) guest.review(`g${i}`, `w${(i % 2) + 1}#REC`, 3, 1000 + i);

    // Signing in is simply the first sync.
    const result = await syncNow(guest.local, server.api);

    expect(result.pushed).toBe(25);
    expect(result.pulled).toBe(0);
    expect(server.events).toHaveLength(25);

    // And a second device picks the whole history up.
    const laptop = device([word('w1'), word('w2')]);
    await syncNow(laptop.local, server.api);
    expect(laptop.state.events).toHaveLength(25);
    expect(stateHash(rebuildFromEvents(laptop.state.deck, laptop.state.events).states)).toBe(
      stateHash(rebuildFromEvents(guest.state.deck, guest.state.events).states),
    );
  });
});

describe('http port', () => {
  it('sends cookies and reports a signed-out session distinctly', async () => {
    const calls = [];
    const api = httpApi(async (path, options) => {
      calls.push({ path, options });
      return { ok: false, status: 401, json: async () => ({}) };
    });

    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'signed_out' });
    expect(calls[0].options.credentials).toBe('same-origin');
    expect(calls[0].path).toBe('/api/me');
  });

  it('builds the documented URLs', async () => {
    const seen = [];
    const api = httpApi(async (path, options = {}) => {
      seen.push([options.method ?? 'GET', path]);
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await api.pullEvents(42);
    await api.pushEvents([]);
    await api.pullWords(7);
    await api.logout();
    await api.deleteAccount();

    expect(seen).toEqual([
      ['GET', '/api/sync/events?since=42'],
      ['POST', '/api/sync/events'],
      ['GET', '/api/sync/words?since=7'],
      ['POST', '/api/auth/logout'],
      ['DELETE', '/api/me'],
    ]);
  });
});
