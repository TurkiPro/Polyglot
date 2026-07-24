/**
 * Browse: search the local dictionary, add words of your own (§9).
 *
 * The dictionary is imported into IndexedDB once, on first visit, with progress shown.
 * Everything after that is local — no request leaves the device (§1.2).
 */
import { config } from '../../../config/app.config.js';
import * as db from '../engine/db.js';
import { numToMarks } from '../zh/pinyin.js';
import { addCustomWord, isPrioritized, store, studyNext } from '../store.js';
import { button, checkStamp, div, el, empty, h, p, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorPinyin } from '../zh/tones.js';
import { summarize } from '../zh/defs.js';
import { prepareEntries, rankResults } from './search.js';

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


export function renderBrowse(root, ctx) {
  const results = div({ class: 'results' });
  const status = div({ class: 'status' });

  /**
   * Browse with nothing typed shows what there is to browse (§3.4.7).
   *
   * Frequency collections are deliberately absent — see DECISIONS: no frequency list we
   * could find permits redistributing derived ranks. Bands are the curriculum itself and
   * need no third-party data.
   */
  function showCollections() {
    const bands = new Map();
    for (const word of store.deck.words) {
      if (!word.band) continue;
      if (!bands.has(word.band)) bands.set(word.band, { total: 0, started: 0 });
      const row = bands.get(word.band);
      row.total += 1;
      if (store.states.get(`${word.id}#REC`)?.reps > 0) row.started += 1;
    }

    const tiles = [...bands.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([band, counts]) => {
        const tile = button('', () => showBand(band), { variant: 'collection' });
        tile.append(
          span({ class: 'collection-name', text: s.bandLabel(band) }),
          span({ class: 'collection-meta', text: s.learned(counts.started, counts.total) }),
        );
        return tile;
      });

    replace(
      results,
      p(s.startTyping, 'muted'),
      h(2, s.bands, 'panel-title'),
      p(s.bandBlurb, 'muted'),
      div({ class: 'collections' }, tiles),
    );
  }

  /** One band's words, in teaching order, each with the same actions as a search row. */
  function showBand(band) {
    const words = store.deck.words.filter((word) => word.band === band);
    replace(
      results,
      button(s.backToCollections, () => showCollections(), { variant: 'btn-quiet btn-small' }),
      h(2, s.bandTitle(band), 'panel-title'),
      p(s.bandCount(words.length), 'result-count'),
      ...words.map((word) => deckRow(word, ctx)),
    );
  }

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
    entries = prepareEntries(await db.getAll(store.db, db.STORES.dict));
    replace(status);
    return entries;
  }

  async function search(query) {
    const trimmed = query.trim();
    if (!trimmed) return showCollections();

    const all = await ensureLoaded();
    // Score the whole dictionary before cutting, or the cut decides relevance.
    const found = rankResults(all, trimmed, store.deck, MAX_RESULTS);

    if (found.length === 0) return replace(results, empty(s.noResults));
    replace(
      results,
      p(found.length >= MAX_RESULTS ? s.resultCap(MAX_RESULTS) : s.resultCount(found.length), 'result-count'),
      ...found.map((entry) => resultRow(entry)),
    );
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value), 150);
  });

  replace(root, div({ class: 'browse' }, [h(1, s.title, 'title'), input, status, results]));
  showCollections();
  queueMicrotask(() => input.focus({ preventScroll: true }));

  return () => clearTimeout(timer);
}

/** A deck word in a band list — the same shape as a search result. */
function deckRow(word, ctx) {
  const pinyin = span({ class: 'pinyin' });
  pinyin.append(colorPinyin(word.pinyinNum));

  const main = div({ class: 'result-main' }, [
    span({ class: 'result-hanzi', text: word.simp }),
    pinyin,
    p(summarize(word.defs), 'result-defs'),
  ]);
  main.addEventListener('click', () => ctx?.navigate(`#word/${encodeURIComponent(word.id)}`));

  return div({ class: 'result' }, [main, knownChip(word)]);
}

/**
 * What to show for a word the app already knows.
 *
 * "Already in your deck" hid a real difference: the HSK curriculum is always in your
 * reviews, while My Words is what you added (§3.3.4). The chip names which.
 *
 * A curriculum word gets its band and a way to pull it forward (§3.4.1) — refusing to
 * "Add" it and offering nothing else reads as the app being broken. A word already being
 * learned shows where it stands instead.
 */
function knownChip(word) {
  if (word.custom) {
    const chip = span({ class: 'chip chip-mine' });
    chip.append(checkStamp(s.inMyWords));
    return chip;
  }

  const band = span({ class: 'chip', text: s.hskBand(word.band) });
  const rec = store.states.get(`${word.id}#REC`);

  // Already in progress: its status is the honest answer, not another action.
  if (rec?.reps > 0) return div({ class: 'result-actions' }, [band]);

  if (isPrioritized(word.id)) {
    return div({ class: 'result-actions' }, [band, span({ class: 'chip chip-next', text: s.queued })]);
  }

  const action = button(s.studyNext, async (event) => {
    await studyNext(word.id);
    event.target.replaceWith(span({ class: 'chip chip-next', text: s.queued }));
  }, { variant: 'btn-quiet btn-small' });

  return div({ class: 'result-actions' }, [band, action]);
}

/** One search result, with an add or study-next action. */
function resultRow(entry) {
  const wordId = `${LANG}:${entry.simp}:${entry.pinyinNum.replace(/\s+/g, '_')}`;
  const known = store.deck.word(wordId);

  const pinyin = span({ class: 'pinyin' });
  pinyin.append(colorPinyin(entry.pinyinNum));

  const action = known
    ? knownChip(known)
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
        // Close the loop: the word is now first in the new-card queue, and My Words
        // proves it. Without this the add looked like it did nothing.
        const done = el('a', { class: 'added-link', href: '#words' });
        done.append(checkStamp(s.addedGoTo));
        event.target.replaceWith(done);
      }, { variant: 'btn-quiet' });

  return div({ class: 'result' }, [
    div({ class: 'result-main' }, [
      span({ class: 'result-hanzi', text: entry.simp }),
      pinyin,
      // Classifier entries are data, not a gloss — the word page renders them properly.
      p(summarize(entry.defs), 'result-defs'),
    ]),
    action,
  ]);
}
