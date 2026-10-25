// Copyright (c) 2026 HbarCG. All rights reserved. 無断での複製・転用を禁じます（apps/commute-range/LICENSE.txt）。
// 通勤圏マップの災害リスクの判定。国土交通省「重ねるハザードマップ」の地図タイル（PNG）を読み、
// 色からリスクの程度を判定する。データはURLから都度読み込む（保存・再配布はしない）。
//   https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html
//
// リスクの程度（sev）:
//   3 = 高い   家屋倒壊等氾濫想定区域、土砂災害特別警戒区域、浸水3m以上
//   2 = 中     土砂災害警戒区域、浸水0.5m以上3m未満
//   1 = 低い   浸水0.5m未満
// 除外の段階（level）が 1 なら sev 3 だけ、2 なら sev 2 以上、3 なら sev 1 以上を除く。
// 川や海の水面は、段階にかかわらず「住めない場所」として除く。
(function (root) {
  "use strict";

  const BASE = "https://disaportaldata.gsi.go.jp/raster/";
  const MAX_ZOOM = 17; // ハザードマップのタイルが配信されている最大ズーム

  const LAYERS = [
    { id: "01_flood_l2_shinsuishin_data", kind: "depth", label: "洪水", minZoom: 2 },
    { id: "03_hightide_l2_shinsuishin_data", kind: "depth", label: "高潮", minZoom: 2 },
    { id: "04_tsunami_newlegend_data", kind: "depth", label: "津波", minZoom: 2 },
    { id: "01_flood_l2_kaokutoukai_hanran_data", kind: "collapse", label: "家屋倒壊等氾濫想定区域（氾濫流）", minZoom: 4 },
    { id: "01_flood_l2_kaokutoukai_kagan_data", kind: "collapse", label: "家屋倒壊等氾濫想定区域（河岸侵食）", minZoom: 4 },
    { id: "05_dosekiryukeikaikuiki", kind: "landslide", label: "土砂災害（土石流）", minZoom: 2 },
    { id: "05_kyukeishakeikaikuiki", kind: "landslide", label: "土砂災害（がけ崩れ）", minZoom: 2 },
    { id: "05_jisuberikeikaikuiki", kind: "landslide", label: "土砂災害（地すべり）", minZoom: 2 },
  ];

  // 川や海の水面。ハザードマップは水面そのものを塗らないので、そのままだと「リスクのない場所」に見えてしまう。
  // 地理院の淡色地図の水色で見分ける。ズーム12以下では太い川も線で描かれていて見分けられないので使わない
  const WATER = { id: "pale", base: "https://cyberjapandata.gsi.go.jp/xyz/", kind: "water", minZoom: 13 };
  const WATER_SHARE_ZOOM = 14; // 安全な範囲の割合を出すときに水面を見るズーム

  // 浸水深の凡例の色（shinsui_legend3.png）
  const DEPTH_COLORS = [
    { rgb: [255, 255, 179], text: "0.3m未満", sev: 1 },
    { rgb: [247, 245, 169], text: "0.5m未満", sev: 1 },
    { rgb: [248, 225, 166], text: "0.5〜1m", sev: 2 },
    { rgb: [255, 216, 192], text: "0.5〜3m", sev: 2 },
    { rgb: [255, 183, 183], text: "3〜5m", sev: 3 },
    { rgb: [255, 145, 145], text: "5〜10m", sev: 3 },
    { rgb: [242, 133, 201], text: "10〜20m", sev: 3 },
    { rgb: [220, 122, 220], text: "20m以上", sev: 3 },
  ];

  // 画素の色を区分の番号にする（0 は「何もない」）。タイルはこの番号の配列にして持つ
  //   depth: 1〜8（DEPTH_COLORS の順）  collapse: 1  landslide: 1 = 警戒区域, 2 = 特別警戒区域  water: 1
  function codeOf(kind, r, g, b, a) {
    if (a < 128) return 0;
    if (kind === "water") return Math.abs(r - 190) < 14 && Math.abs(g - 210) < 14 && b > 240 ? 1 : 0;
    if (kind === "collapse") return r > 200 && g < 80 && b < 80 ? 1 : 0;
    if (kind === "landslide") {
      // 特別警戒区域は赤系、警戒区域は黄〜橙。指定予定の区域を囲む青い点線は区域として扱わない
      if (b > r) return 0;
      if (r > 140 && g < 100) return 2;
      if (r > 200 && g >= 130) return 1;
      return 0;
    }
    // 浸水深: 凡例でいちばん近い色（境目のにじみ程度の差は許す）
    let best = 0;
    let bestD = 40 * 40;
    DEPTH_COLORS.forEach((c, i) => {
      const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    });
    return best;
  }

  // 区分の番号から { sev, text } を返す（何もなければ null）
  function describe(kind, code) {
    if (!code) return null;
    if (kind === "collapse") return { sev: 3, text: "" };
    if (kind === "landslide") return code === 2 ? { sev: 3, text: "特別警戒区域" } : { sev: 2, text: "警戒区域" };
    const c = DEPTH_COLORS[code - 1];
    return { sev: c.sev, text: `浸水${c.text}` };
  }

  // 区分の番号ごとのリスクの程度（毎回 describe を呼ばずに済むように表にしておく）
  const SEV = {};
  for (const kind of ["depth", "collapse", "landslide"]) {
    SEV[kind] = new Uint8Array(16);
    for (let code = 1; code < 16; code++) {
      if (kind === "depth" && code > DEPTH_COLORS.length) break;
      if (kind === "collapse" && code > 1) break;
      if (kind === "landslide" && code > 2) break;
      SEV[kind][code] = describe(kind, code).sev;
    }
  }

  // ---- タイルの読み込み（同じタイルは使い回す） ----

  const cache = new Map(); // "layer/z/x/y" -> Promise<Uint8Array(256*256) | null>（区分の番号）
  const CACHE_LIMIT = 1200; // 1枚 64KB。データのない場所は null なのでほとんど場所を取らない

  function loadTile(layer, z, x, y) {
    const key = `${layer.id}/${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    const p = fetch(`${layer.base || BASE}${key}.png`)
      .then((res) => (res.ok ? res.blob() : null)) // データのない場所は 404 になる
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bmp) => {
        if (!bmp) return null;
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, 256, 256);
        const rgba = ctx.getImageData(0, 0, 256, 256).data;
        const codes = new Uint8Array(256 * 256);
        let any = false;
        for (let i = 0; i < codes.length; i++) {
          const o = i * 4;
          codes[i] = codeOf(layer.kind, rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
          if (codes[i]) any = true;
        }
        return any ? codes : null;
      })
      .catch(() => null);
    cache.set(key, p);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return p;
  }

  // 地点 (lat, lon) が、ズーム z のどのタイルの何番目の画素か
  function locate(lat, lon, z) {
    const scale = 256 * Math.pow(2, z);
    const s = Math.sin((lat * Math.PI) / 180);
    const gx = ((lon + 180) / 360) * scale;
    const gy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    const x = Math.floor(gx / 256);
    const y = Math.floor(gy / 256);
    return { key: `${x}/${y}`, x, y, i: Math.floor(gy - y * 256) * 256 + Math.floor(gx - x * 256) };
  }

  // 表示しているタイル (z, x, y) のうち、除外する画素に 1 を立てた配列（256×256）を返す。
  // z が 17 を超えるときは、ハザードマップは 17 のタイルを拡大して使う
  async function maskForTile(z, x, y, level) {
    const mask = new Uint8Array(256 * 256);
    if (!level) return mask;
    const threshold = 4 - level;
    const hz = Math.min(z, MAX_ZOOM);
    const f = 1 << (z - hz);
    const ox = (x & (f - 1)) * (256 / f);
    const oy = (y & (f - 1)) * (256 / f);
    const layers = LAYERS.filter((l) => hz >= l.minZoom);
    const [water, ...datas] = await Promise.all([
      z >= WATER.minZoom ? loadTile(WATER, z, x, y) : null,
      ...layers.map((l) => loadTile(l, hz, x >> (z - hz), y >> (z - hz))),
    ]);
    if (water) mask.set(water); // 水面は 1
    layers.forEach((layer, k) => {
      const codes = datas[k];
      if (!codes) return;
      const sev = SEV[layer.kind];
      for (let py = 0; py < 256; py++) {
        const row = Math.min(255, Math.floor(oy + py / f)) * 256;
        for (let px = 0; px < 256; px++) {
          const i = py * 256 + px;
          if (!mask[i] && sev[codes[row + Math.min(255, Math.floor(ox + px / f))]] >= threshold) mask[i] = 1;
        }
      }
    });
    return mask;
  }

  // 地点 (lat, lon) のリスクの一覧 [{ label, text, sev }]（ズーム z のタイルで見る）
  async function risksAt(lat, lon, z) {
    const hz = Math.min(Math.max(z, 12), MAX_ZOOM);
    const p = locate(lat, lon, hz);
    const out = [];
    for (const layer of LAYERS) {
      if (hz < layer.minZoom) continue;
      const codes = await loadTile(layer, hz, p.x, p.y);
      const c = codes && describe(layer.kind, codes[p.i]);
      if (c) out.push({ label: layer.label, text: c.text, sev: c.sev });
    }
    return out;
  }

  // 地点 (lat, lon) を中心に半径 radiusM の円の中で、除外の段階 level でも残る（安全な）場所の割合（0〜1）。
  // 円の中を格子状に約100点調べる。災害の想定はズーム13（1画素およそ20m）、水面はズーム14のタイルで見て、
  // 水面の点は割合の計算から外す（陸地のうち何割が安全か）
  async function safeShare(lat, lon, radiusM, level) {
    const z = 13;
    const threshold = 4 - level;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110540;
    const step = Math.max(radiusM / 5.5, 1);
    const points = []; // [緯度, 経度]
    for (let dy = -radiusM; dy <= radiusM + 1e-9; dy += step) {
      for (let dx = -radiusM; dx <= radiusM + 1e-9; dx += step) {
        if (dx * dx + dy * dy <= radiusM * radiusM) points.push([lat + dy / ky, lon + dx / kx]);
      }
    }
    if (!points.length) points.push([lat, lon]);
    const hz = points.map(([la, lo]) => locate(la, lo, z));
    const wz = points.map(([la, lo]) => locate(la, lo, WATER_SHARE_ZOOM));

    // 必要なタイルをまとめて読む
    const hazardTiles = new Map(); // "x/y" -> [Uint8Array | null, ...]（LAYERS の順）
    const waterTiles = new Map(); // "x/y" -> Uint8Array | null
    const jobs = [];
    for (const p of hz) {
      if (hazardTiles.has(p.key)) continue;
      hazardTiles.set(p.key, null);
      jobs.push(Promise.all(LAYERS.map((l) => loadTile(l, z, p.x, p.y))).then((d) => hazardTiles.set(p.key, d)));
    }
    for (const p of wz) {
      if (waterTiles.has(p.key)) continue;
      waterTiles.set(p.key, null);
      jobs.push(loadTile(WATER, WATER_SHARE_ZOOM, p.x, p.y).then((d) => waterTiles.set(p.key, d)));
    }
    await Promise.all(jobs);

    let land = 0;
    let safe = 0;
    points.forEach((_, n) => {
      const water = waterTiles.get(wz[n].key);
      if (water && water[wz[n].i]) return;
      land++;
      const datas = hazardTiles.get(hz[n].key);
      const i = hz[n].i;
      const risky = LAYERS.some((layer, k) => datas[k] && SEV[layer.kind][datas[k][i]] >= threshold);
      if (!risky) safe++;
    });
    return land ? safe / land : 0;
  }

  root.CommuteHazard = { LAYERS, maskForTile, risksAt, safeShare };
})(window);
