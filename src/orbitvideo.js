import * as THREE from 'three';

// 环绕视频：从当前视角开始，绕旋转中心转 arc 度、用时 secs 秒，边转边录画布（不带界面），录完下载。
// 录制时临时提高清晰度（长边约 1920 像素），手机竖屏录出来就是竖屏视频。
// 浏览器支持就存 mp4（新版 Chrome、Safari），否则存 webm。
const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function setupOrbitVideo({ renderer, canvas, camera, controls, onStart, onEnd, fileName, flash }) {
  let rec = null;
  const ease = t => 0.5 - Math.cos(Math.PI * t) / 2;  // 缓起缓停

  function start({ arc = 180, secs = 10, dir = 1 }) {
    if (rec) return;
    const type = TYPES.find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!type || !canvas.captureStream) return flash('这个浏览器不能录视频，请用电脑上的 Chrome 或 Edge');
    const pr = renderer.getPixelRatio(), long = Math.max(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(4096, Math.max(1920, long * pr)) / long);
    const offset = camera.position.clone().sub(controls.target);
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 16e6 });
    const chunks = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type }));
      a.download = `${fileName()}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    rec = { t: 0, t0: performance.now(), secs, arc: THREE.MathUtils.degToRad(arc) * dir, offset, target: controls.target.clone(), recorder, pr };
    controls.enabled = false;
    recorder.start();
    onStart?.(secs);
  }

  function stop(save = true) {
    if (!rec) return;
    const r = rec;
    rec = null;
    if (save) r.recorder.stop();
    else { r.recorder.ondataavailable = r.recorder.onstop = null; r.recorder.stop(); }
    renderer.setPixelRatio(r.pr);
    controls.enabled = true;
    onEnd?.(save);
  }

  // 渲染循环里每帧调用；录制中返回 true（这一帧镜头由这里控制）。按真实时间走：电脑慢、帧数少，视频也还是选的时长
  function tick() {
    if (!rec) return false;
    rec.t = Math.min(rec.secs, (performance.now() - rec.t0) / 1000);
    const k = ease(rec.t / rec.secs);
    camera.position.copy(rec.target).add(rec.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rec.arc * k));
    camera.lookAt(rec.target);
    if (rec.t >= rec.secs) setTimeout(() => stop(true), 100);  // 最后一帧录进去再停
    return true;
  }

  return { start, stop, tick, get on() { return !!rec; }, get t() { return rec?.t ?? 0; } };
}
