// 通勤圏マップ（apps/commute-range/）が使う鉄道データを作る。
// 元データは国土交通省「国土数値情報（鉄道）」。CC BY 4.0 で公開されている。
//   https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html
//
// 使い方:
//   1. 上のページから N02-25_GML.zip をダウンロードして展開する（リポジトリの外でよい）
//   2. node scripts/commute-rail-build.mjs <展開したフォルダ>/N02-25_GML/UTF-8
//   → apps/commute-range/data/kansai.json ができる
//
// 出力するのは「駅（路線ごと）」と「同じ路線で隣り合う駅どうしのつながり（線路沿いの距離）」だけ。
// 所要時間の見積もりや乗り換えの扱いは、ページ側（apps/commute-range/rail.js）で計算する。
// こうしておくと、時間の目安を調整するたびにデータを作り直さなくてよい。

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REGIONS = {
  kansai: {
    label: "関西圏",
    // 南, 西, 北, 東（大阪・京都・兵庫南部・奈良・滋賀南部・和歌山北部）
    bbox: [34.2, 134.6, 35.2, 136.1],
  },
};

// 通勤には使いにくい路線（新幹線・観光鉄道）は入れない
const EXCLUDED_LINES = [/新幹線/, /嵯峨野観光/];

const srcDir = process.argv[2];
const regionKey = process.argv[3] || "kansai";
if (!srcDir) {
  console.error("使い方: node scripts/commute-rail-build.mjs <N02のUTF-8フォルダ> [kansai]");
  process.exit(1);
}
const region = REGIONS[regionKey];
if (!region) {
  console.error(`地域 ${regionKey} は定義されていません`);
  process.exit(1);
}

const stationsGeo = readGeoJson("Station");
const sectionsGeo = readGeoJson("RailroadSection");

function readGeoJson(kind) {
  const name = readdirSync(srcDir).find((n) => n.endsWith(`_${kind}.geojson`));
  if (!name) {
    console.error(`${srcDir} に *_${kind}.geojson が見つかりません`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(join(srcDir, name), "utf8"));
}

// 鉄道区分のコードと事業者・路線名から、速さの目安の種類を決める
function lineKind(cls, operator, line) {
  if (cls === "13") return "cable";
  if (cls === "16" || cls === "23" || cls === "24") return "newtransit";
  if (/阪堺|京福/.test(operator) || /京津線|石山坂本線/.test(line)) return "tram";
  if (/大阪市高速電気軌道|北大阪急行/.test(operator) && !/南港ポートタウン/.test(line)) return "subway";
  if (operator === "京都市" || operator === "神戸市") return "subway";
  if (/けいはんな線/.test(line)) return "subway";
  return cls === "11" ? "jr" : "private";
}

const [south, west, north, east] = region.bbox;
function inRegion(coords) {
  return coords.some(([lon, lat]) => lat >= south && lat <= north && lon >= west && lon <= east);
}

const key = ([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`;

function meters([lon1, lat1], [lon2, lat2]) {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

// 路線（事業者＋路線名）ごとにまとめる。同じ路線でも区間によって鉄道区分のコードが違うことがあるので、
// コードは路線を分ける基準にしない。
const lines = new Map(); // lineId -> { operator, line, cls, sections: [], stations: Map(name -> coords[]) }
function lineFor(p) {
  const id = `${p.N02_004}|${p.N02_003}`;
  if (!lines.has(id)) {
    lines.set(id, { operator: p.N02_004, line: p.N02_003, cls: p.N02_001, sections: [], stations: new Map() });
  }
  return lines.get(id);
}

for (const f of sectionsGeo.features) {
  if (!inRegion(f.geometry.coordinates)) continue;
  lineFor(f.properties).sections.push(f.geometry.coordinates);
}
for (const f of stationsGeo.features) {
  const p = f.properties;
  if (!inRegion(f.geometry.coordinates)) continue;
  const l = lineFor(p);
  // 同じ路線・同じ駅名で複数の地物があることがある（上下線で分かれているなど）。1つの駅にまとめる
  if (!l.stations.has(p.N02_005)) l.stations.set(p.N02_005, []);
  l.stations.get(p.N02_005).push(...f.geometry.coordinates);
}

const outLines = [];
const outStations = []; // [lineIndex, 駅名, 緯度, 経度]
const outLinks = []; // [駅index, 駅index, 線路沿いの距離(m)]
let isolated = 0;

for (const l of lines.values()) {
  if (EXCLUDED_LINES.some((re) => re.test(l.line))) continue;
  if (l.stations.size < 2) continue;

  const lineIndex = outLines.length;
  outLines.push([`${l.operator} ${l.line}`, lineKind(l.cls, l.operator, l.line)]);

  // 線路の頂点をつないだグラフ
  const graph = new Map(); // vertexKey -> [[vertexKey, m], ...]
  const coordOf = new Map();
  const addEdge = (a, b, m) => {
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a).push([b, m]);
  };
  for (const coords of l.sections) {
    for (let i = 0; i < coords.length; i++) {
      coordOf.set(key(coords[i]), coords[i]);
      if (i === 0) continue;
      const a = key(coords[i - 1]);
      const b = key(coords[i]);
      const m = meters(coords[i - 1], coords[i]);
      addEdge(a, b, m);
      addEdge(b, a, m);
    }
  }

  // 駅の地物の頂点がどの駅のものか
  const owner = new Map(); // vertexKey -> 駅index
  const stationIndexes = [];
  for (const [name, coords] of l.stations) {
    const idx = outStations.length;
    const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    outStations.push([lineIndex, name, round5(lat), round5(lon)]);
    stationIndexes.push([idx, coords]);
    for (const c of coords) owner.set(key(c), idx);
  }

  // 各駅から線路をたどり、ほかの駅に着いたらそこで止める。着いた駅が「隣の駅」
  const seen = new Set();
  for (const [idx, coords] of stationIndexes) {
    const dist = new Map();
    const queue = [];
    for (const c of coords) {
      dist.set(key(c), 0);
      queue.push([0, key(c)]);
    }
    let found = 0;
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, v] = queue.shift();
      if (d > (dist.get(v) ?? Infinity)) continue;
      const o = owner.get(v);
      if (o !== undefined && o !== idx) {
        const pair = idx < o ? `${idx}-${o}` : `${o}-${idx}`;
        if (!seen.has(pair)) {
          seen.add(pair);
          outLinks.push([Math.min(idx, o), Math.max(idx, o), Math.round(d)]);
        }
        found++;
        continue;
      }
      for (const [w, m] of graph.get(v) || []) {
        const nd = d + m;
        if (nd < (dist.get(w) ?? Infinity)) {
          dist.set(w, nd);
          queue.push([nd, w]);
        }
      }
    }
    if (found === 0) isolated++;
  }
}

function round5(x) {
  return Math.round(x * 1e5) / 1e5;
}

const out = {
  region: regionKey,
  label: region.label,
  source: "国土交通省 国土数値情報（鉄道データ）N02-2025 を加工（CC BY 4.0）",
  built: new Date().toISOString().slice(0, 10),
  lines: outLines,
  stations: outStations,
  links: outLinks,
};
mkdirSync("apps/commute-range/data", { recursive: true });
const outPath = `apps/commute-range/data/${regionKey}.json`;
writeFileSync(outPath, JSON.stringify(out) + "\n");
console.log(
  `${outPath}: 路線 ${outLines.length} / 駅 ${outStations.length} / つながり ${outLinks.length} / 隣の駅が見つからない駅 ${isolated}`
);
