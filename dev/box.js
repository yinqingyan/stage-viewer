// 开发工具：每种（带样本几何的）灯具/家具在其组坐标系里的包围盒，以及世界“上”方向在组坐标系里是哪个轴
import * as THREE from 'three';
import { FBXLoader } from '../src/vendor/FBXLoader.js';

const FIX = /^(Group-\d+-\d+-|3d66Group)/;
const buf = await (await fetch(new URLSearchParams(location.search).get('f'))).arrayBuffer();
const root = new FBXLoader().parse(buf, '');
root.updateMatrixWorld(true);
const out = {};
root.traverse(f => {
  if (!FIX.test(f.name) || FIX.test(f.parent?.name || '')) return;
  const meshes = [];
  f.traverse(m => m.isMesh && meshes.push(m));
  if (!meshes.length) return;
  const kind = f.name.replace(/\d+$/, '') + '×' + meshes.length;
  if (out[kind]) return;
  const inv = f.matrixWorld.clone().invert(), b = new THREE.Box3();
  for (const m of meshes) {
    const g = m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld));
    g.computeBoundingBox(); b.union(g.boundingBox);
  }
  const up = new THREE.Vector3(0, 1, 0).transformDirection(inv);
  const r = v => v.toArray().map(x => Math.round(x));
  out[kind] = { sample: f.name, min: r(b.min), max: r(b.max), upInLocal: up.toArray().map(x => +x.toFixed(2)),
                worldScale: +new THREE.Vector3().setFromMatrixScale(f.matrixWorld).x.toFixed(4) };
});
window.RESULT = out;
