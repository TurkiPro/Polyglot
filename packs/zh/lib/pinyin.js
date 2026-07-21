/**
 * Pipeline-side pinyin. Deliberately a re-export of the client module so the deck is
 * built with exactly the code that later renders it (§7 "mirrored client-side").
 */
export { numToMarks, syllableToMarks, syllableTone } from '../../../app/src/zh/pinyin.js';
