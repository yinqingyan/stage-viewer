// 开发工具：统计模型里网格实际用到的材质（类型、颜色、是否有贴图），判断“原始材质”显示是否有意义
import * as THREE from 'three';
import { FBXLoader } from '../src/vendor/FBXLoader.js';

const buf = await (await fetch(new URLSearchParams(location.search).get('f'))).arrayBuffer();
const root = new FBXLoader().parse(buf, '');
const mats = new Map();
root.traverse(o => {
  if (!o.isMesh) return;
  for (const m of [].concat(o.material)) {
    const e = mats.get(m) || { name: m.name, type: m.type, color: m.color ? '#' + m.color.getHexString() : '-', map: !!m.map, opacity: m.opacity, meshes: 0, sample: o.name };
    e.meshes++;
    mats.set(m, e);
  }
});
window.RESULT = [...mats.values()].sort((a, b) => b.meshes - a.meshes);
