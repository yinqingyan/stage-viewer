import * as THREE from 'three';

// 家具替身：桌椅凳的几何体被 fbx_strip.py 去掉后只剩节点（位置、朝向），
// 这里按配置 props 里记录的原模型包围盒（节点坐标系，+Z 朝上）画成简单几何体。
//   { match: 节点名正则, parts: 原部件数（同名不同物时区分用）, shape: 'stool'|'chair'|'table', box: [[minX,minY,minZ],[maxX,maxY,maxZ]], seat: 座面离底高度, color: 材质模式下的颜色 }
// 凳子、椅子座面的尺寸落在座位识别范围内，因此可以坐；桌子、椅背标记 noSeat。
// 没有 box（生成器认出的新型号，还不知道原尺寸）时按常见尺寸画，以节点为中心。

const DEFAULT_SIZE = { chair: [0.5, 0.5, 0.9], stool: [0.4, 0.4, 0.45], table: [1.2, 1.2, 0.75] };  // 宽、深、高（米）
function defaultBox(node, shape) {
  const s = node.getWorldScale(new THREE.Vector3()).x;  // 节点坐标 1 单位 = s 米
  const [w, d, h] = DEFAULT_SIZE[shape].map(v => v / s / 2);
  return [[-w, -d, -h], [w, d, h]];
}

const leafCount = o => o.children.length ? o.children.reduce((n, c) => n + leafCount(c), 0) : 1;

function outermost(root, re) {
  const found = [];
  root.traverse(o => {
    if (re.test(o.name) && !found.some(f => isAncestor(f, o))) found.push(o);
  });
  return found;
}
const isAncestor = (a, o) => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };

// 在节点坐标系里放一个 Y 轴向上的几何体：three 的几何体以 Y 为上，原模型以 Z 为上
function place(node, geometry, x, y, z, color) {
  const m = new THREE.Mesh(geometry);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.name = node.name;
  m.userData.prop = true;
  m.userData.propColor = color;
  node.add(m);
  return m;
}

export function buildProps(root, props = []) {
  const made = [], chairs = [], tables = [];
  for (const p of props) {
    const at3 = (node, geo, x, y, z) => place(node, geo, x, y, z, p.color);
    const re = new RegExp(p.match);
    for (const node of outermost(root, re)) {
      if (p.parts && leafCount(node) !== p.parts) continue;
      const [[x0, y0, z0], [x1, y1, z1]] = p.box || defaultBox(node, p.shape);
      const w = x1 - x0, d = y1 - y0, h = z1 - z0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (p.shape === 'stool') {
        made.push(at3(node, new THREE.CylinderGeometry(w / 2, w / 2 * 0.9, h, 24), cx, cy, z0 + h / 2));
      } else if (p.shape === 'table') {
        // 桌布：上小下大的圆台
        const t = at3(node, new THREE.CylinderGeometry(Math.min(w, d) / 2 * 0.92, Math.min(w, d) / 2, h, 32), cx, cy, z0 + h / 2);
        t.userData.noSeat = true;
        made.push(t);
        tables.push(node);
      } else if (p.shape === 'chair') {
        const seat = p.seat ?? h * 0.55;
        made.push(at3(node, new THREE.BoxGeometry(w * 0.9, seat, d * 0.9), cx, cy, z0 + seat / 2));
        chairs.push({ node, w, d, h, seat, cx, cy, z0, color: p.color });
      }
    }
  }
  root.updateMatrixWorld(true);

  // 椅背：放在远离最近那张桌子的一侧（附近没有桌子就不加）
  const at = o => o.getWorldPosition(new THREE.Vector3());
  for (const c of chairs) {
    const pos = at(c.node);
    const table = tables.map(t => [t, at(t).distanceTo(pos)]).sort((a, b) => a[1] - b[1])[0];
    if (!table || table[1] > 3) continue;
    const away = pos.clone().sub(at(table[0])).setY(0).normalize();
    const local = away.transformDirection(c.node.matrixWorld.clone().invert());
    const alongX = Math.abs(local.x) > Math.abs(local.y);
    const s = alongX ? Math.sign(local.x) : Math.sign(local.y);
    const t = Math.min(c.w, c.d) * 0.12, backH = c.h - c.seat;
    const geo = alongX ? new THREE.BoxGeometry(t, backH, c.d * 0.9) : new THREE.BoxGeometry(c.w * 0.9, backH, t);
    const off = (alongX ? c.w : c.d) * 0.45 - t / 2;
    const back = place(c.node, geo, c.cx + (alongX ? s * off : 0), c.cy + (alongX ? 0 : s * off), c.z0 + c.seat + backH / 2, c.color);
    back.userData.noSeat = true;  // 椅背尺寸也像座位，不能坐上去
    made.push(back);
  }
  return made;
}
