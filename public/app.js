'use strict';

/* ============================================================
 * 棉鞋编织花样设计器
 * 网格填色（Excel 风格）+ 对称绘制 + 单元重复 + 本机作品保存
 * ============================================================ */

const PRESET_COLORS = [
  { name: '白',   hex: '#ffffff' },
  { name: '米白', hex: '#f3ece1' },
  { name: '浅灰', hex: '#d7dbe0' },
  { name: '中灰', hex: '#9aa3ae' },
  { name: '深灰', hex: '#6b7280' },
  { name: '黑',   hex: '#1f2328' },
  { name: '银灰', hex: '#eef1f5' },
  { name: '大红', hex: '#c62828' },
  { name: '枣红', hex: '#8e1c1c' },
  { name: '玫红', hex: '#e0527c' },
  { name: '桃粉', hex: '#f4c2cd' },
  { name: '浅粉', hex: '#f8dde4' },
  { name: '橘红', hex: '#e8622a' },
  { name: '橘黄', hex: '#f08a24' },
  { name: '姜黄', hex: '#e8a020' },
  { name: '明黄', hex: '#f4d13d' },
  { name: '鹅黄', hex: '#f8e79a' },
  { name: '草绿', hex: '#7cb342' },
  { name: '豆绿', hex: '#a5c96a' },
  { name: '墨绿', hex: '#2f6b45' },
  { name: '深绿', hex: '#1d4a2e' },
  { name: '薄荷', hex: '#9fd8c8' },
  { name: '天蓝', hex: '#5cb3e0' },
  { name: '湖蓝', hex: '#2f9bb5' },
  { name: '宝蓝', hex: '#2b5fa8' },
  { name: '藏青', hex: '#26355e' },
  { name: '灰蓝', hex: '#8fa3b8' },
  { name: '浅紫', hex: '#c3aede' },
  { name: '藕荷', hex: '#d8c2e0' },
  { name: '紫红', hex: '#7b3f9d' },
  { name: '驼色', hex: '#c8a06a' },
  { name: '卡其', hex: '#d9c7a3' },
  { name: '浅棕', hex: '#b38963' },
  { name: '咖啡', hex: '#5a4032' },
  { name: '深棕', hex: '#3e2b21' },
  { name: '砖红', hex: '#a04a3c' },
];

const MIN_ZOOM = 1;
const MAX_ZOOM = 46;
const HISTORY_LIMIT = 80;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 200;
const HEADER_W = 36;
const HEADER_H = 20;
const LS_KEY = 'mianxie.design.autosave.v2';
const LS_RECENT = 'mianxie.recent.colors.v2';
const LS_PREFS = 'mianxie.prefs.v1';
const LS_CLIP = 'mianxie.clipboard.v1';
const LS_LAST = 'mianxie.lastdraft.v1';
const FILE_TAG = 'mianxie-pattern';
const FILE_VERSION = 2;
const MAX_ANNOTATIONS = 30;
const MAX_ANNOTATION_TEXT = 200;
const EXPORT_WATERMARK = '蓝陌家手工坊';
const ANNOTATION_STYLE_CALLOUT = 'callout';
const ANNOTATION_STYLE_POSTER = 'poster';
const ANNOTATION_STYLE_TEXTBOX = 'textbox';
const ANNOTATION_STYLE_VERSION = 2;
const ANNOTATION_FONT_FAMILY = '"Segoe UI", "PingFang SC", system-ui, sans-serif';
const FIXED_ANNOTATION_FONT_SIZES = Object.freeze({
  screen: Object.freeze({
    [ANNOTATION_STYLE_CALLOUT]: 12,
    [ANNOTATION_STYLE_POSTER]: 13,
  }),
  export: Object.freeze({
    [ANNOTATION_STYLE_CALLOUT]: 15,
    [ANNOTATION_STYLE_POSTER]: 16,
  }),
});

/* ---------------- 状态 ---------------- */
const S = {
  cols: DEFAULT_COLS,
  rows: DEFAULT_ROWS,
  cells: new Uint8Array(DEFAULT_COLS * DEFAULT_ROWS),
  palette: [null],
  names: ['空'],
  current: 1,
  tool: 'select',
  selection: null,
  clipboard: null,
  rectFill: false,
  mirrorX: false,
  mirrorY: false,
  center: false,
  repeat: false,
  repeatW: 20,
  repeatH: 20,
  gridOverFill: false,
  darkBorder: false,
  zoom: 10,
  panX: 0,
  panY: 0,
  hover: null,
  designId: null,
  designName: '未命名花样',
  annotations: [],
  annotationStyle: ANNOTATION_STYLE_TEXTBOX,
  dirty: false,
};

for (const p of PRESET_COLORS) {
  S.palette.push(p.hex);
  S.names.push(p.name);
}

let recentColors = [];
let previewShape = null;
let strokeBefore = null;
let selectDrag = null;
let spaceDown = false;
let pinchState = null;
const pointers = new Map();
const undoStack = [];
const redoStack = [];

/* ---------------- 工具函数 ---------------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 注释文字使用固定像素字号；画板缩放只改变锚点位置，不改变文字大小。
function fixedAnnotationFontSize(note, surface = 'screen') {
  if (note && note.style === ANNOTATION_STYLE_TEXTBOX) {
    return clamp(parseInt(note.fontSize, 10) || 18, 10, 48);
  }
  const sizes = surface === 'export'
    ? FIXED_ANNOTATION_FONT_SIZES.export
    : FIXED_ANNOTATION_FONT_SIZES.screen;
  return note && note.style === ANNOTATION_STYLE_POSTER
    ? sizes[ANNOTATION_STYLE_POSTER]
    : sizes[ANNOTATION_STYLE_CALLOUT];
}

function normalizeAnnotations(list, cols = S.cols, rows = S.rows) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const c = clamp(parseInt(item.c, 10), 0, Math.max(0, cols - 1));
    const r = clamp(parseInt(item.r, 10), 0, Math.max(0, rows - 1));
    const text = String(item.text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_ANNOTATION_TEXT);
    const style = [ANNOTATION_STYLE_POSTER, ANNOTATION_STYLE_TEXTBOX].includes(item.style)
      ? item.style
      : ANNOTATION_STYLE_CALLOUT;
    const orientation = item.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const fontSize = clamp(parseInt(item.fontSize, 10) || 18, 10, 48);
    const fontColor = /^#[0-9a-fA-F]{6}$/.test(String(item.fontColor || ''))
      ? String(item.fontColor).toLowerCase()
      : '#6d2545';
    const rawOpacity = parseInt(item.backgroundOpacity, 10);
    const backgroundOpacity = Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0, 100) : 95;
    const showBorder = item.showBorder !== false;
    const rawX = Number(item.x);
    const rawY = Number(item.y);
    const x = Number.isFinite(rawX) ? clamp(rawX, -0.2, 1.2) : (c + 0.5) / cols;
    const y = Number.isFinite(rawY) ? clamp(rawY, -0.2, 1.2) : (r + 0.5) / rows;
    if (!Number.isFinite(c) || !Number.isFinite(r) || !text) continue;
    const key = style === ANNOTATION_STYLE_TEXTBOX
      ? `textbox:${x.toFixed(3)}:${y.toFixed(3)}`
      : `${r}:${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ c, r, text, style, orientation, fontSize, fontColor, backgroundOpacity, showBorder, x, y });
  }
  return out
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .slice(0, MAX_ANNOTATIONS);
}

function cloneAnnotations(list = S.annotations) {
  return normalizeAnnotations(list, S.cols, S.rows);
}

function annotationsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].c !== b[i].c ||
      a[i].r !== b[i].r ||
      a[i].text !== b[i].text ||
      a[i].style !== b[i].style ||
      a[i].orientation !== b[i].orientation ||
      a[i].fontSize !== b[i].fontSize ||
      a[i].fontColor !== b[i].fontColor ||
      a[i].backgroundOpacity !== b[i].backgroundOpacity ||
      a[i].showBorder !== b[i].showBorder ||
      a[i].x !== b[i].x ||
      a[i].y !== b[i].y
    ) return false;
  }
  return true;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function u8ToBase64(u8) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- 画布 ---------------- */
const canvas = $('board');
const ctx = canvas.getContext('2d');
let dpr = 1;
let viewW = 800;
let viewH = 600;
let renderQueued = false;
let viewTouched = false; // 用户是否手动缩放过（没有的话，窗口变化时自动重新适应）

function resizeCanvas() {
  const wrap = $('canvasWrap');
  const rect = wrap.getBoundingClientRect();
  viewW = Math.max(240, Math.floor(rect.width));
  viewH = Math.max(200, Math.floor(rect.height));
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  if (!viewTouched) fitToWindow();
  else clampPan();
  requestRender();
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function gridW() { return viewW - HEADER_W; }
function gridH() { return viewH - HEADER_H; }
function offsetX() { return HEADER_W + S.panX; }
function offsetY() { return HEADER_H + S.panY; }

function clampPan() {
  const gw = gridW();
  const gh = gridH();
  const pw = S.cols * S.zoom;
  const ph = S.rows * S.zoom;
  S.panX = clamp(S.panX, Math.min(60 - pw, gw - 60), Math.max(gw - 60, 60 - pw));
  S.panY = clamp(S.panY, Math.min(60 - ph, gh - 60), Math.max(gh - 60, 60 - ph));
}

function screenToCellF(sx, sy) {
  return { c: (sx - offsetX()) / S.zoom, r: (sy - offsetY()) / S.zoom };
}

function screenToCell(sx, sy) {
  const f = screenToCellF(sx, sy);
  const c = Math.floor(f.c);
  const r = Math.floor(f.r);
  if (c < 0 || r < 0 || c >= S.cols || r >= S.rows) return null;
  return { c, r };
}

function zoomAt(sx, sy, newZoom) {
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(z - S.zoom) < 0.001) return;
  viewTouched = true;
  const before = screenToCellF(sx, sy);
  S.zoom = z;
  S.panX = sx - HEADER_W - before.c * z;
  S.panY = sy - HEADER_H - before.r * z;
  clampPan();
  updateZoomLabel();
  requestRender();
}

function updateZoomLabel() {
  const z = S.zoom < 10 ? S.zoom.toFixed(1) : String(Math.round(S.zoom));
  const txt = z + ' px/格';
  const a = $('zoomLabel');
  const b = $('zoomLabelMobile');
  if (a) a.textContent = txt;
  if (b) b.textContent = txt;
}

function fitToWindow() {
  viewTouched = false;
  const gw = gridW() - 24;
  const gh = gridH() - 24;
  const z = clamp(Math.floor(Math.min(gw / S.cols, gh / S.rows)), MIN_ZOOM, MAX_ZOOM);
  S.zoom = Math.max(MIN_ZOOM, z);
  S.panX = (gridW() - S.cols * S.zoom) / 2;
  S.panY = (gridH() - S.rows * S.zoom) / 2;
  clampPan();
  updateZoomLabel();
  requestRender();
}

/* ---------------- 渲染 ---------------- */
/* 屏幕坐标 <-> 格子坐标（模块级，渲染和静态层缓存共用） */
function X(c) { return Math.round(offsetX() + c * S.zoom); }
function Y(r) { return Math.round(offsetY() + r * S.zoom); }

function visibleRange() {
  const cs = S.zoom;
  return {
    c0: clamp(Math.floor((HEADER_W - offsetX()) / cs), 0, S.cols - 1),
    c1: clamp(Math.ceil((viewW - offsetX()) / cs), 0, S.cols - 1),
    r0: clamp(Math.floor((HEADER_H - offsetY()) / cs), 0, S.rows - 1),
    r1: clamp(Math.ceil((viewH - offsetY()) / cs), 0, S.rows - 1),
  };
}

/* 已填色的格子：同一行相邻同色合并成一条，减少绘制次数 */
function drawCells(g, vr) {
  for (let r = vr.r0; r <= vr.r1; r++) {
    const base = r * S.cols;
    let c = vr.c0;
    while (c <= vr.c1) {
      const v = S.cells[base + c];
      if (!v) { c++; continue; }
      let e = c;
      while (e + 1 <= vr.c1 && S.cells[base + e + 1] === v) e++;
      g.fillStyle = S.palette[v] || '#000000';
      const x0 = X(c);
      g.fillRect(x0, Y(r), X(e + 1) - x0, Y(r + 1) - Y(r));
      c = e + 1;
    }
  }
}

/* 网格线：普通 / 每 5 格 / 每 10 格 */
function drawGridLines(g, vr, dark) {
  const useDark = dark === undefined ? S.darkBorder : dark;
  const linePass = (step, skipEvery, color) => {
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = vr.c0; c <= vr.c1 + 1; c++) {
      if (c % step !== 0) continue;
      if (skipEvery && c % skipEvery === 0) continue;
      const x = X(c) + 0.5;
      g.moveTo(x, Y(vr.r0));
      g.lineTo(x, Y(vr.r1 + 1));
    }
    for (let r = vr.r0; r <= vr.r1 + 1; r++) {
      if (r % step !== 0) continue;
      if (skipEvery && r % skipEvery === 0) continue;
      const y = Y(r) + 0.5;
      g.moveTo(X(vr.c0), y);
      g.lineTo(X(vr.c1 + 1), y);
    }
    g.stroke();
  };

  if (S.zoom >= 5) linePass(1, 0, useDark ? '#8b97a8' : '#e3e8f0');
  linePass(5, 10, useDark ? '#5d6a7c' : '#cbd4e1');
  linePass(10, 0, useDark ? '#2f3947' : '#a6b3c6');
}

function overlapArea(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

function chooseCalloutRect(ax, ay, w, h, bounds, occupied, gap) {
  const candidates = [
    { x: ax + gap, y: ay - h / 2 },
    { x: ax - gap - w, y: ay - h / 2 },
    { x: ax - w / 2, y: ay - gap - h },
    { x: ax - w / 2, y: ay + gap },
  ];
  let best = null;
  candidates.forEach((candidate, index) => {
    const rawPenalty =
      Math.max(0, bounds.minX - candidate.x) +
      Math.max(0, bounds.minY - candidate.y) +
      Math.max(0, candidate.x + w - bounds.maxX) +
      Math.max(0, candidate.y + h - bounds.maxY);
    const rect = {
      x: clamp(candidate.x, bounds.minX, Math.max(bounds.minX, bounds.maxX - w)),
      y: clamp(candidate.y, bounds.minY, Math.max(bounds.minY, bounds.maxY - h)),
      w,
      h,
    };
    const overlap = occupied.reduce((sum, other) => sum + overlapArea(rect, other), 0);
    const score = overlap * 10 + rawPenalty * 20 + index;
    if (!best || score < best.score) best = { rect, score };
  });
  occupied.push(best.rect);
  return best.rect;
}

function drawAnnotationCallout(g, ax, ay, text, opts) {
  const fontSize = opts.fontSize;
  const lineHeight = opts.lineHeight;
  const padding = opts.padding;
  const boxWidth = opts.boxWidth;
  g.save();
  g.font = `${fontSize}px ${ANNOTATION_FONT_FAMILY}`;
  const lines = wrapCanvasText(g, text, boxWidth - padding * 2);
  const boxHeight = padding * 2 + lines.length * lineHeight;
  const rect = chooseCalloutRect(ax, ay, boxWidth, boxHeight, opts.bounds, opts.occupied, opts.gap);

  const startX = clamp(ax, rect.x, rect.x + rect.w);
  const startY = clamp(ay, rect.y, rect.y + rect.h);
  const angle = Math.atan2(ay - startY, ax - startX);
  const arrowLength = opts.arrowLength;
  g.strokeStyle = '#a14d6d';
  g.fillStyle = '#a14d6d';
  g.lineWidth = opts.lineWidth;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(startX, startY);
  g.lineTo(ax, ay);
  g.stroke();
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(
    ax - arrowLength * Math.cos(angle - Math.PI / 6),
    ay - arrowLength * Math.sin(angle - Math.PI / 6),
  );
  g.lineTo(
    ax - arrowLength * Math.cos(angle + Math.PI / 6),
    ay - arrowLength * Math.sin(angle + Math.PI / 6),
  );
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(ax, ay, opts.anchorRadius, 0, Math.PI * 2);
  g.fill();

  if (typeof g.roundRect === 'function') {
    g.beginPath();
    g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
  } else {
    const r = 8;
    g.beginPath();
    g.moveTo(rect.x + r, rect.y);
    g.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r);
    g.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r);
    g.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r);
    g.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r);
    g.closePath();
  }
  g.shadowColor = 'rgba(40, 28, 35, .18)';
  g.shadowBlur = opts.shadowBlur;
  g.shadowOffsetY = opts.shadowBlur / 4;
  g.fillStyle = 'rgba(255, 250, 232, .97)';
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = '#a14d6d';
  g.lineWidth = opts.boxLineWidth;
  g.stroke();

  g.fillStyle = '#35252d';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  let y = rect.y + padding;
  for (const line of lines) {
    g.fillText(line, rect.x + padding, y);
    y += lineHeight;
  }
  g.restore();
}

function drawPosterAnnotation(g, ax, ay, text, opts) {
  g.save();
  g.font = `bold ${opts.fontSize}px ${ANNOTATION_FONT_FAMILY}`;
  const lines = wrapCanvasText(g, text, opts.maxTextWidth);
  const widths = lines.map((line) => g.measureText(line).width);
  const labelWidth = Math.max(72, ...widths);
  const labelHeight = Math.max(opts.lineHeight, lines.length * opts.lineHeight);
  const rect = chooseCalloutRect(ax, ay, labelWidth, labelHeight, opts.bounds, opts.occupied, opts.gap);
  const startX = clamp(ax, rect.x, rect.x + rect.w);
  const startY = clamp(ay, rect.y, rect.y + rect.h);

  g.strokeStyle = 'rgba(123, 41, 77, .58)';
  g.lineWidth = opts.lineWidth;
  g.setLineDash([3, 4]);
  g.beginPath();
  g.moveTo(startX, startY);
  g.lineTo(ax, ay);
  g.stroke();
  g.setLineDash([]);

  g.beginPath();
  g.arc(ax, ay, opts.anchorRadius + 1.6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255, 255, 255, .9)';
  g.fill();
  g.beginPath();
  g.arc(ax, ay, opts.anchorRadius, 0, Math.PI * 2);
  g.fillStyle = '#7b294d';
  g.fill();

  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  let y = rect.y;
  for (const line of lines) {
    g.strokeStyle = 'rgba(255, 255, 255, .96)';
    g.lineWidth = opts.haloWidth;
    g.strokeText(line, rect.x, y);
    g.fillStyle = '#6d2545';
    g.fillText(line, rect.x, y);
    y += opts.lineHeight;
  }
  g.fillStyle = '#a14d6d';
  g.fillRect(rect.x, y + 2, Math.min(34, labelWidth), 2);
  g.restore();
}

function textBoxGeometry(g, text, note, fontSize, padding, maxTextWidth) {
  g.font = `${fontSize}px ${ANNOTATION_FONT_FAMILY}`;
  const vertical = note.orientation === 'vertical';
  const lines = vertical
    ? String(text).replace(/\r\n/g, '\n').split('\n').flatMap((paragraph) =>
        paragraph ? Array.from(paragraph) : ['']
      )
    : wrapCanvasText(g, text, maxTextWidth);
  const contentWidth = Math.max(48, ...lines.map((line) => g.measureText(line).width));
  const lineHeight = Math.round(fontSize * 1.4);
  const localW = contentWidth + padding * 2;
  const localH = Math.max(lineHeight, lines.length * lineHeight) + padding * 2;
  return {
    lines,
    lineHeight,
    localW,
    localH,
    boxW: localW,
    boxH: localH,
  };
}

function drawTextBoxAnnotation(g, ax, ay, text, note, opts) {
  const fontSize = opts.fontSize;
  const padding = opts.padding;
  g.save();
  const geometry = textBoxGeometry(g, text, note, fontSize, padding, opts.maxTextWidth);
  const { lines, lineHeight, localW, localH, boxW, boxH } = geometry;
  const centerX = Number.isFinite(opts.centerX) ? opts.centerX : ax;
  const centerY = Number.isFinite(opts.centerY) ? opts.centerY : ay;
  const rect = {
    x: clamp(centerX - boxW / 2, opts.bounds.minX, Math.max(opts.bounds.minX, opts.bounds.maxX - boxW)),
    y: clamp(centerY - boxH / 2, opts.bounds.minY, Math.max(opts.bounds.minY, opts.bounds.maxY - boxH)),
    w: boxW,
    h: boxH,
  };
  const fontColor = note.fontColor || '#6d2545';

  g.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  const left = -localW / 2;
  const top = -localH / 2;
  if (typeof g.roundRect === 'function') {
    g.beginPath();
    g.roundRect(left, top, localW, localH, 5);
  } else {
    g.beginPath();
    g.rect(left, top, localW, localH);
  }
  const backgroundAlpha = clamp(note.backgroundOpacity, 0, 100) / 100;
  if (backgroundAlpha > 0) {
    g.shadowColor = 'rgba(40, 28, 35, .18)';
    g.shadowBlur = opts.shadowBlur;
    g.shadowOffsetY = opts.shadowBlur / 4;
    g.fillStyle = `rgba(255, 252, 245, ${backgroundAlpha})`;
    g.fill();
    g.shadowColor = 'transparent';
  }
  if (note.showBorder !== false) {
    g.strokeStyle = hexToRgba(fontColor, 0.78);
    g.lineWidth = opts.boxLineWidth;
    g.stroke();
  }

  g.fillStyle = fontColor;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  let y = top + padding;
  for (const line of lines) {
    g.fillText(line, left + padding, y);
    y += lineHeight;
  }
  g.restore();
}

function screenAnnotationBoxWidth() {
  return clamp((viewW - HEADER_W) * 0.32, 150, 220);
}

function textBoxScreenRect(note) {
  ctx.save();
  const fontSize = fixedAnnotationFontSize(note, 'screen');
  const padding = 7;
  const geometry = textBoxGeometry(ctx, note.text, note, fontSize, padding, screenAnnotationBoxWidth() - 20);
  ctx.restore();
  const centerX = offsetX() + note.x * S.cols * S.zoom;
  const centerY = offsetY() + note.y * S.rows * S.zoom;
  return {
    x: clamp(centerX - geometry.boxW / 2, 4, Math.max(4, viewW - 4 - geometry.boxW)),
    y: clamp(centerY - geometry.boxH / 2, 4, Math.max(4, viewH - 4 - geometry.boxH)),
    w: geometry.boxW,
    h: geometry.boxH,
  };
}

function textBoxAtPoint(x, y) {
  for (let i = S.annotations.length - 1; i >= 0; i--) {
    const note = S.annotations[i];
    if (note.style !== ANNOTATION_STYLE_TEXTBOX) continue;
    const rect = textBoxScreenRect(note);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return note;
  }
  return null;
}

function drawScreenAnnotationCallouts() {
  if (!S.annotations.length) return;
  const bounds = {
    minX: HEADER_W + 4,
    minY: HEADER_H + 4,
    maxX: viewW - 4,
    maxY: viewH - 4,
  };
  const freeBounds = {
    minX: 4,
    minY: 4,
    maxX: viewW - 4,
    maxY: viewH - 4,
  };
  const gridWidth = S.cols * S.zoom;
  const gridHeight = S.rows * S.zoom;
  const occupied = [];
  const boxWidth = screenAnnotationBoxWidth();
  S.annotations.forEach((note) => {
    const ax = (X(note.c) + X(note.c + 1)) / 2;
    const ay = (Y(note.r) + Y(note.r + 1)) / 2;
    if (ax < HEADER_W - 4 || ax > viewW + 4 || ay < HEADER_H - 4 || ay > viewH + 4) return;
    const fontSize = fixedAnnotationFontSize(note, 'screen');
    if (note.style === ANNOTATION_STYLE_POSTER) {
      drawPosterAnnotation(ctx, ax, ay, note.text, {
        fontSize,
        lineHeight: 18,
        maxTextWidth: boxWidth - 8,
        bounds,
        occupied,
        gap: 22,
        anchorRadius: 2.6,
        lineWidth: 1.5,
        haloWidth: 4,
      });
      return;
    }
    if (note.style === ANNOTATION_STYLE_TEXTBOX) {
      drawTextBoxAnnotation(ctx, ax, ay, note.text, note, {
        fontSize,
        maxTextWidth: boxWidth - 20,
        padding: 7,
        bounds: freeBounds,
        centerX: offsetX() + note.x * gridWidth,
        centerY: offsetY() + note.y * gridHeight,
        boxLineWidth: 1.3,
        shadowBlur: 7,
      });
      return;
    }
    drawAnnotationCallout(ctx, ax, ay, note.text, {
      fontSize,
      lineHeight: 16,
      padding: 7,
      boxWidth,
      bounds,
      occupied,
      gap: 24,
      arrowLength: 9,
      anchorRadius: 2.8,
      lineWidth: 1.6,
      boxLineWidth: 1.4,
      shadowBlur: 8,
    });
  });
}

/** 把格子坐标的多边形画成屏幕路径 */
function drawPolyPath(g, pts, close) {
  for (let i = 0; i < pts.length; i++) {
    const x = offsetX() + pts[i][0] * S.zoom;
    const y = offsetY() + pts[i][1] * S.zoom;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  if (close) g.closePath();
}

/* 静态层缓存：白底 + 空白格底色 + 网格线（缩放/平移/尺寸变化时才重画） */
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');
let bgKey = '';

function ensureBackground() {
  const key = [viewW, viewH, dpr, S.zoom, S.panX, S.panY, S.cols, S.rows, S.gridOverFill, S.darkBorder].join('|');
  if (key === bgKey && bgCanvas.width > 1) return;
  bgKey = key;

  const w = Math.max(1, Math.floor(viewW * dpr));
  const h = Math.max(1, Math.floor(viewH * dpr));
  if (bgCanvas.width !== w || bgCanvas.height !== h) {
    bgCanvas.width = w;
    bgCanvas.height = h;
  }

  const g = bgCtx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, viewW, viewH);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, viewW, viewH);

  g.save();
  g.beginPath();
  g.rect(HEADER_W, HEADER_H, Math.max(0, gridW()), Math.max(0, gridH()));
  g.clip();
  g.fillStyle = '#eef1f6';
  g.fillRect(X(0), Y(0), Math.round(S.cols * S.zoom), Math.round(S.rows * S.zoom));
  if (!S.gridOverFill && !S.darkBorder) drawGridLines(g, visibleRange());
  g.restore();
}

function render() {
  const cs = S.zoom;
  const pw = S.cols * cs;
  const ph = S.rows * cs;
  const vr = visibleRange();

  ensureBackground();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.drawImage(bgCanvas, 0, 0, viewW, viewH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(HEADER_W, HEADER_H, Math.max(0, gridW()), Math.max(0, gridH()));
  ctx.clip();

  drawCells(ctx, vr);
  // 需要网格线压在颜色上时，再单独画一遍
  if (S.gridOverFill || S.darkBorder) drawGridLines(ctx, vr);

  // 外框
  ctx.strokeStyle = S.darkBorder ? '#2f3947' : '#7c8ba1';
  ctx.lineWidth = 1;
  ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);

  // 对称轴
  if (S.mirrorX || S.center) {
    ctx.save();
    ctx.strokeStyle = 'rgba(184,68,106,.55)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    const x = X(S.cols / 2);
    ctx.moveTo(x, Y(0));
    ctx.lineTo(x, Y(S.rows));
    ctx.stroke();
    ctx.restore();
  }
  if (S.mirrorY || S.center) {
    ctx.save();
    ctx.strokeStyle = 'rgba(184,68,106,.55)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    const y = Y(S.rows / 2);
    ctx.moveTo(X(0), y);
    ctx.lineTo(X(S.cols), y);
    ctx.stroke();
    ctx.restore();
  }

  // 重复单元网格
  if (S.repeat) {
    ctx.save();
    ctx.strokeStyle = 'rgba(47,125,79,.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let c = S.repeatW; c < S.cols; c += S.repeatW) {
      ctx.moveTo(X(c) + 0.5, Y(0));
      ctx.lineTo(X(c) + 0.5, Y(S.rows));
    }
    for (let r = S.repeatH; r < S.rows; r += S.repeatH) {
      ctx.moveTo(X(0), Y(r) + 0.5);
      ctx.lineTo(X(S.cols), Y(r) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 形状预览
  if (previewShape) {
    const color = S.palette[S.current] || '#000000';
    ctx.save();
    ctx.fillStyle = hexToRgba(color, 0.6);
    for (const [c, r] of previewCells()) {
      ctx.fillRect(X(c), Y(r), X(c + 1) - X(c), Y(r + 1) - Y(r));
    }
    ctx.restore();
  }

  // 选区高亮
  const sel = normalizeSel(S.selection);
  if (sel) {
    ctx.save();
    if (sel.mask) {
      // 套索选区：逐格铺淡色（按行合并，画得少）
      const w = sel.c1 - sel.c0 + 1;
      const rA = Math.max(sel.r0, vr.r0);
      const rB = Math.min(sel.r1, vr.r1);
      const cA = Math.max(sel.c0, vr.c0);
      const cB = Math.min(sel.c1, vr.c1);
      ctx.fillStyle = 'rgba(184,68,106,.2)';
      for (let r = rA; r <= rB; r++) {
        let c = cA;
        while (c <= cB) {
          if (!sel.mask[(r - sel.r0) * w + (c - sel.c0)]) { c++; continue; }
          let e = c;
          while (e + 1 <= cB && sel.mask[(r - sel.r0) * w + (e + 1 - sel.c0)]) e++;
          ctx.fillRect(X(c), Y(r), X(e + 1) - X(c), Y(r + 1) - Y(r));
          c = e + 1;
        }
      }
      if (sel.path && sel.path.length > 1) {
        ctx.strokeStyle = '#b8446a';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 4]);
        ctx.beginPath();
        drawPolyPath(ctx, sel.path, true);
        ctx.stroke();
      }
    } else {
      const sx = X(sel.c0);
      const sy = Y(sel.r0);
      const sw = X(sel.c1 + 1) - sx;
      const sh = Y(sel.r1 + 1) - sy;
      ctx.fillStyle = 'rgba(184,68,106,.18)';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = '#b8446a';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
    }
    ctx.restore();
  }

  // 套索正在圈选：实时轨迹
  if (lassoDrag && lassoDrag.points.length > 1) {
    ctx.save();
    ctx.beginPath();
    drawPolyPath(ctx, lassoDrag.points, true);
    ctx.fillStyle = 'rgba(184,68,106,.12)';
    ctx.fill();
    ctx.strokeStyle = '#b8446a';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.stroke();
    ctx.restore();
  }

  // 浮动选区：复制 / 移动中，跟着手指或鼠标走
  if (floating) {
    const f = floating;
    const bx = offsetX() + f.c0 * S.zoom;
    const by = offsetY() + f.r0 * S.zoom;
    const bx2 = bx + f.w * S.zoom;
    const by2 = by + f.h * S.zoom;
    if (bx2 > HEADER_W && bx < viewW && by2 > HEADER_H && by < viewH) {
      ctx.save();
      for (let r = 0; r < f.h; r++) {
        let c = 0;
        while (c < f.w) {
          if (f.mask && !f.mask[r * f.w + c]) { c++; continue; }
          const v = f.bytes[r * f.w + c];
          let e = c;
          while (e + 1 < f.w && (!f.mask || f.mask[r * f.w + e + 1]) && f.bytes[r * f.w + e + 1] === v) e++;
          if (v) {
            ctx.fillStyle = S.palette[v] || '#000000';
            const x = Math.round(bx + c * S.zoom);
            const y = Math.round(by + r * S.zoom);
            ctx.fillRect(x, y, Math.round(bx + (e + 1) * S.zoom) - x, Math.round(by + (r + 1) * S.zoom) - y);
          }
          c = e + 1;
        }
      }
      ctx.strokeStyle = '#2f7d4f';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5,
        Math.round(f.w * S.zoom), Math.round(f.h * S.zoom));
      ctx.restore();
    }
  }

  // 光标格
  if (S.hover && S.tool !== 'pan' && !inSelection(S.hover.c, S.hover.r)) {
    ctx.save();
    ctx.strokeStyle = S.tool === 'note' ? '#a14d6d' : (S.current === 0 ? '#6b7688' : S.palette[S.current]);
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    const x = X(S.hover.c);
    const y = Y(S.hover.r);
    ctx.strokeRect(x + 1, y + 1, X(S.hover.c + 1) - x - 2, Y(S.hover.r + 1) - y - 2);
    ctx.restore();
  }

  ctx.restore(); // 解除裁剪

  drawHeaders(X, Y);
  drawScreenAnnotationCallouts();
}

function drawHeaders(X, Y) {
  const cs = S.zoom;
  const labelStep = cs >= 17 ? 1 : cs >= 8 ? 5 : cs >= 4 ? 10 : 20;
  const font = '11px "Segoe UI", "PingFang SC", system-ui, sans-serif';

  ctx.save();
  ctx.fillStyle = '#f7f9fc';
  ctx.fillRect(0, 0, viewW, HEADER_H);
  ctx.fillRect(0, 0, HEADER_W, viewH);

  // 高亮光标所在行列（淡）
  if (S.hover) {
    const inSel = inSelection(S.hover.c, S.hover.r);
    ctx.fillStyle = inSel ? 'rgba(184,68,106,.10)' : 'rgba(120,140,170,.14)';
    ctx.fillRect(X(S.hover.c), 0, X(S.hover.c + 1) - X(S.hover.c), HEADER_H);
    ctx.fillRect(0, Y(S.hover.r), HEADER_W, Y(S.hover.r + 1) - Y(S.hover.r));
  }

  // 高亮选区所在行列（浓）
  const sel = normalizeSel(S.selection);
  if (sel) {
    ctx.fillStyle = 'rgba(184,68,106,.22)';
    ctx.fillRect(X(sel.c0), 0, X(sel.c1 + 1) - X(sel.c0), HEADER_H);
    ctx.fillRect(0, Y(sel.r0), HEADER_W, Y(sel.r1 + 1) - Y(sel.r0));
  }

  ctx.strokeStyle = '#dbe2ec';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H - 0.5);
  ctx.lineTo(viewW, HEADER_H - 0.5);
  ctx.moveTo(HEADER_W - 0.5, 0);
  ctx.lineTo(HEADER_W - 0.5, viewH);
  ctx.stroke();

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const c0 = clamp(Math.floor((HEADER_W - offsetX()) / cs), 0, S.cols - 1);
  const c1 = clamp(Math.ceil((viewW - offsetX()) / cs), 0, S.cols - 1);
  for (let c = c0; c <= c1; c++) {
    if ((c + 1) % labelStep !== 0) continue;
    const major = (c + 1) % 10 === 0;
    ctx.fillStyle = major ? '#2c3a4d' : '#6b7688';
    ctx.font = major ? font.replace('11px', 'bold 11px') : font;
    ctx.fillText(String(c + 1), (X(c) + X(c + 1)) / 2, HEADER_H / 2);
  }

  ctx.textAlign = 'right';
  const r0 = clamp(Math.floor((HEADER_H - offsetY()) / cs), 0, S.rows - 1);
  const r1 = clamp(Math.ceil((viewH - offsetY()) / cs), 0, S.rows - 1);
  for (let r = r0; r <= r1; r++) {
    if ((r + 1) % labelStep !== 0) continue;
    const major = (r + 1) % 10 === 0;
    ctx.fillStyle = major ? '#2c3a4d' : '#6b7688';
    ctx.font = major ? font.replace('11px', 'bold 11px') : font;
    ctx.fillText(String(r + 1), HEADER_W - 5, (Y(r) + Y(r + 1)) / 2);
  }

  // 左上角小方块
  ctx.fillStyle = '#eff3f9';
  ctx.fillRect(0, 0, HEADER_W - 1, HEADER_H - 1);
  ctx.strokeStyle = '#dbe2ec';
  ctx.strokeRect(0.5, 0.5, HEADER_W - 2, HEADER_H - 2);
  ctx.restore();
}

/* ---------------- 图案操作 ---------------- */
function idx(c, r) { return r * S.cols + c; }

/* ---------------- 选区 ---------------- */
function normalizeSel(s) {
  if (!s) return null;
  const c0 = clamp(Math.min(s.c0, s.c1), 0, S.cols - 1);
  const c1 = clamp(Math.max(s.c0, s.c1), 0, S.cols - 1);
  const r0 = clamp(Math.min(s.r0, s.r1), 0, S.rows - 1);
  const r1 = clamp(Math.max(s.r0, s.r1), 0, S.rows - 1);
  const out = { c0, c1, r0, r1 };
  // 套索选区：包围盒没变就把形状数据带上
  if (s.mask && s.c0 === c0 && s.c1 === c1 && s.r0 === r0 && s.r1 === r1) {
    out.mask = s.mask;
    out.path = s.path || null;
    out.count = s.count;
  }
  return out;
}

function inSelection(c, r) {
  const n = S.selection;
  if (!n) return false;
  if (c < n.c0 || c > n.c1 || r < n.r0 || r > n.r1) return false;
  if (!n.mask) return true;
  return n.mask[(r - n.r0) * (n.c1 - n.c0 + 1) + (c - n.c0)] === 1;
}

function selectionCells() {
  const n = normalizeSel(S.selection);
  if (!n) return [];
  const out = [];
  const w = n.c1 - n.c0 + 1;
  for (let r = n.r0; r <= n.r1; r++) {
    for (let c = n.c0; c <= n.c1; c++) {
      if (n.mask && !n.mask[(r - n.r0) * w + (c - n.c0)]) continue;
      out.push([c, r]);
    }
  }
  return out;
}

/** 判断点是否在多边形里（偶数奇偶规则），用于套索圈选 */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function setSelection(c0, r0, c1, r1) {
  S.selection = normalizeSel({ c0, r0, c1, r1 });
  updateStatus();
  updateSelectionUI();
  requestRender();
}

function clearSelection() {
  S.selection = null;
  updateStatus();
  updateSelectionUI();
  requestRender();
}

function selectAllCells() {
  setSelection(0, 0, S.cols - 1, S.rows - 1);
  toast('已全选网格');
}

/** 把某个颜色值填进当前选区（会应用镜像 / 重复设置） */
function applyValueToSelection(value) {
  const cells = selectionCells();
  if (!cells.length) return false;
  beginStroke();
  for (const [c, r] of cells) {
    for (const [cc, rr] of paintTargets(c, r)) S.cells[idx(cc, rr)] = value;
  }
  const changed = !equalBytes(strokeBefore.cells, S.cells);
  commitStroke();
  requestRender();
  return changed;
}

/* ---------------- 剪贴板：复制 / 剪切 / 粘贴 ---------------- */
function setClipboard(w, h, u8, mask, count) {
  S.clipboard = {
    w,
    h,
    cells: count != null ? count : w * h,
    data: u8ToBase64(u8),
    bytes: u8,
    mask: mask ? u8ToBase64(mask) : null,
    maskBytes: mask || null,
  };
  saveClipboard();
  updateSelectionUI();
}

function getClipboardParts() {
  const cb = S.clipboard;
  if (!cb) return null;
  if (!cb.bytes) {
    try { cb.bytes = base64ToU8(cb.data); } catch (_) { cb.bytes = new Uint8Array(0); }
  }
  if (cb.mask && !cb.maskBytes) {
    try { cb.maskBytes = base64ToU8(cb.mask); } catch (_) { cb.maskBytes = null; }
  }
  return cb;
}

function saveClipboard() {
  try {
    localStorage.setItem(LS_CLIP, JSON.stringify(
      S.clipboard
        ? { w: S.clipboard.w, h: S.clipboard.h, data: S.clipboard.data, mask: S.clipboard.mask || null }
        : null
    ));
  } catch (_) { /* ignore */ }
}

function loadClipboard() {
  try {
    const raw = localStorage.getItem(LS_CLIP);
    if (!raw) return;
    const cb = JSON.parse(raw);
    if (cb && cb.w > 0 && cb.h > 0 && typeof cb.data === 'string') {
      S.clipboard = {
        w: cb.w, h: cb.h, cells: cb.w * cb.h, data: cb.data,
        mask: typeof cb.mask === 'string' ? cb.mask : null,
      };
      if (S.clipboard.mask) {
        const mb = base64ToU8(S.clipboard.mask);
        S.clipboard.maskBytes = mb;
        S.clipboard.cells = mb.reduce((n, v) => n + (v ? 1 : 0), 0);
      }
    }
  } catch (_) { S.clipboard = null; }
}

/* ---------------- 浮动选区：复制 / 移动后可直接拖到别处 ---------------- */
/**
 * 对一个内容块做几何变换（翻转 / 顺时针旋转 90°）
 * kind: 'flipH' 左右翻转 | 'flipV' 上下翻转 | 'rotate' 顺时针 90°
 * 返回新的 { w, h, bytes, mask }，旋转时宽高互换
 */
function transformBlock(kind, w, h, bytes, mask) {
  const nw = kind === 'rotate' ? h : w;
  const nh = kind === 'rotate' ? w : h;
  const nb = new Uint8Array(nw * nh);
  const nm = mask ? new Uint8Array(nw * nh) : null;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let sx;
      let sy;
      if (kind === 'flipH') { sx = w - 1 - x; sy = y; }
      else if (kind === 'flipV') { sx = x; sy = h - 1 - y; }
      else { sx = y; sy = h - 1 - x; }
      nb[y * nw + x] = bytes[sy * w + sx];
      if (nm) nm[y * nw + x] = mask[sy * w + sx];
    }
  }
  return { w: nw, h: nh, bytes: nb, mask: nm };
}

/** 变换浮动块（复制/剪切出来还没放下时也能翻） */
function transformFloating(kind) {
  const f = floating;
  const t = transformBlock(kind, f.w, f.h, f.bytes, f.mask);
  f.w = t.w;
  f.h = t.h;
  f.bytes = t.bytes;
  f.mask = t.mask;
  updateSelectionUI();
  requestRender();
}

/** 就地变换当前选区的内容 */
function transformSelection(kind) {
  if (floating) { transformFloating(kind); return; }

  const n = normalizeSel(S.selection);
  if (!n) { toast('先框选一块区域，再翻转或旋转'); return; }
  const w = n.c1 - n.c0 + 1;
  const h = n.r1 - n.r0 + 1;

  const bytes = new Uint8Array(w * h);
  let mask = null;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const inSel = !n.mask || n.mask[r * w + c] === 1;
      if (inSel) bytes[r * w + c] = S.cells[idx(n.c0 + c, n.r0 + r)];
      if (n.mask) {
        if (!mask) mask = new Uint8Array(w * h);
        mask[r * w + c] = inSel ? 1 : 0;
      }
    }
  }

  const t = transformBlock(kind, w, h, bytes, mask);

  beginStroke();
  if (kind === 'rotate') {
    // 旋转后尺寸变了，先把原区域清空，避免残留
    for (const [c, r] of selectionCells()) S.cells[idx(c, r)] = 0;
  }
  let clipped = false;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      if (t.mask && !t.mask[y * t.w + x]) continue;
      const tc = n.c0 + x;
      const tr = n.r0 + y;
      if (tc >= S.cols || tr >= S.rows) { clipped = true; continue; }
      S.cells[idx(tc, tr)] = t.bytes[y * t.w + x];
    }
  }
  commitStroke();

  // 更新选区范围（旋转后宽高互换）
  const nc1 = Math.min(n.c0 + t.w - 1, S.cols - 1);
  const nr1 = Math.min(n.r0 + t.h - 1, S.rows - 1);
  if (t.mask) {
    const mw = nc1 - n.c0 + 1;
    const mh = nr1 - n.r0 + 1;
    const nm = new Uint8Array(mw * mh);
    let count = 0;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (t.mask[y * t.w + x]) { nm[y * mw + x] = 1; count++; }
      }
    }
    S.selection = { c0: n.c0, c1: nc1, r0: n.r0, r1: nr1, mask: nm, path: null, count };
    updateStatus();
    updateSelectionUI();
  } else {
    setSelection(n.c0, n.r0, nc1, nr1);
  }
  requestRender();

  const name = kind === 'flipH' ? '左右翻转' : kind === 'flipV' ? '上下翻转' : '旋转 90°';
  toast(clipped ? `已${name}（超出画布的部分被裁掉）` : `已${name}`, 1600);
}

function pointInFloating(c, r) {
  if (!floating) return false;
  return c >= floating.c0 && c < floating.c0 + floating.w && r >= floating.r0 && r < floating.r0 + floating.h;
}

/** 把当前选区的内容取出来变成"浮动块"（move=true 表示放置时清空原位） */
function startFloatingFromSelection(move) {
  if (floating) commitFloating();
  const n = normalizeSel(S.selection);
  if (!n) { toast('先框选一块区域'); return false; }

  const w = n.c1 - n.c0 + 1;
  const h = n.r1 - n.r0 + 1;
  const bytes = new Uint8Array(w * h);
  let mask = null;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const inSel = !n.mask || n.mask[r * w + c] === 1;
      if (inSel) bytes[r * w + c] = S.cells[idx(n.c0 + c, n.r0 + r)];
      if (n.mask) {
        if (!mask) mask = new Uint8Array(w * h);
        mask[r * w + c] = inSel ? 1 : 0;
      }
    }
  }

  floating = { w, h, bytes, mask, c0: n.c0, r0: n.r0, move: !!move, src: n, drag: null };
  updateSelectionUI();
  requestRender();
  return true;
}

/** 把浮动块放到当前位置（一步撤销：移动会同时清空原位） */
function commitFloating() {
  if (!floating) return;
  const f = floating;
  const c0 = Math.round(f.c0);
  const r0 = Math.round(f.r0);

  beginStroke();
  if (f.move) {
    const src = f.src;
    const sw = src.c1 - src.c0 + 1;
    for (let r = src.r0; r <= src.r1; r++) {
      for (let c = src.c0; c <= src.c1; c++) {
        if (src.mask && !src.mask[(r - src.r0) * sw + (c - src.c0)]) continue;
        S.cells[idx(c, r)] = 0;
      }
    }
  }
  for (let r = 0; r < f.h; r++) {
    const rr = r0 + r;
    if (rr < 0 || rr >= S.rows) continue;
    for (let c = 0; c < f.w; c++) {
      if (f.mask && !f.mask[r * f.w + c]) continue;
      const cc = c0 + c;
      if (cc < 0 || cc >= S.cols) continue;
      S.cells[idx(cc, rr)] = f.bytes[r * f.w + c];
    }
  }
  floating = null;
  commitStroke();

  const nc0 = clamp(c0, 0, S.cols - 1);
  const nr0 = clamp(r0, 0, S.rows - 1);
  const nc1 = clamp(c0 + f.w - 1, 0, S.cols - 1);
  const nr1 = clamp(r0 + f.h - 1, 0, S.rows - 1);
  if (f.mask) {
    const mw = nc1 - nc0 + 1;
    const mh = nr1 - nr0 + 1;
    const mask = new Uint8Array(mw * mh);
    let count = 0;
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        const sc = nc0 - c0 + c;
        const sr = nr0 - r0 + r;
        if (sr >= 0 && sr < f.h && sc >= 0 && sc < f.w && f.mask[sr * f.w + sc]) {
          mask[r * mw + c] = 1;
          count++;
        }
      }
    }
    S.selection = { c0: nc0, c1: nc1, r0: nr0, r1: nr1, mask, path: null, count };
    updateStatus();
    updateSelectionUI();
  } else {
    setSelection(nc0, nr0, nc1, nr1);
  }
  requestRender();
  toast(f.move ? '已移动到新位置' : '已放置', 1400);
}

function cancelFloating() {
  if (!floating) return;
  floating = null;
  updateSelectionUI();
  requestRender();
  toast('已取消', 1200);
}

/** 有浮动块时先放下（在切换工具、填色、撤销等操作前调用） */
function settleFloating() {
  if (floating) commitFloating();
}

/** 复制选区内容到剪贴板（silent = 不弹提示） */
function copySelection(silent) {
  const n = normalizeSel(S.selection);
  if (!n) {
    if (!silent) toast('先框选一块区域再复制');
    return null;
  }
  const w = n.c1 - n.c0 + 1;
  const h = n.r1 - n.r0 + 1;
  const data = new Uint8Array(w * h);
  let mask = null;
  let count = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const inSel = !n.mask || n.mask[r * w + c] === 1;
      if (inSel) {
        data[r * w + c] = S.cells[idx(n.c0 + c, n.r0 + r)];
        count++;
      }
      if (n.mask) {
        if (!mask) mask = new Uint8Array(w * h);
        mask[r * w + c] = inSel ? 1 : 0;
      }
    }
  }
  setClipboard(w, h, data, mask, count);
  if (!silent) {
    // 复制出来直接变成可拖动的浮动块
    if (startFloatingFromSelection(false)) {
      toast(n.mask ? `已复制 ${count} 格，拖动到目标位置后点「放下」` : `已复制 ${w}×${h}，拖动到目标位置后点「放下」`, 3200);
    }
  }
  return S.clipboard;
}

function cutSelection() {
  const cb = copySelection(true);
  if (!cb) { toast('先框选一块区域再剪切'); return; }
  if (startFloatingFromSelection(true)) {
    toast(`已剪切 ${cb.w}×${cb.h}，拖动到目标位置后点「放下」`, 3200);
  }
}

/** 粘贴：以当前选区左上角（没有选区就用光标格）为起点 */
function pasteClipboard() {
  const cb = S.clipboard;
  const parts = getClipboardParts();
  const bytes = parts ? parts.bytes : null;
  if (!cb || !bytes || !bytes.length) { toast('剪贴板还是空的'); return; }
  const n = normalizeSel(S.selection);
  const c0 = n ? n.c0 : (S.hover ? S.hover.c : 0);
  const r0 = n ? n.r0 : (S.hover ? S.hover.r : 0);

  beginStroke();
  for (let r = 0; r < cb.h; r++) {
    const rr = r0 + r;
    if (rr >= S.rows) break;
    for (let c = 0; c < cb.w; c++) {
      if (cb.maskBytes && !cb.maskBytes[r * cb.w + c]) continue; // 套索形状外不覆盖
      const cc = c0 + c;
      if (cc >= S.cols) break;
      S.cells[idx(cc, rr)] = bytes[r * cb.w + c];
    }
  }
  commitStroke();
  requestRender();
  if (cb.maskBytes) {
    // 套索形状：把形状一起搬过去，方便连续粘贴
    const w = cb.w;
    const h = cb.h;
    const c1 = Math.min(c0 + w - 1, S.cols - 1);
    const r1 = Math.min(r0 + h - 1, S.rows - 1);
    const mw = c1 - c0 + 1;
    const mh = r1 - r0 + 1;
    const mask = new Uint8Array(mw * mh);
    let count = 0;
    for (let r = 0; r < mh; r++) {
      for (let c = 0; c < mw; c++) {
        if (cb.maskBytes[r * w + c]) { mask[r * mw + c] = 1; count++; }
      }
    }
    S.selection = { c0, r0, c1, r1, mask, path: null, count };
    updateStatus();
    updateSelectionUI();
    toast(`已粘贴套索选区（${count} 格）`, 1500);
  } else {
    setSelection(c0, r0, Math.min(c0 + cb.w - 1, S.cols - 1), Math.min(r0 + cb.h - 1, S.rows - 1));
    toast(`已粘贴 ${cb.w} × ${cb.h}`, 1500);
  }
}

/** 清除选区内容（不复制） */
function clearSelectionContent() {
  if (!S.selection) { toast('先框选一块区域'); return; }
  beginStroke();
  for (const [c, r] of selectionCells()) S.cells[idx(c, r)] = 0;
  commitStroke();
  requestRender();
}

function updateSelectionUI() {
  const bar = $('selBar');
  if (!bar) return;
  const n = normalizeSel(S.selection);
  const f = floating;
  bar.classList.toggle('show', !!n || !!S.clipboard || !!f);
  bar.classList.toggle('floating', !!f);
  const info = $('selInfo');
  if (info) {
    if (f) {
      info.textContent = `拖动中 ${f.w}×${f.h}`;
    } else if (n) {
      const size = n.mask && n.count != null ? n.count : (n.c1 - n.c0 + 1) * (n.r1 - n.r0 + 1);
      info.textContent = (n.mask ? '套索 ' : '选区 ') + `${n.c1 - n.c0 + 1}×${n.r1 - n.r0 + 1}（${size} 格）`;
    } else {
      info.textContent = S.clipboard ? `剪贴板 ${S.clipboard.w}×${S.clipboard.h}` : '';
    }
  }
  const pasteBtn = bar.querySelector('[data-action="paste"]');
  if (pasteBtn) pasteBtn.disabled = !S.clipboard || !!f;
  for (const name of ['flipH', 'flipV', 'rotateSel']) {
    const b = bar.querySelector(`[data-action="${name}"]`);
    if (b) b.disabled = !n && !f;
  }
  const noSel = !n || !!f;
  for (const name of ['copySel', 'cutSel', 'clearSel', 'deselect']) {
    const b = bar.querySelector(`[data-action="${name}"]`);
    if (b) b.disabled = noSel;
  }
}

function symmetryTargets(c, r) {
  const out = [[c, r]];
  const push = (cc, rr) => {
    if (cc >= 0 && cc < S.cols && rr >= 0 && rr < S.rows) out.push([cc, rr]);
  };
  const base = [[c, r]];
  if (S.center) {
    for (const [cc, rr] of base) push(S.cols - 1 - cc, S.rows - 1 - rr);
  } else {
    if (S.mirrorX) for (const [cc, rr] of base) push(S.cols - 1 - cc, rr);
    if (S.mirrorY) for (const [cc, rr] of out.slice()) push(cc, S.rows - 1 - rr);
  }
  const seen = new Set();
  const uniq = [];
  for (const [cc, rr] of out) {
    const k = cc + ',' + rr;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push([cc, rr]);
  }
  return uniq;
}

function expandRepeat(targets) {
  if (!S.repeat) return targets;
  const w = clamp(Math.round(S.repeatW) || 1, 1, S.cols);
  const h = clamp(Math.round(S.repeatH) || 1, 1, S.rows);
  const out = [];
  const seen = new Set();
  for (const [c, r] of targets) {
    const cc = ((c % w) + w) % w;
    const rr = ((r % h) + h) % h;
    for (let y = rr; y < S.rows; y += h) {
      for (let x = cc; x < S.cols; x += w) {
        const k = y * S.cols + x;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x, y]);
      }
    }
  }
  return out;
}

function paintTargets(c, r) {
  return expandRepeat(symmetryTargets(c, r));
}

function paintCell(c, r, value) {
  let changed = false;
  for (const [cc, rr] of paintTargets(c, r)) {
    const i = idx(cc, rr);
    if (S.cells[i] !== value) {
      S.cells[i] = value;
      changed = true;
    }
  }
  return changed;
}

function lineCells(x0, y0, x1, y1, cb) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function rectCellList(c0, r0, c1, r1, filled) {
  const list = [];
  const [ca, cb] = c0 <= c1 ? [c0, c1] : [c1, c0];
  const [ra, rb] = r0 <= r1 ? [r0, r1] : [r1, r0];
  if (filled) {
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) list.push([c, r]);
  } else {
    for (let c = ca; c <= cb; c++) { list.push([c, ra]); if (rb !== ra) list.push([c, rb]); }
    for (let r = ra + 1; r <= rb - 1; r++) { list.push([ca, r]); if (cb !== ca) list.push([cb, r]); }
  }
  return list;
}

function previewCells() {
  if (!previewShape) return [];
  const { type, a, b } = previewShape;
  if (type === 'line') {
    const list = [];
    lineCells(a.c, a.r, b.c, b.r, (c, r) => list.push([c, r]));
    return list;
  }
  return rectCellList(a.c, a.r, b.c, b.r, S.rectFill);
}

function floodFill(c, r, value) {
  const target = S.cells[idx(c, r)];
  if (target === value) return false;
  const { cols, rows } = S;
  const stack = [idx(c, r)];
  while (stack.length) {
    const i = stack.pop();
    if (S.cells[i] !== target) continue;
    S.cells[i] = value;
    const x = i % cols;
    const y = (i / cols) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < cols - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - cols);
    if (y < rows - 1) stack.push(i + cols);
  }
  return true;
}

function countFilled() {
  let n = 0;
  for (let i = 0; i < S.cells.length; i++) if (S.cells[i]) n++;
  return n;
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------------- 撤销 / 重做 ---------------- */
function pushUndo(snapshot) {
  undoStack.push(snapshot);
  // 大网格（>250×250）降低历史深度，避免占用过多内存
  const limit = S.cols * S.rows > 62500 ? 30 : HISTORY_LIMIT;
  while (undoStack.length > limit) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function beginStroke() {
  strokeBefore = {
    cells: S.cells.slice(),
    annotations: cloneAnnotations(),
  };
}

function commitStroke() {
  if (!strokeBefore) return;
  const before = strokeBefore;
  strokeBefore = null;
  if (equalBytes(before.cells, S.cells) && annotationsEqual(before.annotations, S.annotations)) return;
  pushUndo(before);
  markDirty();
  updateStats();
  updateAnnotationUI();
  requestRender();
}

function markDirty() {
  S.dirty = true;
  updateSaveStatus();
  scheduleAutosave();
}

function undo() {
  if (floating) cancelFloating();
  if (!undoStack.length) return;
  const current = { cells: S.cells.slice(), annotations: cloneAnnotations() };
  const previous = undoStack.pop();
  redoStack.push(current);
  S.cells = previous.cells;
  S.annotations = normalizeAnnotations(previous.annotations);
  afterHistoryChange();
}

function redo() {
  if (floating) cancelFloating();
  if (!redoStack.length) return;
  const current = { cells: S.cells.slice(), annotations: cloneAnnotations() };
  const next = redoStack.pop();
  undoStack.push(current);
  S.cells = next.cells;
  S.annotations = normalizeAnnotations(next.annotations);
  afterHistoryChange();
}

function afterHistoryChange() {
  updateHistoryButtons();
  markDirty();
  updateStats();
  updateAnnotationUI();
  requestRender();
}

function updateHistoryButtons() {
  $('btnUndo').disabled = undoStack.length === 0;
  $('btnRedo').disabled = redoStack.length === 0;
}

/* ---------------- 交互 ---------------- */
function isPanTrigger(e) {
  return S.tool === 'pan' || e.button === 1 || spaceDown;
}

function localPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/* 连续笔画状态（画笔 / 橡皮） */
let strokeValue = null;   // 当前笔画颜色，null = 没有进行中的笔画
let strokeLast = null;    // 上一个采样点
let penDown = false;      // Apple Pencil 按下中（用于手掌防误触）
let lassoDrag = null;     // 套索正在圈选中
let floating = null;      // 浮动选区（复制/移动后等待放置）
let noteDrag = null;      // 自由文本框拖动中

/** 屏幕坐标 -> 格子坐标（带小数，套索用） */
function pointToCellF(p) {
  return [(p.x - offsetX()) / S.zoom, (p.y - offsetY()) / S.zoom];
}

function appendLassoPoints(e, p) {
  if (!lassoDrag) return;
  let events = [e];
  if (typeof e.getCoalescedEvents === 'function') {
    try {
      const co = e.getCoalescedEvents();
      if (co && co.length) events = co;
    } catch (_) { /* ignore */ }
  }
  for (const ev of events) {
    const pp = ev.clientX !== undefined ? localPoint(ev) : p;
    const pt = pointToCellF(pp);
    const last = lassoDrag.points[lassoDrag.points.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.4) lassoDrag.points.push(pt);
  }
  const cur = screenToCell(p.x, p.y);
  if (cur) S.hover = cur;
}

/** 松手：把圈出来的多边形转成选区 */
function finishLasso() {
  const pts = lassoDrag ? lassoDrag.points : null;
  lassoDrag = null;

  if (!pts || pts.length < 3) {
    if (S.hover) setSelection(S.hover.c, S.hover.r, S.hover.c, S.hover.r);
    else requestRender();
    return;
  }

  let bc0 = Infinity, bc1 = -Infinity, br0 = Infinity, br1 = -Infinity;
  for (const [c, r] of pts) {
    if (c < bc0) bc0 = c;
    if (c > bc1) bc1 = c;
    if (r < br0) br0 = r;
    if (r > br1) br1 = r;
  }
  const c0 = clamp(Math.floor(bc0), 0, S.cols - 1);
  const c1 = clamp(Math.ceil(bc1), 0, S.cols - 1);
  const r0 = clamp(Math.floor(br0), 0, S.rows - 1);
  const r1 = clamp(Math.ceil(br1), 0, S.rows - 1);
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;

  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (pointInPolygon(c + 0.5, r + 0.5, pts)) {
        mask[(r - r0) * w + (c - c0)] = 1;
        count++;
      }
    }
  }

  if (!count) {
    // 圈得太细（比如拖了一条直线）→ 保留原来的选区
    requestRender();
    toast('这个圈太小了，没有选中格子', 1600);
    return;
  }

  S.selection = { c0, c1, r0, r1, mask, path: pts, count };
  updateStatus();
  updateSelectionUI();
  requestRender();
  toast(`套索选中 ${count} 格`, 1400);
}

function startPaintStroke(cell, value) {
  beginStroke();
  strokeValue = value;
  strokeLast = cell;
  paintCell(cell.c, cell.r, value);
}

function extendPaintStroke(cell, value) {
  if (!strokeLast) {
    strokeLast = cell;
    paintCell(cell.c, cell.r, value);
    return;
  }
  if (strokeLast.c === cell.c && strokeLast.r === cell.r) return;
  lineCells(strokeLast.c, strokeLast.r, cell.c, cell.r, (c, r) => paintCell(c, r, value));
  strokeLast = cell;
}

function endPaintStroke() {
  strokeValue = null;
  strokeLast = null;
  commitStroke();
}

function onPointerDown(e) {
  if (e.button === 2) return;

  // Apple Pencil 优先：笔在画时忽略手指/手掌，避免误触
  if (e.pointerType === 'pen') penDown = true;
  else if (penDown && e.pointerType === 'touch') return;

  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 少数环境不支持，忽略 */ }

  if (pointers.size >= 2) {
    if (strokeBefore) {
      S.cells.set(strokeBefore.cells);
      strokeBefore = null;
    }
    if (noteDrag) {
      noteDrag.note.x = noteDrag.origX;
      noteDrag.note.y = noteDrag.origY;
      noteDrag = null;
    }
    previewShape = null;
    selectDrag = null;
    lassoDrag = null;
    if (floating) floating.drag = null;
    const pts = [...pointers.values()];
    pinchState = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      zoom: S.zoom,
    };
    requestRender();
    return;
  }

  if (isPanTrigger(e)) {
    pointers.get(e.pointerId).pan = { x: p.x, y: p.y, panX: S.panX, panY: S.panY };
    $('canvasWrap').classList.add('grabbing');
    return;
  }

  // 浮动选区：按住任意位置都能把它拖走
  if (floating) {
    const fp = pointToCellF(p);
    floating.drag = { sc: fp[0], sr: fp[1], c0: floating.c0, r0: floating.r0 };
    requestRender();
    return;
  }

  // 套索：自由圈选任意形状（可以从网格外开始圈）
  if (S.tool === 'lasso') {
    lassoDrag = { points: [pointToCellF(p)] };
    requestRender();
    return;
  }

  if (S.tool === 'note') {
    const textBox = textBoxAtPoint(p.x, p.y);
    if (textBox) {
      noteDrag = {
        note: textBox,
        startX: p.x,
        startY: p.y,
        origX: textBox.x,
        origY: textBox.y,
        before: { cells: S.cells.slice(), annotations: cloneAnnotations() },
        moved: false,
      };
      requestRender();
      return;
    }

    const cell = screenToCell(p.x, p.y);
    if (S.annotationStyle === ANNOTATION_STYLE_TEXTBOX) {
      const gridWidth = S.cols * S.zoom;
      const gridHeight = S.rows * S.zoom;
      const x = clamp((p.x - offsetX()) / gridWidth, -0.2, 1.2);
      const y = clamp((p.y - offsetY()) / gridHeight, -0.2, 1.2);
      editAnnotationAt(
        cell ? cell.c : clamp(Math.floor(x * S.cols), 0, S.cols - 1),
        cell ? cell.r : clamp(Math.floor(y * S.rows), 0, S.rows - 1),
        { existing: null, x, y },
      );
      return;
    }
    if (!cell) {
      pointers.get(e.pointerId).pan = { x: p.x, y: p.y, panX: S.panX, panY: S.panY };
      $('canvasWrap').classList.add('grabbing');
      return;
    }
    S.hover = cell;
    updateStatus();
    editAnnotationAt(cell.c, cell.r, { existing: annotationAt(cell.c, cell.r) });
    return;
  }

  const cell = screenToCell(p.x, p.y);
  if (!cell) {
    // 网格之外的空白区域：按住拖动即为平移
    pointers.get(e.pointerId).pan = { x: p.x, y: p.y, panX: S.panX, panY: S.panY };
    $('canvasWrap').classList.add('grabbing');
    return;
  }
  S.hover = cell;
  updateStatus();

  if (S.tool === 'eyedropper') {
    pickColorAt(cell.c, cell.r);
    return;
  }

  if (S.tool === 'fill') {
    beginStroke();
    if (S.selection && inSelection(cell.c, cell.r)) {
      // 有选区且点在选区内：只填选区
      for (const [c, r] of selectionCells()) {
        for (const [cc, rr] of paintTargets(c, r)) S.cells[idx(cc, rr)] = S.current;
      }
    } else {
      floodFill(cell.c, cell.r, S.current);
    }
    commitStroke();
    requestRender();
    return;
  }

  // 选择工具：点一下选中一格，按住拖动框选一块区域
  if (S.tool === 'select') {
    // 在已有选区里按下 = 直接拖动这块内容（移动）
    if (S.selection && inSelection(cell.c, cell.r)) {
      if (startFloatingFromSelection(true)) {
        const fp = pointToCellF(p);
        floating.drag = { sc: fp[0], sr: fp[1], c0: floating.c0, r0: floating.r0 };
      }
      return;
    }
    selectDrag = { anchor: cell };
    setSelection(cell.c, cell.r, cell.c, cell.r);
    return;
  }

  // 画笔 / 橡皮：按下即开始，拖动连续画（像真笔一样），松手才记一步撤销
  if (S.tool === 'brush' || S.tool === 'eraser') {
    startPaintStroke(cell, S.tool === 'eraser' ? 0 : S.current);
    requestRender();
    return;
  }

  beginStroke();
  if (S.tool === 'line' || S.tool === 'rect') {
    previewShape = { type: S.tool, a: cell, b: cell };
  }
  requestRender();
}

function onPointerMove(e) {
  const p = localPoint(e);
  if (pointers.has(e.pointerId)) {
    const rec = pointers.get(e.pointerId);
    rec.x = p.x;
    rec.y = p.y;
    if (rec.pan) {
      viewTouched = true;
      S.panX = rec.pan.panX + (p.x - rec.pan.x);
      S.panY = rec.pan.panY + (p.y - rec.pan.y);
      clampPan();
      requestRender();
      return;
    }
  }

  if (pointers.size >= 2 && pinchState) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    S.panX += mid.x - pinchState.mid.x;
    S.panY += mid.y - pinchState.mid.y;
    if (pinchState.dist > 8) {
      S.zoom = clamp(pinchState.zoom * (dist / pinchState.dist), MIN_ZOOM, MAX_ZOOM);
      updateZoomLabel();
    }
    pinchState.mid = mid;
    clampPan();
    requestRender();
    return;
  }

  const rec = pointers.get(e.pointerId);

  if (rec && noteDrag) {
    const dx = p.x - noteDrag.startX;
    const dy = p.y - noteDrag.startY;
    if (Math.hypot(dx, dy) > 2) noteDrag.moved = true;
    noteDrag.note.x = clamp(noteDrag.origX + dx / (S.cols * S.zoom), -0.2, 1.2);
    noteDrag.note.y = clamp(noteDrag.origY + dy / (S.rows * S.zoom), -0.2, 1.2);
    requestRender();
    return;
  }

  // 拖动浮动选区
  if (rec && floating && floating.drag) {
    const fp = pointToCellF(p);
    floating.c0 = floating.drag.c0 + (fp[0] - floating.drag.sc);
    floating.r0 = floating.drag.r0 + (fp[1] - floating.drag.sr);
    requestRender();
    return;
  }

  // 套索：记录轨迹
  if (rec && lassoDrag) {
    appendLassoPoints(e, p);
    updateStatus();
    requestRender();
    return;
  }

  // 连续绘画：优先使用合并采样点（Apple Pencil / 高刷新率鼠标更顺滑）
  if (rec && strokeValue !== null) {
    let events = [e];
    if (typeof e.getCoalescedEvents === 'function') {
      try {
        const co = e.getCoalescedEvents();
        if (co && co.length) events = co;
      } catch (_) { /* 忽略 */ }
    }
    for (const ev of events) {
      const pp = ev.clientX !== undefined ? localPoint(ev) : p;
      const cc = screenToCell(pp.x, pp.y);
      if (cc) extendPaintStroke(cc, strokeValue);
    }
    const cur = screenToCell(p.x, p.y) || S.hover;
    if (cur) S.hover = cur;
    updateStatus();
    requestRender();
    return;
  }

  const cell = screenToCell(p.x, p.y);
  const prevHover = S.hover;
  S.hover = cell;
  if ((prevHover && cell && (prevHover.c !== cell.c || prevHover.r !== cell.r)) || (!!prevHover !== !!cell)) {
    updateStatus();
    requestRender();
  }
  if (!cell) return;

  if (rec && selectDrag) {
    setSelection(selectDrag.anchor.c, selectDrag.anchor.r, cell.c, cell.r);
    return;
  }
  if (rec && previewShape) {
    previewShape.b = cell;
    requestRender();
  }
}

function onPointerUp(e) {
  const rec = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (e.pointerType === 'pen') penDown = false;
  if (pointers.size < 2) pinchState = null;

  if (rec && rec.pan) {
    $('canvasWrap').classList.remove('grabbing');
    return;
  }
  if (noteDrag) {
    const drag = noteDrag;
    noteDrag = null;
    if (drag.moved) {
      pushUndo(drag.before);
      markDirty();
      updateAnnotationUI();
      requestRender();
      toast('文本框位置已更新', 1400);
    } else {
      editAnnotationAt(drag.note.c, drag.note.r, { existing: drag.note });
    }
    return;
  }
  if (floating && floating.drag) {
    const d = floating.drag;
    floating.drag = null;
    const moved = Math.abs(floating.c0 - d.c0) > 0.35 || Math.abs(floating.r0 - d.r0) > 0.35;
    // 点一下浮动块以外的地方 = 就地放下
    if (!moved && !pointInFloating(d.sc, d.sr)) commitFloating();
    return;
  }
  if (lassoDrag) { finishLasso(); return; }
  if (strokeValue !== null) {
    endPaintStroke();
    requestRender();
    return;
  }
  if (selectDrag) { selectDrag = null; return; }
  if (previewShape) {
    const value = S.current;
    for (const [c, r] of previewCells()) {
      for (const [cc, rr] of paintTargets(c, r)) S.cells[idx(cc, rr)] = value;
    }
    previewShape = null;
    commitStroke();
    requestRender();
  }
}

function pickColorAt(c, r) {
  const v = S.cells[idx(c, r)];
  selectColor(v || 0, { fill: false });
}

function updateStatus() {
  const sel = normalizeSel(S.selection);
  const el = $('statusSel');
  if (!el) return;
  if (!sel) {
    el.textContent = '选区：—';
  } else {
    const multi = sel.c0 !== sel.c1 || sel.r0 !== sel.r1;
    const rowTxt = sel.r0 === sel.r1 ? `第 ${sel.r0 + 1} 行` : `第 ${sel.r0 + 1}–${sel.r1 + 1} 行`;
    const colTxt = sel.c0 === sel.c1 ? `第 ${sel.c0 + 1} 列` : `第 ${sel.c0 + 1}–${sel.c1 + 1} 列`;
    const size = sel.mask && sel.count != null
      ? sel.count
      : (sel.c1 - sel.c0 + 1) * (sel.r1 - sel.r0 + 1);
    const prefix = sel.mask ? '套索' : '选区';
    el.textContent = multi
      ? `${prefix}：${rowTxt} · ${colTxt}（${size} 格）`
      : `选区：${rowTxt} · ${colTxt}`;
  }
  const cur = $('statusCursor');
  if (cur) {
    cur.textContent = S.hover ? `光标：第 ${S.hover.r + 1} 行 · 第 ${S.hover.c + 1} 列` : '光标：—';
  }
}

function onWheel(e) {
  e.preventDefault();
  const p = localPoint(e);
  if (e.ctrlKey || e.metaKey || e.altKey) {
    const factor = Math.exp(-e.deltaY * 0.0018);
    zoomAt(p.x, p.y, S.zoom * factor);
    return;
  }
  if (e.shiftKey) S.panX -= e.deltaY;
  else S.panY -= e.deltaY;
  S.panX -= e.deltaX;
  viewTouched = true;
  clampPan();
  requestRender();
}

/* ============================================================
 * 颜色 / 调色板
 * ============================================================ */
function colorIndexOf(hex) {
  const h = String(hex).toLowerCase();
  for (let i = 1; i < S.palette.length; i++) {
    if (String(S.palette[i]).toLowerCase() === h) return i;
  }
  return -1;
}

function addColor(hex, name) {
  const h = String(hex).toLowerCase();
  const found = colorIndexOf(h);
  if (found > 0) return found;
  if (S.palette.length >= 251) {
    toast('颜色数量已达上限，请先清空自定义颜色');
    return 1;
  }
  S.palette.push(h);
  S.names.push(name || '自定义');
  buildPalette();
  return S.palette.length - 1;
}

function selectColor(i, opts) {
  const fill = !opts || opts.fill !== false;
  if (fill && floating) settleFloating();
  S.current = clamp(i, 0, S.palette.length - 1);
  updateCurrentColor();
  markPaletteActive();
  if (S.current > 0) pushRecent(S.palette[S.current]);
  if (fill && S.selection) {
    const targets = selectionCells().length;
    if (targets) {
      const changed = applyValueToSelection(S.current);
      if (changed) {
        const label = S.current === 0 ? '' : `「${S.names[S.current] || '自定义'}」`;
        toast(
          S.current === 0
            ? (targets === 1 ? '已清除 1 格' : `已清除 ${targets} 格`)
            : (targets === 1 ? `已填入 ${label}` : `已填入 ${label} × ${targets} 格`),
          1400
        );
      }
    }
  }
  requestRender();
}

function updateCurrentColor() {
  const sw = $('currentSwatch');
  const name = $('currentColorName');
  const hexEl = $('currentColorHex');
  if (S.current === 0) {
    sw.style.background = '';
    name.textContent = '空 / 擦除';
    hexEl.textContent = '—';
  } else {
    sw.style.background = S.palette[S.current];
    name.textContent = S.names[S.current] || '自定义';
    hexEl.textContent = String(S.palette[S.current]).toUpperCase();
  }
}

function markPaletteActive() {
  document.querySelectorAll('#palette .swatch').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.index) === S.current);
  });
  markStripActive();
}

function buildPalette() {
  const wrap = $('palette');
  wrap.innerHTML = '';

  const empty = document.createElement('button');
  empty.className = 'swatch swatch-empty';
  empty.dataset.index = '0';
  empty.title = '空（擦除）';
  empty.addEventListener('click', () => selectColor(0));
  wrap.appendChild(empty);

  for (let i = 1; i < S.palette.length; i++) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.index = String(i);
    b.style.background = S.palette[i];
    b.title = `${S.names[i] || ''} ${String(S.palette[i]).toUpperCase()}`;
    b.addEventListener('click', () => selectColor(i));
    wrap.appendChild(b);
  }
  buildColorStrip();
  markPaletteActive();
}

/* ---------------- 手机底部快速色条 ---------------- */
function buildColorStrip() {
  const wrap = $('colorStrip');
  if (!wrap) return;
  wrap.innerHTML = '';

  const mk = (i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' empty' : '');
    b.dataset.index = String(i);
    if (i > 0) b.style.background = S.palette[i];
    b.title = i === 0 ? '空（清除颜色）' : `${S.names[i] || ''} ${String(S.palette[i]).toUpperCase()}`;
    b.addEventListener('click', () => selectColor(i));
    wrap.appendChild(b);
  };

  mk(0);
  for (let i = 1; i < S.palette.length; i++) mk(i);

  const add = document.createElement('button');
  add.className = 'chip add';
  add.textContent = '＋';
  add.title = '打开面板添加自定义颜色';
  add.addEventListener('click', openSidebar);
  wrap.appendChild(add);

  markStripActive();
}

function markStripActive() {
  document.querySelectorAll('#colorStrip .chip[data-index]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.index) === S.current);
  });
}

function pushRecent(hex) {
  recentColors = [hex, ...recentColors.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, 12);
  try { localStorage.setItem(LS_RECENT, JSON.stringify(recentColors)); } catch (_) { /* ignore */ }
  renderRecent();
}

function renderRecent() {
  const wrap = $('recentList');
  wrap.innerHTML = '';
  if (!recentColors.length) {
    const s = document.createElement('span');
    s.className = 'muted';
    s.textContent = '暂无';
    wrap.appendChild(s);
    return;
  }
  for (const hex of recentColors) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = String(hex).toUpperCase();
    b.addEventListener('click', () => selectColor(addColor(hex)));
    wrap.appendChild(b);
  }
}

/* ============================================================
 * 统计
 * ============================================================ */
function updateStats() {
  const total = S.cols * S.rows;
  const counts = new Map();
  let filled = 0;
  for (let i = 0; i < S.cells.length; i++) {
    const v = S.cells[i];
    if (!v) continue;
    filled++;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  $('statusFilled').textContent = `已填色：${filled} / ${total}`;
  const sizeEl = $('statusSize');
  if (sizeEl) sizeEl.textContent = `网格：${S.cols} × ${S.rows}`;

  const box = $('stats');
  box.innerHTML = '';
  if (!filled) {
    box.innerHTML = '<p class="muted">还没有填色，选个颜色在网格上拖一拖吧。</p>';
    return;
  }
  const arr = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  for (const [i, n] of arr) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML =
      `<span class="dot" style="background:${S.palette[i] || '#000'}"></span>` +
      `<span class="stat-name">${escapeHtml(S.names[i] || '颜色')}</span>` +
      `<b>${n}</b><span class="pct">${((n / total) * 100).toFixed(1)}%</span>`;
    box.appendChild(row);
  }
}

function updateSaveStatus(text) {
  const el = $('statusSave');
  el.classList.remove('dirty', 'ok');
  if (text) { el.textContent = text; return; }
  if (S.dirty) {
    el.textContent = '● 有改动未保存';
    el.classList.add('dirty');
  } else {
    el.textContent = '已保存到本机浏览器';
    el.classList.add('ok');
  }
}

function updateTitle() {
  $('designName').textContent = S.designName + (S.dirty ? ' *' : '');
  document.title = `${S.designName} — 棉鞋编织花样设计器`;
}

/* ============================================================
 * 序列化 / 本地保存
 * ============================================================ */
function serialize() {
  return {
    app: FILE_TAG,
    version: FILE_VERSION,
    name: S.designName,
    cols: S.cols,
    rows: S.rows,
    palette: S.palette.slice(1),
    names: S.names.slice(1),
    cells: u8ToBase64(S.cells),
    annotations: S.annotations.map((note) => ({
      c: note.c,
      r: note.r,
      text: note.text,
      style: note.style,
      orientation: note.orientation,
      fontSize: note.fontSize,
      fontColor: note.fontColor,
      backgroundOpacity: note.backgroundOpacity,
      showBorder: note.showBorder,
      x: note.x,
      y: note.y,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function applyDesign(obj, opts = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('文件格式不正确');

  const srcCols = clamp(parseInt(obj.cols, 10) || 120, 4, 400);
  const rows = clamp(parseInt(obj.rows, 10) || 120, 4, 400);
  const cols = clamp(parseInt(obj.cols, 10) || 120, 4, 400);

  // 调色板（保持索引一一对应）
  const pal = [null];
  const names = ['空'];
  const srcPal = Array.isArray(obj.palette) ? obj.palette : [];
  const srcNames = Array.isArray(obj.names) ? obj.names : [];
  for (let i = 0; i < Math.min(srcPal.length, 250); i++) {
    const hex = String(srcPal[i] || '');
    pal.push(/^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#000000');
    names.push(String(srcNames[i] || `颜色 ${i + 1}`).slice(0, 12));
  }
  if (pal.length < 2) {
    for (const p of PRESET_COLORS) { pal.push(p.hex); names.push(p.name); }
  }

  const cells = new Uint8Array(cols * rows);
  let src = null;
  if (obj.cells) {
    try { src = base64ToU8(obj.cells); } catch (_) { src = null; }
  }
  if (src) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const si = r * srcCols + c;
        if (si >= src.length) continue;
        const v = src[si];
        cells[r * cols + c] = v < pal.length ? v : 0;
      }
    }
  }

  S.cols = cols;
  S.rows = rows;
  S.cells = cells;
  S.palette = pal;
  S.names = names;
  S.current = clamp(S.current, 0, pal.length - 1) || 1;
  if (S.current < 1 && pal.length > 1) S.current = 1;
  S.designName = String(obj.name || '未命名花样').slice(0, 60);
  S.annotations = normalizeAnnotations(obj.annotations, cols, rows);
  S.designId = opts.keepId === false ? null : (obj.id || S.designId || null);
  S.dirty = false;

  undoStack.length = 0;
  redoStack.length = 0;
  previewShape = null;
  strokeBefore = null;
  selectDrag = null;
  lassoDrag = null;
  S.selection = null;

  buildPalette();
  updateCurrentColor();
  updateStats();
  updateAnnotationUI();
  updateTitle();
  updateSaveStatus();
  updateHistoryButtons();
  updateStatus();
  fitToWindow();
  requestRender();
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch (_) { /* ignore */ }
  }, 1200);
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    applyDesign(JSON.parse(raw));
    updateSaveStatus('已恢复本机草稿');
    return true;
  } catch (_) {
    return false;
  }
}

/* 界面偏好（是否在填色区域上画网格线等） */
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS) || '{}');
    if (typeof p.gridOverFill === 'boolean') S.gridOverFill = p.gridOverFill;
    if (typeof p.darkBorder === 'boolean') S.darkBorder = p.darkBorder;
    if (p.annotationStyleVersion === ANNOTATION_STYLE_VERSION &&
        [ANNOTATION_STYLE_CALLOUT, ANNOTATION_STYLE_POSTER, ANNOTATION_STYLE_TEXTBOX].includes(p.annotationStyle)) {
      S.annotationStyle = p.annotationStyle;
    }
  } catch (_) { /* ignore */ }
}

function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({
      gridOverFill: S.gridOverFill,
      darkBorder: S.darkBorder,
      annotationStyle: S.annotationStyle,
      annotationStyleVersion: ANNOTATION_STYLE_VERSION,
    }));
  } catch (_) { /* ignore */ }
}

/* ---------------- 覆盖前自动备份：误点也能捞回来 ---------------- */
function backupCurrentDraft() {
  if (countFilled() === 0 && S.annotations.length === 0) return; // 空白的没什么好备份
  try {
    localStorage.setItem(LS_LAST, JSON.stringify(Object.assign(serialize(), {
      name: S.designName,
      backedUpAt: new Date().toISOString(),
    })));
  } catch (_) { /* 存储满就算了 */ }
}

function restoreLastDraft() {
  let raw = null;
  try { raw = localStorage.getItem(LS_LAST); } catch (_) { raw = null; }
  if (!raw) { toast('还没有可恢复的备份（做覆盖操作时会自动留一份）'); return; }

  let obj;
  try { obj = JSON.parse(raw); } catch (_) { toast('备份已损坏，无法恢复'); return; }

  const when = obj.backedUpAt ? String(obj.backedUpAt).replace('T', ' ').slice(0, 16) : '';
  const filled = countFilled();
  const doRestore = () => {
    try {
      applyDesign(obj, { keepId: false });
      toast(when ? `已恢复上一次的内容（${when}）` : '已恢复上一次的内容', 3000);
    } catch (err) {
      toast('恢复失败：' + (err.message || '备份内容不对'));
    }
  };

  if (S.dirty && (filled > 0 || S.annotations.length > 0)) {
    openModal({
      title: '恢复上一次的内容',
      body: `<p>会用备份的「${escapeHtml(obj.name || '未命名花样')}」替换当前画板。</p>
             <p class="muted">当前画板有 ${filled} 格内容和 ${S.annotations.length} 条注释还没保存。</p>`,
      actions: [
        { label: '取消' },
        { label: '先保存', onClick: (close) => { close(); saveDesign(); } },
        { label: '恢复', cls: 'danger', onClick: (close) => { close(); doRestore(); } },
      ],
    });
    return;
  }
  doRestore();
}

/** 这次覆盖是否会丢掉可能重要的内容 */
function needsDiscardConfirm() {
  if (countFilled() === 0 && S.annotations.length === 0) return false;
  if (S.dirty) return true;
  return !S.designId;
}

/** 会覆盖当前画板的操作前，先留一份底；有内容时再确认一次 */
function confirmDiscard(action, fn) {
  backupCurrentDraft();
  if (!needsDiscardConfirm()) { fn(); return; }
  openModal({
    title: '当前内容还没保存',
    body: `<p>画板上有 <b>${countFilled()}</b> 格内容和 <b>${S.annotations.length}</b> 条注释，${S.dirty ? '有改动还没保存' : '还没保存到本机'}。</p>
           <p class="muted">${escapeHtml(action)}会替换掉它（覆盖前的内容已自动留底，可用「恢复上次内容」找回）。</p>`,
    actions: [
      { label: '取消' },
      { label: '先保存', onClick: (close) => { close(); saveDesign(); } },
      { label: '继续', cls: 'danger', onClick: (close) => { close(); fn(); } },
    ],
  });
}

function newDesign(cols, rows, name) {
  backupCurrentDraft();
  S.cols = clamp(cols, 4, 400);
  S.rows = clamp(rows, 4, 400);
  S.cells = new Uint8Array(S.cols * S.rows);
  S.selection = null;
  S.annotations = [];
  S.designId = null;
  S.designName = name || '未命名花样';
  S.dirty = false;
  undoStack.length = 0;
  redoStack.length = 0;
  previewShape = null;
  strokeBefore = null;
  selectDrag = null;
  lassoDrag = null;
  updateStats();
  updateAnnotationUI();
  updateTitle();
  updateSaveStatus();
  updateHistoryButtons();
  updateStatus();
  fitToWindow();
  requestRender();
}

/* ============================================================
 * 本机保存
 * ============================================================ */
function saveDesign() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(serialize()));
    S.dirty = false;
    updateSaveStatus();
    updateTitle();
    toast('已保存到本机浏览器');
  } catch (_) {
    toast('保存失败：本机存储空间不足');
  }
}

/* ============================================================
 * 导入 / 导出
 * ============================================================ */
function exportJson() {
  saveBundle([serialize()], `${safeName(S.designName)}-${S.cols}x${S.rows}.mianxie.json`);
}

/* ============================================================
 * 本地文件：保存 / 载入 / 整机备份
 * 文件格式（.mianxie.json）：
 * {
 *   "app": "mianxie-pattern",
 *   "format": "design-bundle",
 *   "version": 3,
 *   "exportedAt": "2026-09-14T01:23:45.000Z",
 *   "designs": [ { name, cols, rows, palette[], names[], cells(base64), updatedAt } ]
 * }
 * designs 里可以只有一个花样（单个保存），也可以是一整份备份。
 * 旧版单独导出的设计 JSON（没有 designs 数组）同样能导入。
 * ============================================================ */
function buildBundle(designs) {
  return {
    app: FILE_TAG,
    format: 'design-bundle',
    version: 3,
    exportedAt: new Date().toISOString(),
    count: designs.length,
    designs,
  };
}

/** 优先用系统分享面板（iPad 上可以存到"文件"、AirDrop、发微信），不支持就下载 */
async function shareOrDownload(blob, filename, okText) {
  try {
    if (typeof File === 'function' && navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: blob.type || 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        toast(okText || '已保存', 1800);
        return;
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // 用户取消
  }
  downloadBlob(blob, filename);
  toast((okText || '已保存') + '（已下载到本机）', 2000);
}

async function saveBundle(designs, filename, okText) {
  const blob = new Blob([JSON.stringify(buildBundle(designs), null, 1)], { type: 'application/json' });
  await shareOrDownload(blob, filename, okText);
  return blob.size;
}

/** 保存当前花样到本地文件 */
async function saveCurrentToFile() {
  await saveBundle([serialize()], `${safeName(S.designName)}-${S.cols}x${S.rows}.mianxie.json`, '花样文件已保存');
}

/** 载入本地文件：可能是单个花样，也可能是一整份备份 */
function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try {
      obj = JSON.parse(String(reader.result));
    } catch (_) {
      toast('这个文件不是棉鞋花样文件（JSON 解析失败）');
      return;
    }
    const designs = Array.isArray(obj && obj.designs) ? obj.designs.filter((d) => d && d.cells) : null;

    if (!designs) {
      // 旧格式 / 单个花样
      confirmDiscard('载入文件', () => {
        try {
          applyDesign(obj, { keepId: false });
          toast('已载入：' + S.designName);
        } catch (err) {
          toast('载入失败：' + (err.message || '文件内容不对'));
        }
      });
      return;
    }

    if (designs.length === 0) { toast('备份文件里没有花样'); return; }
    if (designs.length === 1) {
      confirmDiscard('载入文件', () => {
        try {
          applyDesign(designs[0], { keepId: false });
          toast('已载入：' + S.designName);
        } catch (err) {
          toast('载入失败：' + (err.message || '文件内容不对'));
        }
      });
      return;
    }

    const body = document.createElement('div');
    body.innerHTML = `<p>这份备份里有 <b>${designs.length}</b> 个花样。</p>
      <p class="muted">本地版一次打开一个花样；选择后会把第一个载入画板，其余内容仍保留在备份文件中。</p>`;
    openModal({
      title: '载入备份文件',
      body,
      actions: [
        { label: '取消' },
        { label: '只打开第一个', cls: 'primary', onClick: (close) => {
          backupCurrentDraft();
          try {
            applyDesign(designs[0], { keepId: false });
            close();
            toast('已载入：' + S.designName);
          } catch (err) { toast('载入失败：' + (err.message || '文件内容不对')); }
        } },
      ],
    });
  };
  reader.onerror = () => toast('文件读取失败');
  reader.readAsText(file);
}

function safeName(s) {
  return String(s || '花样').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

function annotationAt(c, r) {
  return S.annotations.find((note) =>
    note.style !== ANNOTATION_STYLE_TEXTBOX && note.c === c && note.r === r
  ) || null;
}

function updateAnnotationStyleUI() {
  document.querySelectorAll('#annotationStylePicker [data-note-style]').forEach((button) => {
    button.classList.toggle('on', button.dataset.noteStyle === S.annotationStyle);
  });
}

function updateAnnotationUI() {
  const list = $('annotationList');
  const count = $('annotationCount');
  if (!list || !count) return;
  count.textContent = String(S.annotations.length);
  list.innerHTML = '';
  if (!S.annotations.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '还没有注释。';
    list.appendChild(empty);
    return;
  }

  S.annotations.forEach((note, index) => {
    const item = document.createElement('div');
    item.className = 'annotation-item';

    const head = document.createElement('div');
    head.className = 'annotation-head';
    const styleName = note.style === ANNOTATION_STYLE_POSTER
      ? '后期文字'
      : note.style === ANNOTATION_STYLE_TEXTBOX ? 'PPT 文本框' : '箭头标注';
    const styleDetail = note.style === ANNOTATION_STYLE_TEXTBOX
      ? ` · ${note.orientation === 'vertical' ? '竖向' : '横向'} · ${note.fontSize}px · 背景 ${note.backgroundOpacity}%${note.showBorder ? '' : ' · 无边框'}`
      : '';
    const location = note.style === ANNOTATION_STYLE_TEXTBOX
      ? '自由位置'
      : `第 ${note.r + 1} 行 · 第 ${note.c + 1} 列`;
    head.textContent = `${index + 1}. ${location} · ${styleName}${styleDetail}`;

    const text = document.createElement('div');
    text.className = 'annotation-text';
    text.textContent = note.text;

    const actions = document.createElement('div');
    actions.className = 'annotation-actions';

    const locate = document.createElement('button');
    locate.className = 'btn small';
    locate.textContent = '定位';
    locate.addEventListener('click', () => {
      setTool('note');
      S.hover = { c: note.c, r: note.r };
      ensureVisible(note);
      updateStatus();
      requestRender();
    });

    const edit = document.createElement('button');
    edit.className = 'btn small';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editAnnotationAt(note.c, note.r, { existing: note }));

    const remove = document.createElement('button');
    remove.className = 'btn small danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      const before = { cells: S.cells.slice(), annotations: cloneAnnotations() };
      S.annotations = S.annotations.filter((entry) => entry !== note);
      pushUndo(before);
      markDirty();
      updateAnnotationUI();
      requestRender();
      toast('注释已删除');
    });

    actions.appendChild(locate);
    actions.appendChild(edit);
    actions.appendChild(remove);
    item.appendChild(head);
    item.appendChild(text);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function editAnnotationAt(c, r, options = {}) {
  const existing = Object.prototype.hasOwnProperty.call(options, 'existing')
    ? options.existing
    : annotationAt(c, r);
  if (!existing && S.annotations.length >= MAX_ANNOTATIONS) {
    toast(`最多添加 ${MAX_ANNOTATIONS} 条注释`);
    return;
  }

  const startsAsTextBox = existing
    ? existing.style === ANNOTATION_STYLE_TEXTBOX
    : S.annotationStyle === ANNOTATION_STYLE_TEXTBOX;
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="muted">${startsAsTextBox
      ? '自由文本框：保存后可在画板上直接拖动位置'
      : `位置：第 ${r + 1} 行 · 第 ${c + 1} 列`}</p>
    <div class="field">
      <label for="annotationStyle">显示样式</label>
      <select id="annotationStyle">
        <option value="${ANNOTATION_STYLE_CALLOUT}">箭头标注：箭头指向格子并显示文本框</option>
        <option value="${ANNOTATION_STYLE_POSTER}">后期文字：文字直接叠在图片上</option>
        <option value="${ANNOTATION_STYLE_TEXTBOX}">PPT 文本框：可设置方向、字号和颜色</option>
      </select>
    </div>
    <div id="annotationTextBoxOptions">
      <div class="field-row">
        <div class="field">
          <label for="annotationOrientation">文字方向</label>
          <select id="annotationOrientation">
            <option value="horizontal">横向</option>
            <option value="vertical">竖向（逐字竖排）</option>
          </select>
        </div>
        <div class="field">
          <label for="annotationFontSize">字号（px）</label>
          <input type="number" id="annotationFontSize" min="10" max="48" step="1" value="18" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="annotationFontColor">字体颜色</label>
          <input type="color" id="annotationFontColor" value="#6d2545" />
        </div>
        <div class="field">
          <label for="annotationBackgroundOpacity">背景不透明度（%）</label>
          <input type="number" id="annotationBackgroundOpacity" min="0" max="100" step="5" value="95" />
        </div>
      </div>
      <label class="check"><input type="checkbox" id="annotationShowBorder" checked /> 显示文本框边框</label>
    </div>
    <div class="field">
      <label for="annotationText">注释内容（最多 ${MAX_ANNOTATION_TEXT} 字）</label>
      <textarea id="annotationText" maxlength="${MAX_ANNOTATION_TEXT}" rows="5" placeholder="例如：这里换色，再织 8 行"></textarea>
    </div>
    <label class="check"><input type="checkbox" id="annotationRemove" /> 删除这个位置的注释</label>
    <p class="muted">所有样式都会保留在导出 PNG 中。注释字号固定，不随画板缩放；导出时也保持固定大小。“PPT 文本框”可单独设置横竖方向、字号和颜色。</p>`;
  body.querySelector('#annotationText').value = existing ? existing.text : '';
  const styleSelect = body.querySelector('#annotationStyle');
  styleSelect.value = existing ? existing.style : S.annotationStyle;
  styleSelect.className = 'field-select';
  const orientationSelect = body.querySelector('#annotationOrientation');
  const fontSizeInput = body.querySelector('#annotationFontSize');
  const fontColorInput = body.querySelector('#annotationFontColor');
  const backgroundOpacityInput = body.querySelector('#annotationBackgroundOpacity');
  const showBorderInput = body.querySelector('#annotationShowBorder');
  orientationSelect.value = existing ? existing.orientation : 'horizontal';
  fontSizeInput.value = String(existing ? existing.fontSize : 18);
  fontColorInput.value = existing ? existing.fontColor : '#6d2545';
  backgroundOpacityInput.value = String(existing ? existing.backgroundOpacity : 95);
  showBorderInput.checked = existing ? existing.showBorder : true;
  const textBoxOptions = body.querySelector('#annotationTextBoxOptions');
  const initialX = options.x ?? (existing ? existing.x : (c + 0.5) / S.cols);
  const initialY = options.y ?? (existing ? existing.y : (r + 0.5) / S.rows);
  const syncTextBoxOptions = () => {
    textBoxOptions.hidden = styleSelect.value !== ANNOTATION_STYLE_TEXTBOX;
  };
  styleSelect.addEventListener('change', syncTextBoxOptions);
  syncTextBoxOptions();

  openModal({
    title: existing ? '编辑注释' : '添加注释',
    body,
    actions: [
      { label: '取消' },
      {
        label: '保存', cls: 'primary', onClick: (close) => {
          const remove = body.querySelector('#annotationRemove').checked;
          const text = body.querySelector('#annotationText').value.replace(/\r\n/g, '\n').trim();
          const style = [ANNOTATION_STYLE_POSTER, ANNOTATION_STYLE_TEXTBOX].includes(styleSelect.value)
            ? styleSelect.value
            : ANNOTATION_STYLE_CALLOUT;
          const orientation = orientationSelect.value === 'vertical' ? 'vertical' : 'horizontal';
          const fontSize = clamp(parseInt(fontSizeInput.value, 10) || 18, 10, 48);
          const fontColor = /^#[0-9a-fA-F]{6}$/.test(fontColorInput.value)
            ? fontColorInput.value.toLowerCase()
            : '#6d2545';
          const backgroundOpacity = clamp(parseInt(backgroundOpacityInput.value, 10) || 0, 0, 100);
          const showBorder = showBorderInput.checked;
          const x = clamp(Number(initialX), -0.2, 1.2);
          const y = clamp(Number(initialY), -0.2, 1.2);
          if (!remove && !text) {
            toast('请输入注释内容');
            return;
          }

          const before = { cells: S.cells.slice(), annotations: cloneAnnotations() };
          S.annotations = S.annotations.filter((note) => {
            if (existing) return note !== existing;
            if (style === ANNOTATION_STYLE_TEXTBOX) return true;
            return note.style === ANNOTATION_STYLE_TEXTBOX || note.c !== c || note.r !== r;
          });
          if (!remove) {
            S.annotations.push({
              c,
              r,
              text: text.slice(0, MAX_ANNOTATION_TEXT),
              style,
              orientation,
              fontSize,
              fontColor,
              backgroundOpacity,
              showBorder,
              x,
              y,
            });
          }
          S.annotations = normalizeAnnotations(S.annotations);
          S.annotationStyle = style;
          savePrefs();
          pushUndo(before);
          markDirty();
          updateAnnotationUI();
          updateAnnotationStyleUI();
          requestRender();
          close();
          toast(remove ? '注释已删除' : (existing ? '注释已更新' : '注释已添加'));
        },
      },
    ],
  });
}

function pngFileName(input, fallback) {
  const raw = String(input || '').trim() || fallback;
  const base = safeName(raw).replace(/\.png$/i, '').trim();
  return `${base || safeName(fallback)}.png`;
}

function wrapCanvasText(g, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const ch of Array.from(paragraph)) {
      const test = line + ch;
      if (line && g.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function drawExportWatermark(g, width, height) {
  const fontSize = Math.max(24, Math.min(38, width / 26));
  g.save();
  g.globalAlpha = 0.075;
  g.fillStyle = '#7b294d';
  g.font = `bold ${fontSize}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const textWidth = g.measureText(EXPORT_WATERMARK).width;
  const xStep = textWidth + 120;
  const yStep = Math.max(100, fontSize * 3.6);
  const span = Math.ceil(Math.hypot(width, height) / 2) + Math.max(xStep, yStep) * 2;
  g.translate(width / 2, height / 2);
  g.rotate(-Math.PI / 6);
  for (let y = -span, row = 0; y <= span; y += yStep, row++) {
    const offset = row % 2 ? xStep / 2 : 0;
    for (let x = -span + offset; x <= span; x += xStep) {
      g.fillText(EXPORT_WATERMARK, x, y);
    }
  }
  g.restore();
}

function exportPngDialog() {
  const sizeText = (cs) => `${S.cols * cs + 84} × ${S.rows * cs + 122}`;
  const defaultName = `${safeName(S.designName)}-${S.cols}x${S.rows}`;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field">
      <label for="pngFilename">文件名（无需输入 .png）</label>
      <input type="text" id="pngFilename" value="${escapeHtml(defaultName)}" maxlength="80" autocomplete="off" />
    </div>
    <div class="field">
      <label>每格像素（越大越清晰）</label>
      <select id="pngCell">
        <option value="8">8 px · 图片约 ${sizeText(8)}</option>
        <option value="12" selected>12 px · 图片约 ${sizeText(12)}</option>
        <option value="16">16 px · 图片约 ${sizeText(16)}</option>
        <option value="24">24 px · 图片约 ${sizeText(24)}</option>
      </select>
    </div>
    <label class="check"><input type="checkbox" id="pngGrid" checked /> 显示网格线</label>
    <label class="check"><input type="checkbox" id="pngNumbers" checked /> 显示行列编号</label>
    <label class="check"><input type="checkbox" id="pngShade" /> 空白格显示浅灰底</label>
    <label class="check"><input type="checkbox" id="pngTimestamp" /> 图片底部显示导出时间</label>
    <label class="check"><input type="checkbox" id="pngWatermark" /> 添加全图水印「${EXPORT_WATERMARK}」</label>
    <p class="muted">注释会以箭头文本框保留在导出图中，字号固定，不随画板缩放或“每格像素”选项变化。水印只覆盖在导出图上，不改变花纹。${
      S.darkBorder ? '（已开启深色边框：导出图片会强制显示深色表格线）' : ''
    }</p>`;
  body.querySelector('select').className = 'field-select';

  openModal({
    title: '导出 PNG 图片',
    body,
    actions: [
      { label: '取消' },
      {
        label: '导出', cls: 'primary', onClick: (close) => {
          renderPng({
            filename: pngFileName(body.querySelector('#pngFilename').value, defaultName),
            cell: Number(body.querySelector('#pngCell').value),
            grid: body.querySelector('#pngGrid').checked,
            numbers: body.querySelector('#pngNumbers').checked,
            shade: body.querySelector('#pngShade').checked,
            timestamp: body.querySelector('#pngTimestamp').checked,
            watermark: body.querySelector('#pngWatermark').checked,
          });
          close();
        },
      },
    ],
  });
}

function renderPng(opts) {
  const cs = opts.cell;
  const padX = 24;
  const padTop = 58;
  const padBottom = 42;
  const headW = opts.numbers ? 36 : 0;
  const headH = opts.numbers ? 22 : 0;
  const notes = S.annotations.slice();
  const W = padX * 2 + headW + S.cols * cs;
  const H = padTop + headH + S.rows * cs + padBottom;

  const cvs = document.createElement('canvas');
  cvs.width = W;
  cvs.height = H;
  const g = cvs.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  const ox = padX + headW;
  const oy = padTop + headH;
  const X = (c) => ox + c * cs;
  const Y = (r) => oy + r * cs;
  const gridBottomPx = Y(S.rows);

  if (opts.shade) {
    g.fillStyle = '#eef1f6';
    g.fillRect(X(0), Y(0), S.cols * cs, S.rows * cs);
  }

  // 网格线
  const dark = S.darkBorder;
  const drawGrid = () => {
    // 开启深色边框时，导出图片强制带边框
    if (!opts.grid && !dark) return;
    const pass = (step, skip, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let c = 0; c <= S.cols; c++) {
        if (c % step !== 0 || (skip && c % skip === 0)) continue;
        g.moveTo(Math.round(X(c)) + 0.5, Y(0));
        g.lineTo(Math.round(X(c)) + 0.5, Y(S.rows));
      }
      for (let r = 0; r <= S.rows; r++) {
        if (r % step !== 0 || (skip && r % skip === 0)) continue;
        g.moveTo(X(0), Math.round(Y(r)) + 0.5);
        g.lineTo(X(S.cols), Math.round(Y(r)) + 0.5);
      }
      g.stroke();
    };
    if (cs >= 8) pass(1, 0, dark ? '#8b97a8' : '#e3e8f0', 1);
    pass(5, 10, dark ? '#5d6a7c' : '#c8d2e0', dark ? 1.3 : 1);
    pass(10, 0, dark ? '#2f3947' : '#93a3bb', dark ? 1.9 : 1.4);
  };

  const drawCells = () => {
    for (let r = 0; r < S.rows; r++) {
      const base = r * S.cols;
      let c = 0;
      while (c < S.cols) {
        const v = S.cells[base + c];
        if (!v) { c++; continue; }
        let e = c;
        while (e + 1 < S.cols && S.cells[base + e + 1] === v) e++;
        g.fillStyle = S.palette[v] || '#000000';
        g.fillRect(X(c), Y(r), (e - c + 1) * cs, cs);
        c = e + 1;
      }
    }
  };

  // 和屏幕显示保持一致的画法：默认网格线在色块下面；深色边框模式压在色块上面
  if (S.gridOverFill || dark) {
    drawCells();
    drawGrid();
  } else {
    drawGrid();
    drawCells();
  }

  if (opts.numbers) {
    const step = cs >= 16 ? 1 : cs >= 9 ? 5 : 10;
    g.fillStyle = '#5a6b80';
    g.font = `${Math.min(14, Math.max(9, cs - 2))}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f7f9fc';
    g.fillRect(0, 0, W, headH);
    g.fillRect(0, 0, headW, gridBottomPx);
    g.fillStyle = '#5a6b80';
    for (let c = 0; c < S.cols; c++) {
      if ((c + 1) % step !== 0) continue;
      g.fillText(String(c + 1), X(c) + cs / 2, headH / 2);
    }
    g.textAlign = 'right';
    for (let r = 0; r < S.rows; r++) {
      if ((r + 1) % step !== 0) continue;
      g.fillText(String(r + 1), headW - 6, Y(r) + cs / 2);
    }
  }

  g.strokeStyle = dark ? '#2f3947' : '#7c8ba1';
  g.lineWidth = dark ? 2.5 : 1.5;
  g.strokeRect(X(0) - 1.25, Y(0) - 1.25, S.cols * cs + 2.5, S.rows * cs + 2.5);

  g.fillStyle = '#1f2630';
  g.font = 'bold 22px "Segoe UI", "PingFang SC", system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(S.designName, padX, 34);
  g.fillStyle = '#6b7688';
  g.font = '14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
  g.fillText(`${S.cols} 针 × ${S.rows} 行 · 每格 1 针`, padX, 54);

  if (opts.watermark) drawExportWatermark(g, W, H);

  if (notes.length) {
    const occupied = [];
    const gridWidth = S.cols * cs;
    const boxWidth = Math.max(130, Math.min(280, gridWidth - 12));
    const bounds = {
      minX: X(0) + 4,
      minY: Y(0) + 4,
      maxX: X(S.cols) - 4,
      maxY: Y(S.rows) - 4,
    };
    notes.forEach((note) => {
      const ax = X(note.c) + cs / 2;
      const ay = Y(note.r) + cs / 2;
      const fontSize = fixedAnnotationFontSize(note, 'export');
      if (note.style === ANNOTATION_STYLE_POSTER) {
        drawPosterAnnotation(g, ax, ay, note.text, {
          fontSize,
          lineHeight: 23,
          maxTextWidth: boxWidth - 8,
          bounds,
          occupied,
          gap: 26,
          anchorRadius: 3,
          lineWidth: 1.7,
          haloWidth: 5,
        });
        return;
      }
      if (note.style === ANNOTATION_STYLE_TEXTBOX) {
        drawTextBoxAnnotation(g, ax, ay, note.text, note, {
          fontSize,
          maxTextWidth: boxWidth - 20,
          padding: 10,
          bounds: { minX: 8, minY: 8, maxX: W - 8, maxY: H - 8 },
          centerX: X(0) + note.x * S.cols * cs,
          centerY: Y(0) + note.y * S.rows * cs,
          boxLineWidth: 1.5,
          shadowBlur: 10,
        });
        return;
      }
      drawAnnotationCallout(g, ax, ay, note.text, {
        fontSize,
        lineHeight: 21,
        padding: 10,
        boxWidth,
        bounds,
        occupied,
        gap: 28,
        arrowLength: 11,
        anchorRadius: 3.2,
        lineWidth: 1.8,
        boxLineWidth: 1.5,
        shadowBlur: 10,
      });
    });
  }

  if (opts.timestamp) {
    g.fillStyle = '#6b7688';
    g.font = '13px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(`导出时间：${nowText()}`, W - padX, H - padBottom / 2);
  }

  cvs.toBlob((blob) => {
    if (!blob) { toast('导出失败'); return; }
    downloadBlob(blob, opts.filename || pngFileName('', `${safeName(S.designName)}-${S.cols}x${S.rows}`));
    toast('图片已导出');
  }, 'image/png');
}

/* ============================================================
 * 弹窗
 * ============================================================ */
let closeModalFn = null;

function openModal({ title, body, actions }) {
  $('modalTitle').textContent = title;
  const bodyEl = $('modalBody');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const actEl = $('modalActions');
  actEl.innerHTML = '';
  const close = () => { $('modalRoot').classList.add('hidden'); closeModalFn = null; };
  for (const a of actions || []) {
    const b = document.createElement('button');
    b.className = 'btn' + (a.cls ? ' ' + a.cls : '');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      if (a.onClick) a.onClick(close);
      else close();
    });
    actEl.appendChild(b);
  }
  $('modalRoot').classList.remove('hidden');
  closeModalFn = close;
  setTimeout(() => {
    const f = bodyEl.querySelector('input, select, textarea');
    if (f) f.focus();
  }, 40);
  return close;
}

/* ============================================================
 * 示例花样
 * ============================================================ */
function loadSample(force) {
  // 有未保存的内容时先问一句，别把人家辛苦画的盖掉
  if (!force && needsDiscardConfirm()) {
    openModal({
      title: '载入示例花样',
      body: `<p>当前画板上有 <b>${countFilled()}</b> 格内容和 <b>${S.annotations.length}</b> 条注释，${S.dirty ? '有改动还没保存' : '还没保存到本机'}。</p>
             <p class="muted">载入示例会覆盖它。载入后可以按 Ctrl+Z 撤销回来，但更保险是先保存。</p>`,
      actions: [
        { label: '取消' },
        { label: '先保存', onClick: (close) => { close(); saveDesign(); } },
        { label: '仍要载入', cls: 'danger', onClick: (close) => { close(); loadSample(true); } },
      ],
    });
    return;
  }

  backupCurrentDraft();
  const red = addColor('#c62828', '大红');
  const green = addColor('#2f6b45', '墨绿');
  const yellow = addColor('#e8a020', '姜黄');
  const w = 20;
  const h = 20;
  beginStroke();               // 保留撤销栈：载入示例后可以 Ctrl+Z 撤回
  S.cells.fill(0);
  S.annotations = [];
  for (let r = 0; r < S.rows; r++) {
    for (let c = 0; c < S.cols; c++) {
      const lx = Math.abs((c % w) - 9.5);
      const ly = Math.abs((r % h) - 9.5);
      const d = lx + ly;
      let v = 0;
      if (d <= 1.6) v = yellow;
      else if (d >= 4.5 && d < 6.5) v = green;
      else if (d >= 9.5 && d < 11.5) v = red;
      S.cells[r * S.cols + c] = v;
    }
  }
  commitStroke();
  S.repeat = true;
  S.repeatW = w;
  S.repeatH = h;
  $('tglRepeat').checked = true;
  $('repeatW').value = String(w);
  $('repeatH').value = String(h);
  S.current = red;
  buildPalette();
  updateCurrentColor();
  updateStats();
  requestRender();
  toast('已载入示例花样（Ctrl+Z 可以撤销）', 2600);
}

/* ============================================================
 * UI 绑定
 * ============================================================ */
function setTool(tool) {
  if (floating) settleFloating();
  S.tool = tool;
  previewShape = null;
  selectDrag = null;
  document.querySelectorAll('#toolGrid .tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  const wrap = $('canvasWrap');
  wrap.classList.toggle('pan-mode', tool === 'pan');
  wrap.classList.toggle('select-mode', tool === 'select');
  wrap.classList.toggle('eyedropper', tool === 'eyedropper');
  wrap.classList.toggle('note-mode', tool === 'note');
  requestRender();
}

function openSidebar() {
  $('sidebar').classList.add('open');
  const s = $('scrim');
  if (s) s.classList.add('show');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  const s = $('scrim');
  if (s) s.classList.remove('show');
}

function toggleSidebar() {
  if ($('sidebar').classList.contains('open')) closeSidebar();
  else openSidebar();
}

function clearAllDialog() {
  if (countFilled() === 0) { toast('网格已经是空的'); return; }
  openModal({
    title: '清空网格',
    body: '<p>将清除全部填色，可用 Ctrl+Z 撤销。</p>',
    actions: [
      { label: '取消' },
      {
        label: '确定清空', cls: 'danger', onClick: (close) => {
          beginStroke();
          S.cells.fill(0);
          commitStroke();
          close();
          requestRender();
        },
      },
    ],
  });
}

function eraseSelection() {
  if (!S.selection) { toast('先点一下格子选中，再清除颜色'); return; }
  clearSelectionContent();
}

function newDesignDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>花样名称</label><input type="text" id="newName" maxlength="60" value="${escapeHtml(S.designName === '未命名花样' ? '未命名花样' : S.designName + '-副本')}" /></div>
    <div class="field-row">
      <div class="field"><label>列数（针数）</label><input type="number" id="newCols" min="4" max="400" value="${DEFAULT_COLS}" /></div>
      <div class="field"><label>行数</label><input type="number" id="newRows" min="4" max="400" value="${DEFAULT_ROWS}" /></div>
    </div>
    <div class="preset-row">
      <button class="btn small" data-cols="120" data-rows="200">120 × 200（默认）</button>
      <button class="btn small" data-cols="200" data-rows="200">200 × 200</button>
      <button class="btn small" data-cols="120" data-rows="120">120 × 120</button>
      <button class="btn small" data-cols="42" data-rows="60">鞋面 42 × 60</button>
      <button class="btn small" data-cols="300" data-rows="300">300 × 300</button>
    </div>`;
  body.querySelector('.preset-row').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    body.querySelector('#newCols').value = b.dataset.cols;
    body.querySelector('#newRows').value = b.dataset.rows;
  });
  openModal({
    title: '新建花样',
    body,
    actions: [
      { label: '取消' },
        {
          label: '创建', cls: 'primary', onClick: (close) => {
            const name = body.querySelector('#newName').value.trim() || '未命名花样';
            const cols = clamp(parseInt(body.querySelector('#newCols').value, 10) || DEFAULT_COLS, 4, 400);
            const rows = clamp(parseInt(body.querySelector('#newRows').value, 10) || DEFAULT_ROWS, 4, 400);
            confirmDiscard(`新建 ${cols} × ${rows} 画板`, () => {
              newDesign(cols, rows, name);
              close();
              closeSidebar();
              toast(`已新建 ${cols} × ${rows} 网格`);
            });
          },
        },
    ],
  });
}

const ACTIONS = {
  new: newDesignDialog,
  exportPng: exportPngDialog,
  exportJson,
  import: () => $('fileInput').click(),
  saveLocal: () => saveCurrentToFile(),
  loadLocal: () => $('fileInput').click(),
  restoreLast: () => restoreLastDraft(),
  undo,
  redo,
  zoomIn: () => zoomAt(HEADER_W + gridW() / 2, HEADER_H + gridH() / 2, S.zoom * 1.25),
  zoomOut: () => zoomAt(HEADER_W + gridW() / 2, HEADER_H + gridH() / 2, S.zoom / 1.25),
  fit: fitToWindow,
  menu: toggleSidebar,
  clear: clearAllDialog,
  sample: loadSample,
  eraseSel: eraseSelection,
  selectAll: selectAllCells,
  copySel: () => copySelection(),
  cutSel: cutSelection,
  paste: pasteClipboard,
  clearSel: clearSelectionContent,
  deselect: clearSelection,
  flipH: () => transformSelection('flipH'),
  flipV: () => transformSelection('flipV'),
  rotateSel: () => transformSelection('rotate'),
  floatCommit: () => commitFloating(),
  floatCancel: () => cancelFloating(),
};

function bindUI() {
  const scrim = document.createElement('div');
  scrim.id = 'scrim';
  scrim.className = 'scrim';
  scrim.addEventListener('click', closeSidebar);
  $('app').appendChild(scrim);

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  $('toolGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (btn) setTool(btn.dataset.tool);
  });
  $('annotationStylePicker').addEventListener('click', (e) => {
    const button = e.target.closest('[data-note-style]');
    if (!button) return;
    S.annotationStyle = [ANNOTATION_STYLE_POSTER, ANNOTATION_STYLE_TEXTBOX].includes(button.dataset.noteStyle)
      ? button.dataset.noteStyle
      : ANNOTATION_STYLE_CALLOUT;
    savePrefs();
    updateAnnotationStyleUI();
    const styleName = S.annotationStyle === ANNOTATION_STYLE_POSTER
      ? '后期文字'
      : S.annotationStyle === ANNOTATION_STYLE_TEXTBOX ? 'PPT 文本框' : '箭头标注';
    toast(`新注释使用“${styleName}”样式`, 1600);
  });
  $('rectFill').addEventListener('change', (e) => { S.rectFill = e.target.checked; });
  $('gridOverFill').addEventListener('change', (e) => {
    S.gridOverFill = e.target.checked;
    savePrefs();
    requestRender();
  });
  $('darkBorder').addEventListener('change', (e) => {
    S.darkBorder = e.target.checked;
    savePrefs();
    requestRender();
    toast(e.target.checked ? '已开启深色表格边框（导出图片会保留）' : '已关闭深色表格边框', 1800);
  });

  const toggle = (id, key, after) => {
    $(id).addEventListener('click', (e) => {
      S[key] = !S[key];
      e.currentTarget.classList.toggle('on', S[key]);
      if (after) after();
      requestRender();
    });
  };
  toggle('tglMirrorX', 'mirrorX');
  toggle('tglMirrorY', 'mirrorY');
  toggle('tglCenter', 'center');

  $('tglRepeat').addEventListener('change', (e) => { S.repeat = e.target.checked; requestRender(); });
  $('repeatW').addEventListener('change', (e) => {
    S.repeatW = clamp(parseInt(e.target.value, 10) || 20, 2, S.cols);
    e.target.value = String(S.repeatW);
    requestRender();
  });
  $('repeatH').addEventListener('change', (e) => {
    S.repeatH = clamp(parseInt(e.target.value, 10) || 20, 2, S.rows);
    e.target.value = String(S.repeatH);
    requestRender();
  });

  $('customColor').addEventListener('change', (e) => {
    selectColor(addColor(e.target.value, '自定义'));
  });

  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    loadFromFile(file);
  });

  // 手指/鼠标点画布时自动收起抽屉
  canvas.addEventListener('pointerdown', () => { if (isNarrow()) closeSidebar(); }, true);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (!pointers.size) { S.hover = null; updateStatus(); requestRender(); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', onWheel, { passive: false });

  $('modalRoot').addEventListener('click', (e) => {
    if (e.target === $('modalRoot') && closeModalFn) closeModalFn();
  });

  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe($('canvasWrap'));

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { spaceDown = false; $('canvasWrap').classList.remove('panning'); });
}

function onKeyDown(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

  if (e.key === 'Escape') {
    if (closeModalFn) { closeModalFn(); return; }
    if ($('sidebar').classList.contains('open')) { closeSidebar(); return; }
    if (floating) { cancelFloating(); return; }
    if (S.selection) { clearSelection(); return; }
  }
  if (e.key === 'Enter' && floating) { e.preventDefault(); commitFloating(); return; }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; $('canvasWrap').classList.add('panning'); }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    if (k === 's') { e.preventDefault(); saveDesign(); return; }
    if (k === 'a') { e.preventDefault(); selectAllCells(); return; }
    if (k === 'c') { e.preventDefault(); copySelection(); return; }
    if (k === 'x') { e.preventDefault(); cutSelection(); return; }
    if (k === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (k === '0') { e.preventDefault(); fitToWindow(); return; }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (S.selection) { e.preventDefault(); eraseSelection(); return; }
  }
  const k = e.key.toLowerCase();
  // Shift + H/V/R：翻转与旋转选区（普通 H/V/R 已用于工具切换）
  if (e.shiftKey) {
    if (k === 'h') { e.preventDefault(); transformSelection('flipH'); return; }
    if (k === 'v') { e.preventDefault(); transformSelection('flipV'); return; }
    if (k === 'r') { e.preventDefault(); transformSelection('rotate'); return; }
  }
  const map = { v: 'select', s: 'lasso', b: 'brush', e: 'eraser', g: 'fill', l: 'line', r: 'rect', i: 'eyedropper', n: 'note' };
  if (map[k]) { setTool(map[k]); return; }
  if (k === 'h') { setTool('pan'); return; }
  if (k >= '1' && k <= '9') {
    const i = Number(k);
    if (i < S.palette.length) selectColor(i);
    return;
  }
  const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (nudge[k]) {
    e.preventDefault();
    const [dx, dy] = nudge[k];
    const sel = normalizeSel(S.selection) || { c0: 0, c1: 0, r0: 0, r1: 0 };
    if (e.shiftKey) {
      S.selection = normalizeSel({ c0: sel.c0, r0: sel.r0, c1: sel.c1 + dx, r1: sel.r1 + dy });
    } else {
      const w = sel.c1 - sel.c0;
      const h = sel.r1 - sel.r0;
      const c = clamp(sel.c0 + dx, 0, Math.max(0, S.cols - 1 - w));
      const r = clamp(sel.r0 + dy, 0, Math.max(0, S.rows - 1 - h));
      S.selection = { c0: c, r0: r, c1: c + w, r1: r + h };
    }
    S.hover = { c: S.selection.c0, r: S.selection.r0 };
    ensureVisible({ c: S.selection.c0, r: S.selection.r0 });
    ensureVisible({ c: S.selection.c1, r: S.selection.r1 });
    updateStatus();
    requestRender();
  }
}

function ensureVisible(cell) {
  const x = offsetX() + cell.c * S.zoom;
  const y = offsetY() + cell.r * S.zoom;
  if (x < HEADER_W) S.panX += HEADER_W - x + 10;
  if (x + S.zoom > viewW) S.panX -= x + S.zoom - viewW + 10;
  if (y < HEADER_H) S.panY += HEADER_H - y + 10;
  if (y + S.zoom > viewH) S.panY -= y + S.zoom - viewH + 10;
  clampPan();
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    spaceDown = false;
    $('canvasWrap').classList.remove('panning');
  }
}

/* ============================================================
 * 启动
 * ============================================================ */
function init() {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    if (raw) recentColors = JSON.parse(raw).filter((c) => typeof c === 'string').slice(0, 12);
  } catch (_) { recentColors = []; }

  loadPrefs();
  loadClipboard();
  const gof = $('gridOverFill');
  if (gof) gof.checked = S.gridOverFill;
  const dbx = $('darkBorder');
  if (dbx) dbx.checked = S.darkBorder;

  buildPalette();
  renderRecent();
  updateCurrentColor();
  updateStats();
  updateAnnotationUI();
  updateTitle();
  updateHistoryButtons();
  bindUI();
  updateAnnotationStyleUI();
  resizeCanvas();
  setTool(S.tool);
  updateStatus();
  updateSelectionUI();

  const restored = loadAutosave();
  if (!restored) {
    newDesign(DEFAULT_COLS, DEFAULT_ROWS, '未命名花样');
    updateSaveStatus('点格子选中，再点颜色填色');
  } else if (countFilled() === 0 && S.cols === 200 && S.rows === 200) {
    // 空的旧草稿（上一版默认 200×200）：升级成新的默认 120×200
    newDesign(DEFAULT_COLS, DEFAULT_ROWS, S.designName);
  }
  fitToWindow();

  // 移动端首屏布局可能尚未稳定（Safari 地址栏、旋转等），下一帧再校正一次
  requestAnimationFrame(() => {
    const before = viewW + 'x' + viewH;
    resizeCanvas();
    if (before !== viewW + 'x' + viewH) fitToWindow();
  });

  try {
    if (!localStorage.getItem('mianxie.hint.v1')) {
      localStorage.setItem('mianxie.hint.v1', '1');
      setTimeout(() => toast('先点一下格子选中它，再点下面的颜色就能填色', 4200), 600);
    }
  } catch (_) { /* ignore */ }

  // iPad/iPhone 上提示一次"添加到主屏幕"，装完就是全屏 App 的样子
  try {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    if (isIOS && isSafari && !standalone && !localStorage.getItem('mianxie.a2hs.v1')) {
      localStorage.setItem('mianxie.a2hs.v1', '1');
      setTimeout(() => toast('想当 App 用？点 Safari 下方的「分享」→「添加到主屏幕」', 7500), 6000);
    }
  } catch (_) { /* ignore */ }

  if (!S.dirty) updateSaveStatus('本机自动保存已开启');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
