import * as THREE from 'three';

// 表面材质：地毯、水泥、木地板、地胶、亮面，颜色可自选（以深色为主）。
// 纹理用代码现画，不带图片，生成的文件不变大；按世界坐标铺贴（俯视面按 xz、侧面按 xy / zy），
// 不依赖模型的 UV，SketchUp、Rhino 导出的没展 UV 的模型也能用，且纹理大小是真实尺寸（tile：一块纹理多少米）。
export const SURFACES = {
  carpet:   { label: '地毯',   tile: 1,   roughness: 1,    color: '#2a2a2f' },
  concrete: { label: '水泥',   tile: 4,   roughness: 0.9,  color: '#4a4a4f' },
  wood:     { label: '木地板', tile: 2.4, roughness: 0.55, color: '#3b3029' },
  vinyl:    { label: '地胶',   tile: 1.6, roughness: 0.7,  color: '#18181b' },  // 舞台用的哑光地胶，1.6 米一卷，能看到接缝
  gloss:    { label: '亮面',   tile: 4,   roughness: 0.12, color: '#101013' },  // 环氧、亮面地胶
};
export const SWATCHES = ['#0d0d0f', '#1c1c20', '#2e2e33', '#48484e', '#6e6e75'];  // 黑、深灰、灰……

const N = 512;
// 可平铺的值噪声：格子数 cells 必须整除 N，边缘回绕
function noise(cells, rnd) {
  const g = Array.from({ length: cells * cells }, rnd);
  const at = (x, y) => g[((y + cells) % cells) * cells + ((x + cells) % cells)];
  const s = t => t * t * (3 - 2 * t);
  return (px, py) => {
    const fx = px / N * cells, fy = py / N * cells, x = Math.floor(fx), y = Math.floor(fy), u = s(fx - x), v = s(fy - y);
    return (at(x, y) * (1 - u) + at(x + 1, y) * u) * (1 - v) + (at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u) * v;
  };
}
// 固定种子的随机数：每次打开纹理都一样
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

// 灰度纹理（接近白色，和材质颜色相乘）：值 0~1
function paint(type) {
  const rnd = rng(7), img = new Float32Array(N * N);
  const set = f => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) img[y * N + x] = f(x, y); };
  if (type === 'carpet') {
    const n = noise(16, rnd);
    set((x, y) => 0.86 + 0.06 * n(x, y) + 0.08 * rnd());                       // 细密的绒毛
  } else if (type === 'concrete') {
    const a = noise(4, rnd), b = noise(16, rnd), c = noise(64, rnd);
    set((x, y) => {
      const v = 0.8 + 0.1 * a(x, y) + 0.06 * b(x, y) + 0.04 * c(x, y);
      return rnd() < 0.004 ? v * 0.7 : v;                                        // 零星的小气孔
    });
  } else if (type === 'wood') {
    const W = 32, grain = noise(8, rnd), fine = noise(128, rnd);              // 板宽 0.15 米
    const tone = Array.from({ length: N / W }, () => 0.78 + 0.22 * rnd()), cut = tone.map(() => Math.floor(rnd() * N));
    set((x, y) => {
      const i = Math.floor(x / W), yy = (y + cut[i]) % N, seam = x % W === 0 || yy === 0 ? 0.6 : 1;
      return seam * tone[i] * (0.9 + 0.07 * Math.sin((x % W) * 0.9 + grain(x, yy) * 14) + 0.03 * fine(x, yy));
    });
  } else if (type === 'vinyl') {
    const n = noise(8, rnd);
    set((x, y) => (x < 2 ? 0.75 : 0.95 + 0.03 * n(x, y)));                      // 卷材接缝
  } else {
    const n = noise(4, rnd);
    set((x, y) => 0.95 + 0.05 * n(x, y));
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), d = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) d.data.fill(Math.round(Math.min(1, img[i]) * 255), i * 4, i * 4 + 3), d.data[i * 4 + 3] = 255;
  g.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const texCache = new Map(), matCache = new Map();
export function surfaceMaterial(type, color) {
  const key = type + color;
  if (matCache.has(key)) return matCache.get(key);
  const T = SURFACES[type];
  if (!texCache.has(type)) texCache.set(type, paint(type));
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color || T.color), map: texCache.get(type), roughness: T.roughness, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTile = { value: T.tile };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfW;\nvarying vec3 vSurfN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSurfN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfW;\nvarying vec3 vSurfN;\nuniform float uTile;')
      .replace('#include <map_fragment>', `
        vec3 sn = abs(vSurfN);
        vec2 suv = sn.y >= max(sn.x, sn.z) ? vSurfW.xz : (sn.x > sn.z ? vSurfW.zy : vSurfW.xy);
        diffuseColor *= texture2D(map, suv / uTile);`);
  };
  mat.customProgramCacheKey = () => 'surf' + T.tile;
  matCache.set(key, mat);
  return mat;
}
