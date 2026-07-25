/**
 * The dictionary batch parser (audit F3).
 *
 * The parse and reshape that used to freeze the main thread at first Browse now run in a
 * Web Worker; this is its pure core, tested without a Worker. What matters: every entry is
 * reshaped to the `dict` store's `{ simp, trad, pinyinNum, defs }` (§5.2), nothing is lost
 * or duplicated across batches, and the batch size is honoured.
 */
import { describe, expect, it } from 'vitest';
import { DICT_BATCH, dictBatches, shapeRow } from '../app/src/engine/dict-batch.js';

const entry = (n) => [`s${n}`, `t${n}`, `p${n}`, [`d${n}`]];

describe('dictBatches (F3)', () => {
  it('reshapes a stored array into the dict-store row', () => {
    expect(shapeRow(['传统', '傳統', 'chuan2 tong3', ['tradition', 'traditional']])).toEqual({
      simp: '传统',
      trad: '傳統',
      pinyinNum: 'chuan2 tong3',
      defs: ['tradition', 'traditional'],
    });
  });

  it('splits into batches of the requested size, last one short', () => {
    const entries = Array.from({ length: 4500 }, (_, i) => entry(i));
    const batches = [...dictBatches(entries, 2000)];
    expect(batches.map((b) => b.length)).toEqual([2000, 2000, 500]);
  });

  it('loses and duplicates nothing across the batches', () => {
    const entries = Array.from({ length: 3003 }, (_, i) => entry(i));
    const rows = [...dictBatches(entries, 1000)].flat();
    expect(rows).toHaveLength(3003);
    expect(rows.map((r) => r.simp)).toEqual(entries.map(([simp]) => simp));
  });

  it('handles an empty dictionary without a stray batch', () => {
    expect([...dictBatches([])]).toEqual([]);
  });

  it('defaults to the shared batch size', () => {
    const entries = Array.from({ length: DICT_BATCH + 1 }, (_, i) => entry(i));
    const batches = [...dictBatches(entries)];
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(DICT_BATCH);
  });
});
