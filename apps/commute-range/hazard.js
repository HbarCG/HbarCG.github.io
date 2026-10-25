// 通勤圏マップの災害リスクの判定。国土交通省「重ねるハザードマップ」の地図タイル（PNG）を読み、
// 色からリスクの程度を判定する。データはURLから都度読み込む（保存・再配布はしない）。
//   https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html
//
// リスクの程度（sev）:
//   3 = 高い   家屋倒壊等氾濫想定区域、土砂災害特別警戒区域、浸水3m以上
//   2 = 中     土砂災害警戒区域、浸水0.5m以上3m未満
//   1 = 低い   浸水0.5m未満
// 除外の段階（level）が 1 なら sev 3 だけ、2 なら sev 2 以上、3 なら sev 1 以上を除く。
(function (root) {
  "use strict";

  const BASE = "https://disaportaldata.gsi.go.jp/raster/";
  const MAX_ZOOM = 17; // タイルが配信されている最大ズーム

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

  // 1画素の色から { sev, text } を返す（何もなければ null）
  function classify(kind, r, g, b, a) {
    if (a < 128) return null;
    if (kind === "collapse") {
      return r > 200 && g < 80 && b < 80 ? { sev: 3, text: "" } : null;
    }
    if (kind === "landslide") {
      // 特別警戒区域は赤系、警戒区域は黄〜橙。指定予定の区域を囲む青い点線は区域として扱わない
      if (b > r) return null;
      if (r > 140 && g < 100) return { sev: 3, text: "特別警戒区域" };
      if (r > 200 && g >= 130) return { sev: 2, text: "警戒区域" };
      return null;
    }
    // 浸水深: 凡例でいちばん近い色
    let best = null;
    let bestD = 40 * 40; // 境目のにじみ程度の差は許す
    for (const c of DEPTH_COLORS) {
      const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { sev: best.sev, text: `浸水${best.text}` } : null;
  }

  // ---- タイルの読み込み（同じタイルは使い回す） ----

  const cache = new Map(); // "layer/z/x/y" -> Promise<Uint8ClampedArray | null>
  const CACHE_LIMIT = 600;

  function loadTile(layer, z, x, y) {
    const key = `${layer.id}/${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    const p = fetch(`${BASE}${key}.png`)
      .then((res) => (res.ok ? res.blob() : null)) // データのない場所は 404 になる
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bmp) => {
        if (!bmp) return null;
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, 256, 256);
        return ctx.getImageData(0, 0, 256, 256).data;
      })
      .catch(() => null);
    cache.set(key, p);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return p;
  }

  // 表示しているタイル (z, x, y) に対応する配信タイルと、その中での位置。z が 17 を超えるときは 17 のタイルを拡大して使う
  function sourceOf(z, x, y) {
    const hz = Math.min(z, MAX_ZOOM);
    const d = z - hz;
    const f = 1 << d;
    return { hz, hx: x >> d, hy: y >> d, ox: (x & (f - 1)) * (256 / f), oy: (y & (f - 1)) * (256 / f), scale: 1 / f };
  }

  // 表示タイル (z, x, y) のうち、除外する画素に 1 を立てた配列（256×256）を返す
  async function maskForTile(z, x, y, level) {
    const mask = new Uint8Array(256 * 256);
    if (!level) return mask;
    const threshold = 4 - level;
    const src = sourceOf(z, x, y);
    const layers = LAYERS.filter((l) => src.hz >= l.minZoom);
    const datas = await Promise.all(layers.map((l) => loadTile(l, src.hz, src.hx, src.hy)));
    layers.forEach((layer, k) => {
      const data = datas[k];
      if (!data) return;
      for (let py = 0; py < 256; py++) {
        const sy = Math.min(255, Math.floor(src.oy + py * src.scale));
        for (let px = 0; px < 256; px++) {
          if (mask[py * 256 + px]) continue;
          const sx = Math.min(255, Math.floor(src.ox + px * src.scale));
          const o = (sy * 256 + sx) * 4;
          const c = classify(layer.kind, data[o], data[o + 1], data[o + 2], data[o + 3]);
          if (c && c.sev >= threshold) mask[py * 256 + px] = 1;
        }
      }
    });
    return mask;
  }

  // 地点 (lat, lon) のリスクの一覧 [{ label, text, sev }]（ズーム z のタイルで見る）
  async function risksAt(lat, lon, z) {
    const hz = Math.min(Math.max(z, 12), MAX_ZOOM);
    const scale = 256 * Math.pow(2, hz);
    const gx = ((lon + 180) / 360) * scale;
    const s = Math.sin((lat * Math.PI) / 180);
    const gy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    const x = Math.floor(gx / 256);
    const y = Math.floor(gy / 256);
    const px = Math.floor(gx - x * 256);
    const py = Math.floor(gy - y * 256);
    const out = [];
    for (const layer of LAYERS) {
      if (hz < layer.minZoom) continue;
      const data = await loadTile(layer, hz, x, y);
      if (!data) continue;
      const o = (py * 256 + px) * 4;
      const c = classify(layer.kind, data[o], data[o + 1], data[o + 2], data[o + 3]);
      if (c) out.push({ label: layer.label, text: c.text, sev: c.sev });
    }
    return out;
  }

  // 地点 (lat, lon) を中心に半径 radiusM の円の中で、除外の段階 level でも残る（安全な）場所の割合（0〜1）。
  // 円の中を格子状に約100点調べる。ズーム13（1画素およそ20m）のタイルで見る
  async function safeShare(lat, lon, radiusM, level, z) {
    z = z || 13;
    const threshold = 4 - level;
    const scale = 256 * Math.pow(2, z);
    const toGlobal = (la, lo) => {
      const s = Math.sin((la * Math.PI) / 180);
      return [((lo + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
    };
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110540;
    const step = Math.max(radiusM / 5.5, 1);
    const points = [];
    for (let dy = -radiusM; dy <= radiusM + 1e-9; dy += step) {
      for (let dx = -radiusM; dx <= radiusM + 1e-9; dx += step) {
        if (dx * dx + dy * dy <= radiusM * radiusM) points.push(toGlobal(lat + dy / ky, lon + dx / kx));
      }
    }
    if (!points.length) points.push(toGlobal(lat, lon));

    // 必要なタイルをまとめて読む
    const tiles = new Map(); // "x/y" -> [Uint8ClampedArray | null, ...]（LAYERS の順）
    for (const [gx, gy] of points) tiles.set(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`, null);
    await Promise.all(
      [...tiles.keys()].map(async (k) => {
        const [x, y] = k.split("/").map(Number);
        tiles.set(k, await Promise.all(LAYERS.map((l) => (z >= l.minZoom ? loadTile(l, z, x, y) : null))));
      })
    );

    let safe = 0;
    for (const [gx, gy] of points) {
      const x = Math.floor(gx / 256);
      const y = Math.floor(gy / 256);
      const o = (Math.floor(gy - y * 256) * 256 + Math.floor(gx - x * 256)) * 4;
      const datas = tiles.get(`${x}/${y}`);
      const risky = LAYERS.some((layer, k) => {
        const d = datas[k];
        if (!d) return false;
        const c = classify(layer.kind, d[o], d[o + 1], d[o + 2], d[o + 3]);
        return c && c.sev >= threshold;
      });
      if (!risky) safe++;
    }
    return safe / points.length;
  }

  root.CommuteHazard = { LAYERS, classify, maskForTile, risksAt, safeShare };
})(window);
