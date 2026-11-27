// 界面翻译：代码和页面里照常写中文，英文在 EN 表里查。
// 开启后用 MutationObserver 盯着整页：新出现的文字、title/placeholder/aria-label 都按表换成英文，
// 所以各模块里 innerHTML / textContent 写的中文不用逐个改。查不到的原样保留（漏翻只是显示中文，不会出错）。
// 带数字的句子用 PATTERNS；用「 · 」「、」连起来的分段翻；有空格的按词翻（只换表里有的词）。
// 用户的内容（3ds Max 里的组名、项目名、构件名）放在 translate="no" 的元素里，不翻。

export let lang = 'zh';
const CJK = /[一-鿿]/;

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}

// 中英各写一句，按当前语言取（生成器自己的长句子用这个，比查表直观）
export const L = (zh, en) => lang === 'en' ? en : zh;

export function tr(s) {
  if (lang !== 'en' || !s || !CJK.test(s)) return s;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  return lead + one(s.trim()) + trail;
}

function one(s) {
  if (s in EN) return EN[s];
  for (const [re, f] of PATTERNS) {
    const m = s.match(re);
    if (m) return f(...m.slice(1));
  }
  if (s.includes(' · ')) return s.split(' · ').map(one).join(' · ');
  if (s.includes('、')) return s.split('、').map(one).join(', ');
  if (/\s/.test(s)) return s.split(/(\s+)/).map(w => EN[w] ?? w).join('');
  return s;
}

// ---------- 整页翻译 ----------
const ATTRS = ['title', 'placeholder', 'aria-label'];
const orig = new WeakMap(), done = new WeakMap();  // 文字节点 / 属性的中文原文、上次写进去的译文
const skip = n => (n.nodeType === 1 ? n : n.parentElement)?.closest('[translate=no], script, style');

function fixText(n) {
  if (skip(n)) return;
  if (n.data !== done.get(n)) orig.set(n, n.data);  // 代码改过文字：记新的原文
  const t = tr(orig.get(n));
  done.set(n, t);
  if (n.data !== t) n.data = t;
}
function fixAttrs(el) {
  if (skip(el)) return;
  let o = orig.get(el);
  if (!o) orig.set(el, o = {});
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    if (v !== o['t:' + a]) o[a] = v;
    const t = tr(o[a]);
    o['t:' + a] = t;
    if (v !== t) el.setAttribute(a, t);
  }
}
function walk(root) {
  if (root.nodeType === 3) return fixText(root);
  if (root.nodeType !== 1) return;
  fixAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? fixText(n) : fixAttrs(n);
}

let observer = null;
// 按当前语言刷新整页；第一次调用时开始盯着页面变化（中文时也盯，切回英文才不会漏）
export function translatePage() {
  walk(document.documentElement);
  if (observer) return;
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') fixAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// ---------- 带数字的句子 ----------
const PATTERNS = [
  [/^模型加载失败：(.*)$/, e => `Failed to load the model: ${e}`],
  [/^附近 (\S+) 米内没有座位$/, r => `No seat within ${r} m`],
  [/^同材质的 (\d+) 个构件一起换$/, n => `Changes all ${n} parts with this material`],
  [/^离(屏幕|舞台中心) (\S+) 米$/, (w, d) => `${d} m to the ${w === '屏幕' ? 'screen' : 'stage centre'}`],
  [/^(\d+) 台 (.+)$/, (n, types) => `${n} × ${one(types)}`],
  [/^(\d+) 只 (.+)$/, (n, types) => `${n} × ${one(types)}`],
  [/^点击(平面图|地面或台面)放置「(.*)」$/, (w, what) => `Click the ${w === '平面图' ? 'plan' : 'floor or deck'} to place “${one(what)}”`],
  [/^点击新位置移动 (.*)$/, c => `Click a new spot to move ${c}`],
  [/^点击要拍的位置，(.*) 对准那里$/, c => `Click what to shoot — ${c} will aim there`],
  [/^(.+)（(\S+) (\S+)）$/, (lens, kind, range) => `${lens} (${one(kind)} ${range})`],
];

// ---------- 查看器（生成的网页）----------
const EN = {
  // 页面
  '三维查看': 'Stage Viewer',
  '加载模型…': 'Loading the model…',
  'WASD 飞行 · E/Q 升降 · Shift 加速': 'WASD fly · E/Q up/down · Shift faster',
  'WASD 移动 · 拖动转向 · Shift 加速 · 空格 跳 · C 坐下/站起 · Esc 退出': 'WASD move · drag to turn · Shift run · Space jump · C sit/stand · Esc exit',
  '页面里没有模型数据，请用 build_html.py 生成': 'This page has no model data. Create it with the generator.',
  '点击修改项目名称': 'Click to rename the project',
  '项目名称': 'Project name',
  // 视角、显示
  '正立面': 'Front', '左侧 45°': 'Left 45°', '右侧 45°': 'Right 45°', '平面': 'Plan',
  '人物走动': 'Walk', '导摄模式': 'Director', '显示 ▴': 'View ▴', '显示': 'View',
  '观众视角': 'Seat view', '坐到观众席任一座位，看那里的画面': 'Sit in any audience seat and see the view from there',
  '截图': 'Screenshot', '截图：把当前画面存成图片': 'Screenshot: save the current view as an image', '已保存截图': 'Screenshot saved',
  '最左': 'Far left', '最右': 'Far right', '最后一排': 'Back row', '换座位': 'Pick seat', '拖动转头看': 'Drag to look around',
  '点一个座位，看坐在那里的画面': 'Click a seat to see the view from it', '点观众区的地面，看那里的画面': 'Click the audience floor to see the view from there',
  '这里没有座位，点椅子试试': 'No seat here, try clicking a chair', '没有认出座位，点地面就以坐着的高度看': 'No seats recognised; click the floor to look from seated height',
  '先退出导摄模式': 'Exit director mode first',
  '环绕视频：从当前视角绕一圈录成视频': 'Orbit video: record a turn around from the current view', '环绕视频': 'Orbit video', '从当前视角开始，不带界面': 'Starts from the current view, no interface',
  '时长': 'Length', '方向': 'Direction', '10 秒': '10 s', '20 秒': '20 s', '30 秒': '30 s', '向左转': 'Turn left', '向右转': 'Turn right', '开始录制': 'Record',
  '录制中': 'Recording', '秒': 's', '停止': 'Stop', '视频已保存': 'Video saved', '环绕': 'orbit',
  '这个浏览器不能录视频，请用电脑上的 Chrome 或 Edge': 'This browser cannot record video. Use Chrome or Edge on a computer.',
  '先退出人物走动或观众视角，再录环绕视频': 'Leave walk or seat view first, then record the orbit video',
  '表面': 'Surface', '原样': 'Original', '地毯': 'Carpet', '水泥': 'Concrete', '木地板': 'Wood floor', '地胶': 'Dance floor', '亮面': 'Gloss', '颜色': 'Colour', '自定义颜色': 'Custom colour',
  '保存为新文件': 'Save as new file', '把改过的表面材质存进一个新的 html，发给别人打开也是这个样子': 'Save the changed surfaces into a new html, so others see it this way too',
  '已保存新文件，发给别人打开就是现在的样子': 'Saved. Others will see it exactly like this', '退出': 'Exit',
  '材质': 'Materials', '白模+线': 'Clay + edges', '屏幕内容': 'Screen content', '人物比例': 'Scale figure', '网格': 'Grid',
  '跳': 'Jump', '坐下': 'Sit', '站起': 'Stand',
  // 构件信息
  '未命名构件': 'Unnamed part', '所属组': 'Group', '宽×深×高': 'W × D × H', '点击空白处取消选择': 'Click empty space to deselect',
  // 升降屏、机械
  '升降屏': 'Lifting screens', '离台面': 'Above deck', '降到底': 'Lower', '升到顶': 'Raise',
  '机械': 'Machinery', '全部到起点': 'All to start', '全部到终点': 'All to end', '起点': 'Start', '终点': 'End',
  '升降': 'Lift', '平移': 'Slide', '旋转': 'Rotate', '升': 'up', '降': 'down', '移': 'moves', '转': 'turns',
  // 灯光
  '灯光': 'Lights', '全开': 'All on', '全关': 'All off', '亮度': 'Brightness', '星光': 'Star filter', '光束': 'Beam',
  '光束灯': 'Beam', '染色灯': 'Wash', '频闪': 'Strobe', '灯条': 'LED bar',
  // 音响
  '音响': 'Speakers', '全部显示': 'Show all', '全部隐藏': 'Hide all', '线阵音箱': 'line array', '超低音箱': 'subwoofer',
  // 导摄
  '测距': 'Measure', '清除测距': 'Clear', '全图': 'Fit', '剖切': 'Section', '退出导摄': 'Exit',
  '水平': 'flat', '斜距': 'slant',
  // 机位
  '机位': 'Cameras', '＋ 添加机位': '+ Add camera', '◎ 焦点位': '◎ Focus point', '复制': 'Copy',
  '焦点位': 'Focus point', '全部跟焦': 'all cameras follow', '清除焦点': 'Clear focus',
  '长焦座机': 'Long lens', '座机': 'Studio', '摇臂': 'Jib', '轨道': 'Dolly', '游机': 'Handheld',
  '箱式长焦': 'box lens', '演播室': 'studio', '便携': 'portable', '便携广角': 'portable wide',
  '三脚架': 'Tripod', '机位台': 'Riser', '高机位台': 'High riser', '大摇臂': 'Large jib',
  '大全景': 'Extreme wide', '全景': 'Wide', '中景': 'Medium', '近景': 'Close', '特写': 'Close-up',
  '编号': 'No.', '类型': 'Type', '镜头': 'Lens', '推拉（变焦）': 'Zoom', '摇': 'Pan', '跟焦': 'follow', '俯仰': 'Tilt',
  '高度': 'Height', '高': 'H', '预设…': 'Preset…', '长度': 'Length', '角度': 'Angle', '位置': 'Position',
  '平行舞台': 'Parallel', '垂直': 'Square', '■ 停止': '■ Stop', '▶ 预演': '▶ Preview', '往返': 'Ping-pong',
  '边移边摇': 'Pan while moving', '移动': 'Move', '改朝向': 'Re-aim', '删除': 'Delete', 'Esc 取消': 'Esc to cancel',
  '点击舞台上的位置，所有机位对准那里': 'Click a spot on stage — all cameras aim there',
  '已复制机位。放进配置文件的 "cameras" 后重新生成，别人打开也能看到': 'Cameras copied. Put them under "cameras" in the config and regenerate so others see them too.',
  '复制下面的机位配置': 'Copy the camera config below',
  '复制机位配置，放进配置文件 cameras': 'Copy the camera config (for the "cameras" field)',
  '角度 0°': 'Angle 0°', '角度 90°': 'Angle 90°', '速度': 'Speed', '高度预设': 'Height preset',
  '关：横移，朝向不变；开：边移边摇，一直对准对准点': 'Off: slide, keep the heading. On: pan to stay on the target',
};

// 生成器等模块补充自己的词条
export const addWords = words => Object.assign(EN, words);
