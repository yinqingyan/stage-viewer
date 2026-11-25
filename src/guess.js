// 按名字猜灯具桌椅的用途：设计师常把型号、品牌或俗称写进 3ds Max 的组名（「天排beam」「Sharpy」「频闪」「洗墙」）。
// 先找具体型号（docs/fixtures-reference.json 的 keywords），再找中英文俗称。规则见 docs/灯具资料.md 第 4 节：
// 先频闪、灯条，再光束、染色；英文按整词匹配（PAR 不会误中 parent）；230、380 这类纯数字要同时有「光束」/beam 才算。
import REF from '../docs/fixtures-reference.json';

export const FIXTURES = REF.map((f, i) => ({ ...f, i, role: f.renderType === 'ledBar' ? 'bar' : f.renderType }));

const TERMS = [
  ['strobe', ['strobe', 'atomic', 'jdc', 'color strike', 'blinder', '频闪', '爆闪', '观众灯', '四眼', '二眼', '致盲', '闪']],
  ['bar', ['bar', 'batten', 'pixel bar', 'pxl bar', 'sixbar', 'dotline', 'wall wash', 'wallwash', '灯条', '洗墙', '线条灯', '条灯', '地排', '天排灯', '条']],
  ['beam', ['beam', 'sharpy', 'pointe', 'bsw', 'hybrid', 'followspot', 'follow spot', '光束', '三合一', '四合一', '全能王', '追光', '摇头', '电脑灯', '7r', '2r', '17r']],
  ['wash', ['wash', 'par', 'par64', 'led par', 'profile', 'spot', 'framing', 'fresnel', 'cyc', 'leko', 'ellipsoidal', '染色', '帕灯', '帕', '蜂眼', '蜂巢', '切割', '图案', '成像', '面光', '柔光', '聚光']],
  ['chair', ['chair', 'seat', '椅']],
  ['stool', ['stool', '凳']],
  ['table', ['table', 'desk', '桌']],
];
const BEAM_NUMBERS = ['230', '280', '295', '380', '470'];

const norm = s => String(s).toLowerCase().replace(/[_\-]+/g, ' ');
// 英文、数字按整词（前后不是字母数字）；中文直接包含
function has(text, word) {
  if (/[\u4e00-\u9fff]/.test(word)) return text.includes(word);
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ _-]?');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text);
}

// 型号关键词：去掉只是品牌名的（Robe、GLP…）、纯数字、和俗称重复的通用词（PAR、beam、LED…，只能说明类型，不能定型号），
// 长的先匹配（X4 Bar 先于 X4）
const GENERIC = new Set(['par', 'led par', 'beam', 'wash', 'bar', 'strobe', 'spot', 'profile', 'framing', 'batten', 'blinder', 'hybrid', 'bsw', 'led', 'laser', 'moving head', 'zoom', 'pixel', 'pixel bar', 'wall wash', 'followspot', 'ellipsoidal', 'leko', 'fresnel', 'cyc', 'ip65', 'outdoor']);
const MODEL_WORDS = FIXTURES.flatMap(f => f.keywords
  .filter(k => k.toLowerCase() !== f.brand.toLowerCase() && !/^\d+$/.test(k) && k.length >= 3 && !GENERIC.has(norm(k)) && !/[\u4e00-\u9fff]/.test(k))
  .map(k => ({ k: norm(k), f })))
  .sort((a, b) => b.k.length - a.k.length);

// texts：按可信程度排好的名字（型号名、组名…）。返回 { role, fixture, word } 或 null
export function guess(texts) {
  for (const raw of texts) {
    const t = norm(raw);
    const m = MODEL_WORDS.find(({ k }) => has(t, k));
    if (m) return { role: m.f.role, fixture: m.f.i, word: raw.match(new RegExp(m.k.replace(/ /g, '.?'), 'i'))?.[0] || m.k };
    for (const [role, words] of TERMS) {
      const w = words.find(w => has(t, w));
      if (w) return { role, fixture: null, word: w };
    }
    const n = BEAM_NUMBERS.find(n => has(t, n));
    if (n && (has(t, 'beam') || t.includes('光束'))) return { role: 'beam', fixture: null, word: n };
  }
  return null;
}

// 选了具体型号：按它的规格给查看器 sizeM（灯口半径或发光面宽高，米）和 angle（光束角）
export function fixtureParams(f) {
  const out = {}, clamp = (v, a, b) => Math.min(Math.max(v, a ?? v), b ?? v);
  const hi = f.beamAngleMax ?? f.beamAngleMin, lo = f.beamAngleMin > 0 ? f.beamAngleMin : hi;  // 有的写 0–3.8°，0 画不出光束
  if (lo != null) out.angle = f.role === 'beam' ? lo : f.role === 'wash' ? clamp(20, lo, hi) : f.role === 'bar' ? clamp(25, lo, hi) : undefined;
  if (out.angle === undefined) delete out.angle;
  if ((f.role === 'beam' || f.role === 'wash') && f.lensDiameterMm) out.sizeM = f.lensDiameterMm / 2000;
  if ((f.role === 'strobe' || f.role === 'bar') && f.emitW_mm && f.emitH_mm) out.sizeM = [f.emitW_mm / 1000, f.emitH_mm / 1000];
  return out;
}
