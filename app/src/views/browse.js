/**
 * Browse: search the local dictionary, add words of your own (§9).
 *
 * The dictionary is imported into IndexedDB once, on first visit, with progress shown.
 * Everything after that is local — no request leaves the device (§1.2).
 */
import { config } from '../../../config/app.config.js';
import * as db from '../engine/db.js';
import { numToMarks } from '../zh/pinyin.js';
import { addCustomWord, store } from '../store.js';
import { button, div, el, empty, h, p, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorPinyin } from '../zh/tones.js';

const s = strings.browse;
const LANG = config.pack.langPackV1;
const MAX_RESULTS = 50;
const DICT_READY_KEY = 'dictImported';

/** Import the pack dictionary into IndexedDB once (§5.2). */
async function ensureDictionary(onProgress) {
  if (await db.getMeta(store.db, DICT_READY_KEY, false)) return;

  onProgress();
  const res = await fetch(`/assets/packs/${LANG}/dict.${LANG}.json`);
  if (!res.ok) throw new Error(`dictionary: ${res.status}`);
  const entries = await res.json();

  // Chunked so a huge transaction cannot stall the UI thread.
  const CHUNK = 5000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const rows = entries.slice(i, i + CHUNK).map(([simp, trad, pinyinNum, defs]) => ({
      simp,
      trad,
      pinyinNum,
      defs,
    }));
    await db.putAll(store.db, db.STORES.dict, rows);
  }
  await db.setMeta(store.db, DICT_READY_KEY, true);
}

/** Match across simp, trad, numbered pinyin and definitions (§9). */
export function matches(entry, query) {
  const q = query.toLowerCase();
  if (entry.simp.includes(query)) return true;
  if (entry.trad && entry.trad.includes(query)) return true;
  const pinyin = entry.pinyinNum.toLowerCase();
  if (pinyin.includes(q)) return true;
  // "kafei" should find "ka1 fei1": compare with tones and spaces stripped.
  if (pinyin.replace(/[1-5\s]/g, '').includes(q.replace(/[1-5\s]/g, ''))) return true;
  return entry.defs.some((d) => d.toLowerCase().includes(q));
}

export function renderBrowse(root) {
  const results = div({ class: 'results' });
  const status = div({ class: 'status' });

  const input = el('input', {
    class: 'search',
    attrs: {
      type: 'search',
      placeholder: s.placeholder,
      'aria-label': s.placeholder,
      autocomplete: 'off',
    },
  });

  let entries = null;

  async function ensureLoaded() {
    if (entries) return entries;
    await ensureDictionary(() => {
      replace(status, div({ class: 'loading' }, [p(s.loading), p(s.loadingHint, 'muted')]));
    });
    entries = await db.getAll(store.db, db.STORES.dict);
    replace(status);
    return entries;
  }

  async function search(query) {
    const trimmed = query.trim();
    if (!trimmed) return replace(results);

    const all = await ensureLoaded();
    const found = [];
    for (const entry of all) {
      if (matches(entry, trimmed)) {
        found.push(entry);
        if (found.length >= MAX_RESULTS) break;
      }
    }

    if (found.length === 0) return replace(results, empty(s.noResults));
    replace(
      results,
      ...found.map((entry) => resultRow(entry)),
      found.length >= MAX_RESULTS ? p(s.resultCap(MAX_RESULTS), 'muted') : null,
    );
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value), 150);
  });

  replace(
    root,
    div({ class: 'browse' }, [h(1, s.title, 'title'), input, status, results]),
  );
  queueMicrotask(() => input.focus({ preventScroll: true }));

  return () => clearTimeout(timer);
}

/** One search result, with an "add" action. */
function resultRow(entry) {
  const wordId = `${LANG}:${entry.simp}:${entry.pinyinNum.replace(/\s+/g, '_')}`;
  const already = store.deck.has(wordId);

  const pinyin = span({ class: 'pinyin' });
  pinyin.append(colorPinyin(entry.pinyinNum));

  const action = already
    ? span({ class: 'added', text: s.inDeck })
    : button(s.add, async (event) => {
        await addCustomWord({
          id: wordId,
          simp: entry.simp,
          trad: entry.trad || undefined,
          pinyin: numToMarks(entry.pinyinNum),
          pinyinNum: entry.pinyinNum,
          defs: entry.defs,
          sentences: [],
        });
        event.target.replaceWith(span({ class: 'added', text: s.added }));
      }, { variant: 'btn-quiet' });

  return div({ class: 'result' }, [
    div({ class: 'result-main' }, [
      span({ class: 'result-hanzi', text: entry.simp }),
      pinyin,
      p(entry.defs.slice(0, 3).join('; '), 'result-defs'),
    ]),
    action,
  ]);
}
