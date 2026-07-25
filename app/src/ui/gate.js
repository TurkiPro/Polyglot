/**
 * The home's 3D gate — a Chinese paifang lit in the app's own vermilion and neon, turning
 * slowly behind the cards and grabbable with the pointer.
 *
 * Dependency-free by necessity (§1.2, §4.3): raw WebGL, a hand-written mesh loader for the
 * baked `gate.mesh` (scripts/gate-mesh.mjs), and a few 4×4 matrices below. No three.js, no
 * model-viewer, no CDN — the CSP's `script-src 'self'` and the allowlist both hold.
 *
 * It is decoration: if WebGL is missing it simply does not appear, and the reduce-effects
 * switch or OS reduced-motion stops the auto-spin (you can still nudge it by hand).
 */
const MESH_URL = '/assets/3d-model/gate.mesh';

/* ── Tiny mat4 (column-major, like WebGL) ───────────────── */
const m4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  },
  multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },
  rotationY(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  },
  rotationX(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  },
  translation(x, y, z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  },
};

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNormal;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(0.5, 0.8, 0.65))), 0.0);
  float rim = pow(1.0 - abs(n.z), 2.0);
  vec3 c = uColor * (0.4 + 0.7 * key) + uColor * rim * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/** Parse the baked mesh: [u32 headerLen][header JSON][Int16 pos][Int8 normal][index buffer]. */
function parseMesh(buffer) {
  const view = new DataView(buffer);
  const headerLen = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen)));
  let offset = 4 + headerLen;

  const positions = new Int16Array(buffer, offset, header.vertexCount * 3);
  offset += positions.byteLength;
  const normals = new Int8Array(buffer, offset, header.vertexCount * 3);
  offset += normals.byteLength;
  // Int8 count is odd-safe; indices must start 2/4-aligned, so copy them out.
  const IndexArray = header.indexBits === 32 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(buffer.slice(offset, offset + header.indexCount * (header.indexBits / 8)));

  return { header, positions, normals, indices };
}

const reduceMotion = () =>
  document.documentElement.dataset.effects === 'off' ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Build the gate behind the home content. Returns `{ destroy }`. Fails silent — a missing
 * context, a fetch error, anything — because it is only decoration.
 */
function createGate() {
  const canvas = document.createElement('canvas');
  canvas.className = 'gate-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return { destroy() {} };

  document.body.append(canvas);

  let raf = 0;
  let disposed = false;
  let yaw = -0.5;
  let pitch = 0.12;
  let spin = reduceMotion() ? 0 : 0.15; // radians/second
  let last = performance.now();

  // ── Orbit by dragging anywhere that is not a control ──────
  let dragging = false;
  let px = 0;
  let py = 0;
  const isControl = (target) => target?.closest?.('button, a, input, textarea, select, [role="button"], .gloss, .slider');

  const onDown = (event) => {
    if (isControl(event.target)) return;
    dragging = true;
    spin = 0; // a hand on it stops the drift
    px = event.clientX;
    py = event.clientY;
  };
  const onMove = (event) => {
    if (!dragging) return;
    yaw += (event.clientX - px) * 0.01;
    pitch = Math.max(-0.9, Math.min(0.9, pitch + (event.clientY - py) * 0.01));
    px = event.clientX;
    py = event.clientY;
  };
  const onUp = () => { dragging = false; };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    uMVP: gl.getUniformLocation(program, 'uMVP'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uColor: gl.getUniformLocation(program, 'uColor'),
  };
  gl.enable(gl.DEPTH_TEST);

  let mesh = null;

  fetch(MESH_URL)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('gate mesh missing'))))
    .then((buffer) => {
      if (disposed) return;
      mesh = parseMesh(buffer);

      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(loc.aPos, 3, gl.SHORT, true, 0, 0);
      gl.enableVertexAttribArray(loc.aPos);

      const normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      gl.vertexAttribPointer(loc.aNormal, 3, gl.BYTE, true, 0, 0);
      gl.enableVertexAttribArray(loc.aNormal);

      const indexBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      mesh.indexType = mesh.header.indexBits === 32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

      last = performance.now();
      raf = requestAnimationFrame(frame);
    })
    .catch(() => {});

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!dragging) yaw += spin * dt;

    resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (mesh) {
      const model = m4.multiply(m4.rotationY(yaw), m4.rotationX(pitch));
      const view = m4.translation(0, -0.05, -3.1);
      const proj = m4.perspective(0.9, canvas.width / canvas.height || 1, 0.1, 20);
      const mvp = m4.multiply(proj, m4.multiply(view, model));
      gl.uniformMatrix4fv(loc.uMVP, false, mvp);
      gl.uniformMatrix4fv(loc.uModel, false, model);

      for (const group of mesh.header.groups) {
        gl.uniform3fv(loc.uColor, group.color);
        gl.drawElements(gl.TRIANGLES, group.count, mesh.indexType, group.start * (mesh.header.indexBits / 8));
      }
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.remove();
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    },
  };
}

// The gate is a single instance owned by the router (main.js): mounted on Home, gone
// elsewhere. Idempotent, so repainting Home never stacks a second canvas.
let instance = null;

export function mountGate() {
  if (!instance) instance = createGate();
}

export function unmountGate() {
  instance?.destroy();
  instance = null;
}
