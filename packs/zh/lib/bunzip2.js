/**
 * Pure-JS bzip2 decompressor (build-time only).
 *
 * Why this exists: the Tatoeba exports are `.bz2`, Node's zlib handles gzip/deflate/br
 * but not bzip2, and §4.3 caps the dependency allowlist — so we write the small utility
 * ourselves rather than take a package. Decode-only; nothing here compresses.
 *
 * Implements the format as documented by the reference implementation:
 * `BZh<level>`, then blocks of {symbol map, Huffman groups, MTF+RLE2, inverse BWT, RLE1}.
 */

const BLOCK_MAGIC = 0x314159265359n;
const EOS_MAGIC = 0x177245385090n;
const MAX_CODE_LEN = 23;
const GROUP_SIZE = 50;

/** MSB-first bit reader. */
class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /**
   * @param {number} n 1..32
   * Reads wider than 24 bits in two steps: the accumulator is a 32-bit int, so topping
   * it up 8 bits at a time for n > 24 would shift the high bits off the end.
   */
  read(n) {
    if (n > 24) {
      const hi = this.read(n - 16);
      const lo = this.read(16);
      return (hi * 0x10000 + lo) >>> 0;
    }
    while (this.bitCount < n) {
      if (this.pos >= this.bytes.length) throw new Error('bunzip2: unexpected end of input');
      this.bitBuf = (this.bitBuf << 8) | this.bytes[this.pos++];
      this.bitCount += 8;
    }
    this.bitCount -= n;
    const value = (this.bitBuf >>> this.bitCount) & ((1 << n) - 1);
    this.bitBuf &= (1 << this.bitCount) - 1;
    return value >>> 0;
  }

  readBit() {
    return this.read(1);
  }

  /** Read `n` bits as BigInt, for the 48-bit block magics. */
  readBig(n) {
    let v = 0n;
    let left = n;
    while (left > 0) {
      const take = Math.min(24, left);
      v = (v << BigInt(take)) | BigInt(this.read(take));
      left -= take;
    }
    return v;
  }

  align() {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  atEnd() {
    return this.pos >= this.bytes.length && this.bitCount === 0;
  }
}

/** bzip2 uses a non-reflected CRC-32 (poly 0x04c11db7). */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c;
  }
  return t;
})();

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff];
  }
  return ~crc >>> 0;
}

/** Build the canonical-Huffman decode tables used by the reference decoder. */
function decodeTables(lengths, alphaSize) {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    if (lengths[i] > maxLen) maxLen = lengths[i];
    if (lengths[i] < minLen) minLen = lengths[i];
  }

  const perm = new Int32Array(alphaSize);
  let pp = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let sym = 0; sym < alphaSize; sym++) if (lengths[sym] === len) perm[pp++] = sym;
  }

  const base = new Int32Array(MAX_CODE_LEN + 2);
  const limit = new Int32Array(MAX_CODE_LEN + 2);
  for (let i = 0; i < alphaSize; i++) base[lengths[i] + 1]++;
  for (let i = 1; i < base.length; i++) base[i] += base[i - 1];

  let vec = 0;
  for (let len = minLen; len <= maxLen; len++) {
    vec += base[len + 1] - base[len];
    limit[len] = vec - 1;
    vec <<= 1;
  }
  for (let len = minLen + 1; len <= maxLen; len++) {
    base[len] = ((limit[len - 1] + 1) << 1) - base[len];
  }

  return { limit, base, perm, minLen, maxLen };
}

/** Read the per-block symbol map, Huffman groups and selectors. */
function readBlockHeader(br) {
  const usedGroups = br.read(16);
  const symToByte = [];
  for (let g = 0; g < 16; g++) {
    if (!(usedGroups & (0x8000 >>> g))) continue;
    const bits = br.read(16);
    for (let b = 0; b < 16; b++) if (bits & (0x8000 >>> b)) symToByte.push(g * 16 + b);
  }
  if (symToByte.length === 0) throw new Error('bunzip2: empty symbol map');
  const alphaSize = symToByte.length + 2;

  const nGroups = br.read(3);
  const nSelectors = br.read(15);
  if (nGroups < 2 || nGroups > 6) throw new Error('bunzip2: bad group count');

  // Selectors arrive MTF-encoded as unary indices into the group list.
  const groupMtf = Array.from({ length: nGroups }, (_, i) => i);
  const selectors = new Int32Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (br.readBit()) {
      if (++j >= nGroups) throw new Error('bunzip2: bad selector');
    }
    const [picked] = groupMtf.splice(j, 1);
    groupMtf.unshift(picked);
    selectors[i] = picked;
  }

  // Huffman code lengths, delta-coded per group.
  const tables = [];
  for (let g = 0; g < nGroups; g++) {
    const lengths = new Int32Array(alphaSize);
    let len = br.read(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > 20) throw new Error('bunzip2: bad code length');
        if (!br.readBit()) break;
        len += br.readBit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(decodeTables(lengths, alphaSize));
  }

  return { symToByte, alphaSize, selectors, tables };
}

/**
 * Decode one block's MTF+RLE2 symbol stream into the BWT string.
 * @returns {{ bwt: Uint8Array, counts: Int32Array }}
 */
function readBwtString(br, header, maxLen) {
  const { symToByte, alphaSize, selectors, tables } = header;
  const EOB = alphaSize - 1;
  const bwt = new Uint8Array(maxLen);
  const counts = new Int32Array(256);
  const mtf = symToByte.slice();

  let n = 0;
  let groupIdx = -1;
  let groupLeft = 0;
  let table = null;
  let runLength = 0;
  let runBit = 0;

  const nextSymbol = () => {
    if (groupLeft === 0) {
      groupLeft = GROUP_SIZE;
      table = tables[selectors[++groupIdx]];
    }
    groupLeft--;
    let len = table.minLen;
    let vec = br.read(len);
    while (len <= table.maxLen && vec > table.limit[len]) {
      vec = (vec << 1) | br.readBit();
      len++;
    }
    const idx = vec - table.base[len];
    if (idx < 0 || idx >= alphaSize) throw new Error('bunzip2: bad Huffman symbol');
    return table.perm[idx];
  };

  const flushRun = () => {
    if (runLength === 0) return;
    const byte = mtf[0];
    if (n + runLength > maxLen) throw new Error('bunzip2: block overflow');
    bwt.fill(byte, n, n + runLength);
    counts[byte] += runLength;
    n += runLength;
    runLength = 0;
    runBit = 0;
  };

  for (;;) {
    const sym = nextSymbol();
    if (sym <= 1) {
      // RUNA/RUNB encode a run of the front-of-MTF byte in bijective base 2.
      runLength += (sym + 1) << runBit;
      runBit++;
      continue;
    }
    flushRun();
    if (sym === EOB) break;

    // Any other symbol is an MTF index (shifted by the two run symbols).
    const [byte] = mtf.splice(sym - 1, 1);
    mtf.unshift(byte);
    if (n >= maxLen) throw new Error('bunzip2: block overflow');
    bwt[n++] = byte;
    counts[byte]++;
  }

  return { bwt: bwt.subarray(0, n), counts };
}

/** Invert the Burrows-Wheeler transform, then undo the initial run-length coding. */
function inverseBwtAndRle(bwt, counts, origPtr, out) {
  const n = bwt.length;
  if (origPtr >= n) throw new Error('bunzip2: bad origPtr');

  const cftab = new Int32Array(256);
  let total = 0;
  for (let i = 0; i < 256; i++) {
    cftab[i] = total;
    total += counts[i];
  }

  const tt = new Int32Array(n);
  for (let i = 0; i < n; i++) tt[cftab[bwt[i]]++] = i;

  let p = tt[origPtr];
  let last = -1;
  let runLen = 0;
  for (let i = 0; i < n; i++) {
    const byte = bwt[p];
    p = tt[p];

    if (runLen === 4) {
      // A run of four equal bytes is followed by a count of extra repeats.
      for (let k = 0; k < byte; k++) out.push(last);
      runLen = 0;
      last = -1;
      continue;
    }
    runLen = byte === last ? runLen + 1 : 1;
    last = byte;
    out.push(byte);
  }
}

/** Growable byte sink — avoids reallocating the whole output per block. */
class ByteSink {
  constructor() {
    this.chunks = [];
    this.buf = new Uint8Array(1 << 20);
    this.n = 0;
    this.total = 0;
  }

  push(byte) {
    if (this.n === this.buf.length) {
      this.chunks.push(this.buf);
      this.buf = new Uint8Array(1 << 20);
      this.n = 0;
    }
    this.buf[this.n++] = byte;
    this.total++;
  }

  /** @returns {Uint8Array} */
  concat() {
    const out = new Uint8Array(this.total);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    out.set(this.buf.subarray(0, this.n), at);
    return out;
  }
}

/**
 * Decompress a bzip2 stream. Handles concatenated streams (as pbzip2 emits).
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
export function bunzip2(input) {
  const br = new BitReader(input);
  const out = new ByteSink();

  for (;;) {
    if (br.read(8) !== 0x42 || br.read(8) !== 0x5a || br.read(8) !== 0x68) {
      throw new Error('bunzip2: not a bzip2 stream');
    }
    const level = br.read(8) - 0x30;
    if (level < 1 || level > 9) throw new Error('bunzip2: bad block-size level');
    const maxBlock = level * 100000;

    for (;;) {
      const magic = br.readBig(48);
      if (magic === EOS_MAGIC) {
        br.read(32); // stream CRC — the per-block CRCs already checked the data
        break;
      }
      if (magic !== BLOCK_MAGIC) throw new Error('bunzip2: bad block magic');

      const expectedCrc = br.read(32);
      if (br.readBit()) throw new Error('bunzip2: randomized blocks are not supported');
      const origPtr = br.read(24);

      const header = readBlockHeader(br);
      const { bwt, counts } = readBwtString(br, header, maxBlock);

      const blockStart = out.total;
      inverseBwtAndRle(bwt, counts, origPtr, out);

      // Verify this block against its stored CRC before moving on.
      const block = sliceSink(out, blockStart);
      if (crc32(block) !== expectedCrc) throw new Error('bunzip2: block CRC mismatch');
    }

    br.align();
    if (br.atEnd() || br.pos >= input.length) break;
  }

  return out.concat();
}

/** Read back the bytes a block just appended, for CRC verification. */
function sliceSink(sink, from) {
  const len = sink.total - from;
  const block = new Uint8Array(len);
  let at = 0;
  let seen = 0;
  const parts = [...sink.chunks, sink.buf.subarray(0, sink.n)];
  for (const part of parts) {
    const start = Math.max(0, from - seen);
    if (start < part.length) {
      const piece = part.subarray(start, part.length);
      block.set(piece.subarray(0, len - at), at);
      at += Math.min(piece.length, len - at);
    }
    seen += part.length;
    if (at >= len) break;
  }
  return block;
}

export default bunzip2;
