/**
 * Bake the Chinese-gate OBJ into a compact binary mesh for the home background (build-time).
 *
 *   node scripts/gate-mesh.mjs
 *
 * The raw .obj/.glb/.mtl are 2.6 MB of source and are gitignored; this ships one small
 * committed artifact, `app/assets/3d-model/gate.mesh`, that the dependency-free WebGL
 * renderer (app/src/ui/gate.js) loads at runtime. Positions are quantised to Int16 and
 * normals to Int8; colour is per material group, not per vertex, so there is nothing to
 * store per vertex but geometry.
 *
 *   layout: [uint32 headerLen][header JSON][Int16 positions][Int8 normals][index buffer]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../app/assets/3d-model/', import.meta.url);
const OBJ = new URL('chinese-gate-yu.obj', DIR);
const MTL = new URL('chinese-gate-yu.mtl', DIR);
const OUT = new URL('gate.mesh', DIR);

/** Diffuse colour per material from the .mtl (Kd). */
function readMaterials(text) {
  const colors = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const [tag, ...rest] = line.trim().split(/\s+/);
    if (tag === 'newmtl') current = rest[0];
    else if (tag === 'Kd' && current) colors.set(current, rest.slice(0, 3).map(Number));
  }
  return colors;
}

const materials = readMaterials(readFileSync(MTL, 'utf8'));

// ── Parse the OBJ ──────────────────────────────────────────
const positions = [];
const normals = [];
/** Per material: list of triangle corners as "posIdx/normIdx" (1-based, OBJ style). */
const groups = new Map();
let material = 'default';

for (const line of readFileSync(OBJ, 'utf8').split('\n')) {
  const space = line.indexOf(' ');
  const tag = space === -1 ? line : line.slice(0, space);
  const rest = line.slice(space + 1);
  if (tag === 'v') positions.push(rest.split(/\s+/).map(Number));
  else if (tag === 'vn') normals.push(rest.split(/\s+/).map(Number));
  else if (tag === 'usemtl') material = rest.trim();
  else if (tag === 'f') {
    const corners = rest.trim().split(/\s+/).map((c) => {
      const [p, , n] = c.split('/');
      return `${p}/${n}`;
    });
    if (!groups.has(material)) groups.set(material, []);
    // Fan-triangulate in case any face is not already a triangle.
    for (let i = 1; i < corners.length - 1; i++) {
      groups.get(material).push(corners[0], corners[i], corners[i + 1]);
    }
  }
}

// ── Bounding box → normalise into [-1, 1] centred ──────────
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const p of positions) for (let i = 0; i < 3; i++) {
  min[i] = Math.min(min[i], p[i]);
  max[i] = Math.max(max[i], p[i]);
}
const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
const extent = Math.max(...[0, 1, 2].map((i) => (max[i] - min[i]) / 2)) || 1;

// ── Dedup (position, normal) pairs into one vertex buffer ──
const vertexIndex = new Map(); // "p/n" → index
const outPos = []; // Int16
const outNorm = []; // Int8
const indices = [];
const outGroups = [];

const vertexFor = (key) => {
  let index = vertexIndex.get(key);
  if (index !== undefined) return index;
  const [p, n] = key.split('/').map(Number);
  const pos = positions[p - 1];
  const norm = normals[n - 1] ?? [0, 1, 0];
  for (let i = 0; i < 3; i++) {
    outPos.push(Math.max(-32767, Math.min(32767, Math.round(((pos[i] - center[i]) / extent) * 32767))));
    outNorm.push(Math.max(-127, Math.min(127, Math.round(norm[i] * 127))));
  }
  index = vertexIndex.size;
  vertexIndex.set(key, index);
  return index;
};

for (const [name, corners] of groups) {
  const start = indices.length;
  for (const key of corners) indices.push(vertexFor(key));
  const color = materials.get(name) ?? [0.5, 0.5, 0.5];
  outGroups.push({ material: name, color, start, count: indices.length - start });
}

// ── Serialise ──────────────────────────────────────────────
const vertexCount = vertexIndex.size;
const indexBits = vertexCount > 65535 ? 32 : 16;
const header = {
  vertexCount,
  indexCount: indices.length,
  indexBits,
  center,
  extent,
  groups: outGroups,
};
// Pad the header with spaces (valid JSON whitespace) so the Int16 position block that
// follows starts on a 4-byte boundary — a typed-array view must be aligned to its element.
let headerJson = JSON.stringify(header);
while ((4 + Buffer.byteLength(headerJson, 'utf8')) % 4 !== 0) headerJson += ' ';
const headerBytes = Buffer.from(headerJson, 'utf8');

const posBytes = Buffer.from(Int16Array.from(outPos).buffer);
const normBytes = Buffer.from(Int8Array.from(outNorm).buffer);
const indexBytes = Buffer.from(
  (indexBits === 32 ? Uint32Array : Uint16Array).from(indices).buffer,
);

const head = Buffer.alloc(4);
head.writeUInt32LE(headerBytes.length, 0);
const out = Buffer.concat([head, headerBytes, posBytes, normBytes, indexBytes]);
writeFileSync(OUT, out);

console.log(`gate.mesh — ${vertexCount} verts, ${indices.length / 3} tris, ${outGroups.length} groups, ${(out.length / 1024).toFixed(0)} KB`);
for (const g of outGroups) console.log(`  ${g.material.padEnd(18)} ${g.count / 3} tris`);
