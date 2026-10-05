// 家康の憂鬱（試作版）のイラスト。すべてSVGをコードで描いている（画像ファイルや外部サービスは使わない）。
// 絵柄は浮世絵・切り絵ふうの平面的なもの。部品（城・家・人・松・霞など）を組み合わせて場面を作る。
//
//   IEYASU_ART.scene('fire')        … 出来事の場面（横長）。名前は SCENES の一覧を参照
//   IEYASU_ART.ieyasu('worry')      … 家康（神さま姿）の顔。'calm' / 'worry' / 'angry'
//   IEYASU_ART.shogun('華美')        … 将軍の顔。性格で着物の色が変わる
//   IEYASU_ART.child('慎重')         … 若君の顔
//   IEYASU_ART.iemitsu()             … 霊体の家光の顔（チュートリアルとガイドの案内役）
//   IEYASU_ART.retainer(3)           … 家臣の顔。数字で着物の色や顔つきが変わる
window.IEYASU_ART = (() => {
  'use strict';

  // 和の色
  const C = {
    paper: '#f4ecd8', ink: '#2a2422', ink2: '#4a3f3a', red: '#c0432c', red2: '#e0673c',
    gold: '#d4a63a', gold2: '#f0cf6a', blue: '#2e4a6b', navy: '#1c2740', sea: '#3d6b8c',
    green: '#5d7f4c', green2: '#3f5e3a', earth: '#a07a4f', earth2: '#7a5a3a', white: '#fbf7ee',
    grey: '#8a8580', wall: '#efe7d6', roof: '#3b3f4a', stone: '#9a948a', skin: '#f0d2b0',
    purple: '#6b4a7a', smoke: '#6f6a66',
  };

  let uid = 0;
  const id = (name) => `iy-${name}-${++uid}`;

  // ─────────────────────────────── 部品

  function sky(top, bottom) {
    const g = id('sky');
    return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
      <rect width="320" height="160" fill="url(#${g})"/>`;
  }

  function sun(x, y, r, color) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
  }

  function mountains(y, color, peaks = [[0, 30], [70, 10], [140, 34], [210, 8], [280, 28], [320, 18]]) {
    const pts = peaks.map(([px, h]) => `${px},${y - 40 + h}`).join(' L');
    return `<path d="M0,${y} L${pts} L320,${y} Z" fill="${color}"/>`;
  }

  function ground(y, color) {
    return `<rect x="0" y="${y}" width="320" height="${160 - y}" fill="${color}"/>`;
  }

  // 霞（浮世絵によく出てくる横長の雲）
  function kasumi(x, y, w, color = C.gold2, opacity = 0.85) {
    return `<rect x="${x}" y="${y}" width="${w}" height="9" rx="4.5" fill="${color}" opacity="${opacity}"/>
      <rect x="${x + w * 0.2}" y="${y + 6}" width="${w * 0.7}" height="8" rx="4" fill="${color}" opacity="${opacity}"/>`;
  }

  function roofShape(x, y, w, h, color) {
    // 反りのある屋根
    return `<path d="M${x - 6},${y + h} Q${x + w * 0.15},${y + h * 0.55} ${x + w * 0.22},${y}
      L${x + w * 0.78},${y} Q${x + w * 0.85},${y + h * 0.55} ${x + w + 6},${y + h} Z" fill="${color}"/>`;
  }

  function castle(x, baseY, s = 1, burning = false) {
    const w = (n) => n * s;
    let out = `<path d="M${x - w(34)},${baseY} L${x - w(26)},${baseY - w(16)} L${x + w(26)},${baseY - w(16)} L${x + w(34)},${baseY} Z" fill="${C.stone}"/>`;
    // 石垣の目地
    for (let i = 1; i < 4; i++) {
      out += `<line x1="${x - w(34) + w(2) * i}" y1="${baseY - w(4) * i}" x2="${x + w(34) - w(2) * i}" y2="${baseY - w(4) * i}" stroke="${C.grey}" stroke-width="${0.6 * s}"/>`;
    }
    let y = baseY - w(16);
    const tiers = [[44, 11], [32, 10], [20, 10]];
    for (const [tw, th] of tiers) {
      out += `<rect x="${x - w(tw / 2)}" y="${y - w(th)}" width="${w(tw)}" height="${w(th)}" fill="${C.wall}"/>`;
      out += `<rect x="${x - w(tw / 2) + w(3)}" y="${y - w(th) + w(3)}" width="${w(3)}" height="${w(3)}" fill="${C.ink}"/>
        <rect x="${x + w(tw / 2) - w(6)}" y="${y - w(th) + w(3)}" width="${w(3)}" height="${w(3)}" fill="${C.ink}"/>`;
      y -= w(th);
      out += roofShape(x - w(tw / 2) - w(2), y - w(6), w(tw + 4), w(6), C.roof);
      y -= w(6);
    }
    out += `<path d="M${x - w(7)},${y + w(1)} q${w(2)},${-w(6)} ${w(4)},${-w(2)} M${x + w(7)},${y + w(1)} q${-w(2)},${-w(6)} ${-w(4)},${-w(2)}" stroke="${C.gold}" stroke-width="${1.6 * s}" fill="none"/>`;
    if (burning) out += flames(x, baseY - w(30), 2.2 * s);
    return out;
  }

  function house(x, y, w = 26, h = 14, roof = C.roof, wall = C.wall) {
    return `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${wall}"/>
      <rect x="${x + w * 0.35}" y="${y - h * 0.65}" width="${w * 0.3}" height="${h * 0.65}" fill="${C.ink2}"/>
      ${roofShape(x - 1, y - h - 7, w + 2, 7, roof)}`;
  }

  function town(y, n = 8, roof = C.roof, start = 0, gap = 36) {
    let out = '';
    for (let i = 0; i < n; i++) out += house(start + i * gap + (i % 2) * 4, y + (i % 3), 26 + (i % 2) * 6, 13 + (i % 3) * 2, roof);
    return out;
  }

  function pine(x, y, s = 1) {
    return `<path d="M${x},${y} q${-3 * s},${-14 * s} ${2 * s},${-30 * s}" stroke="${C.earth2}" stroke-width="${3 * s}" fill="none"/>
      <ellipse cx="${x - 6 * s}" cy="${y - 22 * s}" rx="${12 * s}" ry="${4 * s}" fill="${C.green2}"/>
      <ellipse cx="${x + 7 * s}" cy="${y - 28 * s}" rx="${11 * s}" ry="${4 * s}" fill="${C.green2}"/>
      <ellipse cx="${x}" cy="${y - 34 * s}" rx="${9 * s}" ry="${3.5 * s}" fill="${C.green}"/>`;
  }

  // 人のシルエット。opts: kasa（笠）/ spear（竹槍）/ sword（刀）/ color
  function person(x, y, s = 1, opts = {}) {
    const color = opts.color || C.ink;
    let out = `<circle cx="${x}" cy="${y - 17 * s}" r="${3.4 * s}" fill="${opts.face || color}"/>
      <path d="M${x - 6 * s},${y} L${x - 4 * s},${y - 13 * s} Q${x},${y - 15 * s} ${x + 4 * s},${y - 13 * s} L${x + 6 * s},${y} Z" fill="${color}"/>`;
    if (opts.kasa) out += `<path d="M${x - 7 * s},${y - 18 * s} L${x},${y - 24 * s} L${x + 7 * s},${y - 18 * s} Z" fill="${C.earth}"/>`;
    if (opts.spear) out += `<line x1="${x + 5 * s}" y1="${y + 1 * s}" x2="${x + 9 * s}" y2="${y - 32 * s}" stroke="${C.earth2}" stroke-width="${1.4 * s}"/>`;
    if (opts.sword) out += `<line x1="${x - 7 * s}" y1="${y - 6 * s}" x2="${x + 8 * s}" y2="${y - 10 * s}" stroke="${C.ink2}" stroke-width="${1.2 * s}"/>`;
    if (opts.topknot) out += `<rect x="${x - 1 * s}" y="${y - 22.5 * s}" width="${2 * s}" height="${3 * s}" fill="${color}"/>`;
    return out;
  }

  function crowd(y, n, opts = {}, start = 20, gap = 22) {
    let out = '';
    for (let i = 0; i < n; i++) out += person(start + i * gap + (i % 2) * 5, y + (i % 3) * 3, 1 + (i % 3) * 0.08, opts);
    return out;
  }

  function flag(x, y, h, color, crest = true) {
    return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - h}" stroke="${C.ink}" stroke-width="1.4"/>
      <rect x="${x}" y="${y - h}" width="12" height="${h * 0.55}" fill="${color}"/>
      ${crest ? `<circle cx="${x + 6}" cy="${y - h + h * 0.22}" r="3.2" fill="none" stroke="${C.white}" stroke-width="1"/>` : ''}`;
  }

  function flames(x, y, s = 1) {
    return `<path d="M${x - 14 * s},${y + 10 * s} Q${x - 16 * s},${y - 6 * s} ${x - 6 * s},${y - 16 * s} Q${x - 6 * s},${y - 4 * s} ${x},${y - 8 * s}
      Q${x + 2 * s},${y - 22 * s} ${x + 10 * s},${y - 26 * s} Q${x + 8 * s},${y - 10 * s} ${x + 16 * s},${y - 4 * s} Q${x + 18 * s},${y + 6 * s} ${x + 12 * s},${y + 10 * s} Z" fill="${C.red2}"/>
      <path d="M${x - 7 * s},${y + 10 * s} Q${x - 8 * s},${y} ${x - 2 * s},${y - 6 * s} Q${x},${y + 1 * s} ${x + 4 * s},${y - 10 * s} Q${x + 9 * s},${y} ${x + 7 * s},${y + 10 * s} Z" fill="${C.gold2}"/>`;
  }

  function smoke(x, y, s = 1) {
    return `<g fill="${C.smoke}" opacity="0.55"><circle cx="${x}" cy="${y}" r="${9 * s}"/><circle cx="${x + 10 * s}" cy="${y - 10 * s}" r="${11 * s}"/>
      <circle cx="${x + 24 * s}" cy="${y - 20 * s}" r="${13 * s}"/></g>`;
  }

  function waves(y, color = C.sea, light = C.white) {
    let out = `<rect x="0" y="${y}" width="320" height="${160 - y}" fill="${color}"/>`;
    for (let row = 0; row < 3; row++) {
      for (let i = -1; i < 18; i++) {
        const cx = i * 20 + (row % 2) * 10;
        const cy = y + 8 + row * 10;
        out += `<path d="M${cx - 9},${cy} a9,9 0 0 1 18,0" fill="none" stroke="${light}" stroke-width="1" opacity="0.6"/>`;
      }
    }
    return out;
  }

  function ship(x, y, s = 1, sail = C.white) {
    return `<path d="M${x - 26 * s},${y - 8 * s} L${x + 26 * s},${y - 8 * s} L${x + 18 * s},${y} L${x - 20 * s},${y} Z" fill="${C.earth2}"/>
      <line x1="${x}" y1="${y - 8 * s}" x2="${x}" y2="${y - 44 * s}" stroke="${C.ink}" stroke-width="${1.5 * s}"/>
      <line x1="${x - 14 * s}" y1="${y - 8 * s}" x2="${x - 14 * s}" y2="${y - 34 * s}" stroke="${C.ink}" stroke-width="${1.2 * s}"/>
      <path d="M${x + 2 * s},${y - 42 * s} Q${x + 18 * s},${y - 28 * s} ${x + 2 * s},${y - 14 * s} Z" fill="${sail}"/>
      <path d="M${x - 12 * s},${y - 32 * s} Q${x - 2 * s},${y - 24 * s} ${x - 12 * s},${y - 14 * s} Z" fill="${sail}"/>`;
  }

  function blackShip(x, y, s = 1) {
    return `${smoke(x + 2 * s, y - 50 * s, 1.1 * s)}
      <path d="M${x - 50 * s},${y - 14 * s} L${x + 46 * s},${y - 14 * s} L${x + 38 * s},${y} L${x - 44 * s},${y} Z" fill="${C.ink}"/>
      <rect x="${x - 4 * s}" y="${y - 42 * s}" width="${8 * s}" height="${28 * s}" fill="${C.ink2}"/>
      <circle cx="${x - 26 * s}" cy="${y - 8 * s}" r="${7 * s}" fill="${C.ink2}" stroke="${C.grey}" stroke-width="${1 * s}"/>
      <line x1="${x - 30 * s}" y1="${y - 14 * s}" x2="${x - 30 * s}" y2="${y - 60 * s}" stroke="${C.ink}" stroke-width="${1.4 * s}"/>
      <line x1="${x + 26 * s}" y1="${y - 14 * s}" x2="${x + 26 * s}" y2="${y - 58 * s}" stroke="${C.ink}" stroke-width="${1.4 * s}"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${x - 36 * s + i * 20 * s}" y="${y - 12 * s}" width="${4 * s}" height="${3 * s}" fill="${C.gold}"/>`).join('')}`;
  }

  function torii(x, y, s = 1) {
    return `<rect x="${x - 18 * s}" y="${y - 30 * s}" width="${4 * s}" height="${30 * s}" fill="${C.red}"/>
      <rect x="${x + 14 * s}" y="${y - 30 * s}" width="${4 * s}" height="${30 * s}" fill="${C.red}"/>
      <rect x="${x - 22 * s}" y="${y - 25 * s}" width="${44 * s}" height="${3 * s}" fill="${C.red}"/>
      <path d="M${x - 27 * s},${y - 33 * s} Q${x},${y - 30 * s} ${x + 27 * s},${y - 33 * s} L${x + 25 * s},${y - 29 * s} L${x - 25 * s},${y - 29 * s} Z" fill="${C.ink}"/>`;
  }

  function shrine(x, y, s = 1, shine = true) {
    let out = `<rect x="${x - 34 * s}" y="${y - 6 * s}" width="${68 * s}" height="${6 * s}" fill="${C.stone}"/>
      <rect x="${x - 26 * s}" y="${y - 26 * s}" width="${52 * s}" height="${20 * s}" fill="${C.red}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${x - 22 * s + i * 10 * s}" y="${y - 23 * s}" width="${4 * s}" height="${14 * s}" fill="${C.gold}"/>`).join('')}
      ${roofShape(x - 30 * s, y - 38 * s, 60 * s, 12 * s, C.ink)}
      <path d="M${x - 8 * s},${y - 38 * s} L${x},${y - 46 * s} L${x + 8 * s},${y - 38 * s} Z" fill="${C.gold}"/>
      <rect x="${x - 22 * s}" y="${y - 30 * s}" width="${44 * s}" height="${2 * s}" fill="${C.gold}"/>`;
    if (shine) {
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * (i + 0.5)) / 8 + Math.PI;
        out += `<line x1="${x + Math.cos(a) * 52 * s}" y1="${y - 30 * s + Math.sin(a) * 34 * s}" x2="${x + Math.cos(a) * 66 * s}" y2="${y - 30 * s + Math.sin(a) * 44 * s}" stroke="${C.gold2}" stroke-width="${2 * s}" stroke-linecap="round"/>`;
      }
    }
    return out;
  }

  function rice(y, color, n = 26, dry = false) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = 6 + i * 12 + (i % 2) * 3;
      const h = dry ? 10 + (i % 3) * 2 : 16 + (i % 3) * 3;
      out += `<path d="M${x},${y} q${dry ? 4 : 2},${-h / 2} ${dry ? 7 : 5},${-h}" stroke="${color}" stroke-width="1.6" fill="none"/>`;
      if (!dry) out += `<ellipse cx="${x + 6}" cy="${y - h + 1}" rx="2.4" ry="4" fill="${C.gold}" transform="rotate(25 ${x + 6} ${y - h + 1})"/>`;
    }
    return out;
  }

  function koban(x, y, s = 1) {
    return `<ellipse cx="${x}" cy="${y}" rx="${7 * s}" ry="${10 * s}" fill="${C.gold}" stroke="${C.earth2}" stroke-width="${0.8 * s}"/>
      <line x1="${x - 4 * s}" y1="${y - 3 * s}" x2="${x + 4 * s}" y2="${y - 3 * s}" stroke="${C.earth2}" stroke-width="${0.6 * s}"/>
      <line x1="${x - 4 * s}" y1="${y + 3 * s}" x2="${x + 4 * s}" y2="${y + 3 * s}" stroke="${C.earth2}" stroke-width="${0.6 * s}"/>`;
  }

  function senryobako(x, y, s = 1) {
    return `<rect x="${x - 22 * s}" y="${y - 22 * s}" width="${44 * s}" height="${22 * s}" fill="${C.earth2}"/>
      <rect x="${x - 22 * s}" y="${y - 22 * s}" width="${44 * s}" height="${4 * s}" fill="${C.ink2}"/>
      <rect x="${x - 4 * s}" y="${y - 16 * s}" width="${8 * s}" height="${7 * s}" fill="${C.gold}"/>
      <line x1="${x - 22 * s}" y1="${y - 6 * s}" x2="${x + 22 * s}" y2="${y - 6 * s}" stroke="${C.ink2}" stroke-width="${1 * s}"/>`;
  }

  function andon(x, y, s = 1) {
    return `<circle cx="${x}" cy="${y - 14 * s}" r="${16 * s}" fill="${C.gold2}" opacity="0.25"/>
      <rect x="${x - 5 * s}" y="${y - 20 * s}" width="${10 * s}" height="${14 * s}" fill="${C.paper}" stroke="${C.ink2}" stroke-width="${0.8 * s}"/>
      <line x1="${x - 3 * s}" y1="${y - 6 * s}" x2="${x - 4 * s}" y2="${y}" stroke="${C.ink2}"/><line x1="${x + 3 * s}" y1="${y - 6 * s}" x2="${x + 4 * s}" y2="${y}" stroke="${C.ink2}"/>`;
  }

  function byobu(x, y, w, h, color = C.gold) {
    let out = '';
    const panel = w / 6;
    for (let i = 0; i < 6; i++) {
      out += `<rect x="${x + i * panel}" y="${y - h + (i % 2) * 2}" width="${panel}" height="${h}" fill="${color}" stroke="${C.earth2}" stroke-width="0.8"/>`;
    }
    out += `<path d="M${x + 6},${y - h * 0.35} q${w * 0.25},${-h * 0.35} ${w * 0.5},${-h * 0.1} t${w * 0.45},${-h * 0.2}" stroke="${C.green2}" stroke-width="3" fill="none"/>`;
    return out;
  }

  // 徳川の家紋（三つ葉葵）を簡略化したもの
  function aoi(x, y, r, color = C.gold) {
    const leaf = (deg) => `<path transform="rotate(${deg} ${x} ${y})" d="M${x},${y} C${x - r * 0.55},${y - r * 0.25} ${x - r * 0.55},${y - r * 0.85} ${x},${y - r * 0.85} C${x + r * 0.55},${y - r * 0.85} ${x + r * 0.55},${y - r * 0.25} ${x},${y} Z" fill="${color}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${r * 0.12}"/>${leaf(0)}${leaf(120)}${leaf(240)}`;
  }

  // 家康（神さま姿）を場面の中に小さく描く
  function ghost(x, y, s = 1) {
    return `<g opacity="0.92">
      <circle cx="${x}" cy="${y - 16 * s}" r="${15 * s}" fill="${C.gold2}" opacity="0.45"/>
      ${kasumi(x - 22 * s, y + 2 * s, 44 * s, C.white, 0.9)}
      <path d="M${x - 12 * s},${y + 4 * s} L${x - 9 * s},${y - 10 * s} Q${x},${y - 14 * s} ${x + 9 * s},${y - 10 * s} L${x + 12 * s},${y + 4 * s} Z" fill="${C.ink}"/>
      ${aoi(x, y - 4 * s, 3 * s)}
      <circle cx="${x}" cy="${y - 17 * s}" r="${6.5 * s}" fill="${C.skin}"/>
      <path d="M${x - 3 * s},${y - 13.5 * s} q${3 * s},${3 * s} ${6 * s},0" stroke="${C.white}" stroke-width="${1.4 * s}" fill="none"/>
      <path d="M${x - 3.5 * s},${y - 18 * s} l${2 * s},0 M${x + 1.5 * s},${y - 18 * s} l${2 * s},0" stroke="${C.ink}" stroke-width="${0.9 * s}"/>
      </g>`;
  }

  function wrap(body, label) {
    return `<svg viewBox="0 0 320 160" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  }

  // ─────────────────────────────── 場面

  const SCENES = {
    castle: ['城', () => sky('#cfe0e8', C.paper) + sun(258, 38, 16, C.red) + kasumi(20, 40, 90) + mountains(118, '#b7c4bd')
      + ground(118, C.green) + castle(160, 122, 1.35) + pine(52, 132, 1.1) + pine(282, 136, 0.9) + kasumi(170, 100, 120, C.white, 0.7)],

    fall: ['燃え落ちる城', () => sky(C.navy, '#4a2a2a') + sun(60, 34, 12, C.paper) + mountains(120, '#2a2030')
      + ground(120, '#2a2422') + smoke(170, 40, 1.4) + castle(160, 124, 1.35, true) + flames(84, 112, 1) + flames(238, 114, 1.1)
      + crowd(150, 6, { color: '#1a1414', spear: true }, 24, 52)],

    heaven: ['日光の山と雲の上の家康', () => sky('#f7e3b0', C.paper) + sun(160, 60, 34, C.gold2) + mountains(130, '#9fb0a5', [[0, 20], [60, 0], [120, 26], [200, 4], [260, 24], [320, 10]])
      + ground(130, C.green2) + kasumi(10, 108, 120, C.white, 0.9) + kasumi(190, 116, 120, C.white, 0.9) + ghost(160, 84, 2)],

    descend: ['江戸城へ降りる家康', () => sky('#2a3350', '#c9b98a') + sun(250, 30, 12, C.paper)
      + `<path d="M150,0 L110,160 L210,160 L170,0 Z" fill="${C.gold2}" opacity="0.25"/>`
      + mountains(124, '#5a6070') + ground(124, '#4a5a40') + castle(160, 128, 1.2)
      + ghost(160, 48, 1.4) + ghost(206, 64, 0.8) + kasumi(30, 90, 90, C.white, 0.6) + kasumi(210, 100, 90, C.white, 0.6)],

    shrine: ['東照宮', () => sky('#e9d9b8', C.paper) + mountains(116, '#b9b39a') + ground(116, C.green2)
      + pine(40, 130, 1.2) + pine(286, 132, 1.2) + shrine(160, 118, 1.3) + torii(160, 150, 0.9) + kasumi(16, 30, 100) + kasumi(210, 22, 90)],

    court: ['京の御所', () => sky('#efe2cf', C.paper) + kasumi(30, 26, 120, C.gold2) + ground(118, '#d8ccb4')
      + `<rect x="70" y="84" width="180" height="34" fill="${C.wall}"/>`
      + Array.from({ length: 14 }, (_, i) => `<line x1="${78 + i * 12}" y1="88" x2="${78 + i * 12}" y2="116" stroke="${C.earth}" stroke-width="1"/>`).join('')
      + roofShape(60, 62, 200, 22, '#7a5a44') + `<rect x="66" y="118" width="188" height="5" fill="${C.earth2}"/>`
      + pine(36, 130, 1) + `<circle cx="276" cy="112" r="10" fill="#d9879a"/><circle cx="288" cy="104" r="8" fill="#e6a2b2"/><line x1="282" y1="132" x2="282" y2="108" stroke="${C.earth2}" stroke-width="3"/>`
      + kasumi(170, 130, 130, C.gold2, 0.7)],

    fire: ['江戸の大火', () => sky('#5a2a22', '#c0602c') + smoke(60, 40, 1.6) + smoke(200, 30, 1.8)
      + ground(124, '#3a2a22') + town(126, 9, C.ink) + flames(50, 108, 1.3) + flames(140, 104, 1.6) + flames(230, 108, 1.4) + flames(300, 112, 1)
      + crowd(156, 7, { color: '#1a1414' }, 14, 46)],

    ship: ['南蛮船', () => sky('#cfe3ec', C.paper) + sun(64, 36, 14, C.red) + kasumi(150, 30, 120)
      + waves(110) + ship(180, 120, 1.6, C.white) + ship(70, 128, 0.8, C.paper)],

    blackship: ['異国の黒い船', () => sky('#7d8794', '#c9c4b8') + waves(108, '#2d4d63') + blackShip(196, 122, 1.25)
      + `<path d="M0,128 L60,120 L80,160 L0,160 Z" fill="${C.green2}"/>` + person(30, 134, 1, { sword: true, topknot: true }) + person(50, 130, 0.9, { topknot: true })],

    ronin: ['夜の町の浪人たち', () => sky(C.navy, '#3a4560') + sun(262, 34, 14, C.paper) + ground(122, '#2a2b36')
      + town(124, 9, '#1a1d26') + andon(250, 146, 1) + crowd(150, 5, { color: '#14161d', sword: true, topknot: true }, 40, 38)],

    mine: ['金山', () => sky('#d6dccf', C.paper) + mountains(140, '#8a7a62', [[0, 30], [80, -10], [170, 16], [250, -4], [320, 24]])
      + `<path d="M126,140 Q126,104 150,104 Q174,104 174,140 Z" fill="${C.ink}"/>` + `<rect x="124" y="100" width="52" height="5" fill="${C.earth2}"/>`
      + ground(150, C.earth) + senryobako(244, 152, 1.1) + koban(206, 146, 1) + koban(222, 140, 0.9) + person(92, 152, 1.2, { kasa: true })],

    hall: ['城の大広間', () => `<rect width="320" height="160" fill="${C.paper}"/>` + byobu(30, 100, 260, 60)
      + `<rect x="0" y="100" width="320" height="60" fill="#c9b98f"/>`
      + Array.from({ length: 6 }, (_, i) => `<line x1="${i * 64}" y1="100" x2="${i * 64 - 30}" y2="160" stroke="${C.earth}" stroke-width="1"/>`).join('')
      + person(100, 140, 1.5, { color: C.blue, topknot: true }) + person(220, 140, 1.5, { color: C.red, topknot: true })
      + `<rect x="148" y="104" width="24" height="12" fill="${C.ink2}"/>`],

    palanquin: ['姫の輿入れ', () => sky('#f1d9d9', C.paper) + kasumi(30, 28, 110, '#f3b8c2') + ground(118, '#d8c7a4')
      + pine(290, 128, 1) + `<rect x="138" y="96" width="44" height="26" rx="3" fill="${C.ink}"/>${aoi(160, 109, 6)}
        ${roofShape(134, 88, 52, 8, C.gold)}<line x1="100" y1="100" x2="220" y2="100" stroke="${C.earth2}" stroke-width="3"/>`
      + person(108, 132, 1, { color: C.blue }) + person(212, 132, 1, { color: C.blue })
      + crowd(140, 3, { color: C.red, topknot: true }, 24, 24) + crowd(140, 2, { color: C.red, topknot: true }, 248, 22)],

    harvest: ['豊作の田', () => sky('#cfe3ec', C.paper) + sun(270, 36, 16, C.red) + kasumi(30, 36, 120) + mountains(104, '#a9bba4')
      + ground(104, '#c9a85a') + rice(124, C.green2) + rice(146, C.green2) + rice(166, C.green2)
      + person(70, 118, 1.1, { kasa: true, color: C.blue }) + person(230, 116, 1, { kasa: true, color: C.blue })],

    famine: ['ひび割れた田', () => sky('#9a958d', '#cfc6b4') + sun(240, 40, 14, '#e6ddc9') + mountains(104, '#8f8a7e')
      + ground(104, '#b49a72') + `<path d="M20,130 l30,6 l20,-8 l40,10 M150,120 l26,14 l30,-6 M220,140 l40,-6 l30,10" stroke="${C.earth2}" stroke-width="1.4" fill="none"/>`
      + rice(126, '#8a7a5a', 12, true) + person(120, 152, 1.2, { kasa: true, color: C.ink2 }) + person(146, 154, 0.8, { color: C.ink2 })],

    river: ['大河の堤', () => sky('#c9dae4', C.paper) + kasumi(170, 26, 120) + mountains(90, '#a9b8b0') + ground(90, C.green)
      + `<path d="M0,112 Q160,96 320,116 L320,140 Q160,124 0,138 Z" fill="${C.sea}"/>`
      + `<path d="M0,110 Q160,94 320,114 L320,108 Q160,88 0,104 Z" fill="${C.earth}"/>`
      + crowd(158, 7, { kasa: true, color: C.blue }, 18, 44) + pine(296, 92, 0.8)],

    ikki: ['一揆', () => sky('#d9c7a8', C.paper) + ground(120, '#bfa880') + house(220, 122, 70, 26, C.roof)
      + flag(40, 132, 50, C.paper, false) + flag(120, 128, 46, C.paper, false)
      + `<text x="44" y="100" font-size="10" fill="${C.ink}" font-family="serif">一揆</text>`
      + crowd(156, 9, { kasa: true, spear: true, color: C.ink2 }, 14, 30)],

    sickbed: ['病の床', () => `<rect width="320" height="160" fill="#2a2a38"/>` + `<rect x="0" y="110" width="320" height="50" fill="#5a4a38"/>`
      + andon(250, 120, 1.6) + `<rect x="70" y="106" width="140" height="18" rx="4" fill="${C.paper}"/><rect x="70" y="100" width="100" height="14" rx="5" fill="${C.blue}"/>`
      + `<circle cx="190" cy="104" r="7" fill="${C.skin}"/><rect x="180" y="98" width="20" height="4" fill="${C.white}"/>`
      + person(120, 150, 1.4, { color: '#1d1d26', topknot: true })
      + `<rect x="26" y="26" width="64" height="64" fill="#d9cfb4" opacity="0.35"/><circle cx="58" cy="52" r="12" fill="${C.paper}" opacity="0.5"/>`
      + `<path d="M58,26 V90 M26,47 H90 M26,68 H90" stroke="#2a2a38" stroke-width="2"/>`],

    study: ['書物と学問', () => `<rect width="320" height="160" fill="${C.paper}"/>` + `<rect x="0" y="112" width="320" height="48" fill="#c9b98f"/>`
      + `<rect x="200" y="30" width="80" height="80" fill="#e8e0c8" stroke="${C.earth}" stroke-width="2"/><line x1="240" y1="30" x2="240" y2="110" stroke="${C.earth}" stroke-width="2"/><line x1="200" y1="70" x2="280" y2="70" stroke="${C.earth}" stroke-width="2"/>`
      + `<rect x="60" y="112" width="110" height="10" fill="${C.earth2}"/><rect x="66" y="122" width="6" height="14" fill="${C.earth2}"/><rect x="158" y="122" width="6" height="14" fill="${C.earth2}"/>`
      + `<rect x="80" y="104" width="40" height="8" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.8"/><rect x="128" y="100" width="26" height="12" fill="${C.blue}"/><rect x="130" y="96" width="22" height="4" fill="${C.red}"/>`
      + andon(40, 136, 1.2) + person(116, 158, 1.4, { color: C.green2, topknot: true })],

    earthquake: ['大地震', () => sky('#a8a29a', '#d8cfbe') + ground(122, '#a08a6a')
      + `<g transform="rotate(-8 70 120)">${house(40, 122, 50, 20, C.roof)}</g><g transform="rotate(10 220 120)">${house(200, 124, 60, 22, C.roof)}</g>`
      + `<path d="M140,122 l8,10 l-6,8 l10,8 l-4,12" stroke="${C.ink}" stroke-width="3" fill="none"/>` + smoke(110, 70, 1) + crowd(154, 5, { color: C.ink2 }, 30, 60)],

    money: ['千両箱と小判', () => `<rect width="320" height="160" fill="#efe4c6"/>` + `<rect x="0" y="118" width="320" height="42" fill="#b89a6a"/>`
      + senryobako(110, 130, 1.6) + senryobako(196, 132, 1.3) + koban(240, 140, 1) + koban(258, 146, 1) + koban(60, 146, 1)
      + `<rect x="250" y="44" width="40" height="56" fill="${C.white}" stroke="${C.ink2}"/><line x1="258" y1="54" x2="282" y2="54" stroke="${C.ink2}"/><line x1="258" y1="64" x2="282" y2="64" stroke="${C.ink2}"/><line x1="258" y1="74" x2="276" y2="74" stroke="${C.ink2}"/>`
      + person(40, 118, 1.2, { color: C.earth2, topknot: true })],

    road: ['街道と宿場', () => sky('#cfe0e8', C.paper) + sun(260, 34, 13, C.red) + mountains(96, '#b0bfb4', [[0, 24], [60, 8], [110, 30], [200, -18], [260, 20], [320, 10]])
      + ground(96, C.green)
      + `<path d="M140,96 L180,96 L260,160 L60,160 Z" fill="#d8c7a4"/>` + pine(70, 120, 1) + pine(250, 118, 1)
      + house(20, 150, 40, 18, C.roof) + house(270, 152, 44, 18, C.roof) + person(150, 130, 1, { kasa: true, color: C.blue }) + person(176, 146, 1.2, { kasa: true, color: C.earth2 })],

    banquet: ['華やかな大奥', () => `<rect width="320" height="160" fill="#3a2230"/>` + byobu(20, 100, 280, 64)
      + `<rect x="0" y="100" width="320" height="60" fill="#7a4a3a"/>`
      + andon(40, 140, 1.4) + andon(280, 140, 1.4)
      + crowd(146, 6, { color: C.red, face: C.skin }, 80, 32) + `<path d="M150,150 l20,0" stroke="${C.gold}" stroke-width="3"/>`],

    falcon: ['鷹狩り', () => sky('#d9e6ea', C.paper) + kasumi(30, 30, 100) + mountains(108, '#b5c3b6') + ground(108, '#a9b46e')
      + `<path d="M190,56 q12,-14 30,-10 q-10,4 -14,10 q14,-4 24,4 q-16,0 -24,8 Z" fill="${C.ink2}"/>`
      + person(110, 150, 1.6, { color: C.blue, topknot: true }) + `<line x1="118" y1="122" x2="132" y2="112" stroke="${C.ink}" stroke-width="3"/>`
      + pine(270, 140, 1.1) + crowd(152, 2, { color: C.earth2 }, 40, 22)],

    league: ['夜に集う大名たち', () => sky('#141a2c', '#2c2a3c') + sun(60, 34, 10, C.paper) + ground(118, '#1f1d24')
      + `<circle cx="160" cy="132" r="22" fill="${C.red2}" opacity="0.35"/>` + flames(160, 132, 0.8)
      + flag(60, 128, 64, C.red) + flag(100, 124, 60, C.blue) + flag(220, 124, 60, C.green2) + flag(260, 128, 64, C.purple)
      + crowd(156, 4, { color: '#0e0d12', topknot: true, sword: true }, 70, 60)],
  };

  function scene(name) {
    const entry = SCENES[name] || SCENES.castle;
    return wrap(entry[1](), entry[0]);
  }

  // ─────────────────────────────── 顔（四角い小さな絵）

  function portrait(body, label) {
    return `<svg viewBox="0 0 64 64" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  }

  function face(x, y, r, mood = 'calm', opts = {}) {
    const brow = {
      calm: `<path d="M${x - 8},${y - 5} q3,-2 6,0 M${x + 2},${y - 5} q3,-2 6,0" stroke="${C.ink}" stroke-width="1.3" fill="none"/>`,
      worry: `<path d="M${x - 8},${y - 4} q3,-4 6,-5 M${x + 2},${y - 9} q3,1 6,5" stroke="${C.ink}" stroke-width="1.3" fill="none"/>`,
      angry: `<path d="M${x - 8},${y - 8} l6,3 M${x + 8},${y - 8} l-6,3" stroke="${C.ink}" stroke-width="1.5" fill="none"/>`,
    }[mood];
    const eyes = mood === 'calm'
      ? `<path d="M${x - 7},${y} q2.5,2 5,0 M${x + 2},${y} q2.5,2 5,0" stroke="${C.ink}" stroke-width="1.3" fill="none"/>`
      : `<circle cx="${x - 4.5}" cy="${y}" r="1.4" fill="${C.ink}"/><circle cx="${x + 4.5}" cy="${y}" r="1.4" fill="${C.ink}"/>`;
    const mouth = {
      calm: `<path d="M${x - 3},${y + 7} q3,2 6,0" stroke="${C.ink}" stroke-width="1.2" fill="none"/>`,
      worry: `<path d="M${x - 4},${y + 8} q2,-2 4,0 q2,2 4,0" stroke="${C.ink}" stroke-width="1.2" fill="none"/>`,
      angry: `<path d="M${x - 4},${y + 8} l8,0" stroke="${C.ink}" stroke-width="1.4"/>`,
    }[mood];
    let out = `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.skin}"/>${brow}${eyes}${mouth}`;
    if (opts.cheeks) out += `<circle cx="${x - 8}" cy="${y + 4}" r="2.2" fill="#e8a090" opacity="0.6"/><circle cx="${x + 8}" cy="${y + 4}" r="2.2" fill="#e8a090" opacity="0.6"/>`;
    if (opts.beard) out += `<path d="M${x - 6},${y + 10} q6,7 12,0" fill="${C.white}" stroke="${C.grey}" stroke-width="0.6"/><path d="M${x - 6},${y + 5} q-3,1 -3,4 M${x + 6},${y + 5} q3,1 3,4" stroke="${C.white}" stroke-width="1.6" fill="none"/>`;
    return out;
  }

  function ieyasu(mood = 'calm') {
    return portrait(`<rect width="64" height="64" rx="10" fill="#f7e3b0"/>
      <circle cx="32" cy="30" r="24" fill="${C.gold2}" opacity="0.6"/>
      <path d="M8,64 L12,46 Q32,38 52,46 L56,64 Z" fill="${C.ink}"/>${aoi(32, 54, 5)}
      ${face(32, 30, 14, mood, { beard: true })}
      <path d="M18,24 Q20,12 32,11 Q44,12 46,24 Q40,18 32,18 Q24,18 18,24 Z" fill="${C.ink2}"/>
      ${kasumi(2, 56, 22, C.white, 0.9)}${kasumi(42, 58, 20, C.white, 0.9)}`, '家康');
  }

  const TRAIT_COLORS = { 慎重: C.blue, 豪胆: C.red, 寛大: C.green, 倹約: C.earth, 華美: C.purple };

  function shogun(trait) {
    const color = TRAIT_COLORS[trait] || C.blue;
    return portrait(`<rect width="64" height="64" rx="10" fill="#e9e1cc"/>
      <path d="M6,64 L10,46 Q32,38 54,46 L58,64 Z" fill="${color}"/>
      <path d="M24,44 L32,56 L40,44" stroke="${C.white}" stroke-width="2" fill="none"/>${aoi(20, 54, 3.5, C.gold)}${aoi(44, 54, 3.5, C.gold)}
      ${face(32, 30, 13, trait === '豪胆' ? 'angry' : 'calm')}
      <path d="M21,22 Q22,4 36,4 Q42,8 40,20 Z" fill="${C.ink}"/>
      <rect x="20" y="19" width="24" height="5" rx="2" fill="${C.ink}"/>`, `将軍（${trait}）`);
  }

  // 霊体の家光（チュートリアルとガイドの案内役）。光の輪と霞をまとう
  function iemitsu() {
    return portrait(`<rect width="64" height="64" rx="10" fill="#efe0f0"/>
      <circle cx="32" cy="28" r="24" fill="${C.gold2}" opacity="0.45"/>
      <path d="M6,64 L10,46 Q32,38 54,46 L58,64 Z" fill="${C.purple}" opacity="0.9"/>
      <path d="M24,44 L32,56 L40,44" stroke="${C.white}" stroke-width="2" fill="none"/>${aoi(20, 54, 3.5, C.gold)}${aoi(44, 54, 3.5, C.gold)}
      ${face(32, 30, 13, 'calm')}
      <path d="M21,22 Q22,4 36,4 Q42,8 40,20 Z" fill="${C.ink}"/>
      <rect x="20" y="19" width="24" height="5" rx="2" fill="${C.ink}"/>
      ${kasumi(2, 56, 22, C.white, 0.9)}${kasumi(40, 58, 22, C.white, 0.9)}`, '家光（霊体）');
  }

  function child(trait) {
    const color = TRAIT_COLORS[trait] || C.blue;
    return portrait(`<rect width="64" height="64" rx="10" fill="#f3ead6"/>
      <path d="M12,64 L15,48 Q32,42 49,48 L52,64 Z" fill="${color}"/>
      <path d="M26,46 L32,54 L38,46" stroke="${C.white}" stroke-width="2" fill="none"/>
      ${face(32, 33, 13, 'calm', { cheeks: true })}
      <path d="M19,30 Q18,16 32,16 Q46,16 45,30 Q42,22 32,22 Q22,22 19,30 Z" fill="${C.ink}"/>
      <ellipse cx="32" cy="17" rx="5" ry="3" fill="${C.ink}"/>`, `若君（${trait}）`);
  }

  // 家臣の顔。seed で着物の色と顔つきを少し変える（同じ家臣はいつも同じ顔になる）
  function retainer(seed = 0) {
    const robes = [C.ink2, C.blue, C.green2, C.earth2, '#5a4a6a', '#3a5a5a'];
    const robe = robes[seed % robes.length];
    const mood = seed % 5 === 3 ? 'angry' : 'calm';
    return portrait(`<rect width="64" height="64" rx="10" fill="#e4e0d4"/>
      <path d="M4,64 L8,46 Q32,38 56,46 L60,64 Z" fill="${robe}"/>
      <path d="M8,46 L2,40 L20,44 Z M56,46 L62,40 L44,44 Z" fill="${robe}"/>
      ${face(32, 30, 13, mood, { beard: seed % 4 === 1 })}
      <path d="M20,24 Q22,14 32,14 Q42,14 44,24 Q38,20 32,20 Q26,20 20,24 Z" fill="${C.ink}"/>
      <rect x="30" y="11" width="4" height="6" fill="${C.ink}"/>`, '家臣');
  }

  return { scene, ieyasu, iemitsu, shogun, child, retainer, sceneNames: Object.keys(SCENES) };
})();
