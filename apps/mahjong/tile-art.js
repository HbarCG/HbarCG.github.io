'use strict';

/*
 * 牌の見た目(SVG)を生成する。
 * 画像ファイルや外部フォント・サービスを追加せず、牌種ごとの描画規則から
 * その場でSVGを組み立てる。34種類すべてを手作業で絵として用意する代わりに、
 * 「どの牌が何のルールで描かれているか」がコードを読めばわかる状態を保つ。
 * このファイルは状態を持たない純粋関数のみで構成する(tiles.jsに依存)。
 */

const TILE_ART_VIEWBOX_W = 60;
const TILE_ART_VIEWBOX_H = 84;

const ART_BLUE = '#1f55a8';
const ART_RED = '#c8281f';
const ART_GREEN = '#1f8a4c';
const ART_DARK = '#27313d';
const TILE_FACE = '#fdfaf1';
const RED_FIVE_COLOR = ART_RED;

// 下の配置表で使う色の略号。
const LAYOUT_COLORS = { b: ART_BLUE, r: ART_RED, g: ART_GREEN };

// 筒子の配置。実物の牌と同じ並び方・色を、[x, y, 色] の一覧でそのまま書く。
// r は丸1つの半径(枚数が多いほど小さくする)。1pは専用の絵なのでここには無い。
const PIN_LAYOUTS = {
  2: { r: 10.5, pips: [[30, 23, 'b'], [30, 61, 'b']] },
  3: { r: 9.5, pips: [[15, 17, 'b'], [30, 42, 'r'], [45, 67, 'b']] },
  4: { r: 10, pips: [[17, 21, 'b'], [43, 21, 'b'], [17, 63, 'b'], [43, 63, 'b']] },
  5: { r: 9.5, pips: [[16, 17, 'b'], [44, 17, 'b'], [30, 42, 'r'], [16, 67, 'b'], [44, 67, 'b']] },
  6: { r: 8.5, pips: [
    [19, 16, 'r'], [41, 16, 'r'],
    [19, 47, 'b'], [41, 47, 'b'], [19, 67, 'b'], [41, 67, 'b'],
  ] },
  7: { r: 7.5, pips: [
    [14, 13, 'r'], [30, 19, 'r'], [46, 25, 'r'],
    [19, 48, 'b'], [41, 48, 'b'], [19, 67, 'b'], [41, 67, 'b'],
  ] },
  8: { r: 8, pips: [
    [20, 14, 'b'], [40, 14, 'b'], [20, 33, 'b'], [40, 33, 'b'],
    [20, 52, 'b'], [40, 52, 'b'], [20, 71, 'b'], [40, 71, 'b'],
  ] },
  9: { r: 8, pips: [
    [13, 16, 'b'], [30, 16, 'b'], [47, 16, 'b'],
    [13, 42, 'r'], [30, 42, 'r'], [47, 42, 'r'],
    [13, 68, 'b'], [30, 68, 'b'], [47, 68, 'b'],
  ] },
};

// 索子の配置。[x, y, 色, 傾き(度, 省略時0)] の一覧。h は竹1本の長さ。
// 8sだけは実物と同じく、上段が「M」、下段が「Λ」の形になるよう内側2本を傾ける。
const SOU_LAYOUTS = {
  2: { h: 26, sticks: [[30, 25, 'g'], [30, 59, 'g']] },
  3: { h: 26, sticks: [[30, 25, 'g'], [17, 59, 'g'], [43, 59, 'g']] },
  4: { h: 26, sticks: [[17, 25, 'g'], [43, 25, 'g'], [17, 59, 'g'], [43, 59, 'g']] },
  5: { h: 26, sticks: [[14, 25, 'g'], [46, 25, 'g'], [30, 42, 'r'], [14, 59, 'g'], [46, 59, 'g']] },
  6: { h: 26, sticks: [
    [14, 25, 'g'], [30, 25, 'g'], [46, 25, 'g'],
    [14, 59, 'g'], [30, 59, 'g'], [46, 59, 'g'],
  ] },
  7: { h: 21, sticks: [
    [30, 16, 'r'],
    [14, 41, 'g'], [30, 41, 'g'], [46, 41, 'g'],
    [14, 65, 'g'], [30, 65, 'g'], [46, 65, 'g'],
  ] },
  8: { h: 24, sticks: [
    [11, 25, 'g'], [24, 25, 'g', -28], [36, 25, 'g', 28], [49, 25, 'g'],
    [11, 59, 'g'], [24, 59, 'g', 28], [36, 59, 'g', -28], [49, 59, 'g'],
  ] },
  9: { h: 20, sticks: [
    [14, 16, 'g'], [30, 16, 'r'], [46, 16, 'g'],
    [14, 42, 'g'], [30, 42, 'r'], [46, 42, 'g'],
    [14, 68, 'g'], [30, 68, 'r'], [46, 68, 'g'],
  ] },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function tileBase() {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${TILE_ART_VIEWBOX_W} ${TILE_ART_VIEWBOX_H}`,
    class: 'mj-tile-art',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.appendChild(svgEl('rect', {
    x: 1, y: 1, width: TILE_ART_VIEWBOX_W - 2, height: TILE_ART_VIEWBOX_H - 2,
    rx: 6, ry: 6, fill: TILE_FACE, stroke: '#c9c2ac', 'stroke-width': 1.4,
  }));
  return svg;
}

function addText(svg, text, x, y, size, color) {
  const t = svgEl('text', {
    x, y, fill: color, 'font-size': size,
    'font-family': "'Yu Mincho', 'Hiragino Mincho ProN', serif",
    'font-weight': '700',
    'text-anchor': 'middle', 'dominant-baseline': 'central',
  });
  t.textContent = text;
  svg.appendChild(t);
}

const MAN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 萬子: 上に漢数字、下に「萬」。赤5は両方とも赤字にする(実物の赤ドラ牌と同じ表現)。
function buildManArt(svg, rank, isRed) {
  const numColor = isRed ? RED_FIVE_COLOR : '#1c1c1c';
  const manColor = isRed ? RED_FIVE_COLOR : '#8a2a12';
  addText(svg, MAN_NUMERALS[rank - 1], 30, 30, 24, numColor);
  addText(svg, '萬', 30, 60, 22, manColor);
}

// 点を円周上に等間隔で count 個並べる(筒子の縁取りや花模様に使う)。
function addRingOfDots(svg, cx, cy, ringR, count, dotR, color) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    svg.appendChild(svgEl('circle', {
      cx: cx + ringR * Math.cos(a), cy: cy + ringR * Math.sin(a), r: dotR, fill: color,
    }));
  }
}

// 筒子の丸1つ。実物と同じく「色付きの花形の縁 → 濃い輪 → 白い芯」の三重構造にする。
// 単なる色の点だと小さく表示したときに索子・字牌と区別しにくいため。
function drawPinPip(svg, cx, cy, r, color) {
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: color }));
  addRingOfDots(svg, cx, cy, r * 0.78, 8, r * 0.12, TILE_FACE);
  svg.appendChild(svgEl('circle', { cx, cy, r: r * 0.52, fill: ART_DARK }));
  svg.appendChild(svgEl('circle', { cx, cy, r: r * 0.24, fill: TILE_FACE }));
}

// 1p: 大きな丸。青い縁に白い点、内側は赤い花模様。
function buildPinOneArt(svg) {
  const cx = 30;
  const cy = 42;
  svg.appendChild(svgEl('circle', { cx, cy, r: 23, fill: ART_BLUE }));
  addRingOfDots(svg, cx, cy, 19, 12, 2.4, TILE_FACE);
  svg.appendChild(svgEl('circle', { cx, cy, r: 14.5, fill: TILE_FACE }));
  svg.appendChild(svgEl('circle', { cx, cy, r: 12.5, fill: ART_RED }));
  addRingOfDots(svg, cx, cy, 7.5, 6, 2.2, TILE_FACE);
  svg.appendChild(svgEl('circle', { cx, cy, r: 3.6, fill: TILE_FACE }));
  svg.appendChild(svgEl('circle', { cx, cy, r: 1.6, fill: ART_RED }));
}

// 筒子: PIN_LAYOUTS の位置・色で丸を並べる。赤5は全ての丸を赤にする(実物の赤ドラ牌の表現)。
function buildPinArt(svg, rank, isRed) {
  if (rank === 1) {
    buildPinOneArt(svg);
    return;
  }
  const layout = PIN_LAYOUTS[rank];
  for (const [x, y, color] of layout.pips) {
    drawPinPip(svg, x, y, layout.r, isRed ? RED_FIVE_COLOR : LAYOUT_COLORS[color]);
  }
}

// 索子の竹1本。両端と中央に濃い色の節、節の間に白い筋を入れて竹らしく見せる。
function drawSouStick(svg, cx, cy, h, color, angle) {
  const g = svgEl('g', angle ? { transform: `rotate(${angle} ${cx} ${cy})` } : {});
  const w = 7;
  const top = cy - h / 2;
  const capH = 2.6;
  g.appendChild(svgEl('rect', { x: cx - w / 2, y: top, width: w, height: h, rx: 1.5, fill: color }));
  for (const y of [top, cy - capH / 2, top + h - capH]) {
    g.appendChild(svgEl('rect', { x: cx - w / 2 - 0.5, y, width: w + 1, height: capH, rx: 0.8, fill: ART_DARK }));
  }
  const segH = h / 2 - capH * 1.5;
  for (const segTop of [top + capH, cy + capH / 2]) {
    g.appendChild(svgEl('rect', {
      x: cx - 0.6, y: segTop + segH * 0.3, width: 1.2, height: segH * 0.4, rx: 0.6, fill: TILE_FACE,
    }));
  }
  svg.appendChild(g);
}

// 1s: 実物に合わせて鳥(孔雀)の絵にする。緑の扇状の羽、白い胴、赤い足。
function buildSouOneArt(svg) {
  // 羽: 大きな円の上側に小さな円を重ねて、ふちをギザギザ(扇形)にする
  svg.appendChild(svgEl('circle', { cx: 30, cy: 30, r: 16, fill: ART_GREEN }));
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (Math.PI * i) / 6;
    svg.appendChild(svgEl('circle', {
      cx: 30 + 16 * Math.cos(a), cy: 30 + 16 * Math.sin(a), r: 4.5, fill: ART_GREEN,
    }));
  }
  for (const [x, y] of [[25, 20], [35, 20], [20, 27], [30, 27], [40, 27], [25, 34], [35, 34]]) {
    svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 2.2, fill: TILE_FACE }));
    svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 1, fill: ART_BLUE }));
  }
  // 胴と頭
  svg.appendChild(svgEl('ellipse', { cx: 30, cy: 56, rx: 11, ry: 10, fill: TILE_FACE, stroke: ART_BLUE, 'stroke-width': 1.8 }));
  svg.appendChild(svgEl('path', { d: 'M22 55 Q30 62 38 55 M24 60 Q30 66 36 60', fill: 'none', stroke: ART_BLUE, 'stroke-width': 1.4 }));
  svg.appendChild(svgEl('circle', { cx: 30, cy: 44, r: 5.5, fill: TILE_FACE, stroke: ART_BLUE, 'stroke-width': 1.6 }));
  svg.appendChild(svgEl('circle', { cx: 28.2, cy: 43.2, r: 1.1, fill: ART_DARK }));
  svg.appendChild(svgEl('path', { d: 'M31 45 L36 46.5 L31 48 Z', fill: ART_RED }));
  // 足
  svg.appendChild(svgEl('path', {
    d: 'M26 65 L25 75 M22 75 L28 75 M34 65 L35 75 M32 75 L38 75',
    fill: 'none', stroke: ART_RED, 'stroke-width': 1.8, 'stroke-linecap': 'round',
  }));
}

// 索子: SOU_LAYOUTS の位置・色・傾きで竹を並べる。赤5は全ての竹を赤にする。
function buildSouArt(svg, rank, isRed) {
  if (rank === 1) {
    buildSouOneArt(svg);
    return;
  }
  const layout = SOU_LAYOUTS[rank];
  for (const [x, y, color, angle] of layout.sticks) {
    drawSouStick(svg, x, y, layout.h, isRed ? RED_FIVE_COLOR : LAYOUT_COLORS[color], angle || 0);
  }
}

const HONOR_LABELS = { 27: '東', 28: '南', 29: '西', 30: '北', 31: '白', 32: '發', 33: '中' };
const HONOR_COLORS = { 27: '#1c1c1c', 28: '#1c1c1c', 29: '#1c1c1c', 30: '#1c1c1c', 31: '#1a5fb4', 32: '#2f7d3c', 33: '#c8281f' };

function buildHonorArt(svg, type) {
  addText(svg, HONOR_LABELS[type], 30, 44, 32, HONOR_COLORS[type]);
}

// 牌1枚分のSVG要素を組み立てて返す。
function buildTileArt(id) {
  const type = tileType(id);
  const suit = suitOfType(type);
  const rank = rankOfType(type);
  const isRed = isRedFive(id);
  const svg = tileBase();
  if (suit === 'm') buildManArt(svg, rank, isRed);
  else if (suit === 'p') buildPinArt(svg, rank, isRed);
  else if (suit === 's') buildSouArt(svg, rank, isRed);
  else buildHonorArt(svg, type);
  return svg;
}
