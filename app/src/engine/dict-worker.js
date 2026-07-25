/**
 * The dictionary import, off the main thread (audit F3).
 *
 * A module Web Worker: it fetches the pack dictionary, parses it, and posts the entries
 * back in batches. The heavy `res.json()` of ~120k rows — the multi-second freeze at first
 * Browse — happens here, where it cannot touch the UI. The main thread writes each batch to
 * IndexedDB between frames. Same-origin, so CSP `default-src 'self'` already permits it
 * (see DECISIONS, F3) — no CDN, no third-party request (§1.2).
 *
 * Protocol: main posts `{ url }`; the worker replies `{ type: 'batch', rows }` repeatedly,
 * then `{ type: 'done', total }`, or `{ type: 'error', message }`.
 */
import { dictBatches } from './dict-batch.js';

self.onmessage = async (event) => {
  const { url } = event.data ?? {};
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dictionary: ${res.status}`);
    const entries = await res.json();
    for (const rows of dictBatches(entries)) {
      self.postMessage({ type: 'batch', rows });
    }
    self.postMessage({ type: 'done', total: entries.length });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
