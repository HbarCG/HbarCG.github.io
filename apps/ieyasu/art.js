// 家康の憂鬱（試作版）のイラスト。すべてSVGをコードで描いている（画像ファイルや外部サービスは使わない）。
// 絵柄は浮世絵・錦絵ふう。部品（空・山・霞・城・家・人・松・波・炎など）を組み合わせて場面を作り、
// 最後に和紙の質感と、ふちの陰り、細い額縁を重ねる。
//
//   IEYASU_ART.scene('fire')        … 出来事の場面（横長）。名前は SCENES の一覧を参照
//   IEYASU_ART.scene('fire', 'bad') … 結果の絵。'good' なら金の光、'bad' なら曇り空と雨を重ねる
//   IEYASU_ART.edo({ level: 3, works: ['josui'] }) … 江戸の町。町の育ちと、終わった普請で絵が変わる
//   IEYASU_ART.ieyasu('worry')      … 家康（神さま姿）の顔。'calm' / 'worry' / 'angry'
//   IEYASU_ART.shogun('華美', 12, 55) … 将軍の顔。性格で着物の色が、人ごとの番号で顔つきが、歳で髪の白さとしわが変わる
//   IEYASU_ART.child('慎重', 12)     … 若君の顔（番号で顔つきが少し変わる）
//   IEYASU_ART.iemitsu()             … 霊体の家光の顔（チュートリアルとガイドの案内役）
//   IEYASU_ART.retainer(3)           … 家臣の顔。数字で着物の色や顔つきが変わる
window.IEYASU_ART = (() => {
  'use strict';

  // 和の色
  const C = {
    paper: '#f4ecd8', ink: '#2a2422', ink2: '#4a3f3a', red: '#c0432c', red2: '#e0673c',
    gold: '#d4a63a', gold2: '#f0cf6a', gold3: '#a87c22', blue: '#2e4a6b', navy: '#1c2740', sea: '#3d6b8c',
    green: '#5d7f4c', green2: '#3f5e3a', green3: '#2c4630', earth: '#a07a4f', earth2: '#7a5a3a', white: '#fbf7ee',
    grey: '#8a8580', wall: '#f3ecdc', roof: '#3b3f4a', roof2: '#555b68', stone: '#9a948a', stone2: '#7d776d',
    skin: '#f2d4b4', skin2: '#e2b994', purple: '#6b4a7a', smoke: '#6f6a66',
  };

  let uid = 0;
  const id = (name) => `iy-${name}-${++uid}`;

  // 色を明るく（amt > 0）・暗く（amt < 0）する
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  function linear(stops, vertical = true) {
    const g = id('lg');
    const dir = vertical ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="0"';
    return {
      id: g,
      def: `<linearGradient id="${g}" ${dir}>${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</linearGradient>`,
    };
  }

  function radial(stops) {
    const g = id('rg');
    return {
      id: g,
      def: `<radialGradient id="${g}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</radialGradient>`,
    };
  }

  // ─────────────────────────────── 背景の部品

  function sky(top, bottom) {
    const g = linear([[0, top], [0.65, shade(bottom, -0.03)], [1, bottom]]);
    const haze = linear([[0, bottom, 0], [1, '#ffffff', 0.35]]);
    return `<defs>${g.def}${haze.def}</defs><rect width="320" height="160" fill="url(#${g.id})"/>
      <rect y="70" width="320" height="60" fill="url(#${haze.id})"/>`;
  }

  function sun(x, y, r, color) {
    const glow = radial([[0, color, 0.55], [0.45, color, 0.18], [1, color, 0]]);
    return `<defs>${glow.def}</defs><circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="url(#${glow.id})"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>
      <circle cx="${x - r * 0.25}" cy="${y - r * 0.25}" r="${r * 0.55}" fill="#ffffff" opacity="0.18"/>`;
  }

  // なめらかな稜線の山。手前ほど濃く、上ほど明るい
  function mountains(y, color, peaks = [[0, 30], [70, 10], [140, 34], [210, 8], [280, 28], [320, 18]]) {
    const pts = peaks.map(([px, h]) => [px, y - 40 + h]);
    let d = `M0,${y} L${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2 + (y1 > y0 ? -4 : 4);
      d += ` Q${x0 + (x1 - x0) * 0.35},${Math.min(y0, y1) - 2} ${mx},${my} T${x1},${y1}`;
    }
    d += ` L320,${y} Z`;
    const g = linear([[0, shade(color, 0.25)], [1, shade(color, -0.08)]]);
    return `<defs>${g.def}</defs><path d="${d}" fill="url(#${g.id})"/>`;
  }

  function ground(y, color) {
    const g = linear([[0, shade(color, 0.08)], [1, shade(color, -0.2)]]);
    let tufts = '';
    for (let i = 0; i < 14; i++) {
      const tx = 8 + i * 23 + (i % 3) * 5;
      const ty = y + 6 + ((i * 7) % (160 - y - 8));
      tufts += `<path d="M${tx},${ty} l2,-4 M${tx + 3},${ty} l1,-5 M${tx + 6},${ty} l-1,-4" stroke="${shade(color, -0.25)}" stroke-width="0.8" opacity="0.6"/>`;
    }
    return `<defs>${g.def}</defs><rect x="0" y="${y}" width="320" height="${160 - y}" fill="url(#${g.id})"/>${tufts}`;
  }

  // 霞（浮世絵の金雲）。上のふちが丸く波打ち、輪郭線がつく
  function kasumi(x, y, w, color = C.gold2, opacity = 0.9) {
    const band = (bx, by, bw, bh) => {
      const bumps = Math.max(2, Math.round(bw / 14));
      const step = bw / bumps;
      let d = `M${bx},${by + bh} L${bx},${by + bh * 0.5}`;
      for (let i = 0; i < bumps; i++) d += ` a${step / 2},${bh * 0.5} 0 0 1 ${step},0`;
      d += ` L${bx + bw},${by + bh} Z`;
      return d;
    };
    const edge = shade(color, -0.3);
    const g = linear([[0, shade(color, 0.25)], [1, color]]);
    return `<defs>${g.def}</defs><g opacity="${opacity}">
      <path d="${band(x, y, w, 10)}" fill="url(#${g.id})" stroke="${edge}" stroke-width="0.7"/>
      <path d="${band(x + w * 0.18, y + 7, w * 0.7, 9)}" fill="url(#${g.id})" stroke="${edge}" stroke-width="0.7"/></g>`;
  }

  // ─────────────────────────────── 建物

  // 反りのある瓦屋根。瓦の筋と、棟の光
  function roofShape(x, y, w, h, color) {
    const g = linear([[0, shade(color, 0.2)], [1, shade(color, -0.15)]]);
    let tiles = '';
    const n = Math.max(3, Math.round(w / 6));
    for (let i = 1; i < n; i++) {
      const tx = x + (w * i) / n;
      tiles += `<line x1="${tx}" y1="${y + 1}" x2="${tx + (tx - (x + w / 2)) * 0.12}" y2="${y + h - 1}" stroke="${shade(color, -0.35)}" stroke-width="0.5" opacity="0.7"/>`;
    }
    return `<defs>${g.def}</defs><path d="M${x - 6},${y + h} Q${x + w * 0.15},${y + h * 0.55} ${x + w * 0.22},${y}
      L${x + w * 0.78},${y} Q${x + w * 0.85},${y + h * 0.55} ${x + w + 6},${y + h} Z" fill="url(#${g.id})"/>${tiles}
      <line x1="${x + w * 0.22}" y1="${y + 0.5}" x2="${x + w * 0.78}" y2="${y + 0.5}" stroke="${shade(color, 0.45)}" stroke-width="1"/>`;
  }

  function castle(x, baseY, s = 1, burning = false) {
    const w = (n) => n * s;
    // 石垣（裾が広がり、石組みが見える）
    const sg = linear([[0, shade(C.stone, 0.12)], [1, C.stone2]]);
    let out = `<defs>${sg.def}</defs><path d="M${x - w(36)},${baseY} Q${x - w(29)},${baseY - w(6)} ${x - w(26)},${baseY - w(17)} L${x + w(26)},${baseY - w(17)} Q${x + w(29)},${baseY - w(6)} ${x + w(36)},${baseY} Z" fill="url(#${sg.id})"/>`;
    for (let row = 0; row < 4; row++) {
      const ry = baseY - w(4) * row - w(4);
      const half = w(34) - w(2.2) * row;
      for (let bx = -half + (row % 2) * w(3); bx < half - w(3); bx += w(6)) {
        out += `<rect x="${x + bx}" y="${ry}" width="${w(5.4)}" height="${w(3.6)}" rx="${w(0.6)}" fill="none" stroke="${C.stone2}" stroke-width="${0.5 * s}" opacity="0.8"/>`;
      }
    }
    let y = baseY - w(17);
    const tiers = [[46, 12], [34, 11], [22, 11]];
    tiers.forEach(([tw, th], i) => {
      // 白壁と黒い下見板
      out += `<rect x="${x - w(tw / 2)}" y="${y - w(th)}" width="${w(tw)}" height="${w(th)}" fill="${C.wall}"/>
        <rect x="${x - w(tw / 2)}" y="${y - w(th * 0.42)}" width="${w(tw)}" height="${w(th * 0.42)}" fill="${C.ink2}"/>`;
      for (let k = 0; k < Math.floor(tw / 9); k++) {
        const wx = x - w(tw / 2) + w(4) + k * w(9);
        out += `<rect x="${wx}" y="${y - w(th) + w(2)}" width="${w(4)}" height="${w(3.2)}" fill="${C.ink}"/>
          <line x1="${wx + w(1.3)}" y1="${y - w(th) + w(2)}" x2="${wx + w(1.3)}" y2="${y - w(th) + w(5.2)}" stroke="${C.wall}" stroke-width="${0.4 * s}"/>
          <line x1="${wx + w(2.7)}" y1="${y - w(th) + w(2)}" x2="${wx + w(2.7)}" y2="${y - w(th) + w(5.2)}" stroke="${C.wall}" stroke-width="${0.4 * s}"/>`;
      }
      y -= w(th);
      out += roofShape(x - w(tw / 2) - w(2), y - w(6), w(tw + 4), w(6), C.roof);
      // 千鳥破風（三角の飾り屋根）
      if (i === 1) {
        out += `<path d="M${x - w(7)},${y - w(1)} L${x},${y - w(8)} L${x + w(7)},${y - w(1)} Z" fill="${C.wall}" stroke="${C.roof}" stroke-width="${1.4 * s}"/>
          <circle cx="${x}" cy="${y - w(3.5)}" r="${w(1.1)}" fill="${C.gold}"/>`;
      }
      y -= w(6);
    });
    // 金の鯱
    out += `<path d="M${x - w(8)},${y + w(1)} q${w(-1)},${-w(5)} ${w(3)},${-w(4)} q${w(-1)},${w(2)} ${w(1)},${w(3)} Z" fill="${C.gold}" stroke="${C.gold3}" stroke-width="${0.4 * s}"/>
      <path d="M${x + w(8)},${y + w(1)} q${w(1)},${-w(5)} ${w(-3)},${-w(4)} q${w(1)},${w(2)} ${w(-1)},${w(3)} Z" fill="${C.gold}" stroke="${C.gold3}" stroke-width="${0.4 * s}"/>`;
    if (burning) out += flames(x, baseY - w(32), 2.2 * s);
    return out;
  }

  function house(x, y, w = 26, h = 14, roof = C.roof, wall = C.wall) {
    let lattice = '';
    for (let i = 0; i < 4; i++) {
      lattice += `<line x1="${x + w * 0.08 + i * 2.2}" y1="${y - h * 0.7}" x2="${x + w * 0.08 + i * 2.2}" y2="${y - h * 0.25}" stroke="${C.earth2}" stroke-width="0.6"/>`;
    }
    return `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${wall}"/>
      <rect x="${x}" y="${y - h}" width="1.5" height="${h}" fill="${C.earth2}"/><rect x="${x + w - 1.5}" y="${y - h}" width="1.5" height="${h}" fill="${C.earth2}"/>
      <rect x="${x + w * 0.06}" y="${y - h * 0.72}" width="${w * 0.28}" height="${h * 0.5}" fill="${shade(wall, -0.12)}"/>${lattice}
      <rect x="${x + w * 0.45}" y="${y - h * 0.68}" width="${w * 0.32}" height="${h * 0.68}" fill="${C.ink2}"/>
      <rect x="${x + w * 0.45}" y="${y - h * 0.68}" width="${w * 0.32}" height="${h * 0.22}" fill="${C.blue}" opacity="0.85"/>
      ${roofShape(x - 1, y - h - 7, w + 2, 7, roof)}`;
  }

  function town(y, n = 8, roof = C.roof, start = 0, gap = 36) {
    let out = '';
    for (let i = 0; i < n; i++) out += house(start + i * gap + (i % 2) * 4, y + (i % 3), 26 + (i % 2) * 6, 13 + (i % 3) * 2, roof);
    return out;
  }

  function pine(x, y, s = 1) {
    const clump = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy + ry * 0.35}" rx="${rx}" ry="${ry}" fill="${C.green3}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.92}" ry="${ry * 0.85}" fill="${C.green2}"/>
      <ellipse cx="${cx - rx * 0.15}" cy="${cy - ry * 0.3}" rx="${rx * 0.6}" ry="${ry * 0.45}" fill="${C.green}"/>`;
    return `<path d="M${x - 2 * s},${y} q${-4 * s},${-14 * s} ${1 * s},${-30 * s} l${2.6 * s},0 q${-3 * s},${15 * s} ${2.4 * s},${30 * s} Z" fill="${C.earth2}"/>
      <path d="M${x},${y - 18 * s} q${-6 * s},${-2 * s} ${-10 * s},${-4 * s} M${x + 1 * s},${y - 24 * s} q${5 * s},${-2 * s} ${9 * s},${-4 * s}" stroke="${C.earth2}" stroke-width="${1.4 * s}" fill="none"/>
      ${clump(x - 9 * s, y - 22 * s, 11 * s, 4 * s)}${clump(x + 9 * s, y - 28 * s, 10 * s, 4 * s)}${clump(x + 1 * s, y - 35 * s, 8 * s, 3.4 * s)}`;
  }

  // ─────────────────────────────── 人

  // 着物姿の人。opts: color（着物）/ kasa（笠）/ spear（竹槍）/ sword（刀）/ topknot（髷）/ face（顔を描く）
  function person(x, y, s = 1, opts = {}) {
    const color = opts.color || C.ink;
    const dark = shade(color, -0.25);
    const head = opts.face ? C.skin : shade(color, -0.1);
    let out = `<path d="M${x - 6.5 * s},${y} L${x - 5 * s},${y - 9 * s} L${x - 8 * s},${y - 12.5 * s} Q${x - 4 * s},${y - 15.5 * s} ${x},${y - 14.5 * s}
        Q${x + 4 * s},${y - 15.5 * s} ${x + 8 * s},${y - 12.5 * s} L${x + 5 * s},${y - 9 * s} L${x + 6.5 * s},${y} Z" fill="${color}"/>
      <path d="M${x - 5 * s},${y - 8.5 * s} L${x + 5 * s},${y - 8.5 * s} L${x + 5.2 * s},${y - 6.8 * s} L${x - 5.2 * s},${y - 6.8 * s} Z" fill="${dark}"/>
      <path d="M${x - 2 * s},${y - 14.5 * s} L${x},${y - 10.5 * s} L${x + 2 * s},${y - 14.5 * s}" stroke="${C.white}" stroke-width="${0.7 * s}" fill="none" opacity="0.8"/>
      <circle cx="${x}" cy="${y - 17.6 * s}" r="${3.3 * s}" fill="${head}"/>`;
    if (opts.face) out += `<path d="M${x - 3.3 * s},${y - 18.6 * s} q${3.3 * s},${-3.4 * s} ${6.6 * s},0" fill="${C.ink}"/>`;
    if (opts.topknot) out += `<rect x="${x - 0.8 * s}" y="${y - 23 * s}" width="${1.6 * s}" height="${3 * s}" rx="${0.6 * s}" fill="${opts.face ? C.ink : dark}"/>`;
    if (opts.kasa) {
      out += `<path d="M${x - 8 * s},${y - 18.6 * s} Q${x},${y - 26 * s} ${x + 8 * s},${y - 18.6 * s} Z" fill="${C.earth}"/>
        <path d="M${x - 8 * s},${y - 18.6 * s} L${x + 8 * s},${y - 18.6 * s}" stroke="${C.earth2}" stroke-width="${0.6 * s}"/>
        <path d="M${x},${y - 23.6 * s} L${x - 4 * s},${y - 18.8 * s} M${x},${y - 23.6 * s} L${x + 4 * s},${y - 18.8 * s}" stroke="${C.earth2}" stroke-width="${0.4 * s}"/>`;
    }
    if (opts.spear) out += `<line x1="${x + 5 * s}" y1="${y + 1 * s}" x2="${x + 9 * s}" y2="${y - 32 * s}" stroke="${C.earth2}" stroke-width="${1.4 * s}"/>
      <path d="M${x + 9 * s},${y - 32 * s} l${-0.6 * s},${-4 * s} l${1.6 * s},${3.6 * s} Z" fill="${C.grey}"/>`;
    if (opts.sword) out += `<line x1="${x - 7 * s}" y1="${y - 6 * s}" x2="${x + 8 * s}" y2="${y - 10 * s}" stroke="${C.ink}" stroke-width="${1.3 * s}"/>
      <line x1="${x - 7 * s}" y1="${y - 6 * s}" x2="${x - 4.5 * s}" y2="${y - 6.7 * s}" stroke="${C.gold}" stroke-width="${1.3 * s}"/>`;
    return out;
  }

  function crowd(y, n, opts = {}, start = 20, gap = 22) {
    let out = '';
    for (let i = 0; i < n; i++) out += person(start + i * gap + (i % 2) * 5, y + (i % 3) * 3, 1 + (i % 3) * 0.08, opts);
    return out;
  }

  function flag(x, y, h, color, crest = true) {
    const g = linear([[0, shade(color, 0.15)], [1, shade(color, -0.15)]], false);
    return `<defs>${g.def}</defs><line x1="${x}" y1="${y}" x2="${x}" y2="${y - h}" stroke="${C.ink}" stroke-width="1.4"/>
      <line x1="${x}" y1="${y - h}" x2="${x + 13}" y2="${y - h}" stroke="${C.ink}" stroke-width="1"/>
      <path d="M${x},${y - h} L${x + 12},${y - h} L${x + 12},${y - h + h * 0.55} Q${x + 6},${y - h + h * 0.5} ${x},${y - h + h * 0.56} Z" fill="url(#${g.id})"/>
      ${crest ? `<circle cx="${x + 6}" cy="${y - h + h * 0.22}" r="3.2" fill="none" stroke="${C.white}" stroke-width="1"/><circle cx="${x + 6}" cy="${y - h + h * 0.22}" r="1.2" fill="${C.white}"/>` : ''}`;
  }

  // ─────────────────────────────── 火・煙・水

  function flames(x, y, s = 1) {
    const g = linear([[0, C.gold2], [0.5, C.red2], [1, C.red]]);
    return `<defs>${g.def}</defs>
      <path d="M${x - 14 * s},${y + 10 * s} Q${x - 16 * s},${y - 6 * s} ${x - 6 * s},${y - 16 * s} Q${x - 6 * s},${y - 4 * s} ${x},${y - 8 * s}
      Q${x + 2 * s},${y - 22 * s} ${x + 10 * s},${y - 26 * s} Q${x + 8 * s},${y - 10 * s} ${x + 16 * s},${y - 4 * s} Q${x + 18 * s},${y + 6 * s} ${x + 12 * s},${y + 10 * s} Z" fill="url(#${g.id})"/>
      <path d="M${x - 7 * s},${y + 10 * s} Q${x - 8 * s},${y} ${x - 2 * s},${y - 6 * s} Q${x},${y + 1 * s} ${x + 4 * s},${y - 10 * s} Q${x + 9 * s},${y} ${x + 7 * s},${y + 10 * s} Z" fill="${C.gold2}"/>
      <circle cx="${x - 10 * s}" cy="${y - 20 * s}" r="${0.9 * s}" fill="${C.gold2}"/><circle cx="${x + 14 * s}" cy="${y - 30 * s}" r="${0.7 * s}" fill="${C.gold2}"/><circle cx="${x + 2 * s}" cy="${y - 34 * s}" r="${0.8 * s}" fill="${C.red2}"/>`;
  }

  function smoke(x, y, s = 1) {
    return `<g fill="${C.smoke}"><circle cx="${x}" cy="${y}" r="${9 * s}" opacity="0.5"/><circle cx="${x + 10 * s}" cy="${y - 10 * s}" r="${11 * s}" opacity="0.45"/>
      <circle cx="${x + 24 * s}" cy="${y - 20 * s}" r="${13 * s}" opacity="0.38"/><circle cx="${x + 40 * s}" cy="${y - 26 * s}" r="${10 * s}" opacity="0.28"/>
      <circle cx="${x + 6 * s}" cy="${y - 4 * s}" r="${6 * s}" fill="#8f8a85" opacity="0.4"/></g>`;
  }

  // 青海波（半円を重ねた波の文様）
  function waves(y, color = C.sea, light = C.white) {
    const g = linear([[0, shade(color, 0.15)], [1, shade(color, -0.25)]]);
    let out = `<defs>${g.def}</defs><rect x="0" y="${y}" width="320" height="${160 - y}" fill="url(#${g.id})"/>`;
    const rows = Math.ceil((160 - y) / 9);
    for (let row = 0; row < rows; row++) {
      for (let i = -1; i < 18; i++) {
        const cx = i * 20 + (row % 2) * 10;
        const cy = y + 9 + row * 9;
        for (const r of [9, 6, 3]) {
          out += `<path d="M${cx - r},${cy} a${r},${r} 0 0 1 ${r * 2},0" fill="none" stroke="${light}" stroke-width="0.7" opacity="${0.25 + (row / rows) * 0.25}"/>`;
        }
      }
    }
    out += `<path d="M0,${y + 1} q20,-4 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="${light}" stroke-width="1.4" fill="none" opacity="0.7"/>`;
    return out;
  }

  // ─────────────────────────────── 船

  function ship(x, y, s = 1, sail = C.white) {
    let battens = '';
    for (let i = 1; i < 5; i++) battens += `<line x1="${x + 2 * s}" y1="${y - 42 * s + i * 6 * s}" x2="${x + 14 * s - Math.abs(i - 2.5) * 2 * s}" y2="${y - 42 * s + i * 6 * s}" stroke="${shade(sail, -0.25)}" stroke-width="${0.5 * s}"/>`;
    return `<path d="M${x - 28 * s},${y - 10 * s} L${x + 28 * s},${y - 10 * s} L${x + 20 * s},${y} L${x - 22 * s},${y} Z" fill="${C.earth2}"/>
      <line x1="${x - 24 * s}" y1="${y - 6 * s}" x2="${x + 24 * s}" y2="${y - 6 * s}" stroke="${shade(C.earth2, -0.3)}" stroke-width="${0.6 * s}"/>
      <rect x="${x - 18 * s}" y="${y - 15 * s}" width="${12 * s}" height="${5 * s}" fill="${C.earth}"/>
      <line x1="${x}" y1="${y - 10 * s}" x2="${x}" y2="${y - 46 * s}" stroke="${C.ink}" stroke-width="${1.5 * s}"/>
      <line x1="${x - 14 * s}" y1="${y - 10 * s}" x2="${x - 14 * s}" y2="${y - 36 * s}" stroke="${C.ink}" stroke-width="${1.2 * s}"/>
      <path d="M${x + 2 * s},${y - 42 * s} Q${x + 18 * s},${y - 28 * s} ${x + 2 * s},${y - 14 * s} Z" fill="${sail}"/>${battens}
      <path d="M${x - 12 * s},${y - 34 * s} Q${x - 2 * s},${y - 25 * s} ${x - 12 * s},${y - 15 * s} Z" fill="${sail}"/>
      <path d="M${x},${y - 46 * s} l${8 * s},${2 * s} l${-8 * s},${2 * s} Z" fill="${C.red}"/>`;
  }

  function blackShip(x, y, s = 1) {
    return `${smoke(x + 2 * s, y - 52 * s, 1.1 * s)}
      <path d="M${x - 50 * s},${y - 14 * s} L${x + 46 * s},${y - 14 * s} L${x + 38 * s},${y} L${x - 44 * s},${y} Z" fill="${C.ink}"/>
      <line x1="${x - 46 * s}" y1="${y - 9 * s}" x2="${x + 42 * s}" y2="${y - 9 * s}" stroke="#4a4a50" stroke-width="${0.7 * s}"/>
      <rect x="${x - 4 * s}" y="${y - 42 * s}" width="${8 * s}" height="${28 * s}" fill="${C.ink2}"/><rect x="${x - 5 * s}" y="${y - 44 * s}" width="${10 * s}" height="${3 * s}" fill="${C.ink}"/>
      <circle cx="${x - 26 * s}" cy="${y - 10 * s}" r="${8 * s}" fill="${C.ink2}" stroke="${C.grey}" stroke-width="${1 * s}"/>
      ${[0, 45, 90, 135].map((a) => `<line x1="${x - 26 * s}" y1="${y - 10 * s}" x2="${x - 26 * s + Math.cos((a * Math.PI) / 180) * 8 * s}" y2="${y - 10 * s + Math.sin((a * Math.PI) / 180) * 8 * s}" stroke="${C.grey}" stroke-width="${0.6 * s}"/>`).join('')}
      <line x1="${x - 30 * s}" y1="${y - 14 * s}" x2="${x - 30 * s}" y2="${y - 62 * s}" stroke="${C.ink}" stroke-width="${1.4 * s}"/>
      <line x1="${x + 26 * s}" y1="${y - 14 * s}" x2="${x + 26 * s}" y2="${y - 60 * s}" stroke="${C.ink}" stroke-width="${1.4 * s}"/>
      <line x1="${x - 38 * s}" y1="${y - 50 * s}" x2="${x - 22 * s}" y2="${y - 50 * s}" stroke="${C.ink}" stroke-width="${1 * s}"/>
      <line x1="${x + 18 * s}" y1="${y - 48 * s}" x2="${x + 34 * s}" y2="${y - 48 * s}" stroke="${C.ink}" stroke-width="${1 * s}"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${x - 36 * s + i * 20 * s}" y="${y - 12 * s}" width="${4 * s}" height="${3 * s}" fill="${C.gold}"/>`).join('')}`;
  }

  // 異国の三本帆柱の帆船（白船・赤船）。hull: 船体の色 / sail: 帆の色 / guns: 舷側の砲門の数
  function gaisen(x, y, s = 1, hull = C.white, sail = C.white, guns = 0) {
    const h = (dx) => x + dx * s;
    const v = (dy) => y + dy * s;
    const edge = shade(hull, -0.4);
    const sailEdge = shade(sail, -0.3);
    // 船体（反り上がった船首と、高い船尾）
    let out = `<path d="M${h(-58)},${v(-30)} L${h(-44)},${v(-30)} L${h(-40)},${v(-18)} L${h(40)},${v(-18)} L${h(56)},${v(-26)} L${h(48)},${v(-10)} L${h(38)},${v(0)} L${h(-40)},${v(0)} L${h(-52)},${v(-14)} Z"
      fill="${hull}" stroke="${edge}" stroke-width="${0.8 * s}"/>
      <line x1="${h(-46)}" y1="${v(-10)}" x2="${h(46)}" y2="${v(-10)}" stroke="${edge}" stroke-width="${0.9 * s}"/>`;
    for (let i = 0; i < guns; i++) {
      out += `<rect x="${h(-32 + i * 11)}" y="${v(-8)}" width="${4 * s}" height="${3 * s}" fill="${C.ink}"/>`;
    }
    // 船首の斜めの帆柱と三角帆
    out += `<line x1="${h(46)}" y1="${v(-20)}" x2="${h(72)}" y2="${v(-34)}" stroke="${C.earth2}" stroke-width="${1.1 * s}"/>
      <path d="M${h(34)},${v(-58)} L${h(68)},${v(-33)} L${h(38)},${v(-24)} Z" fill="${sail}" stroke="${sailEdge}" stroke-width="${0.5 * s}"/>`;
    // 三本の帆柱と、重なった横帆
    for (const [mx, top] of [[-26, -66], [4, -78], [30, -62]]) {
      out += `<line x1="${h(mx)}" y1="${v(-18)}" x2="${h(mx)}" y2="${v(top)}" stroke="${C.earth2}" stroke-width="${1.4 * s}"/>`;
      [13, 11, 8].forEach((w, row) => {
        const yy = top + 6 + row * 13;
        out += `<path d="M${h(mx - w)},${v(yy)} L${h(mx + w)},${v(yy)} Q${h(mx + w + 2.5)},${v(yy + 6)} ${h(mx + w - 1)},${v(yy + 11)} L${h(mx - w + 1)},${v(yy + 11)} Q${h(mx - w - 2.5)},${v(yy + 6)} ${h(mx - w)},${v(yy)} Z"
          fill="${sail}" stroke="${sailEdge}" stroke-width="${0.5 * s}"/>`;
      });
      out += `<path d="M${h(mx)},${v(top)} l${6 * s},${2 * s} l${-6 * s},${2 * s} Z" fill="${C.red}"/>`;
    }
    return out;
  }

  // 大砲の煙
  function cannonSmoke(x, y, s = 1) {
    return `<circle cx="${x}" cy="${y}" r="${5 * s}" fill="#e8e2d6" opacity="0.85"/><circle cx="${x + 6 * s}" cy="${y - 3 * s}" r="${4 * s}" fill="#e8e2d6" opacity="0.75"/>
      <circle cx="${x + 11 * s}" cy="${y - 1 * s}" r="${3 * s}" fill="#e8e2d6" opacity="0.6"/>`;
  }

  // 岸の見張り（遠見番所）
  function lookout(x, y, s = 1) {
    return `<line x1="${x - 8 * s}" y1="${y}" x2="${x - 5 * s}" y2="${y - 34 * s}" stroke="${C.earth2}" stroke-width="${1.6 * s}"/>
      <line x1="${x + 8 * s}" y1="${y}" x2="${x + 5 * s}" y2="${y - 34 * s}" stroke="${C.earth2}" stroke-width="${1.6 * s}"/>
      <line x1="${x - 7 * s}" y1="${y - 12 * s}" x2="${x + 7 * s}" y2="${y - 24 * s}" stroke="${C.earth2}" stroke-width="${1 * s}"/>
      <line x1="${x + 7 * s}" y1="${y - 12 * s}" x2="${x - 7 * s}" y2="${y - 24 * s}" stroke="${C.earth2}" stroke-width="${1 * s}"/>
      <rect x="${x - 9 * s}" y="${y - 40 * s}" width="${18 * s}" height="${7 * s}" fill="${C.earth}"/>
      ${roofShape(x - 11 * s, y - 48 * s, 22 * s, 8 * s, C.roof)}`;
  }

  // ─────────────────────────────── 社と道具

  function torii(x, y, s = 1) {
    return `<rect x="${x - 18 * s}" y="${y - 30 * s}" width="${4 * s}" height="${30 * s}" fill="${C.red}"/>
      <rect x="${x + 14 * s}" y="${y - 30 * s}" width="${4 * s}" height="${30 * s}" fill="${C.red}"/>
      <rect x="${x - 22 * s}" y="${y - 25 * s}" width="${44 * s}" height="${3 * s}" fill="${C.red}"/>
      <rect x="${x - 2 * s}" y="${y - 29 * s}" width="${4 * s}" height="${4 * s}" fill="${C.ink}"/>
      <path d="M${x - 28 * s},${y - 34 * s} Q${x},${y - 30 * s} ${x + 28 * s},${y - 34 * s} L${x + 26 * s},${y - 29 * s} L${x - 26 * s},${y - 29 * s} Z" fill="${C.ink}"/>
      <rect x="${x - 19 * s}" y="${y - 4 * s}" width="${6 * s}" height="${4 * s}" fill="${C.ink}"/><rect x="${x + 13 * s}" y="${y - 4 * s}" width="${6 * s}" height="${4 * s}" fill="${C.ink}"/>`;
  }

  function shrine(x, y, s = 1, shine = true) {
    let out = '';
    if (shine) {
      const glow = radial([[0, C.gold2, 0.5], [1, C.gold2, 0]]);
      out += `<defs>${glow.def}</defs><circle cx="${x}" cy="${y - 30 * s}" r="${70 * s}" fill="url(#${glow.id})"/>`;
      for (let i = 0; i < 9; i++) {
        const a = (Math.PI * (i + 0.5)) / 9 + Math.PI;
        out += `<line x1="${x + Math.cos(a) * 54 * s}" y1="${y - 30 * s + Math.sin(a) * 36 * s}" x2="${x + Math.cos(a) * 68 * s}" y2="${y - 30 * s + Math.sin(a) * 46 * s}" stroke="${C.gold2}" stroke-width="${2 * s}" stroke-linecap="round"/>`;
      }
    }
    out += `<rect x="${x - 36 * s}" y="${y - 6 * s}" width="${72 * s}" height="${6 * s}" fill="${C.stone}"/>
      <rect x="${x - 36 * s}" y="${y - 6 * s}" width="${72 * s}" height="${1.2 * s}" fill="${shade(C.stone, 0.3)}"/>
      <rect x="${x - 26 * s}" y="${y - 26 * s}" width="${52 * s}" height="${20 * s}" fill="${C.red}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${x - 22 * s + i * 10 * s}" y="${y - 23 * s}" width="${4 * s}" height="${14 * s}" fill="${C.gold}"/>
        <rect x="${x - 21 * s + i * 10 * s}" y="${y - 21 * s}" width="${2 * s}" height="${10 * s}" fill="${C.green2}"/>`).join('')}
      <rect x="${x - 28 * s}" y="${y - 30 * s}" width="${56 * s}" height="${4 * s}" fill="${C.gold}"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${x - 24 * s + i * 8 * s}" cy="${y - 28 * s}" r="${1.1 * s}" fill="${C.red}"/>`).join('')}
      ${roofShape(x - 30 * s, y - 40 * s, 60 * s, 12 * s, C.ink)}
      <path d="M${x - 10 * s},${y - 40 * s} L${x},${y - 49 * s} L${x + 10 * s},${y - 40 * s} Z" fill="${C.gold}" stroke="${C.gold3}" stroke-width="${0.6 * s}"/>
      <circle cx="${x}" cy="${y - 43 * s}" r="${1.8 * s}" fill="${C.red}"/>`;
    return out;
  }

  function rice(y, color, n = 26, dry = false) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = 6 + i * 12 + (i % 2) * 3;
      const h = dry ? 10 + (i % 3) * 2 : 16 + (i % 3) * 3;
      out += `<path d="M${x},${y} q${dry ? 4 : 2},${-h / 2} ${dry ? 7 : 5},${-h}" stroke="${color}" stroke-width="1.6" fill="none"/>
        <path d="M${x + 1},${y - h * 0.3} q${-4},${-3} ${-6},${-1}" stroke="${color}" stroke-width="1" fill="none"/>`;
      if (!dry) {
        out += `<ellipse cx="${x + 6}" cy="${y - h + 1}" rx="2.4" ry="4.4" fill="${C.gold}" transform="rotate(25 ${x + 6} ${y - h + 1})"/>
          <ellipse cx="${x + 5.4}" cy="${y - h}" rx="0.9" ry="2.4" fill="${C.gold2}" transform="rotate(25 ${x + 6} ${y - h + 1})"/>`;
      }
    }
    return out;
  }

  function koban(x, y, s = 1) {
    const g = linear([[0, C.gold2], [1, C.gold]], false);
    return `<defs>${g.def}</defs><ellipse cx="${x}" cy="${y}" rx="${7 * s}" ry="${10 * s}" fill="url(#${g.id})" stroke="${C.gold3}" stroke-width="${0.8 * s}"/>
      ${[-5, -2, 1, 4].map((d) => `<line x1="${x - 4.5 * s}" y1="${y + d * s}" x2="${x + 4.5 * s}" y2="${y + d * s}" stroke="${C.gold3}" stroke-width="${0.45 * s}"/>`).join('')}
      <ellipse cx="${x - 2 * s}" cy="${y - 5 * s}" rx="${1.6 * s}" ry="${2.6 * s}" fill="#ffffff" opacity="0.35"/>`;
  }

  function senryobako(x, y, s = 1) {
    return `<rect x="${x - 22 * s}" y="${y - 22 * s}" width="${44 * s}" height="${22 * s}" fill="${C.earth2}"/>
      <rect x="${x - 22 * s}" y="${y - 22 * s}" width="${44 * s}" height="${4 * s}" fill="${C.ink2}"/>
      <rect x="${x - 22 * s}" y="${y - 22 * s}" width="${3 * s}" height="${22 * s}" fill="${C.ink2}"/><rect x="${x + 19 * s}" y="${y - 22 * s}" width="${3 * s}" height="${22 * s}" fill="${C.ink2}"/>
      <rect x="${x - 4 * s}" y="${y - 16 * s}" width="${8 * s}" height="${7 * s}" fill="${C.gold}" stroke="${C.gold3}" stroke-width="${0.5 * s}"/>
      <line x1="${x - 22 * s}" y1="${y - 6 * s}" x2="${x + 22 * s}" y2="${y - 6 * s}" stroke="${C.ink2}" stroke-width="${1 * s}"/>
      <text x="${x}" y="${y - 3 * s}" font-size="${4.5 * s}" text-anchor="middle" fill="${C.gold2}" font-family="serif">千両</text>`;
  }

  function andon(x, y, s = 1) {
    const glow = radial([[0, C.gold2, 0.55], [1, C.gold2, 0]]);
    return `<defs>${glow.def}</defs><circle cx="${x}" cy="${y - 14 * s}" r="${24 * s}" fill="url(#${glow.id})"/>
      <rect x="${x - 5 * s}" y="${y - 20 * s}" width="${10 * s}" height="${14 * s}" fill="#fff6dc" stroke="${C.ink2}" stroke-width="${0.8 * s}"/>
      <line x1="${x}" y1="${y - 20 * s}" x2="${x}" y2="${y - 6 * s}" stroke="${C.ink2}" stroke-width="${0.5 * s}"/>
      <rect x="${x - 6 * s}" y="${y - 21 * s}" width="${12 * s}" height="${1.6 * s}" fill="${C.ink2}"/>
      <line x1="${x - 3 * s}" y1="${y - 6 * s}" x2="${x - 4 * s}" y2="${y}" stroke="${C.ink2}"/><line x1="${x + 3 * s}" y1="${y - 6 * s}" x2="${x + 4 * s}" y2="${y}" stroke="${C.ink2}"/>`;
  }

  // 金屏風（金地に松と雲）
  function byobu(x, y, w, h, color = C.gold) {
    const g = linear([[0, C.gold2], [1, color]]);
    let out = `<defs>${g.def}</defs>`;
    const panel = w / 6;
    for (let i = 0; i < 6; i++) {
      out += `<rect x="${x + i * panel}" y="${y - h + (i % 2) * 2}" width="${panel}" height="${h}" fill="url(#${g.id})" stroke="${C.earth2}" stroke-width="0.8"/>`;
    }
    out += kasumi(x + w * 0.05, y - h * 0.82, w * 0.35, C.white, 0.5) + kasumi(x + w * 0.55, y - h * 0.62, w * 0.35, C.white, 0.5);
    out += `<path d="M${x + 6},${y - h * 0.35} q${w * 0.25},${-h * 0.35} ${w * 0.5},${-h * 0.1} t${w * 0.45},${-h * 0.2}" stroke="${C.green2}" stroke-width="3" fill="none"/>
      ${pine(x + w * 0.22, y - h * 0.08, 0.8)}`;
    return out;
  }

  // 徳川の家紋（三つ葉葵）を簡略化したもの
  function aoi(x, y, r, color = C.gold) {
    const leaf = (deg) => `<path transform="rotate(${deg} ${x} ${y})" d="M${x},${y} C${x - r * 0.55},${y - r * 0.25} ${x - r * 0.55},${y - r * 0.85} ${x},${y - r * 0.85} C${x + r * 0.55},${y - r * 0.85} ${x + r * 0.55},${y - r * 0.25} ${x},${y} Z" fill="${color}"/>
      <line transform="rotate(${deg} ${x} ${y})" x1="${x}" y1="${y - r * 0.15}" x2="${x}" y2="${y - r * 0.75}" stroke="${shade(color, -0.35)}" stroke-width="${r * 0.08}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${r * 0.12}"/>${leaf(0)}${leaf(120)}${leaf(240)}`;
  }

  // 家康（神さま姿）を場面の中に小さく描く
  function ghost(x, y, s = 1) {
    const halo = radial([[0, C.gold2, 0.9], [0.6, C.gold2, 0.35], [1, C.gold2, 0]]);
    return `<defs>${halo.def}</defs><g>
      <circle cx="${x}" cy="${y - 16 * s}" r="${20 * s}" fill="url(#${halo.id})"/>
      <path d="M${x - 13 * s},${y + 4 * s} L${x - 9 * s},${y - 10 * s} Q${x},${y - 14 * s} ${x + 9 * s},${y - 10 * s} L${x + 13 * s},${y + 4 * s} Z" fill="${C.ink}"/>
      <path d="M${x - 2.5 * s},${y - 12 * s} L${x},${y - 6 * s} L${x + 2.5 * s},${y - 12 * s}" stroke="${C.white}" stroke-width="${0.8 * s}" fill="none"/>
      ${aoi(x - 6 * s, y - 4 * s, 2.2 * s)}${aoi(x + 6 * s, y - 4 * s, 2.2 * s)}
      <circle cx="${x}" cy="${y - 17 * s}" r="${6.5 * s}" fill="${C.skin}"/>
      <path d="M${x - 6.6 * s},${y - 18 * s} Q${x - 6 * s},${y - 25 * s} ${x},${y - 24.5 * s} Q${x + 6 * s},${y - 25 * s} ${x + 6.6 * s},${y - 18 * s} Q${x + 3 * s},${y - 21 * s} ${x},${y - 21 * s} Q${x - 3 * s},${y - 21 * s} ${x - 6.6 * s},${y - 18 * s} Z" fill="${C.ink2}"/>
      <path d="M${x - 3 * s},${y - 13.5 * s} q${3 * s},${4 * s} ${6 * s},0" stroke="${C.white}" stroke-width="${1.6 * s}" fill="none"/>
      <path d="M${x - 3.5 * s},${y - 18 * s} q${1 * s},${1 * s} ${2 * s},0 M${x + 1.5 * s},${y - 18 * s} q${1 * s},${1 * s} ${2 * s},0" stroke="${C.ink}" stroke-width="${0.8 * s}" fill="none"/>
      ${kasumi(x - 22 * s, y + 2 * s, 44 * s, C.white, 0.95)}
      </g>`;
  }

  // 米俵
  function tawara(x, y, s = 1) {
    return `<ellipse cx="${x}" cy="${y}" rx="${11 * s}" ry="${7 * s}" fill="#d8bf83" stroke="${C.earth2}" stroke-width="${0.7 * s}"/>
      ${[-6, 0, 6].map((d) => `<line x1="${x + d * s}" y1="${y - 6.5 * s}" x2="${x + d * s}" y2="${y + 6.5 * s}" stroke="${C.earth2}" stroke-width="${0.9 * s}"/>`).join('')}
      <ellipse cx="${x - 11 * s}" cy="${y}" rx="${2.4 * s}" ry="${6 * s}" fill="#c9ab6a" stroke="${C.earth2}" stroke-width="${0.6 * s}"/>`;
  }

  // 桜の木（幹と、薄紅の花のかたまり）
  function sakuraTree(x, y, s = 1) {
    const blossom = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6c3cf"/><circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.6}" fill="#fbdde4"/>`;
    return `<path d="M${x - 3 * s},${y} Q${x - 2 * s},${y - 14 * s} ${x - 8 * s},${y - 26 * s} M${x + 2 * s},${y} Q${x + 3 * s},${y - 16 * s} ${x + 10 * s},${y - 28 * s}" stroke="#5a3f34" stroke-width="${3 * s}" fill="none" stroke-linecap="round"/>
      ${blossom(x - 12 * s, y - 30 * s, 11 * s)}${blossom(x + 12 * s, y - 32 * s, 12 * s)}${blossom(x, y - 40 * s, 12 * s)}${blossom(x - 22 * s, y - 22 * s, 8 * s)}${blossom(x + 22 * s, y - 24 * s, 8 * s)}`;
  }

  // 散る花びら（乱数は使わない）
  function petals(n = 30, seed = 2) {
    let out = '<g fill="#f6c3cf">';
    for (let i = 0; i < n; i++) {
      const x = (i * 59 + seed * 13) % 320;
      const y = (i * 31 + seed * 7) % 150;
      out += `<ellipse cx="${x}" cy="${y}" rx="1.8" ry="1" transform="rotate(${(i * 37) % 180} ${x} ${y})" opacity="${0.6 + (i % 3) * 0.12}"/>`;
    }
    return `${out}</g>`;
  }

  // 象（横向き。鼻を少し持ち上げている）
  function elephant(x, y, s = 1) {
    const body = '#8a8e94';
    const dark = '#6c7076';
    return `<rect x="${x - 26 * s}" y="${y - 18 * s}" width="${9 * s}" height="${18 * s}" rx="${2 * s}" fill="${dark}"/>
      <rect x="${x + 12 * s}" y="${y - 18 * s}" width="${9 * s}" height="${18 * s}" rx="${2 * s}" fill="${dark}"/>
      <ellipse cx="${x - 4 * s}" cy="${y - 26 * s}" rx="${30 * s}" ry="${17 * s}" fill="${body}"/>
      <rect x="${x - 18 * s}" y="${y - 16 * s}" width="${9 * s}" height="${16 * s}" rx="${2 * s}" fill="${body}"/>
      <rect x="${x + 4 * s}" y="${y - 16 * s}" width="${9 * s}" height="${16 * s}" rx="${2 * s}" fill="${body}"/>
      <path d="M${x - 33 * s},${y - 28 * s} q${-6 * s},${2 * s} ${-5 * s},${10 * s}" stroke="${dark}" stroke-width="${1.6 * s}" fill="none"/>
      <circle cx="${x + 26 * s}" cy="${y - 34 * s}" r="${13 * s}" fill="${body}"/>
      <path d="M${x + 36 * s},${y - 30 * s} Q${x + 44 * s},${y - 16 * s} ${x + 40 * s},${y - 6 * s} Q${x + 46 * s},${y - 4 * s} ${x + 48 * s},${y - 12 * s}" stroke="${body}" stroke-width="${6 * s}" fill="none" stroke-linecap="round"/>
      <ellipse cx="${x + 18 * s}" cy="${y - 33 * s}" rx="${8 * s}" ry="${11 * s}" fill="${dark}"/>
      <path d="M${x + 34 * s},${y - 26 * s} q${5 * s},${3 * s} ${8 * s},${1 * s}" stroke="${C.white}" stroke-width="${2 * s}" fill="none" stroke-linecap="round"/>
      <circle cx="${x + 30 * s}" cy="${y - 38 * s}" r="${1.4 * s}" fill="${C.ink}"/>
      <path d="M${x - 16 * s},${y - 42 * s} L${x + 8 * s},${y - 42 * s} L${x + 6 * s},${y - 30 * s} L${x - 14 * s},${y - 30 * s} Z" fill="${C.red}"/>
      <path d="M${x - 16 * s},${y - 42 * s} L${x + 8 * s},${y - 42 * s}" stroke="${C.gold}" stroke-width="${1.6 * s}"/>`;
  }

  // 相撲の土俵と、組み合う二人の力士
  function dohyo(x, y, s = 1) {
    const rikishi = (cx, dir, color) => `<ellipse cx="${cx}" cy="${y - 20 * s}" rx="${11 * s}" ry="${13 * s}" fill="${C.skin2}"/>
      <rect x="${cx - 10 * s}" y="${y - 14 * s}" width="${20 * s}" height="${5 * s}" fill="${color}"/>
      <rect x="${cx - 8 * s}" y="${y - 9 * s}" width="${5 * s}" height="${9 * s}" fill="${C.skin2}"/><rect x="${cx + 3 * s}" y="${y - 9 * s}" width="${5 * s}" height="${9 * s}" fill="${C.skin2}"/>
      <circle cx="${cx + dir * 6 * s}" cy="${y - 36 * s}" r="${5.5 * s}" fill="${C.skin2}"/>
      <path d="M${cx + dir * 4 * s},${y - 42 * s} q${dir * 2 * s},${-3 * s} ${dir * 5 * s},${-1 * s}" stroke="${C.ink}" stroke-width="${2.4 * s}" fill="none"/>`;
    return `<ellipse cx="${x}" cy="${y}" rx="${70 * s}" ry="${12 * s}" fill="#c8a870"/>
      <ellipse cx="${x}" cy="${y}" rx="${56 * s}" ry="${9 * s}" fill="none" stroke="#efe2c0" stroke-width="${2 * s}"/>
      ${rikishi(x - 11 * s, 1, C.blue)}${rikishi(x + 11 * s, -1, C.red)}`;
  }

  // 降る雪（同じ場面ではいつも同じ降り方になるよう、乱数は使わない）
  function snowfall(n = 60, seed = 3) {
    let out = '<g fill="#ffffff">';
    for (let i = 0; i < n; i++) {
      out += `<circle cx="${(i * 53 + seed * 17) % 320}" cy="${(i * 37 + seed * 11) % 150}" r="${0.8 + (i % 3) * 0.5}" opacity="${0.55 + (i % 4) * 0.1}"/>`;
    }
    return `${out}</g>`;
  }

  // 打ち上げ花火（中心と半径）
  function firework(x, y, r, color) {
    const glow = radial([[0, color, 0.35], [1, color, 0]]);
    let out = `<defs>${glow.def}</defs><circle cx="${x}" cy="${y}" r="${r * 1.3}" fill="url(#${glow.id})"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16;
      const x2 = x + Math.cos(a) * r;
      const y2 = y + Math.sin(a) * r;
      out += `<line x1="${x + Math.cos(a) * r * 0.25}" y1="${y + Math.sin(a) * r * 0.25}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity="0.9"/>
        <circle cx="${x2}" cy="${y2}" r="1.3" fill="${color}"/>`;
    }
    return out;
  }

  // 台車に載った大砲。dir が -1 なら左向き
  function cannon(x, y, s = 1, dir = 1) {
    return `<rect x="${x - 6 * s}" y="${y - 4 * s}" width="${12 * s}" height="${4 * s}" fill="${C.earth2}"/>
      <circle cx="${x - 4 * s}" cy="${y}" r="${2.4 * s}" fill="${C.ink2}"/><circle cx="${x + 4 * s}" cy="${y}" r="${2.4 * s}" fill="${C.ink2}"/>
      <path d="M${x - 5 * s * dir},${y - 7 * s} L${x + 14 * s * dir},${y - 10 * s} L${x + 14 * s * dir},${y - 6 * s} L${x - 5 * s * dir},${y - 3 * s} Z" fill="${C.ink}"/>`;
  }

  // 屋形船（ちょうちんを下げた川遊びの船）
  function yakatabune(x, y, s = 1) {
    return `<path d="M${x - 24 * s},${y - 6 * s} L${x + 24 * s},${y - 6 * s} L${x + 18 * s},${y} L${x - 20 * s},${y} Z" fill="${C.earth2}"/>
      <rect x="${x - 15 * s}" y="${y - 16 * s}" width="${30 * s}" height="${10 * s}" fill="#f6e2b0" opacity="0.9"/>
      ${roofShape(x - 17 * s, y - 21 * s, 34 * s, 5 * s, C.roof)}
      ${[-10, 0, 10].map((d) => `<circle cx="${x + d * s}" cy="${y - 11 * s}" r="${2 * s}" fill="${C.red2}"/>`).join('')}`;
  }

  // 結果の絵。'good' は金の光と金雲、'bad' は曇り空と雨を、場面の上に重ねる
  function outcomeLayer(outcome) {
    if (outcome === 'good') {
      let rays = '';
      for (let i = 0; i < 10; i++) {
        const a1 = (Math.PI * (28 + i * 13.5)) / 180;
        const a2 = a1 + Math.PI / 60;
        rays += `<path d="M160,-14 L${160 + Math.cos(a1) * 260},${-14 + Math.sin(a1) * 260} L${160 + Math.cos(a2) * 260},${-14 + Math.sin(a2) * 260} Z" fill="${C.gold2}" opacity="0.16"/>`;
      }
      return `${rays}${kasumi(-6, 4, 96, C.gold2, 0.9)}${kasumi(228, 8, 96, C.gold2, 0.9)}`;
    }
    if (outcome === 'bad') {
      let rain = '';
      for (let i = 0; i < 70; i++) {
        const x = ((i * 41) % 330) - 5;
        const y = (i * 23) % 160;
        rain += `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 12}" stroke="#c8d0d8" stroke-width="0.7" opacity="0.55"/>`;
      }
      const cloud = (cx, cy, s) => `<g fill="#4a4c56" opacity="0.85"><ellipse cx="${cx}" cy="${cy}" rx="${34 * s}" ry="${12 * s}"/>
        <ellipse cx="${cx - 20 * s}" cy="${cy + 4 * s}" rx="${22 * s}" ry="${9 * s}"/><ellipse cx="${cx + 22 * s}" cy="${cy + 3 * s}" rx="${24 * s}" ry="${10 * s}"/></g>`;
      return `<rect width="320" height="160" fill="#2a2c36" opacity="0.3"/>${cloud(70, 8, 1.2)}${cloud(220, 4, 1.4)}${rain}`;
    }
    return '';
  }

  // 場面の仕上げ：和紙の質感、ふちの陰り、細い額縁
  function wrap(body, label) {
    const paper = id('paper');
    const vig = radial([[0.55, '#000000', 0], [1, '#2a1a10', 0.28]]);
    return `<svg viewBox="0 0 320 160" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="${paper}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise"/>
          <feColorMatrix in="noise" values="0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.24  0 0 0 0.16 0"/>
        </filter>
        ${vig.def}
      </defs>
      ${body}
      <rect width="320" height="160" filter="url(#${paper})"/>
      <rect width="320" height="160" fill="url(#${vig.id})"/>
      <rect x="3" y="3" width="314" height="154" fill="none" stroke="#fff6e0" stroke-width="1" opacity="0.45"/>
    </svg>`;
  }

  // ─────────────────────────────── 場面

  const SCENES = {
    castle: ['城', () => sky('#bcd4e0', C.paper) + sun(258, 38, 16, C.red) + kasumi(20, 40, 90) + mountains(118, '#a9bab2')
      + ground(118, C.green) + castle(160, 124, 1.35) + pine(52, 134, 1.1) + pine(282, 138, 0.9) + kasumi(170, 104, 120, C.white, 0.75)],

    fall: ['燃え落ちる城', () => sky(C.navy, '#5a2a22') + sun(60, 34, 12, C.paper) + mountains(120, '#2a2030')
      + ground(120, '#2a2422') + smoke(150, 40, 1.6) + castle(160, 124, 1.35, true) + flames(84, 112, 1) + flames(238, 114, 1.1)
      + crowd(152, 6, { color: '#1a1414', spear: true }, 24, 52)],

    heaven: ['日光の山と雲の上の家康', () => sky('#f3d79a', C.paper) + sun(160, 60, 34, C.gold2) + mountains(130, '#94a89a', [[0, 20], [60, 0], [120, 26], [200, 4], [260, 24], [320, 10]])
      + ground(130, C.green2) + kasumi(10, 108, 120, C.white, 0.95) + kasumi(190, 116, 120, C.white, 0.95) + ghost(160, 84, 2)],

    descend: ['江戸城へ降りる家康', () => sky('#232c48', '#c9b98a') + sun(250, 30, 12, C.paper)
      + `<path d="M150,0 L104,160 L216,160 L170,0 Z" fill="${C.gold2}" opacity="0.22"/><path d="M156,0 L132,160 L188,160 L164,0 Z" fill="${C.gold2}" opacity="0.18"/>`
      + mountains(124, '#4f5668') + ground(124, '#3f4e38') + castle(160, 128, 1.2)
      + ghost(160, 48, 1.4) + ghost(208, 66, 0.8) + kasumi(26, 90, 90, C.white, 0.6) + kasumi(210, 100, 90, C.white, 0.6)],

    comet: ['夜空のほうき星', () => sky('#0e1430', '#2e3658')
      + Array.from({ length: 24 }, (_, i) => `<circle cx="${(i * 53) % 320}" cy="${(i * 29) % 90}" r="${0.5 + (i % 3) * 0.4}" fill="#fff6dc" opacity="${0.4 + (i % 4) * 0.15}"/>`).join('')
      + (() => {
        const tail = linear([[0, '#fff6dc', 0], [1, '#fff6dc', 0.85]], false);
        return `<defs>${tail.def}</defs><path d="M40,8 L226,62 L222,70 Z" fill="url(#${tail.id})"/><path d="M70,4 L226,64 L230,58 Z" fill="url(#${tail.id})" opacity="0.6"/>`;
      })()
      + sun(228, 64, 5, '#fff6dc') + mountains(120, '#262c44') + ground(122, '#1c1f2c') + town(124, 9, '#141722')
      + crowd(156, 5, { color: '#10121a' }, 50, 50)],

    shrine: ['東照宮', () => sky('#e6d2a8', C.paper) + mountains(116, '#a8a38a') + ground(116, C.green2)
      + pine(40, 132, 1.2) + pine(286, 134, 1.2) + shrine(160, 118, 1.3) + torii(160, 152, 0.9) + kasumi(16, 30, 100) + kasumi(210, 22, 90)],

    court: ['京の御所', () => sky('#ecdcc4', C.paper) + kasumi(30, 26, 120) + ground(118, '#d8ccb4')
      + `<rect x="70" y="84" width="180" height="34" fill="${C.wall}"/>`
      + Array.from({ length: 14 }, (_, i) => `<line x1="${78 + i * 12}" y1="88" x2="${78 + i * 12}" y2="116" stroke="${C.earth}" stroke-width="1"/>`).join('')
      + `<rect x="70" y="84" width="180" height="5" fill="#e8dcc0"/>` + Array.from({ length: 30 }, (_, i) => `<line x1="${72 + i * 6}" y1="90" x2="${72 + i * 6}" y2="104" stroke="#b9a37a" stroke-width="0.5"/>`).join('')
      + roofShape(60, 62, 200, 22, '#7a5a44') + `<rect x="66" y="118" width="188" height="5" fill="${C.earth2}"/>`
      + pine(36, 132, 1) + `<line x1="282" y1="134" x2="282" y2="106" stroke="${C.earth2}" stroke-width="3"/><circle cx="276" cy="110" r="10" fill="#d9879a"/><circle cx="289" cy="103" r="8" fill="#e6a2b2"/><circle cx="270" cy="100" r="6" fill="#efb8c4"/>`
      + kasumi(170, 132, 130, C.gold2, 0.75)],

    fire: ['江戸の大火', () => sky('#4a2420', '#c0602c') + smoke(40, 44, 1.6) + smoke(190, 34, 1.8)
      + ground(124, '#3a2a22') + town(126, 9, C.ink) + flames(50, 108, 1.3) + flames(140, 104, 1.6) + flames(230, 108, 1.4) + flames(300, 112, 1)
      + crowd(158, 7, { color: '#1a1414' }, 14, 46)],

    ship: ['南蛮船', () => sky('#bfd9e6', C.paper) + sun(64, 36, 14, C.red) + kasumi(150, 30, 120)
      + waves(110) + ship(184, 122, 1.6, C.white) + ship(70, 130, 0.8, C.paper)],

    horizon: ['水平線の異国船の影', () => sky('#c7d6dd', C.paper) + sun(250, 40, 12, '#f2ead0') + kasumi(150, 34, 130, C.white, 0.8)
      + waves(100, '#4b7a96') + `<g opacity="0.55">${gaisen(236, 101, 0.22, '#8a96a0', '#c9d0d4')}</g>`
      + `<path d="M0,112 Q40,104 92,108 L112,160 L0,160 Z" fill="${C.green2}"/>` + pine(16, 120, 0.6) + lookout(60, 118, 0.9)
      + person(84, 138, 1, { topknot: true, color: C.blue })],

    whiteship: ['白い帆の異国船', () => sky('#bcd8e6', C.paper) + sun(70, 34, 13, C.red) + kasumi(30, 30, 110)
      + waves(110, '#3d6b8c') + gaisen(200, 128, 0.95, '#f4efe4', C.white, 4)
      + `<path d="M0,124 Q30,116 62,120 L80,160 L0,160 Z" fill="${C.green2}"/>` + pine(18, 126, 0.7)
      + person(32, 140, 1.05, { sword: true, topknot: true, color: C.blue }) + person(52, 136, 0.95, { topknot: true, color: C.ink2 })],

    redship: ['赤い異国の軍船', () => sky('#e0a07a', '#efd8bc') + sun(250, 40, 16, '#f6d2a0') + kasumi(20, 28, 100, '#f3c8a8', 0.8)
      + waves(108, '#3a4f63') + `<g opacity="0.8">${gaisen(96, 116, 0.5, '#9c2f24', '#e9d9c4', 3)}</g>`
      + gaisen(214, 130, 0.9, '#b8392b', '#efe2cf', 5) + cannonSmoke(160, 116, 1.1) + cannonSmoke(60, 108, 0.7)
      + `<path d="M0,128 Q24,122 46,126 L58,160 L0,160 Z" fill="${C.green3}"/>`],

    blackship: ['異国の黒い船', () => sky('#6f7a88', '#c9c4b8') + waves(108, '#2d4d63') + blackShip(196, 124, 1.25)
      + `<path d="M0,126 Q30,118 64,122 L84,160 L0,160 Z" fill="${C.green2}"/>` + pine(20, 128, 0.7)
      + person(34, 138, 1.05, { sword: true, topknot: true, color: C.blue }) + person(54, 134, 0.95, { topknot: true, color: C.ink2 })],

    ronin: ['夜の町の浪人たち', () => sky('#141a2e', '#3a4560') + sun(262, 34, 14, '#f2ead0') + ground(122, '#23242e')
      + town(124, 9, '#151821') + andon(250, 148, 1) + crowd(152, 5, { color: '#10121a', sword: true, topknot: true }, 40, 38)],

    mine: ['金山', () => sky('#d0d8cb', C.paper) + mountains(140, '#8a7a62', [[0, 30], [80, -10], [170, 16], [250, -4], [320, 24]])
      + `<path d="M124,142 Q124,102 150,102 Q176,102 176,142 Z" fill="${C.ink}"/><path d="M128,142 Q128,106 150,106 Q172,106 172,142" fill="none" stroke="${C.earth}" stroke-width="2"/>`
      + `<rect x="122" y="98" width="56" height="5" fill="${C.earth2}"/>` + andon(150, 136, 0.7)
      + ground(150, C.earth) + senryobako(244, 154, 1.1) + koban(206, 148, 1) + koban(222, 142, 0.9) + person(92, 154, 1.2, { kasa: true, color: C.earth2 })],

    hall: ['城の大広間', () => `<rect width="320" height="160" fill="${C.paper}"/>` + byobu(30, 100, 260, 60)
      + `<rect x="0" y="100" width="320" height="60" fill="#c9b98f"/>`
      + Array.from({ length: 6 }, (_, i) => `<line x1="${i * 64}" y1="100" x2="${i * 64 - 30}" y2="160" stroke="${C.earth}" stroke-width="1"/>`).join('')
      + `<line x1="0" y1="130" x2="320" y2="130" stroke="${C.earth}" stroke-width="0.8"/>`
      + person(100, 142, 1.5, { color: C.blue, topknot: true, face: true }) + person(220, 142, 1.5, { color: C.red, topknot: true, face: true })
      + `<rect x="146" y="106" width="28" height="12" fill="${C.ink2}"/><rect x="146" y="106" width="28" height="2" fill="${C.gold}"/>`],

    palanquin: ['姫の輿入れ', () => sky('#efd2d2', C.paper) + kasumi(30, 28, 110, '#f3b8c2') + ground(118, '#d8c7a4')
      + pine(290, 130, 1) + `<line x1="96" y1="100" x2="224" y2="100" stroke="${C.earth2}" stroke-width="3"/>
        <rect x="136" y="96" width="48" height="28" rx="3" fill="${C.ink}"/><rect x="140" y="100" width="40" height="16" fill="#3a2a2a"/>${aoi(160, 108, 6)}
        ${roofShape(132, 87, 56, 9, C.gold)}`
      + person(106, 134, 1, { color: C.blue, face: true }) + person(214, 134, 1, { color: C.blue, face: true })
      + crowd(142, 3, { color: C.red, topknot: true, face: true }, 22, 24) + crowd(142, 2, { color: C.red, topknot: true, face: true }, 248, 22)],

    harvest: ['豊作の田', () => sky('#bfd9e6', C.paper) + sun(270, 36, 16, C.red) + kasumi(30, 36, 120) + mountains(104, '#9fb39a')
      + ground(104, '#c9a85a') + rice(124, C.green2) + rice(146, C.green2) + rice(166, C.green2)
      + person(70, 120, 1.1, { kasa: true, color: C.blue }) + person(230, 118, 1, { kasa: true, color: C.blue })],

    famine: ['ひび割れた田', () => sky('#8f8a82', '#cfc6b4') + sun(240, 40, 14, '#e6ddc9') + mountains(104, '#86817a')
      + ground(104, '#b49a72') + `<path d="M20,130 l30,6 l20,-8 l40,10 M150,120 l26,14 l30,-6 M220,140 l40,-6 l30,10 M70,150 l20,-6 l24,8" stroke="${C.earth2}" stroke-width="1.4" fill="none"/>`
      + rice(126, '#8a7a5a', 12, true) + person(120, 154, 1.2, { kasa: true, color: C.ink2 }) + person(146, 156, 0.8, { color: C.ink2 })
      + `<path d="M250,64 q6,-4 12,0 q6,-4 12,0" stroke="${C.ink}" stroke-width="1.2" fill="none"/>`],

    river: ['大河の堤', () => sky('#bcd2de', C.paper) + kasumi(170, 26, 120) + mountains(90, '#9fb0a8') + ground(90, C.green)
      + `<path d="M0,112 Q160,96 320,116 L320,140 Q160,124 0,138 Z" fill="${C.sea}"/>`
      + `<path d="M0,120 q20,-3 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="${C.white}" stroke-width="1" fill="none" opacity="0.5"/>`
      + `<path d="M0,110 Q160,94 320,114 L320,108 Q160,88 0,104 Z" fill="${C.earth}"/>`
      + crowd(158, 7, { kasa: true, color: C.blue }, 18, 44) + pine(296, 94, 0.8)],

    ikki: ['一揆', () => sky('#d4c09c', C.paper) + ground(120, '#bfa880') + house(220, 122, 70, 26, C.roof)
      + flag(40, 132, 50, C.paper, false) + flag(120, 128, 46, C.paper, false)
      + `<text x="44" y="100" font-size="10" fill="${C.ink}" font-family="serif">一揆</text>`
      + crowd(158, 9, { kasa: true, spear: true, color: C.ink2 }, 14, 30)],

    sickbed: ['病の床', () => `<rect width="320" height="160" fill="#262636"/>` + `<rect x="0" y="110" width="320" height="50" fill="#5a4a38"/>`
      + Array.from({ length: 8 }, (_, i) => `<line x1="${i * 44}" y1="110" x2="${i * 44 - 20}" y2="160" stroke="#4a3c2e" stroke-width="1"/>`).join('')
      + andon(250, 120, 1.6) + `<rect x="70" y="106" width="140" height="18" rx="4" fill="${C.paper}"/><rect x="70" y="100" width="104" height="15" rx="5" fill="${C.blue}"/>`
      + `<path d="M76,104 q20,-3 40,0 t40,0" stroke="#4a6a8c" stroke-width="1.2" fill="none"/>`
      + `<circle cx="190" cy="104" r="7" fill="${C.skin}"/><rect x="180" y="98" width="20" height="4" fill="${C.white}"/>`
      + person(120, 150, 1.4, { color: '#1d1d26', topknot: true })
      + `<rect x="26" y="26" width="64" height="64" fill="#d9cfb4" opacity="0.35"/><circle cx="58" cy="52" r="12" fill="${C.paper}" opacity="0.5"/>`
      + `<path d="M58,26 V90 M26,47 H90 M26,68 H90" stroke="#262636" stroke-width="2"/>`],

    study: ['書物と学問', () => `<rect width="320" height="160" fill="${C.paper}"/>` + `<rect x="0" y="112" width="320" height="48" fill="#c9b98f"/>`
      + `<rect x="200" y="30" width="80" height="80" fill="#efe8d2" stroke="${C.earth}" stroke-width="2"/><line x1="240" y1="30" x2="240" y2="110" stroke="${C.earth}" stroke-width="2"/><line x1="200" y1="70" x2="280" y2="70" stroke="${C.earth}" stroke-width="2"/>`
      + pine(232, 104, 0.6)
      + `<rect x="60" y="112" width="110" height="10" fill="${C.earth2}"/><rect x="66" y="122" width="6" height="14" fill="${C.earth2}"/><rect x="158" y="122" width="6" height="14" fill="${C.earth2}"/>`
      + `<rect x="80" y="104" width="40" height="8" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.8"/><line x1="84" y1="107" x2="116" y2="107" stroke="${C.ink2}" stroke-width="0.4"/><line x1="84" y1="109" x2="110" y2="109" stroke="${C.ink2}" stroke-width="0.4"/>`
      + `<rect x="128" y="100" width="26" height="12" fill="${C.blue}"/><rect x="130" y="96" width="22" height="4" fill="${C.red}"/>`
      + andon(40, 138, 1.2) + person(116, 160, 1.4, { color: C.green2, topknot: true, face: true })],

    earthquake: ['大地震', () => sky('#a19b92', '#d8cfbe') + ground(122, '#a08a6a')
      + `<g transform="rotate(-8 70 120)">${house(40, 122, 50, 20, C.roof)}</g><g transform="rotate(10 220 120)">${house(200, 124, 60, 22, C.roof)}</g>`
      + `<path d="M140,122 l8,10 l-6,8 l10,8 l-4,12" stroke="${C.ink}" stroke-width="3" fill="none"/>` + smoke(100, 70, 1) + crowd(156, 5, { color: C.ink2 }, 30, 60)],

    money: ['千両箱と小判', () => `<rect width="320" height="160" fill="#efe4c6"/>` + `<rect x="0" y="118" width="320" height="42" fill="#b89a6a"/>`
      + Array.from({ length: 6 }, (_, i) => `<line x1="${i * 64}" y1="118" x2="${i * 64 - 20}" y2="160" stroke="#a58a5e" stroke-width="1"/>`).join('')
      + senryobako(110, 132, 1.6) + senryobako(196, 134, 1.3) + koban(240, 142, 1) + koban(258, 148, 1) + koban(60, 148, 1)
      + `<rect x="250" y="44" width="40" height="56" fill="${C.white}" stroke="${C.ink2}"/><line x1="258" y1="54" x2="282" y2="54" stroke="${C.ink2}"/><line x1="258" y1="64" x2="282" y2="64" stroke="${C.ink2}"/><line x1="258" y1="74" x2="276" y2="74" stroke="${C.ink2}"/>`
      + person(40, 120, 1.2, { color: C.earth2, topknot: true, face: true })],

    road: ['街道と宿場', () => sky('#bcd4e0', C.paper) + sun(260, 34, 13, C.red) + mountains(96, '#a4b4aa', [[0, 24], [60, 8], [110, 30], [200, -18], [260, 20], [320, 10]])
      + ground(96, C.green)
      + `<path d="M140,96 L180,96 L260,160 L60,160 Z" fill="#d8c7a4"/>` + pine(70, 122, 1) + pine(250, 120, 1)
      + house(18, 152, 42, 18, C.roof) + house(268, 154, 46, 18, C.roof) + person(150, 132, 1, { kasa: true, color: C.blue }) + person(176, 148, 1.2, { kasa: true, color: C.earth2 })],

    banquet: ['華やかな大奥', () => `<rect width="320" height="160" fill="#3a2230"/>` + byobu(20, 100, 280, 64)
      + `<rect x="0" y="100" width="320" height="60" fill="#7a4a3a"/>`
      + andon(40, 142, 1.4) + andon(280, 142, 1.4)
      + crowd(148, 6, { color: C.red, face: true }, 80, 32) + `<path d="M150,152 l20,0" stroke="${C.gold}" stroke-width="3"/>`],

    falcon: ['鷹狩り', () => sky('#cfe0e6', C.paper) + kasumi(30, 30, 100) + mountains(108, '#a8b8aa') + ground(108, '#a9b46e')
      + `<path d="M190,56 q12,-14 30,-10 q-10,4 -14,10 q14,-4 24,4 q-16,0 -24,8 Z" fill="${C.ink2}"/><circle cx="208" cy="50" r="1" fill="${C.gold}"/>`
      + person(110, 152, 1.6, { color: C.blue, topknot: true, face: true }) + `<line x1="118" y1="124" x2="132" y2="114" stroke="${C.ink}" stroke-width="3"/>`
      + pine(270, 142, 1.1) + crowd(154, 2, { color: C.earth2 }, 40, 22)],

    league: ['夜に集う大名たち', () => sky('#10152a', '#2c2a3c') + sun(60, 34, 10, '#f2ead0') + ground(118, '#1c1a22')
      + `<circle cx="160" cy="132" r="30" fill="${C.red2}" opacity="0.25"/>` + flames(160, 134, 0.8)
      + flag(60, 128, 64, C.red) + flag(100, 124, 60, C.blue) + flag(220, 124, 60, C.green2) + flag(260, 128, 64, C.purple)
      + crowd(158, 4, { color: '#0e0d12', topknot: true, sword: true }, 70, 60)],

    volcano: ['火を噴く山', () => sky('#4a2e2a', '#c9a27c')
      + `<path d="M30,150 L128,84 Q150,76 172,84 L290,150 Z" fill="#5a4a44"/><path d="M128,84 Q150,76 172,84 L196,100 Q150,92 104,100 Z" fill="#6e5c54"/>`
      + smoke(120, 52, 2) + smoke(150, 40, 1.6)
      + `<path d="M140,86 Q120,118 100,150 L114,150 Q130,120 148,88 Z M160,86 Q182,116 200,150 L186,150 Q172,120 154,88 Z" fill="${C.red}" opacity="0.85"/>`
      + flames(150, 78, 1.2) + ground(138, '#6f6258')
      + Array.from({ length: 44 }, (_, i) => `<circle cx="${(i * 47) % 320}" cy="${(i * 29) % 136}" r="${0.8 + (i % 3) * 0.4}" fill="#3a302c" opacity="0.5"/>`).join('')
      + house(24, 152, 40, 16, '#4a4440') + house(254, 154, 44, 16, '#4a4440') + crowd(156, 3, { color: C.ink2, kasa: true }, 92, 30)],

    snow: ['雪の夜の屋敷', () => sky('#1a2238', '#56607a') + `<rect x="0" y="118" width="320" height="42" fill="#e9eef2"/>`
      + `<rect x="0" y="92" width="320" height="28" fill="${C.wall}"/>` + roofShape(-6, 84, 332, 9, C.roof)
      + `<path d="M-6,84 L326,84" stroke="#ffffff" stroke-width="2.4" opacity="0.85"/>`
      + `<rect x="128" y="76" width="64" height="44" fill="${C.earth2}"/><rect x="134" y="84" width="24" height="36" fill="${C.ink2}"/><rect x="162" y="84" width="24" height="36" fill="${C.ink2}"/>`
      + roofShape(118, 62, 84, 14, C.roof) + `<path d="M118,62.5 L202,62.5" stroke="#ffffff" stroke-width="2.4" opacity="0.85"/>`
      + andon(100, 134, 0.9) + crowd(152, 6, { color: '#202838', sword: true, topknot: true, spear: true }, 36, 48)
      + snowfall(70, 5)],

    market: ['米相場のにぎわい', () => `<rect width="320" height="160" fill="#efe2c4"/>` + `<rect x="0" y="112" width="320" height="48" fill="#b8996a"/>`
      + Array.from({ length: 6 }, (_, i) => `<line x1="${i * 64}" y1="112" x2="${i * 64 - 24}" y2="160" stroke="#a58a5e" stroke-width="1"/>`).join('')
      + `<rect x="18" y="16" width="284" height="66" fill="${C.wall}" stroke="${C.earth2}"/>`
      + ['米', '六十', '値', '七十', '米'].map((t, i) => `<rect x="${32 + i * 56}" y="26" width="36" height="46" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.8"/>
        <text x="${50 + i * 56}" y="${t.length > 1 ? 54 : 58}" font-size="${t.length > 1 ? 11 : 18}" text-anchor="middle" fill="${C.ink}" font-family="serif">${t}</text>`).join('')
      + tawara(44, 140, 1.1) + tawara(70, 148, 1.1) + tawara(56, 128, 1.1)
      + crowd(152, 6, { color: C.earth2, topknot: true, face: true }, 120, 30)
      + [126, 186, 246].map((x) => `<line x1="${x + 5}" y1="${132}" x2="${x + 9}" y2="${116}" stroke="${C.skin2}" stroke-width="2" stroke-linecap="round"/>`).join('')],

    kawaraban: ['瓦版売りと町の人', () => sky('#d8e2e4', C.paper) + kasumi(170, 24, 120) + town(104, 9, C.roof, 0, 36) + ground(104, '#d8c7a4')
      + person(160, 148, 1.7, { color: C.red, kasa: true })
      + `<g transform="rotate(-10 184 112)"><rect x="170" y="102" width="28" height="20" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.8"/>
        ${[107, 111, 115, 119].map((y) => `<line x1="174" y1="${y}" x2="194" y2="${y}" stroke="${C.ink2}" stroke-width="0.7"/>`).join('')}</g>`
      + crowd(152, 3, { color: C.blue, face: true, topknot: true }, 66, 28) + crowd(154, 3, { color: C.green2, face: true }, 214, 30)
      + `<rect x="120" y="150" width="14" height="10" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.5" transform="rotate(14 127 155)"/>`],

    fireworks: ['隅田川の花火', () => sky('#0d1330', '#2a2f52') + firework(86, 42, 26, C.gold2) + firework(196, 28, 20, C.red2) + firework(262, 58, 16, '#9fd0ff')
      + waves(116, '#1c2a4a', '#6f86b0')
      + `<path d="M-4,114 Q160,86 324,114" stroke="${C.earth2}" stroke-width="5" fill="none"/><path d="M-4,108 Q160,80 324,108" stroke="${C.earth2}" stroke-width="1.6" fill="none"/>`
      + [30, 90, 160, 230, 290].map((x) => { const y = 114 - 28 * (1 - ((x - 160) / 164) ** 2); return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 22}" stroke="${C.earth2}" stroke-width="2"/>`; }).join('')
      + yakatabune(70, 148, 1) + yakatabune(240, 152, 1.1)],

    sakura: ['桜の堤と花見の人', () => sky('#f4dfe4', C.paper) + kasumi(30, 26, 120, '#f3b8c2') + mountains(98, '#b9c4b0') + ground(98, '#a9b46e')
      + `<path d="M0,124 Q160,108 320,126 L320,160 L0,160 Z" fill="${C.sea}"/>`
      + `<path d="M0,132 q20,-3 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" stroke="${C.white}" stroke-width="1" fill="none" opacity="0.5"/>`
      + `<path d="M0,120 Q160,104 320,122 L320,114 Q160,96 0,110 Z" fill="${C.earth}"/>`
      + sakuraTree(50, 112, 1.1) + sakuraTree(160, 104, 1.25) + sakuraTree(272, 112, 1.05)
      + crowd(116, 4, { color: C.red, face: true }, 86, 22) + crowd(118, 3, { color: C.blue, face: true, topknot: true }, 196, 24)
      + yakatabune(110, 150, 0.9) + petals(36, 4)],

    elephant: ['街道を歩く象', () => sky('#e6dcc4', C.paper) + sun(258, 36, 14, C.red) + mountains(98, '#aab6a6', [[0, 20], [70, 4], [140, 26], [220, 6], [320, 22]])
      + ground(98, '#d8c7a4') + `<path d="M120,98 L200,98 L300,160 L20,160 Z" fill="#e6d8b8"/>` + pine(30, 128, 1) + pine(296, 130, 0.9)
      + elephant(160, 146, 1.2) + person(104, 146, 1.1, { color: C.purple, face: true })
      + crowd(118, 3, { color: C.blue, face: true, topknot: true }, 40, 20) + crowd(120, 3, { color: C.earth2, face: true }, 236, 20)],

    sumo: ['境内の勧進相撲', () => sky('#e9dcc0', C.paper)
      + torii(70, 96, 0.9) + roofShape(110, 38, 100, 12, C.roof) + `<rect x="116" y="50" width="4" height="58" fill="${C.earth2}"/><rect x="200" y="50" width="4" height="58" fill="${C.earth2}"/>`
      + `<rect x="0" y="100" width="320" height="60" fill="#c9b98f"/>`
      + dohyo(160, 128, 1.1)
      + crowd(156, 5, { color: C.blue, face: true, topknot: true }, 6, 20) + crowd(156, 5, { color: C.green2, face: true }, 228, 20)
      + flag(286, 100, 40, C.red, false) + flag(14, 100, 40, C.blue, false)],

    fort: ['海の台場', () => sky('#b8c8d2', C.paper) + sun(262, 36, 12, '#f2ead0') + kasumi(20, 30, 110, C.white, 0.7)
      + gaisen(44, 100, 0.32, '#3a3a40', '#d8d4cc', 0) + waves(100, '#3d5f78')
      + `<path d="M58,124 L252,124 L272,142 L38,142 Z" fill="${C.stone}"/><rect x="38" y="142" width="234" height="6" fill="${C.stone2}"/>`
      + Array.from({ length: 9 }, (_, i) => `<line x1="${62 + i * 22}" y1="124" x2="${56 + i * 24}" y2="142" stroke="${C.stone2}" stroke-width="0.7"/>`).join('')
      + cannon(92, 124, 1.3, -1) + cannon(146, 124, 1.3, -1) + cannon(200, 124, 1.3, -1)
      + person(120, 124, 0.9, { color: C.blue, topknot: true }) + person(174, 124, 0.9, { color: C.blue, topknot: true })
      + flag(236, 124, 44, C.red)],
  };

  // 決算報告の金蔵。千両箱（boxes 個）と、商人の証文（bills 枚）を並べる。
  // 1つずつ落ちてくるように、groups に class="iy-pop" と遅れ（--i）をつける（動きは style.css）
  function purse(boxes = 0, bills = 0) {
    const h = boxes > 10 ? 52 : 40;
    const floor = h - 6;
    let out = `<rect width="320" height="${h}" fill="#efe4c6"/><rect x="0" y="${floor}" width="320" height="6" fill="#b89a6a"/>`;
    for (let i = 0; i < boxes; i++) {
      const row = Math.floor(i / 10);
      const x = 22 + (i % 10) * 26 + row * 13;
      out += `<g class="iy-pop" style="--i:${i}">${senryobako(x, floor - row * 12, 0.52)}</g>`;
    }
    for (let i = 0; i < bills; i++) {
      const x = 300 - (i % 5) * 9;
      const y = floor - 22 - Math.floor(i / 5) * 5;
      const tilt = `transform="rotate(${(i % 3) * 6 - 6} ${x} ${y + 10})"`;
      out += `<g class="iy-pop" style="--i:${boxes + i}"><rect x="${x - 7}" y="${y}" width="14" height="20" fill="${C.white}" stroke="${C.ink2}" stroke-width="0.6" ${tilt}/>
        <rect x="${x - 2}" y="${y + 12}" width="5" height="5" fill="${C.red}" opacity="0.85" ${tilt}/></g>`;
    }
    if (boxes === 0) out += `<text x="${bills ? 130 : 160}" y="${floor - 10}" font-size="12" text-anchor="middle" fill="${C.ink2}" font-family="serif">金蔵は空</text>`;
    return `<svg viewBox="0 0 320 ${h}" role="img" aria-label="金蔵の千両箱${boxes}つ${bills ? `と、借入の証文${bills}枚` : ''}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
  }

  // outcome … 'good' / 'bad' を渡すと、結果の絵として光や曇りを重ねる
  function scene(name, outcome = null) {
    const entry = SCENES[name] || SCENES.castle;
    const label = entry[0] + (outcome === 'good' ? '（うまくいった）' : outcome === 'bad' ? '（うまくいかなかった）' : '');
    return wrap(entry[1]() + outcomeLayer(outcome), label);
  }

  // 江戸の町。v: { level: 町の育ち（1〜6）, works: 終わった普請の id, minshin: 民心, opened: 黒船を退けて国を開いたか }。
  // 段が上がるほど家が増え、終わった普請が絵に加わる（上水の樋・日本橋と街道・堤・新田・天守・学問所・湊の船・台場・大船など）
  function edo(v = {}) {
    const level = v.level || 1;
    const has = (name) => (v.works || []).includes(name);
    const minshin = v.minshin === undefined ? 50 : v.minshin;
    // 空と富士と、遠くの山
    let out = sky('#cfe0e6', C.paper) + sun(46, 30, 11, C.red) + kasumi(140, 20, 110);
    out += `<path d="M188,92 L234,44 Q241,38 248,44 L300,92 Z" fill="#8ea3b5"/>
      <path d="M224,55 L234,44 Q241,38 248,44 L259,56 Q253,52 249,57 Q243,51 239,57 Q232,52 224,55 Z" fill="${C.white}"/>`;
    out += mountains(100, '#a9bab2', [[0, 28], [60, 14], [120, 32], [180, 26], [240, 38], [320, 30]]);
    out += ground(96, has('shinden') ? '#a3b56c' : C.green);
    // 上水（左の奥から町へ水を引く木の樋）
    if (has('josui')) {
      out += `<path d="M-2,104 L74,114" stroke="${C.earth2}" stroke-width="3"/><path d="M-2,103 L74,113" stroke="#7fb0d0" stroke-width="1.2"/>
        ${[8, 26, 44, 62].map((x) => `<line x1="${x}" y1="${105 + x * 0.13}" x2="${x}" y2="${112 + x * 0.13}" stroke="${C.earth2}" stroke-width="1"/>`).join('')}`;
    }
    // 測量の旗（蝦夷地の見分）
    if (has('ezo')) out += flag(18, 112, 24, C.red, false);
    // 江戸城。天守を再建していれば大きく、金の光をまとう
    if (has('tenshu')) {
      const glow = radial([[0, C.gold2, 0.45], [1, C.gold2, 0]]);
      out += `<defs>${glow.def}</defs><circle cx="140" cy="76" r="48" fill="url(#${glow.id})"/>` + castle(140, 112, 0.82);
    } else {
      out += castle(140, 112, 0.6);
    }
    if (has('toshogu')) out += torii(44, 118, 0.42);
    if (has('gakumonjo')) out += house(238, 118, 34, 13, '#3f5e5a', '#f6efe0');
    // 奥の家並み（町が育つほど増える）
    const back = 2 + level * 2;
    for (let i = 0; i < back; i++) {
      const x = 4 + ((i * 47) % 296);
      if (x > 104 && x < 176) continue; // 城の前はあけておく
      out += house(x, 120 + (i % 2) * 2, 16 + (i % 3) * 2, 8, i % 3 === 2 ? C.roof2 : C.roof);
    }
    // 川と、堤（堤を築いていれば、土手と柳が並ぶ。なければ濁った暴れ川）
    out += `<path d="M-4,127 Q60,121 120,127 T236,128" stroke="${has('tsutsumi') ? C.sea : '#7d8a78'}" stroke-width="6" fill="none"/>`;
    if (has('tsutsumi')) {
      out += `<path d="M-4,122 Q60,116 120,122 T232,123" stroke="${C.earth}" stroke-width="2" fill="none"/>
        ${[16, 70, 190].map((x) => `<path d="M${x},121 q-3,6 -4,10 M${x},121 q0,6 1,10 M${x},121 q3,6 5,9" stroke="${C.green}" stroke-width="1" fill="none"/>`).join('')}`;
    }
    // 街道と日本橋
    if (has('kaido')) {
      out += `<path d="M70,160 Q110,144 150,131" stroke="#c9b48a" stroke-width="7" fill="none"/>
        <path d="M134,131 Q150,120 166,131" stroke="${C.earth2}" stroke-width="2.4" fill="none"/>
        <line x1="138" y1="128" x2="138" y2="132" stroke="${C.earth2}"/><line x1="162" y1="128" x2="162" y2="132" stroke="${C.earth2}"/>`;
    }
    // 新田（左の手前に実った田）
    if (has('shinden')) out += rice(160, '#7a8a3a', 6);
    // 手前の家並み
    const front = Math.max(0, level * 2 - 2);
    for (let i = 0; i < front; i++) {
      const x = 92 + ((i * 29) % 128);
      out += house(x, 146 + (i % 2) * 3, 22 + (i % 2) * 4, 11, [C.roof, '#6a4a3a', C.roof2][i % 3]);
    }
    // 江戸の湊（右の手前の海）。湊の普請・台場・大船・開国で、船や砲台が加わる
    out += `<path d="M222,160 Q246,130 320,122 L320,160 Z" fill="${C.sea}"/>`
      + [[262, 136], [292, 132], [248, 150], [282, 148], [304, 154]].map(([x, y]) => `<path d="M${x - 6},${y} a6,4 0 0 1 12,0" fill="none" stroke="${C.white}" stroke-width="0.7" opacity="0.6"/>`).join('');
    if (has('daiba')) out += `<path d="M284,138 L312,138 L316,145 L280,145 Z" fill="${C.stone}"/>` + cannon(298, 138, 0.6, -1);
    if (has('dejima')) out += ship(258, 152, 0.36);
    if (has('taisen')) out += gaisen(296, 158, 0.22, C.earth2, C.white, 0);
    if (v.opened) out += gaisen(300, 132, 0.16, '#3a3a40', '#d8d4cc', 0);
    // 町の人。民心が高いほど、にぎわう
    const people = minshin >= 60 ? 4 : minshin >= 30 ? 2 : 1;
    out += crowd(158, people, minshin >= 30 ? { color: C.blue, face: true, topknot: true } : { color: C.ink2, kasa: true }, 104, 28);
    return wrap(out, `江戸の町（${level}段）`);
  }

  // ─────────────────────────────── 顔（四角い小さな絵）

  function portrait(body, label, bg = '#ece3cf') {
    const g = linear([[0, shade(bg, 0.25)], [1, shade(bg, -0.06)]]);
    const frame = shade(bg, -0.25);
    return `<svg viewBox="0 0 64 64" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
      <defs>${g.def}</defs><rect width="64" height="64" rx="10" fill="url(#${g.id})"/>
      ${[0, 1, 2].map((r) => `<path d="M${-6 + r * 26},64 a13,13 0 0 1 26,0" fill="none" stroke="${frame}" stroke-width="0.6" opacity="0.35"/>
        <path d="M${1 + r * 26},64 a6,6 0 0 1 12,0" fill="none" stroke="${frame}" stroke-width="0.6" opacity="0.35"/>`).join('')}
      ${body}
      <rect x="0.5" y="0.5" width="63" height="63" rx="9.5" fill="none" stroke="${frame}" stroke-width="1" opacity="0.6"/></svg>`;
  }

  // 顔。目・眉・口は表情で変わる。opts: cheeks（頬の赤み）/ beard（白いひげ）/ young（子どもの大きな目）/
  //   wide（輪郭の横幅の倍率）/ eyes（穏やかなときの目：'closed' 細めた目・'open' 開いた目・'narrow' 一文字の目）/
  //   thickBrow・thinBrow（眉の太さ）/ hairColor（口ひげの色）/ beardColor（あごひげの色）/ wrinkles（しわ）
  function face(x, y, r, mood = 'calm', opts = {}) {
    const skin = radial([[0, C.skin], [0.85, C.skin], [1, C.skin2]]);
    const browW = opts.thickBrow ? 1.9 : opts.thinBrow ? 1 : 1.4;
    const rx = r * (opts.wide || 1);
    const brow = {
      calm: `<path d="M${x - 8},${y - 5.5} q3,-2.2 6,-0.4 M${x + 2},${y - 5.9} q3,-1.8 6,0.4" stroke="${C.ink}" stroke-width="${browW}" fill="none" stroke-linecap="round"/>`,
      worry: `<path d="M${x - 8},${y - 4} q3,-3.5 6,-5.5 M${x + 2},${y - 9.5} q3,1.5 6,5.5" stroke="${C.ink}" stroke-width="${browW}" fill="none" stroke-linecap="round"/>`,
      angry: `<path d="M${x - 8.5},${y - 8.5} l6.5,3.2 M${x + 8.5},${y - 8.5} l-6.5,3.2" stroke="${C.ink}" stroke-width="${browW + 0.3}" fill="none" stroke-linecap="round"/>`,
    }[mood];
    let eyes;
    const calmEyes = opts.eyes || 'closed';
    if (mood === 'calm' && !opts.young && calmEyes === 'closed') {
      eyes = `<path d="M${x - 7.2},${y - 0.4} q2.6,2.4 5.2,0 M${x + 2},${y - 0.4} q2.6,2.4 5.2,0" stroke="${C.ink}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
    } else if (mood === 'calm' && !opts.young && calmEyes === 'narrow') {
      eyes = `<path d="M${x - 7},${y + 0.4} l5,-0.6 M${x + 2},${y - 0.2} l5,0.6" stroke="${C.ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    } else {
      const er = opts.young ? 2.1 : 1.7;
      eyes = [-4.5, 4.5].map((dx) => `<ellipse cx="${x + dx}" cy="${y}" rx="${er + 0.6}" ry="${er}" fill="#ffffff"/>
        <circle cx="${x + dx}" cy="${y + 0.2}" r="${er * 0.75}" fill="${C.ink}"/><circle cx="${x + dx + 0.5}" cy="${y - 0.5}" r="${er * 0.25}" fill="#ffffff"/>`).join('');
    }
    const mouth = {
      calm: `<path d="M${x - 3},${y + 7} q3,2.2 6,0" stroke="#8a4a3a" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
      worry: `<path d="M${x - 4},${y + 8} q2,-2 4,0 q2,2 4,0" stroke="#8a4a3a" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
      angry: `<path d="M${x - 4},${y + 8.4} q4,-1.6 8,0" stroke="#8a4a3a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    }[mood];
    let out = `<defs>${skin.def}</defs>
      <ellipse cx="${x - rx + 0.6}" cy="${y + 1}" rx="2.2" ry="3.2" fill="${C.skin2}"/><ellipse cx="${x + rx - 0.6}" cy="${y + 1}" rx="2.2" ry="3.2" fill="${C.skin2}"/>
      <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${r * 1.05}" fill="url(#${skin.id})"/>
      ${brow}${eyes}<path d="M${x - 0.4},${y + 1.6} q1.2,2.4 1.4,3" stroke="${C.skin2}" stroke-width="1.1" fill="none" stroke-linecap="round"/>${mouth}`;
    if (opts.wrinkles) {
      out += `<path d="M${x - 5},${y - 10} q5,-1.4 10,0 M${x - 3.5},${y - 12} q3.5,-1 7,0" stroke="${C.skin2}" stroke-width="0.8" fill="none" stroke-linecap="round"/>
        <path d="M${x - 4.6},${y + 3} q-1.4,2.6 -0.4,5 M${x + 4.6},${y + 3} q1.4,2.6 0.4,5" stroke="${C.skin2}" stroke-width="0.9" fill="none" stroke-linecap="round"/>`;
    }
    if (opts.cheeks) out += `<ellipse cx="${x - 8}" cy="${y + 4.5}" rx="2.6" ry="1.7" fill="#e8907c" opacity="0.55"/><ellipse cx="${x + 8}" cy="${y + 4.5}" rx="2.6" ry="1.7" fill="#e8907c" opacity="0.55"/>`;
    if (opts.mustache) out += `<path d="M${x - 5},${y + 5.6} q2.5,-1.6 5,0 q2.5,-1.6 5,0" stroke="${opts.hairColor || C.ink}" stroke-width="1.2" fill="none"/>`;
    if (opts.beard) {
      const bc = opts.beardColor || '#f6f1e6';
      out += `<path d="M${x - 7},${y + 8} Q${x},${y + 21} ${x + 7},${y + 8} Q${x},${y + 13} ${x - 7},${y + 8} Z" fill="${bc}" stroke="${shade(bc, -0.18)}" stroke-width="0.6"/>
        <path d="M${x - 6},${y + 5.4} q3,-2 6,0.4 q3,-2.4 6,-0.4" stroke="${bc}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    }
    return out;
  }

  // 着物（重ねた襟と肩）。color は上着、inner は下の襟
  function robe(color, inner = C.white, crest = C.gold, kamishimo = false) {
    const g = linear([[0, shade(color, 0.12)], [1, shade(color, -0.2)]]);
    let out = `<defs>${g.def}</defs>`;
    if (kamishimo) {
      out += `<path d="M2,48 L18,41 L24,46 L8,52 Z M62,48 L46,41 L40,46 L56,52 Z" fill="${shade(color, -0.1)}"/>`;
    }
    out += `<path d="M6,64 L10,47 Q32,38 54,47 L58,64 Z" fill="url(#${g.id})"/>
      <path d="M23,43 L32,58 L41,43" stroke="${inner}" stroke-width="3.2" fill="none"/>
      <path d="M25,43 L32,55 L39,43" stroke="${shade(color, -0.35)}" stroke-width="1" fill="none"/>
      ${aoi(19, 53, 3.4, crest)}${aoi(45, 53, 3.4, crest)}`;
    return out;
  }

  // 烏帽子（将軍がかぶる黒い帽子）
  function eboshi() {
    const g = linear([[0, '#4a4550'], [1, C.ink]], false);
    return `<defs>${g.def}</defs><path d="M20,22 Q20,6 33,3 Q43,4 41,19 Z" fill="url(#${g.id})"/>
      <path d="M26,8 Q31,5 36,6" stroke="#6a6470" stroke-width="1" fill="none" opacity="0.7"/>
      <rect x="19" y="18.5" width="26" height="5" rx="2" fill="${C.ink}"/>
      <line x1="21" y1="21" x2="43" y2="21" stroke="#5a5560" stroke-width="0.6"/>`;
  }

  function halo(cx, cy, r) {
    const g = radial([[0, C.gold2, 0.85], [0.6, C.gold2, 0.4], [1, C.gold2, 0]]);
    return `<defs>${g.def}</defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g.id})"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="${C.gold}" stroke-width="0.8" opacity="0.6"/>`;
  }

  function ieyasu(mood = 'calm') {
    return portrait(`${halo(32, 28, 26)}
      ${robe(C.ink, C.white, C.gold)}
      ${face(32, 30, 13.5, mood, { beard: true })}
      <path d="M17.6,25 Q18,10 32,9 Q46,10 46.4,25 Q41,17.6 32,17.6 Q23,17.6 17.6,25 Z" fill="#5a4e48"/>
      <path d="M22,14 Q32,9.6 42,14" stroke="#7a6e66" stroke-width="1" fill="none"/>
      ${kasumi(0, 55, 22, C.white, 0.95)}${kasumi(42, 57, 22, C.white, 0.95)}`, '家康', '#f6dfa6');
  }

  const TRAIT_COLORS = { 慎重: C.blue, 豪胆: C.red, 寛大: C.green, 倹約: C.earth, 華美: C.purple };

  // 0〜1の決まった数（同じ seed と n なら、いつも同じ値）。顔つきを人ごとに変えるのに使う
  function hash(seed, n) {
    let v = (seed * 374761393 + n * 668265263) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  }

  // 髪の色。歳をとるほど白くなる
  function hairOf(age) {
    return age >= 60 ? '#a8a29a' : age >= 48 ? '#5e5a58' : C.ink;
  }

  // 将軍の顔。性格で着物の色が変わり、seed（人ごとの番号）で輪郭・目・眉・ひげが、age（歳）で髪の白さとしわが変わる
  function shogun(trait, seed = 0, age = 30) {
    const color = TRAIT_COLORS[trait] || C.blue;
    const hair = hairOf(age);
    const brow = hash(seed, 2);
    const look = {
      wide: 0.95 + hash(seed, 1) * 0.12,
      eyes: ['closed', 'open', 'narrow'][Math.floor(hash(seed, 3) * 3)],
      thickBrow: trait === '豪胆' || brow < 0.3,
      thinBrow: trait !== '豪胆' && brow > 0.75,
      mustache: age >= 22 && hash(seed, 4) < 0.4,
      beard: age >= 35 && hash(seed, 5) < 0.25,
      hairColor: hair,
      beardColor: hair,
      wrinkles: age >= 50,
      cheeks: age < 18,
    };
    const inner = [C.white, '#eadcb4', '#d9e2ea'][Math.floor(hash(seed, 6) * 3)];
    return portrait(`${robe(color, inner)}
      ${face(32, 31, 13, trait === '豪胆' ? 'angry' : 'calm', look)}
      <path d="M19.5,27 Q19,17 26,15 L38,15 Q45,17 44.5,27 Q42,20 32,20 Q22,20 19.5,27 Z" fill="${hair}"/>
      ${eboshi()}`, `将軍（${trait}・${age}歳）`);
  }

  // 霊体の家光（チュートリアルとガイドの案内役）。光の輪と霞をまとう
  function iemitsu() {
    return portrait(`${halo(32, 27, 26)}
      ${robe(C.purple)}
      ${face(32, 31, 13, 'calm')}
      <path d="M19.5,27 Q19,17 26,15 L38,15 Q45,17 44.5,27 Q42,20 32,20 Q22,20 19.5,27 Z" fill="${C.ink}"/>
      ${eboshi()}
      ${kasumi(0, 55, 22, C.white, 0.95)}${kasumi(40, 57, 24, C.white, 0.95)}`, '家光（霊体）', '#ecdcef');
  }

  // 若君の顔。seed で輪郭と髪の結い方、着物の柄が少しずつ変わる
  function child(trait, seed = 0) {
    const color = TRAIT_COLORS[trait] || C.blue;
    const g = linear([[0, shade(color, 0.2)], [1, shade(color, -0.1)]]);
    const tuft = 4.6 + hash(seed, 7) * 2;
    const dots = [[20, 56], [30, 60], [42, 55], [47, 61], [25, 62], [37, 58]].filter((_, i) => hash(seed, 10 + i) < 0.7);
    return portrait(`<defs>${g.def}</defs>
      <path d="M12,64 L15,49 Q32,43 49,49 L52,64 Z" fill="url(#${g.id})"/>
      ${dots.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.6" fill="${C.white}" opacity="0.7"/>`).join('')}
      <path d="M25,46 L32,56 L39,46" stroke="${C.red}" stroke-width="3" fill="none"/>
      ${face(32, 33, 12.5, 'calm', { cheeks: true, young: true, wide: 0.96 + hash(seed, 8) * 0.1, thickBrow: hash(seed, 9) < 0.3 })}
      <path d="M19.6,31 Q18,17 32,16 Q46,17 44.4,31 Q42,23 37,22 L32,25 L27,22 Q22,23 19.6,31 Z" fill="${C.ink}"/>
      <ellipse cx="32" cy="15.5" rx="${tuft}" ry="3.4" fill="${C.ink}"/>
      <path d="M28,14.6 q4,-2 8,0" stroke="#5a5050" stroke-width="0.8" fill="none"/>`, `若君（${trait}）`, '#f3e7cf');
  }

  // 正室・姫の顔。seed で打掛の色を変える。young なら幼い姫（短い髪に赤い髪飾り）
  function lady(seed = 0, young = false) {
    const robes = [C.red, C.purple, '#b0475f', C.blue, '#c0632c', C.green2];
    const color = robes[seed % robes.length];
    const g = linear([[0, shade(color, 0.15)], [1, shade(color, -0.18)]]);
    const flowers = [[16, 56], [24, 61], [44, 55], [50, 61], [37, 62]].map(([cx, cy], i) =>
      `<circle cx="${cx}" cy="${cy}" r="${i % 2 ? 1.4 : 1.9}" fill="${i % 2 ? C.white : C.gold2}" opacity="0.8"/>`).join('');
    // 後ろ髪（若い姫は肩まで、正室は背中まで垂らす）
    const backHair = young
      ? `<path d="M18.5,36 Q16,14 32,12.5 Q48,14 45.5,36 L44,40 L20,40 Z" fill="${C.ink}"/>`
      : `<path d="M16.5,30 Q16,11.5 32,10.5 Q48,11.5 47.5,30 L49,57 Q32,60 15,57 Z" fill="${C.ink}"/>`;
    const front = young
      // 切りそろえた前髪
      ? `<path d="M19.6,30 Q18.6,15.5 32,14.8 Q45.4,15.5 44.4,30 L43.6,24.6 Q32,22.4 20.4,24.6 Z" fill="${C.ink}"/>
        <path d="M41,14.6 l4,-3 l1.2,4.2 Z M41,14.6 l5.4,1.6 l-2.6,3.2 Z" fill="${C.red}"/><circle cx="41.4" cy="15.2" r="1.3" fill="${C.red2}"/>`
      // 真ん中で分けた髪と、両脇に垂らした髪、金のかんざし
      : `<path d="M19.6,30 Q18.8,16 32,15.4 Q45.2,16 44.4,30 Q42,20.6 32.6,20.2 L32,17.4 L31.4,20.2 Q22,20.6 19.6,30 Z" fill="${C.ink}"/>
        <path d="M19.6,28 Q18.4,40 20.8,47 L22.6,46.4 Q21.2,38 21.8,29 Z M44.4,28 Q45.6,40 43.2,47 L41.4,46.4 Q42.8,38 42.2,29 Z" fill="${C.ink}"/>
        <line x1="39" y1="14.5" x2="47" y2="8.5" stroke="${C.gold}" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="47.6" cy="8.1" r="2" fill="${C.gold2}"/><circle cx="46" cy="10.6" r="0.9" fill="${C.red}"/>`;
    return portrait(`<defs>${g.def}</defs>${backHair}
      <path d="M6,64 L10,48 Q32,40 54,48 L58,64 Z" fill="url(#${g.id})"/>${flowers}
      <path d="M24,44 L32,58 L40,44" stroke="${C.white}" stroke-width="3.2" fill="none"/>
      <path d="M26,44 L32,55 L38,44" stroke="${C.red}" stroke-width="1.4" fill="none"/>
      ${face(32, 31, young ? 12 : 12.5, 'calm', { cheeks: true, young })}
      ${front}`, young ? '姫' : '正室', '#f3e3e6');
  }

  // 家臣の顔。seed で着物の色と顔つきを変える（同じ家臣はいつも同じ顔になる）
  function retainer(seed = 0) {
    const robes = [C.ink2, C.blue, C.green2, C.earth2, '#5a4a6a', '#3a5a5a', '#6a3a32'];
    const color = robes[seed % robes.length];
    const mood = seed % 5 === 3 ? 'angry' : seed % 7 === 2 ? 'worry' : 'calm';
    return portrait(`${robe(color, C.white, C.white, true)}
      ${face(32, 31, 13, mood, { beard: seed % 6 === 1, mustache: seed % 4 === 2, thickBrow: seed % 3 === 0 })}
      <path d="M19.4,29 Q19,18 25,16 Q32,14.4 39,16 Q45,18 44.6,29 Q43,22 40,21 L24,21 Q21,22 19.4,29 Z" fill="${C.ink}"/>
      <path d="M24,21 Q32,17.6 40,21 Q32,19.6 24,21 Z" fill="${C.skin2}"/>
      <rect x="29.6" y="10.6" width="4.8" height="7.4" rx="2" fill="${C.ink}"/>`, '家臣', '#e6e1d4');
  }

  return { scene, edo, purse, ieyasu, iemitsu, shogun, child, lady, retainer, sceneNames: Object.keys(SCENES) };
})();
