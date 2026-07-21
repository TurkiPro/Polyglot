/**
 * The deck: pack words plus the user's own, and which cards each word yields.
 *
 * Language-agnostic (§1.6) — this reads the pack's data shape and knows nothing about
 * Chinese. `zh` lives entirely in the pack JSON and in `app/src/zh/`.
 */

/** Card modes, in the order a word introduces them (§5.4). */
export const MODES = Object.freeze(['REC', 'LIS', 'PROD', 'SENT', 'WRITE']);

/** `<wordId>#<MODE>` (§5.4). */
export const cardId = (wordId, mode) => `${wordId}#${mode}`;

/** Split `<wordId>#<MODE>` back apart; `#` cannot occur in a word id. */
export function parseCardId(id) {
  const at = String(id).lastIndexOf('#');
  if (at === -1) return { wordId: String(id), mode: null };
  return { wordId: id.slice(0, at), mode: id.slice(at + 1) };
}

/**
 * The modes a word actually supports.
 *   - no sentences      → no SENT card
 *   - no stroke data    → no WRITE card       (pipeline sets `noWrite`)
 *   - non-primary split → no LIS card (§5.4)  — TTS would speak the primary reading
 */
export function modesForWord(word) {
  return MODES.filter((mode) => {
    if (mode === 'SENT') return (word.sentences?.length ?? 0) > 0;
    if (mode === 'WRITE') return word.noWrite !== true;
    if (mode === 'LIS') return word.splitPrimary !== false;
    return true;
  });
}

/** Every card id a word yields. */
export function cardIdsForWord(word) {
  return modesForWord(word).map((mode) => cardId(word.id, mode));
}

/**
 * A deck is an immutable lookup over pack words merged with the user's custom words.
 * Custom words win on id collision, and tombstoned ones (`deleted`) drop out.
 *
 * @param {{ words: object[], packVersion?: string, schemaVersion?: number, language?: string }} pack
 * @param {object[]} [customWords]
 */
export function createDeck(pack, customWords = []) {
  const byId = new Map();
  for (const word of pack?.words ?? []) byId.set(word.id, word);
  for (const word of customWords) {
    if (word.deleted) byId.delete(word.id);
    else byId.set(word.id, word);
  }

  const words = [...byId.values()];
  return {
    schemaVersion: pack?.schemaVersion,
    language: pack?.language,
    packVersion: pack?.packVersion,
    words,
    /** @returns {object|undefined} */
    word: (wordId) => byId.get(wordId),
    /** The word a card belongs to. */
    wordOfCard: (id) => byId.get(parseCardId(id).wordId),
    has: (wordId) => byId.has(wordId),
    size: words.length,
  };
}

/**
 * Load the pack for a language. Browser-side; tests build decks with `createDeck`
 * directly so the engine stays runnable headless.
 */
export async function loadPack(language, { fetchImpl = fetch, base = '/assets/packs' } = {}) {
  const res = await fetchImpl(`${base}/${language}/deck.${language}.json`);
  if (!res.ok) throw new Error(`deck ${language}: ${res.status} ${res.statusText}`);
  return res.json();
}
