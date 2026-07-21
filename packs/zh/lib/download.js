/**
 * Source fetching for the deck pipeline.
 *
 * Downloads land in `packs/zh/data/` (gitignored) and are reused on later runs, so a
 * rebuild costs nothing after the first. Deleting the file forces a re-fetch.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { bunzip2 } from './bunzip2.js';

export const DATA_DIR = new URL('../data/', import.meta.url);

/** @returns {Promise<boolean>} */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch `url` into `data/<name>` unless it is already there.
 * @returns {Promise<{ path: URL, bytes: number, cached: boolean }>}
 */
export async function download(url, name, { log = console.log } = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const path = new URL(name, DATA_DIR);

  if (await exists(path)) {
    const { size } = await stat(path);
    log(`  cached  ${name} (${mb(size)})`);
    return { path, bytes: size, cached: true };
  }

  log(`  fetch   ${name} …`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} ${res.statusText} — ${url}`);
  const body = new Uint8Array(await res.arrayBuffer());
  await writeFile(path, body);
  log(`  saved   ${name} (${mb(body.length)})`);
  return { path, bytes: body.length, cached: false };
}

/** Read a downloaded file, transparently decompressing by extension. */
export async function readSource(name) {
  const path = new URL(name, DATA_DIR);
  const raw = new Uint8Array(await readFile(path));
  if (name.endsWith('.bz2')) return bunzip2(raw);
  if (name.endsWith('.gz')) return new Uint8Array(gunzipSync(raw));
  return raw;
}

/** Read a downloaded file and decode it as UTF-8 text. */
export async function readSourceText(name) {
  return new TextDecoder('utf-8').decode(await readSource(name));
}

/**
 * Walk a byte buffer line by line without materializing one giant JS string.
 * The English sentence export is ~180 MB decompressed; decoding it whole is wasteful
 * when we only keep the handful of lines the deck references.
 * @param {Uint8Array} bytes
 * @param {(line: Uint8Array) => void} onLine
 */
export function forEachLine(bytes, onLine) {
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    let end = i;
    if (end > start && bytes[end - 1] === 0x0d) end--;
    if (end > start) onLine(bytes.subarray(start, end));
    start = i + 1;
  }
  if (start < bytes.length) onLine(bytes.subarray(start));
}

/** Parse leading ASCII digits from a line, for id-first TSV formats. */
export function leadingInt(line) {
  let n = 0;
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c < 0x30 || c > 0x39) break;
    n = n * 10 + (c - 0x30);
  }
  return i === 0 ? -1 : n;
}

export const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
