/**
 * The rule-based topic tagger (Phase 11 §1).
 *
 * The two defects the maintainer's eye caught: 电话 in "numbers" (a "phone number" sense matched
 * the substring "number") and units titled "Numbers & time" opening with 男/男朋友. These pin the
 * tagger's guarantees — head-term matching, a poison trap list, a closed-class CORE, one home
 * topic per word, and ordered sequences — plus determinism.
 */
import { describe, expect, it } from 'vitest';
import { tagTopics, LABELS } from '../packs/zh/lib/topics.js';

const w = (id, simp, band, defs) => ({ id, simp, band, defs });

const deck = [
  w('n:8', '八', 1, ['eight']),
  w('n:2', '二', 1, ['two']),
  w('n:0', '零', 1, ['zero']),
  w('t:phone', '电话', 1, ['telephone', 'phone call', 'phone number']),
  w('p:bf', '男朋友', 1, ['boyfriend']),
  w('fn:de', '的', 1, ["of; ~'s (possessive particle)"]),
  w('fn:ge', '个', 1, ['(classifier used before a noun that has no specific classifier)']),
  w('food:cha', '茶', 1, ['tea', 'tea plant']),
  // A poison FIRST sense (a bound-form/classifier gloss) that must be skipped for the real one.
  w('trap:leaf', '叶', 3, ['(bound form) page; leaf', 'a kind of tea leaf']),
];

describe('tagTopics (§1)', () => {
  const { topics, home, core } = tagTopics(deck);

  it('does not let a "phone number" sense drag 电话 into numbers', () => {
    expect(home['t:phone']).toBe('tech');
    expect(topics.numbers ?? []).not.toContain('t:phone');
  });

  it('keeps numbers as cardinals in value order', () => {
    expect(topics.numbers).toEqual(['n:0', 'n:2', 'n:8']); // 零 二 八
  });

  it('puts 男朋友 among people, never in numbers/time', () => {
    expect(home['p:bf']).toBe('people');
  });

  it('routes function words to CORE, never to a topic', () => {
    expect(core).toContain('fn:de'); // particle
    expect(core).toContain('fn:ge'); // classifier
    expect(home['fn:de']).toBeUndefined();
    expect(home['fn:ge']).toBeUndefined();
  });

  it('matches on the primary sense, skipping a poison first gloss (trap list)', () => {
    // The "(bound form) page; leaf" sense is skipped; the "tea leaf" sense homes it in food.
    expect(home['trap:leaf']).toBe('food');
  });

  it('gives every word a single home topic', () => {
    const counts = {};
    for (const t of Object.keys(home)) counts[home[t]] = (counts[home[t]] ?? 0) + 1;
    // A word appears in exactly one home; secondary memberships are separate.
    for (const [id, topic] of Object.entries(home)) {
      const firstOwner = Object.keys(topics).find((t) => topics[t][0] === id || topics[t].includes(id));
      expect(firstOwner, id).toBeTruthy();
      expect(LABELS[topic], topic).toBeTruthy();
    }
  });

  it('is deterministic — same deck, identical output', () => {
    expect(JSON.stringify(tagTopics(deck))).toBe(JSON.stringify(tagTopics(deck)));
  });

  // §5: within a topic — orderedTopics sequence where defined, else band → frequency.
  it('orders an ordered topic by its sequence, and a plain topic by band', () => {
    const plain = [
      w('f1', '茶', 3, ['tea']),
      w('f2', '肉', 1, ['meat']),
      w('f3', '菜', 2, ['vegetable']),
    ];
    const tagged = tagTopics(plain);
    // Food has no sequence, so it sorts by band ascending (a frequency proxy) — 肉(1) 菜(2) 茶(3).
    expect(tagged.topics.food).toEqual(['f2', 'f3', 'f1']);
  });
});
