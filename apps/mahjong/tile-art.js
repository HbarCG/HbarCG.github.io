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

// 索子・筒子の点(牌)を並べる3x3グリッド。将棋の駒台のような単純な格子に
// マス番号(0-8, 左上から行優先)で位置を指定する。
const PIP_GRID_X0 = 9;
const PIP_GRID_Y0 = 15;
const PIP_GRID_W = 42;
const PIP_GRID_H = 56;

function gridPoint(cell) {
  const col = cell % 3;
  const row = Math.floor(cell / 3);
  return {
    x: PIP_GRID_X0 + (PIP_GRID_W * (col + 0.5)) / 3,
    y: PIP_GRID_Y0 + (PIP_GRID_H * (row + 0.5)) / 3,
  };
}

// 1〜9個の点を、サイコロ/トランプの目のような配置にするマス番号一覧。
const PIP_LAYOUTS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
  7: [0, 2, 3, 4, 5, 6, 8],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

const PIN_COLORS = ['#1a5fb4', '#b4381a', '#2f7d3c'];
const RED_FIVE_COLOR = '#c8281f';

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
    rx: 6, ry: 6, fill: '#fdfaf1', stroke: '#c9c2ac', 'stroke-width': 1.4,
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

// 筒子: 1pだけ的(まと)のような二重丸、それ以外は色付きの点をグリッド配置。
// 赤5は全ての点を赤にする(実物の赤ドラ牌の表現に合わせる)。
function buildPinArt(svg, rank, isRed) {
  if (rank === 1) {
    const c = gridPoint(4);
    svg.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r: 15, fill: isRed ? RED_FIVE_COLOR : '#1a5fb4' }));
    svg.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r: 10, fill: '#fdfaf1' }));
    svg.appendChild(svgEl('circle', { cx: c.x, cy: c.y, r: 5, fill: isRed ? RED_FIVE_COLOR : '#b4381a' }));
    return;
  }
  PIP_LAYOUTS[rank].forEach((cell, i) => {
    const p = gridPoint(cell);
    const color = isRed ? RED_FIVE_COLOR : PIN_COLORS[i % PIN_COLORS.length];
    svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 4.8, fill: color }));
  });
}

// 索子: 竹の棒をグリッド配置。1sだけ棒+丸で他と見分けやすくする。
// 赤5は全ての棒を赤にする。
function buildSouArt(svg, rank, isRed) {
  const stickColor = isRed ? RED_FIVE_COLOR : '#2f7d3c';
  const nodeColor = isRed ? '#8f1712' : '#1c4a24';
  function drawStick(cx, cy, h) {
    svg.appendChild(svgEl('rect', {
      x: cx - 2.6, y: cy - h / 2, width: 5.2, height: h, rx: 1.6, fill: stickColor,
    }));
    for (const t of [0.32, 0.68]) {
      svg.appendChild(svgEl('rect', {
        x: cx - 2.6, y: cy - h / 2 + h * t - 0.6, width: 5.2, height: 1.2, fill: nodeColor,
      }));
    }
  }
  if (rank === 1) {
    svg.appendChild(svgEl('circle', { cx: 30, cy: 24, r: 7.5, fill: stickColor }));
    drawStick(30, 50, 26);
    return;
  }
  for (const cell of PIP_LAYOUTS[rank]) {
    const p = gridPoint(cell);
    drawStick(p.x, p.y, 16);
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
