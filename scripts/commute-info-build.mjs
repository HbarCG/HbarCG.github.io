// Copyright (c) 2026 HbarCG. All rights reserved. 無断での複製・転用を禁じます（apps/commute-range/LICENSE.txt）。
// 通勤圏マップ（apps/commute-range/）の駅ごとの情報と、大規模盛土造成地の区域を作る。
// 先に scripts/commute-rail-build.mjs で apps/commute-range/data/kansai.json を作っておくこと。
//
// 使うデータ（どれも国土数値情報、CC BY 4.0）。ダウンロードして展開したものを1つのフォルダに入れておく:
//   - 駅別乗降客数 S12-25（UTF-8 の S12-25_NumberOfPassengers.geojson）
//   - 地価公示 L01-26（府県ごとの L01-26_NN.geojson）
//   - 大規模盛土造成地 A54-23（府県ごとの A54-23_NN.geojson）
//   - 500mメッシュ別将来推計人口 R6（府県ごとの 500m_mesh_2024_NN.geojson）
// 地盤（揺れやすさ・微地形区分）は J-SHIS（防災科学技術研究所）の表層地盤情報 API から取る。
// 取得結果は第3引数のファイルに保存し、次からはそれを使う（API に何度も問い合わせないため）。
//
// 使い方:
//   node scripts/commute-info-build.mjs <データのフォルダ> [kansai] [J-SHISの保存ファイル]
//   → apps/commute-range/data/kansai-info.json と kansai-morido.json ができる

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const srcDir = process.argv[2];
const regionKey = process.argv[3] || "kansai";
const jshisCachePath = process.argv[4] || `jshis-cache-${regionKey}.json`;
if (!srcDir) {
  console.error("使い方: node scripts/commute-info-build.mjs <データのフォルダ> [kansai] [J-SHISの保存ファイル]");
  process.exit(1);
}

const rail = JSON.parse(readFileSync(`apps/commute-range/data/${regionKey}.json`, "utf8"));
const stations = rail.stations.map(([line, name, lat, lon]) => ({ line: rail.lines[line][0], name, lat, lon }));

// 駅の範囲を少し広げた範囲だけを使う
const lats = stations.map((s) => s.lat);
const lons = stations.map((s) => s.lon);
const bbox = [Math.min(...lats) - 0.05, Math.min(...lons) - 0.05, Math.max(...lats) + 0.05, Math.max(...lons) + 0.05];
const inBox = (lat, lon) => lat >= bbox[0] && lat <= bbox[2] && lon >= bbox[1] && lon <= bbox[3];

function findFiles(dir, re) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findFiles(p, re));
    else if (re.test(name)) out.push(p);
  }
  return out;
}
const readFeatures = (re) => findFiles(srcDir, re).flatMap((f) => JSON.parse(readFileSync(f, "utf8")).features);

function meters(lat1, lon1, lat2, lon2) {
  const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110540);
}
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- 駅別乗降客数（2011〜2024年度。年度ごとに「重複コード・データ有無・備考・乗降客数」の4項目が並ぶ） ----

const passengerYear = (p, year) => {
  const v = p[`S12_${String(9 + 4 * (year - 2011)).padStart(3, "0")}`];
  return typeof v === "number" && v > 0 ? v : null;
};
// 同じ会社・路線・駅名の記録が複数あることがある（JRの大きな駅など。数字は1つにだけ入っていて、ほかは0）ので、大きいほうを残す
const passengers = new Map(); // "事業者 路線|駅名" -> { y2019, y2024 }
for (const f of readFeatures(/S12-25_NumberOfPassengers\.geojson$/)) {
  const p = f.properties;
  const key = `${p.S12_002} ${p.S12_003}|${p.S12_001}`;
  const cur = passengers.get(key) || { y2019: null, y2024: null };
  const max = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b));
  passengers.set(key, { y2019: max(cur.y2019, passengerYear(p, 2019)), y2024: max(cur.y2024, passengerYear(p, 2024)) });
}

// ---- 地価公示（住宅地のみ。L01_002 が用途の区分で "000" が住宅地） ----

const landPoints = readFeatures(/^L01-26_\d\d\.geojson$/)
  .filter((f) => f.properties.L01_002 === "000")
  .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], price: f.properties.L01_008 }))
  .filter((p) => inBox(p.lat, p.lon) && p.price > 0);

// ---- 500mメッシュ別将来推計人口 ----

const meshes = readFeatures(/^500m_mesh_2024_\d\d\.geojson$/)
  .map((f) => {
    const ring = f.geometry.coordinates[0];
    const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
    const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
    return { lat, lon, p2020: f.properties.PTN_2020 || 0, p2050: f.properties.PTN_2050 || 0 };
  })
  .filter((m) => inBox(m.lat, m.lon));

// ---- 大規模盛土造成地（ページで地図から消すのに使う） ----
// そのままだと 20MB 近くあるので、形を約10mの精度に間引き（Douglas-Peucker）、座標を小数5桁に丸める

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const SIMPLIFY_DEG = 0.0001; // 約10m（もともと「おおよその位置と規模」を示すデータなので十分）

function simplify(points, tol) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (points[i][0] - ax) - dx * (points[i][1] - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// 閉じた輪（始点と終点が同じ）は、始点からいちばん遠い点で2つに分けて間引く
function simplifyRing(ring, tol) {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return ring;
  let far = 0;
  let farD = -1;
  pts.forEach(([x, y], i) => {
    const d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol);
  return a.concat(b.slice(1));
}

const morido = [];
for (const f of readFeatures(/^A54-23_\d\d\.geojson$/)) {
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const rings of polys) {
    const outer = rings[0];
    if (!outer.some(([lon, lat]) => inBox(lat, lon))) continue;
    const simplified = rings
      .map((ring) => simplifyRing(ring, SIMPLIFY_DEG).map(([lon, lat]) => [round5(lon), round5(lat)]))
      .filter((ring) => ring.length >= 4);
    if (simplified.length) morido.push(simplified);
  }
}

// ---- J-SHIS 表層地盤（駅と、その周り400mの4点） ----

const jshisCache = existsSync(jshisCachePath) ? JSON.parse(readFileSync(jshisCachePath, "utf8")) : {};
const keyOf = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

async function fetchGround(lat, lon) {
  const key = keyOf(lat, lon);
  if (jshisCache[key] !== undefined) return jshisCache[key];
  const url = `https://www.j-shis.bosai.go.jp/map/api/sstrct/V4/meshinfo.geojson?position=${lon.toFixed(5)},${lat.toFixed(5)}&epsg=4326`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        const p = d.features && d.features[0] && d.features[0].properties;
        jshisCache[key] = p ? { arv: Number(p.ARV) || null, jname: p.JNAME || null } : null;
        return jshisCache[key];
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null; // 取れなかった点は保存しない（次に実行したとき取り直す）
}

const groundPoints = (s) => {
  const d = 400;
  const kx = 111320 * Math.cos((s.lat * Math.PI) / 180);
  return [
    [s.lat, s.lon],
    [s.lat + d / 110540, s.lon],
    [s.lat - d / 110540, s.lon],
    [s.lat, s.lon + d / kx],
    [s.lat, s.lon - d / kx],
  ];
};

// 同時に問い合わせるのは4件まで。進み具合を表示し、途中経過も保存する
const allPoints = [...new Map(stations.flatMap(groundPoints).map(([la, lo]) => [keyOf(la, lo), [la, lo]])).values()];
const todo = allPoints.filter(([la, lo]) => jshisCache[keyOf(la, lo)] === undefined);
console.log(`J-SHIS: ${allPoints.length}地点のうち ${todo.length}地点を問い合わせます`);
let done = 0;
async function worker() {
  while (todo.length) {
    const [la, lo] = todo.shift();
    await fetchGround(la, lo);
    if (++done % 200 === 0) {
      console.log(`  ${done}地点`);
      writeFileSync(jshisCachePath, JSON.stringify(jshisCache));
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
writeFileSync(jshisCachePath, JSON.stringify(jshisCache));

// 微地形区分ごとの液状化のしやすさ（2 = しやすい、1 = ややしやすい、0 = しにくい）。
// 若松ほか（2013）などで液状化しやすいとされる区分をもとにした目安
const LIQUEFACTION = {
  埋立地: 2,
  干拓地: 2,
  旧河道: 2,
  河原: 2,
  "砂州・砂丘間低地": 2,
  "三角州・海岸低地": 1,
  後背湿地: 1,
  自然堤防: 1,
  "砂州・砂礫州": 1,
  砂丘: 1,
  谷底低地: 1,
  扇状地: 1,
};

// ---- 駅ごとにまとめる ----

const info = stations.map((s) => {
  const pas = passengers.get(`${s.line}|${s.name}`) || null;

  let near = landPoints.filter((p) => meters(s.lat, s.lon, p.lat, p.lon) <= 1000);
  if (near.length < 2) near = landPoints.filter((p) => meters(s.lat, s.lon, p.lat, p.lon) <= 2000);
  const land = near.length ? Math.round(median(near.map((p) => p.price))) : null;

  let p2020 = 0;
  let p2050 = 0;
  for (const m of meshes) {
    if (meters(s.lat, s.lon, m.lat, m.lon) <= 1000) {
      p2020 += m.p2020;
      p2050 += m.p2050;
    }
  }

  const grounds = groundPoints(s).map(([la, lo]) => jshisCache[keyOf(la, lo)]).filter(Boolean);
  const arv = median(grounds.map((g) => g.arv).filter((v) => v));
  const center = jshisCache[keyOf(s.lat, s.lon)];
  const liq = grounds.length ? Math.max(...grounds.map((g) => LIQUEFACTION[g.jname] || 0)) : null;

  return [
    pas ? pas.y2024 : null, // 乗降客数（2024年度、人/日）
    pas ? pas.y2019 : null, // 乗降客数（2019年度）
    land, // 住宅地の公示地価の中央値（円/m²、駅から1km以内。少なければ2km以内）
    p2020 > 0 ? Math.round(p2020) : null, // 駅から1km以内の人口（2020年）
    p2020 > 0 ? Math.round(p2050) : null, // 同じ範囲の推計人口（2050年）
    arv ? Math.round(arv * 100) / 100 : null, // 地盤増幅率（駅と周り400mの5点の中央値）
    center ? center.jname : null, // 駅の場所の微地形区分
    liq, // 液状化のしやすさ（5点のうち最も高いもの）
  ];
});

const out = {
  region: regionKey,
  built: new Date().toISOString().slice(0, 10),
  fields: ["passengers2024", "passengers2019", "landPrice", "pop2020", "pop2050", "arv", "landform", "liquefaction"],
  sources: [
    "国土交通省 国土数値情報（駅別乗降客数 S12-25、地価公示 L01-26、500mメッシュ別将来推計人口 R6）を加工（CC BY 4.0）",
    "防災科学技術研究所 J-SHIS 表層地盤情報（V4）を加工",
  ],
  stations: info,
};
writeFileSync(`apps/commute-range/data/${regionKey}-info.json`, JSON.stringify(out) + "\n");
writeFileSync(
  `apps/commute-range/data/${regionKey}-morido.json`,
  JSON.stringify({
    source: "国土交通省 国土数値情報（大規模盛土造成地 A54-23）を加工（CC BY 4.0）",
    polygons: morido,
  }) + "\n"
);

const count = (i) => info.filter((r) => r[i] !== null).length;
console.log(
  `駅 ${info.length}: 乗降客数あり ${count(0)} / 地価あり ${count(2)} / 人口あり ${count(3)} / 地盤あり ${count(5)}、盛土の区域 ${morido.length}`
);
