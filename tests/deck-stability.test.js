/**
 * Deck immutability (Phase 11 acceptance): the deck is untouchable.
 *
 * Every phase since 7 has promised card ids and deck words stay fixed while topics, the course
 * and the UI churn around them. This makes that promise mechanical: a content hash over the
 * committed deck words must equal the frozen value below. ANY deck-word change — a re-ordered
 * introRank, an edited definition, an added field — fails this the moment it lands, forcing the
 * change to be a deliberate, reviewed act (bump the hash on purpose) rather than a silent drift.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = resolve(process.cwd(), 'app/assets/packs/zh/deck.zh.json');

// Frozen 2026-07 (Phase 11). Bump ONLY when the deck is intentionally regenerated.
const DECK_WORDS_SHA256 = '407b292734c1e237e6f7dd5e4b9756a27e4a254273420110dfec4b8ec7fa82dc';
const DECK_WORD_COUNT = 10904;

describe('deck is untouchable (Phase 11)', () => {
  it.skipIf(!existsSync(path))('the committed deck words match the frozen content hash', () => {
    const deck = JSON.parse(readFileSync(path, 'utf8'));
    expect(deck.words).toHaveLength(DECK_WORD_COUNT);
    const hash = createHash('sha256').update(JSON.stringify(deck.words)).digest('hex');
    expect(
      hash,
      'deck words changed — if intentional, regenerate the deck and update DECK_WORDS_SHA256',
    ).toBe(DECK_WORDS_SHA256);
  });
});
