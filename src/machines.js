import * as THREE from 'three';

// 机械：读取模型里的关键帧动画（3ds Max 里给组打的关键帧：第一帧初始位置，最后一帧运动到头），每个会动的部件一个滑块。
// 滑块 0 = 第一帧，1 = 最后一帧，中间按动画本身走，所以先升后开这类多段运动也照原样。
// 按首尾两帧判断类型：转过 5° 以上是旋转；否则竖直位移为主是升降，水平为主是平移（开合屏）。
// 全程位移不到 5 厘米、转动不到 2° 的不算（3ds Max 勾了动画导出时，没动的物体也会带曲线）。
const SPEED = 0.25;  // 按「起点 / 终点」按钮时，每秒走全程的多少
export const KINDS = { lift: '升降', slide: '平移', rotate: '旋转' };

export function setupMachines(root, clips = [], { onSettle } = {}) {
  const mixer = new THREE.AnimationMixer(root), list = [];
  for (const clip of clips) {
    const byNode = new Map();
    for (const t of clip.tracks) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(t.name);
      (byNode.get(nodeName) || byNode.set(nodeName, []).get(nodeName)).push(t);
    }
    for (const [name, tracks] of byNode) {
      const node = THREE.PropertyBinding.findNode(root, name);
      if (!node || !tracks.some(t => t.times.length > 1)) continue;
      const t0 = Math.min(...tracks.map(t => t.times[0])), t1 = Math.max(...tracks.map(t => t.times[t.times.length - 1]));
      const action = mixer.clipAction(new THREE.AnimationClip(name, t1, tracks));
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      list.push({ node, name: node.name || name, action, t0, t1, t: 0, target: 0 });
    }
  }
  const apply = () => { mixer.update(0); root.updateMatrixWorld(true); };
  const setT = (m, t) => { m.t = t; m.action.time = m.t0 + t * (m.t1 - m.t0); };

  // 沿动画取几个点，看它动了多少；首尾两帧定类型和读数
  const N = 12, samples = list.map(() => []);
  for (let i = 0; i <= N; i++) {
    list.forEach(m => setT(m, i / N));
    apply();
    list.forEach((m, j) => samples[j].push({ p: m.node.getWorldPosition(new THREE.Vector3()), q: m.node.getWorldQuaternion(new THREE.Quaternion()) }));
  }
  const moving = [];
  list.forEach((m, j) => {
    const s = samples[j], a = s[0], b = s[N];
    const far = Math.max(...s.map(x => x.p.distanceTo(a.p))), turn = Math.max(...s.map(x => THREE.MathUtils.radToDeg(x.q.angleTo(a.q))));
    if (far < 0.05 && turn < 2) { m.action.stop(); return; }
    const d = b.p.clone().sub(a.p), flat = Math.hypot(d.x, d.z);
    m.kind = turn >= 5 ? 'rotate' : Math.abs(d.y) >= flat ? 'lift' : 'slide';
    m.detail = m.kind === 'rotate' ? `转 ${Math.round(THREE.MathUtils.radToDeg(a.q.angleTo(b.q)))}°`
      : m.kind === 'lift' ? `${d.y >= 0 ? '升' : '降'} ${Math.abs(d.y).toFixed(1)} m` : `移 ${flat.toFixed(1)} m`;
    moving.push(m);
  });
  moving.forEach(m => setT(m, 0));
  apply();

  let settled = true;
  return {
    list: moving,
    // 直接拖到某个位置（滑块）
    set(m, t) { setT(m, t); m.target = t; apply(); },
    // 慢慢走到某个位置（按钮）；全部停下时回调一次，用来重算光束、反射
    go(m, t) { m.target = t; settled = false; },
    update(dt) {
      let busy = false;
      for (const m of moving) {
        if (m.t === m.target) continue;
        const d = m.target - m.t, step = SPEED * dt;
        setT(m, Math.abs(d) <= step ? m.target : m.t + Math.sign(d) * step);
        m.onMove?.(m.t);
        busy = true;
      }
      if (busy) apply();
      else if (!settled) { settled = true; onSettle?.(); }
    },
  };
}
