// Copyright (c) 2026 HbarCG. All rights reserved. 無断での複製・転用を禁じます（apps/commute-range/LICENSE.txt）。
(function () {
  "use strict";

  const Rail = window.CommuteRail;
  const Hazard = window.CommuteHazard;
  Hazard.setFillData("/apps/commute-range/data/kansai-morido.json");

  const DATA_URL = "/apps/commute-range/data/kansai.json";
  const INFO_URL = "/apps/commute-range/data/kansai-info.json";
  const VALHALLA_URL = "https://valhalla1.openstreetmap.de/isochrone";
  const ADDRESS_SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
  const DEFAULT_CENTER = [34.7025, 135.4959]; // 大阪駅
  const DEFAULT_ZOOM = 11;

  // 目的地は4か所まで。A〜D の記号で呼ぶ
  const MAX_DESTS = 4;
  const LETTERS = ["A", "B", "C", "D"];
  const LIMIT_OPTIONS = [15, 20, 30, 45, 60];
  const DEFAULT_LIMIT = 30;
  const MAP_POINT_LABEL = "地図で選んだ地点";

  // 近い → 遠い の3段階（同じ青の濃い → 薄い）。上限時間を3等分して塗り分ける。
  // 目的地が複数あるときは、いちばん遠い目的地で見た「上限に対する割合」で塗り分ける
  const BAND_COLORS = ["#184f95", "#3987e5", "#86b6ef"];
  const BAND_RGB = BAND_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const REACH_OPACITY = 0.7; // 塗りの濃さは pane ごとまとめて下げる（重なっても色が濃くならない）
  const OUTLINE_RGB = [13, 54, 107]; // 範囲の境目の線（塗りのいちばん濃い青よりさらに濃い色）
  const STATIONS_MIN_ZOOM = 13; // 駅の点はこのズーム以上で出す（一覧で絞り込んでいるときはいつでも出す）
  const SAMPLE_PX = 2; // 電車の塗りは2pxごとに計算する

  const MODE_LABELS = { rail: "電車＋徒歩", pedestrian: "徒歩", bicycle: "自転車", auto: "車" };

  const form = document.getElementById("cr-form");
  const destInput = document.getElementById("cr-dest");
  const destsBox = document.getElementById("cr-dests");
  const destsList = document.getElementById("cr-dests-list");
  const modeSelect = document.getElementById("cr-mode");
  const transfersSelect = document.getElementById("cr-transfers");
  const hazardSelect = document.getElementById("cr-hazard");
  const statusEl = document.getElementById("cr-status");
  const legendEl = document.getElementById("cr-legend");
  const stationsSection = document.getElementById("cr-stations");
  const stationsBody = document.getElementById("cr-stations-body");
  const stationsTable = document.querySelector(".cr-table");
  const stationsCount = document.getElementById("cr-stations-count");
  const stationsNote = document.getElementById("cr-stations-note");

  const state = {
    // 目的地 { lat, lon, label, limit, result（電車の計算）, sources（電車の塗りに使う点）, geo（Valhalla の範囲）, marker }
    dests: [],
    mode: "rail",
    maxTransfers: null, // 乗り換えの上限（null なら制限なし）。電車のときだけ使う
    hazardLevel: 0, // 災害リスクで除外する段階（0 なら除外しない。hazard.js を参照）
    graph: null,
    railBounds: null, // 電車のデータがある範囲
    railReady: false, // 電車の計算が済んでいるか
    requestId: 0,
    stationsRequestId: 0,
  };

  const letterOf = (d) => LETTERS[state.dests.indexOf(d)];
  const multi = () => state.dests.length > 1;

  // ---- 地図 ----

  const map = L.map("cr-map", { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  }).addTo(map);

  map.createPane("reach");
  map.getPane("reach").style.zIndex = 350;
  map.getPane("reach").style.opacity = String(REACH_OPACITY);
  map.getPane("reach").style.pointerEvents = "none";

  // 通勤圏の塗り。電車は自前の計算、徒歩・自転車・車は Valhalla の範囲をタイルごとに描き、
  // 災害リスクで除外する設定なら、そのあとでハザードマップの該当箇所を消す
  const ReachLayer = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      // 境目の線と災害リスクの除外で何度も画素を読み返すので、そのための設定で作っておく
      tile.getContext("2d", { willReadFrequently: true });
      const drawn = state.mode === "rail" ? drawRailTile(tile, coords, size.x) : drawRoadTile(tile, coords, size.x);
      if (drawn) addOutline(tile, size.x);
      if (!drawn || !state.hazardLevel) {
        setTimeout(() => done(null, tile), 0);
        return tile;
      }
      Hazard.maskForTile(coords.z, coords.x, coords.y, state.hazardLevel).then((mask) => {
        const ctx = tile.getContext("2d");
        const img = ctx.getImageData(0, 0, size.x, size.y);
        for (let i = 0; i < mask.length; i++) {
          if (mask[i]) img.data[i * 4 + 3] = 0;
        }
        ctx.putImageData(img, 0, 0);
        done(null, tile);
      });
      return tile;
    },
  });
  const reachTiles = new ReachLayer({ pane: "reach", updateWhenZooming: false });
  reachTiles.addTo(map);

  // 範囲の境目に線を引く。塗った画素のうち、2px 以内に塗っていない画素があるものを線の色にする。
  // タイルの外は分からないので「塗ってある」とみなす（タイルの継ぎ目に線が出ないように）。
  // 災害リスクで消す前の範囲に引くので、ハザードの細かい穴ごとに線が増えることはない
  function addOutline(canvas, size) {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, size, size);
    const a = img.data;
    const filled = (x, y) => x < 0 || y < 0 || x >= size || y >= size || a[(y * size + x) * 4 + 3] > 0;
    const edge = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!a[(y * size + x) * 4 + 3]) continue;
        if (!filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1) || !filled(x - 2, y) || !filled(x + 2, y) || !filled(x, y - 2) || !filled(x, y + 2)) {
          edge.push((y * size + x) * 4);
        }
      }
    }
    for (const o of edge) {
      a[o] = OUTLINE_RGB[0];
      a[o + 1] = OUTLINE_RGB[1];
      a[o + 2] = OUTLINE_RGB[2];
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- 全画面表示 ----
  // ブラウザの全画面機能を使う（凡例も一緒に入るよう、地図を囲む要素ごと全画面にする）。
  // iPhone の Safari のように要素の全画面に対応していないときは、ページの上に地図を画面いっぱいに広げる
  const mapWrap = document.querySelector(".cr-map-wrap");
  const canFullscreen = !!(mapWrap.requestFullscreen && document.exitFullscreen);
  const FullscreenControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const box = L.DomUtil.create("div", "leaflet-bar");
      const btn = L.DomUtil.create("a", "cr-fullscreen-btn", box);
      btn.href = "#";
      btn.setAttribute("role", "button");
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.preventDefault(e);
        toggleFullscreen();
      });
      this.btn = btn;
      return box;
    },
  });
  const fullscreenControl = new FullscreenControl();
  fullscreenControl.addTo(map);

  function isFullscreen() {
    return canFullscreen ? document.fullscreenElement === mapWrap : mapWrap.classList.contains("is-fullscreen");
  }

  function toggleFullscreen() {
    if (canFullscreen) {
      if (isFullscreen()) document.exitFullscreen();
      else mapWrap.requestFullscreen().catch(() => setPseudoFullscreen(true));
    } else {
      setPseudoFullscreen(!isFullscreen());
    }
  }

  // 全画面機能が使えないときの代わり（CSS で画面いっぱいに広げる）
  function setPseudoFullscreen(on) {
    mapWrap.classList.toggle("is-fullscreen", on);
    onFullscreenChange();
  }

  function onFullscreenChange() {
    const on = isFullscreen() || mapWrap.classList.contains("is-fullscreen");
    const btn = fullscreenControl.btn;
    btn.textContent = on ? "✕" : "⛶";
    btn.title = on ? "全画面を終わる（Esc）" : "地図を全画面で表示";
    btn.setAttribute("aria-label", btn.title);
    mapWrap.classList.toggle("is-fullscreen-active", on);
    // 全画面のあいだは後ろのページのスクロール（とスクロールバーのぶんの隙間）をなくす
    document.documentElement.classList.toggle("cr-no-scroll", on);
    // 地図の大きさが変わったことを Leaflet に伝える
    setTimeout(() => map.invalidateSize(), 50);
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mapWrap.classList.contains("is-fullscreen")) setPseudoFullscreen(false);
  });
  onFullscreenChange();

  // 範囲内の駅の点。数百個になることがあるので canvas で描く
  map.createPane("stations");
  map.getPane("stations").style.zIndex = 450;
  const stationRenderer = L.canvas({ pane: "stations", padding: 0.5 });
  const stationLayer = L.layerGroup().addTo(map);

  // 駅の点は数百個になり、広く見ると範囲を隠してしまうので、拡大したときだけ出す。
  // 一覧で絞り込んでいるときは、絞り込んだ駅がどこかを見たいので、いつでも出す
  function updateStationVisibility() {
    const show = map.getZoom() >= STATIONS_MIN_ZOOM || !!state.filteredStations;
    if (show && !map.hasLayer(stationLayer)) stationLayer.addTo(map);
    if (!show && map.hasLayer(stationLayer)) stationLayer.remove();
    renderLegend();
  }
  map.on("zoomend", updateStationVisibility);

  // 上限に対する割合（0〜1）から塗りの段階を決める
  function bandOfRatio(r) {
    if (r <= 1 / 3 + 1e-6) return 0;
    if (r <= 2 / 3 + 1e-6) return 1;
    return 2;
  }

  // ---- 電車の塗り ----

  // タイル内の各点について、目的地ごとに「いちばん早く着ける駅（または目的地まで直接歩く）」の時間を出す。
  // すべての目的地に上限時間内で着ける点だけを、いちばん遠い目的地の上限に対する割合で塗り分ける。
  // 何か描いたら true を返す
  function drawRailTile(canvas, coords, size) {
    // 目的地を足した直後など、まだ計算していない目的地があるときは描かない
    if (!state.railReady || !state.dests.length || state.dests.some((d) => !d.sources)) return false;
    const scale = 256 * Math.pow(2, coords.z);
    const x0 = coords.x * size;
    const y0 = coords.y * size;
    const lonAt = (px) => (px / scale) * 360 - 180;
    const latAt = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / scale))) * 180) / Math.PI;

    const north = latAt(y0);
    const south = latAt(y0 + size);
    const west = lonAt(x0);
    const east = lonAt(x0 + size);
    const kx = 111320 * Math.cos((((north + south) / 2) * Math.PI) / 180);
    const ky = 110540;
    const p = state.graph.params;
    const minPerMeter = p.walkDetour / p.walkMetersPerMin;

    // 目的地ごとに、このタイルに届く駅だけに絞る（残り時間で歩ける距離がタイルにかかるもの）。
    // 一覧で駅を絞り込んでいるときは、絞り込んだ駅の周りだけを塗る（目的地まで直接歩く範囲は塗らない）
    const only = state.filteredStations;
    const nears = [];
    for (const d of state.dests) {
      const near = [];
      for (const s of d.sources) {
        if (only && (s.i === undefined || !only.has(s.i))) continue;
        const reach = Math.min(d.limit - s.t, s.maxWalk) / minPerMeter;
        const dx = Math.max(west - s.lon, 0, s.lon - east) * kx;
        const dy = Math.max(south - s.lat, 0, s.lat - north) * ky;
        if (dx * dx + dy * dy <= reach * reach) near.push(s);
      }
      if (!near.length) return false; // この目的地に届く場所がタイルにない＝すべてを満たす場所もない
      near.sort((a, b) => a.t - b.t);
      nears.push(near);
    }

    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let sy = 0; sy < size; sy += SAMPLE_PX) {
      const lat = latAt(y0 + sy + SAMPLE_PX / 2);
      for (let sx = 0; sx < size; sx += SAMPLE_PX) {
        const lon = lonAt(x0 + sx + SAMPLE_PX / 2);
        let worst = 0;
        let ok = true;
        for (let k = 0; k < nears.length && ok; k++) {
          const limit = state.dests[k].limit;
          let best = Infinity;
          for (const s of nears[k]) {
            if (s.t >= best) break; // t の小さい順に並べてあるので、ここから先は更新されない
            const dx = (lon - s.lon) * kx;
            const dy = (lat - s.lat) * ky;
            const walk = Math.sqrt(dx * dx + dy * dy) * minPerMeter;
            if (walk > s.maxWalk) continue;
            const t = s.t + walk;
            if (t < best) best = t;
          }
          if (best > limit) ok = false;
          else worst = Math.max(worst, best / limit);
        }
        if (!ok) continue;
        const rgb = BAND_RGB[bandOfRatio(worst)];
        for (let yy = sy; yy < sy + SAMPLE_PX && yy < size; yy++) {
          for (let xx = sx; xx < sx + SAMPLE_PX && xx < size; xx++) {
            const o = (yy * size + xx) * 4;
            img.data[o] = rgb[0];
            img.data[o + 1] = rgb[1];
            img.data[o + 2] = rgb[2];
            img.data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  // ---- 徒歩・自転車・車の塗り（Valhalla の範囲） ----

  // 目的地ごとに範囲（GeoJSON の多角形）をタイルの形に塗り、画素ごとの段階（0 = 範囲外、1〜3 = 段階+1）にする
  function rasterizeRoad(d, coords, size) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const scale = 256 * Math.pow(2, coords.z);
    const x0 = coords.x * size;
    const y0 = coords.y * size;
    const toPx = ([lon, lat]) => {
      const s = Math.sin((lat * Math.PI) / 180);
      return [((lon + 180) / 360) * scale - x0, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale - y0];
    };
    // 大きい範囲（遠い段階）から順に重ね、内側（近い段階）ほど上に来るようにする。段階は赤の強さで表す
    const SHADE = [255, 170, 85];
    const features = (d.geo.features || []).slice().sort((a, b) => b.properties.contour - a.properties.contour);
    for (const f of features) {
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      ctx.beginPath();
      for (const rings of polys) {
        for (const ring of rings) {
          ring.forEach((c, i) => {
            const [px, py] = toPx(c);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
        }
      }
      ctx.fillStyle = `rgb(${SHADE[bandOfRatio(f.properties.contour / d.limit)]},0,0)`;
      ctx.fill("evenodd");
    }
    const rgba = ctx.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) {
      if (rgba[i * 4 + 3] < 128) continue;
      const r = rgba[i * 4];
      out[i] = r > 212 ? 1 : r > 127 ? 2 : 3;
    }
    return out;
  }

  function drawRoadTile(canvas, coords, size) {
    if (!state.dests.length || state.dests.some((d) => !d.geo)) return false;
    const layers = state.dests.map((d) => rasterizeRoad(d, coords, size));
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    let any = false;
    for (let i = 0; i < size * size; i++) {
      let worst = 0;
      for (const l of layers) {
        if (!l[i]) {
          worst = 0;
          break;
        }
        worst = Math.max(worst, l[i]);
      }
      if (!worst) continue;
      const rgb = BAND_RGB[worst - 1];
      img.data[i * 4] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = 255;
      any = true;
    }
    ctx.putImageData(img, 0, 0);
    return any;
  }

  // ---- 電車の計算 ----

  function inRailArea(lat, lon) {
    const b = state.railBounds;
    return b && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  }

  function computeRail() {
    const { graph } = state;
    const maxWalk = graph.params.maxStationWalkMin;
    for (const d of state.dests) {
      d.result = Rail.timesTo(graph, d.lat, d.lon, d.limit, state.maxTransfers);
      // 目的地へ直接歩くのは上限時間まで、駅まで歩くのは maxStationWalkMin まで
      d.sources = [{ lat: d.lat, lon: d.lon, t: 0, maxWalk: d.limit }];
      for (let i = 0; i < graph.n; i++) {
        const t = d.result.time[i];
        if (t <= d.limit) d.sources.push({ i, lat: graph.stations[i].lat, lon: graph.stations[i].lon, t, maxWalk });
      }
    }
    state.railReady = true;
    reachTiles.redraw();
    const groups = groupStations();
    const id = ++state.stationsRequestId;
    if (!state.hazardLevel) {
      renderStations(groups);
      setStatus(railStatus(groups.length));
      return;
    }
    // 災害リスクで除外するときは、駅から歩いて住める範囲（地図の塗りと同じ円）のうち
    // 除外されずに残る場所の割合を出す。残る場所がまったくない駅だけ一覧と地図から外す。
    // 一覧は先に出し、割合はタイルを読み終えてから埋める
    renderStations(groups);
    setStatus(railStatus(null));
    const p = graph.params;
    const minPerMeter = p.walkDetour / p.walkMetersPerMin;
    const failuresBefore = Hazard.failureCount();
    Promise.all(
      groups.map((g) => {
        // 住める範囲は、どの目的地にも間に合う範囲（残り時間がいちばん少ない目的地で決まる）
        const spare = Math.min(...state.dests.map((d, k) => d.limit - g.minutesBy[k]));
        const radius = Math.min(spare, p.maxStationWalkMin) / minPerMeter;
        return Hazard.safeShare(g.lat, g.lon, radius, state.hazardLevel);
      })
    ).then((shares) => {
      if (id !== state.stationsRequestId) return; // あとから別の条件で計算し直した
      groups.forEach((g, k) => (g.safeShare = shares[k]));
      const kept = groups.filter((g) => g.safeShare > 0);
      renderStations(kept);
      let msg = railStatus(kept.length, groups.length - kept.length);
      if (Hazard.failureCount() > failuresBefore) {
        msg += " 一部のハザードマップを読み込めなかったため、結果が実際より安全側に出ている可能性があります。少し待ってから条件を選び直してください。";
      }
      setStatus(msg);
    });
  }

  // 「「大阪駅」まで30分以内」「「大阪駅」(A)まで30分以内・「京都駅」(B)まで45分以内」
  function destsText() {
    return state.dests
      .map((d) => `「${d.label}」${multi() ? `（${letterOf(d)}）` : ""}まで${d.limit}分以内`)
      .join("・");
  }

  function railStatus(count, removed) {
    const transfers =
      state.maxTransfers === null ? "" : state.maxTransfers === 0 ? "・乗り換えなし" : `・乗り換え${state.maxTransfers}回まで`;
    const stations =
      count === null
        ? "駅の周りの災害リスクを確認中…"
        : removed
          ? `駅 ${count}。ほかに、歩いて住める範囲がすべて除外の対象になる駅が ${removed}`
          : `駅 ${count}`;
    const hazard = state.hazardLevel ? `${HAZARD_LABELS[state.hazardLevel]}。` : "";
    const all = multi() ? "（すべてを満たす場所）" : "";
    let msg = `${destsText()}${all}、${MODE_LABELS.rail}${transfers}の範囲です（${hazard}${stations}）。`;
    if (state.dests.some((d) => !inRailArea(d.lat, d.lon))) {
      msg += " 電車のデータは関西圏だけなので、関西圏の外の目的地には徒歩の範囲しか出ません。";
    }
    return msg;
  }

  function clearRail() {
    state.stationsRequestId++;
    state.railReady = false;
    for (const d of state.dests) {
      d.result = null;
      d.sources = null;
    }
    reachTiles.redraw();
    renderStations([]);
  }

  // ---- 範囲内の駅の一覧と地図の点 ----

  // データでは駅が路線ごとに分かれているので、同じ名前で近く（500m以内）にある駅を1つにまとめる。
  // すべての目的地に上限時間内で着ける駅だけを出す。時間は目的地ごとに、まとめた中でいちばん早い路線のもの
  function groupStations() {
    const { graph } = state;
    const dests = state.dests;
    const ok = (i) => dests.every((d) => d.result.time[i] <= d.limit);
    const worstRatio = (i) => Math.max(...dests.map((d) => d.result.time[i] / d.limit));
    const idx = [];
    for (let i = 0; i < graph.n; i++) {
      if (ok(i)) idx.push(i);
    }
    idx.sort((a, b) => worstRatio(a) - worstRatio(b));
    const groups = [];
    for (const i of idx) {
      const s = graph.stations[i];
      const g = groups.find((g) => g.name === s.name && Rail.metersBetween(g.lat, g.lon, s.lat, s.lon) < 500);
      const line = shortName(graph.lines[s.line][0]);
      if (g) {
        if (!g.lines.includes(line)) g.lines.push(line);
        g.members.push(i);
        // 目的地ごとに、いちばん早く着ける路線の駅を選び直す
        dests.forEach((d, k) => {
          if (d.result.time[i] < g.minutesBy[k]) {
            g.minutesBy[k] = d.result.time[i];
            g.stationBy[k] = i;
          }
        });
        continue;
      }
      groups.push({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        station: i,
        members: [i],
        stationBy: dests.map(() => i), // 目的地ごとに、経路の出発に使う駅
        minutesBy: dests.map((d) => d.result.time[i]),
        lines: [line],
      });
    }
    // 範囲外の路線も含めて、同じ駅の路線をすべて members に入れる（乗降客数は路線ごとに分かれているため）
    for (const g of groups) {
      for (let i = 0; i < graph.n; i++) {
        const s = graph.stations[i];
        if (!g.members.includes(i) && s.name === g.name && Rail.metersBetween(g.lat, g.lon, s.lat, s.lon) < 500) {
          g.members.push(i);
        }
      }
      // 目的地ごとの経路。一覧の「乗り換え」はいちばん多い目的地のもの、「目的地まで」はいちばん遠い目的地のもの
      g.ridesBy = dests.map((d, k) => Rail.describeRoute(graph, d.result, g.stationBy[k]).filter((step) => step.type === "ride"));
      g.transfers = Math.max(...g.ridesBy.map((r) => Math.max(0, r.length - 1)));
      g.viaBy = g.ridesBy.map((rides) => rides.map((r) => shortName(r.service)).join(" → "));
      g.via = g.viaBy.join(" / ");
      g.minutes = Math.max(...g.minutesBy);
      g.ratio = Math.max(...g.minutesBy.map((m, k) => m / dests[k].limit));
      Object.assign(g, stationInfo(g.members));
    }
    return groups;
  }

  // 駅ごとの情報（data/<地域>-info.json）をまとめる。
  // 乗降客数は会社ごとに1つの路線にだけ入っていることが多い（ほかの路線は空）ので、
  // 会社ごとにいちばん大きい値をとり、会社をまたいで合計する
  function stationInfo(members) {
    const rows = state.info ? members.map((i) => state.info.stations[i]).filter(Boolean) : [];
    if (!rows.length) return {};
    const first = (k) => {
      for (const r of rows) if (r[k] !== null) return r[k];
      return null;
    };
    const byOperator = new Map();
    members.forEach((i) => {
      const r = state.info.stations[i];
      if (!r) return;
      const op = state.graph.lines[state.graph.stations[i].line][0].split(" ")[0];
      const cur = byOperator.get(op) || [null, null];
      byOperator.set(op, [Math.max(cur[0] ?? 0, r[0] ?? 0) || null, Math.max(cur[1] ?? 0, r[1] ?? 0) || null]);
    });
    let p2024 = 0;
    let p2019 = 0;
    let p2019ok = true;
    for (const [a, b] of byOperator.values()) {
      if (a) {
        p2024 += a;
        if (b) p2019 += b;
        else p2019ok = false;
      }
    }
    const pop2020 = first(3);
    const pop2050 = first(4);
    const arvs = rows.map((r) => r[5]).filter((v) => v !== null);
    return {
      passengers: p2024 || null,
      passengersChange: p2024 && p2019 && p2019ok ? p2024 / p2019 - 1 : null,
      landPrice: first(2),
      popChange: pop2020 && pop2050 !== null ? pop2050 / pop2020 - 1 : null,
      arv: arvs.length ? Math.max(...arvs) : null,
      landform: first(6),
      liquefaction: rows.reduce((m, r) => (r[7] === null ? m : Math.max(m ?? 0, r[7])), null),
    };
  }

  // 一覧の元になる駅をしまい、絞り込み・並べ替えをかけて表と地図に出す
  function renderStations(groups) {
    state.stationRows = groups;
    applyStationQuery();
  }

  // 表の見出しの下の入力欄（列ごとの絞り込み）と、見出しのクリック（並べ替え）
  const stationQuery = { sortKey: "minutes", sortDir: 1 };
  const SORT_VALUES = {
    name: (g) => g.name,
    minutes: (g) => (multi() ? g.ratio : g.minutes),
    safe: (g) => (g.safeShare === undefined ? null : g.safeShare),
    transfers: (g) => g.transfers,
    via: (g) => g.via,
    land: (g) => g.landPrice ?? null,
    pop: (g) => g.popChange ?? null,
    ground: (g) => g.arv ?? null,
    passengers: (g) => g.passengers ?? null,
  };
  // 最初に見出しを選んだときの向き（大きいほうがよいものは大きい順から）
  const SORT_FIRST_DESC = ["safe", "pop", "passengers"];

  // ---- 駅ごとの情報の表示 ----

  const M2_PER_TSUBO = 3.30579;
  function landText(g) {
    return g.landPrice ? `${Math.round((g.landPrice * M2_PER_TSUBO) / 10000)}万円` : "—";
  }
  function percentText(r) {
    const v = Math.round(r * 100);
    return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}%`;
  }
  function popText(g) {
    return g.popChange === null || g.popChange === undefined ? "—" : percentText(g.popChange);
  }
  // 地盤増幅率の目安（J-SHIS の地図の区分に近い分け方）
  function shakeLabel(arv) {
    if (arv === null || arv === undefined) return "";
    if (arv >= 2.0) return "とても揺れやすい";
    if (arv >= 1.6) return "揺れやすい";
    return "比較的揺れにくい";
  }
  const LIQUEFACTION_LABELS = ["", "液状化にやや注意", "液状化しやすい"];
  function groundText(g) {
    if (g.arv === null || g.arv === undefined) return "—";
    const liq = g.liquefaction ? `<span class="cr-sub">${LIQUEFACTION_LABELS[g.liquefaction]}</span>` : "";
    return `${g.arv.toFixed(2)}<span class="cr-sub">${shakeLabel(g.arv)}</span>${liq}`;
  }
  function passengersText(g) {
    if (!g.passengers) return "—";
    const n = g.passengers >= 10000 ? `${(g.passengers / 10000).toFixed(1)}万` : g.passengers.toLocaleString("ja-JP");
    const ch =
      g.passengersChange === null || g.passengersChange === undefined
        ? ""
        : `<span class="cr-sub">2019年比 ${percentText(g.passengersChange)}</span>`;
    return `${n}${ch}`;
  }
  // 目的地が複数あるときは「A 12分」「B 25分」のように目的地ごとに並べる
  function minutesText(g) {
    if (!multi()) return `${Math.round(g.minutes)}分`;
    return g.minutesBy.map((m, k) => `<span class="cr-per-dest">${LETTERS[k]} ${Math.round(m)}分</span>`).join("");
  }
  function viaText(g) {
    if (!multi()) return g.viaBy[0] ? escapeHtml(g.viaBy[0]) : "徒歩";
    return g.viaBy.map((v, k) => `<span class="cr-per-dest">${LETTERS[k]}: ${v ? escapeHtml(v) : "徒歩"}</span>`).join("");
  }

  function queryValues() {
    const num = (id) => {
      const v = document.getElementById(id).value.trim();
      return v === "" ? null : Number(v);
    };
    return {
      name: document.getElementById("cr-q-name").value.trim(),
      maxMinutes: num("cr-q-minutes"),
      minSafe: num("cr-q-safe"),
      maxTransfers: num("cr-q-transfers"),
      via: document.getElementById("cr-q-via").value.trim(),
      maxLand: num("cr-q-land"), // 万円/坪
      minPop: num("cr-q-pop"), // %
      ground: document.getElementById("cr-q-ground").value,
      minPassengers: num("cr-q-passengers"), // 万人/日
    };
  }

  function groundOk(g, cond) {
    if (!cond) return true;
    if (g.arv === null || g.arv === undefined) return false;
    if (cond === "firm") return g.arv < 1.6;
    if (cond === "noliq") return !g.liquefaction || g.liquefaction < 2;
    if (cond === "firm-noliq") return g.arv < 1.6 && (!g.liquefaction || g.liquefaction < 2);
    return true;
  }

  // 一覧の絞り込みを地図の塗りにも反映する。絞り込んでいるときは、残った駅の周りだけを塗る
  let mapFilterKey = "";
  let mapFilterTimer = null;
  function updateMapFilter(q, groups) {
    const active =
      q !== null &&
      (q.name !== "" ||
        q.via !== "" ||
        q.ground !== "" ||
        q.maxMinutes !== null ||
        q.maxTransfers !== null ||
        q.maxLand !== null ||
        q.minPop !== null ||
        q.minPassengers !== null ||
        (q.minSafe !== null && !!state.hazardLevel));
    const ids = active ? groups.flatMap((g) => g.members) : null;
    const key = active ? ids.slice().sort((a, b) => a - b).join(",") + "|" : "";
    if (key === mapFilterKey) return;
    mapFilterKey = key;
    state.filteredStations = active ? new Set(ids) : null;
    updateStationVisibility(); // 凡例も描き直す
    // 入力のたびに塗り直すと重いので、手が止まってから塗り直す
    clearTimeout(mapFilterTimer);
    mapFilterTimer = setTimeout(() => reachTiles.redraw(), 200);
  }

  function applyStationQuery() {
    const all = state.stationRows || [];
    stationLayer.clearLayers();
    if (!all.length) {
      updateMapFilter(null, []);
      stationsSection.hidden = state.mode === "rail" && state.dests.length ? false : true;
      stationsBody.innerHTML = "";
      stationsCount.textContent = "";
      stationsNote.textContent = state.mode === "rail" ? "範囲内に駅はありません。" : "";
      return;
    }
    const q = queryValues();
    const groups = all.filter(
      (g) =>
        (!q.name || g.name.includes(q.name) || g.lines.some((l) => l.includes(q.name))) &&
        (q.maxMinutes === null || g.minutes <= q.maxMinutes) &&
        (q.minSafe === null || !state.hazardLevel || (g.safeShare !== undefined && g.safeShare * 100 >= q.minSafe - 1e-9)) &&
        (q.maxTransfers === null || g.transfers <= q.maxTransfers) &&
        (!q.via || g.viaBy.some((v) => (v || "徒歩").includes(q.via))) &&
        (q.maxLand === null || (g.landPrice && (g.landPrice * M2_PER_TSUBO) / 10000 <= q.maxLand)) &&
        (q.minPop === null || (g.popChange !== null && g.popChange !== undefined && g.popChange * 100 >= q.minPop - 1e-9)) &&
        groundOk(g, q.ground) &&
        (q.minPassengers === null || (g.passengers && g.passengers / 10000 >= q.minPassengers))
    );
    updateMapFilter(q, groups);
    const key = SORT_VALUES[stationQuery.sortKey];
    groups.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      // 値のない駅は向きにかかわらず最後に
      if (va === null || vb === null) return (va === null) - (vb === null) || a.ratio - b.ratio;
      const c = typeof va === "string" ? va.localeCompare(vb, "ja") : va - vb;
      return c * stationQuery.sortDir || a.ratio - b.ratio;
    });
    for (const th of stationsTable.querySelectorAll("thead [data-sort]")) {
      th.setAttribute(
        "aria-sort",
        th.dataset.sort === stationQuery.sortKey ? (stationQuery.sortDir > 0 ? "ascending" : "descending") : "none"
      );
    }

    for (const g of groups) {
      const marker = L.circleMarker([g.lat, g.lon], {
        renderer: stationRenderer,
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: BAND_COLORS[bandOfRatio(g.ratio)],
        fillOpacity: 1,
        bubblingMouseEvents: false, // 点のクリックを、地図のクリック（その地点からの時間）として扱わない
      });
      const times = multi()
        ? g.minutesBy.map((m, k) => `${LETTERS[k]} ${Math.round(m)}分`).join(" / ")
        : `約${Math.round(g.minutes)}分`;
      marker.bindTooltip(`${escapeHtml(g.name)}　${times}`, { direction: "top", offset: [0, -4] });
      marker.on("click", () => openStationPopup(g));
      marker.addTo(stationLayer);
    }
    stationsBody.innerHTML = groups
      .map(
        (g, k) =>
          `<tr data-k="${k}" tabindex="0"><th scope="row"><span class="cr-swatch" style="background:${onLightMap(
            bandOfRatio(g.ratio)
          )}"></span>${escapeHtml(g.name)}<span class="cr-lines">${escapeHtml(
            g.lines.join("、")
          )}</span></th><td class="cr-num">${minutesText(g)}</td><td class="cr-num cr-safe">${safeText(
            g
          )}</td><td class="cr-num">${g.transfers}回</td><td class="cr-via">${viaText(g)}</td><td class="cr-num">${landText(
            g
          )}</td><td class="cr-num">${popText(g)}</td><td class="cr-num">${groundText(g)}</td><td class="cr-num">${passengersText(
            g
          )}</td></tr>`
      )
      .join("");
    stationsTable.classList.toggle("has-hazard", !!state.hazardLevel);
    applyColumns();
    stationsBody.onclick = stationsBody.onkeydown = (e) => {
      if (e.type === "keydown" && e.key !== "Enter") return;
      const row = e.target.closest("tr[data-k]");
      if (!row) return;
      const g = groups[Number(row.dataset.k)];
      map.setView([g.lat, g.lon], Math.max(map.getZoom(), 13));
      openStationPopup(g);
      document.getElementById("cr-map").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    stationsCount.textContent = groups.length === all.length ? `（${all.length}駅）` : `（${all.length}駅中 ${groups.length}駅）`;
    stationsNote.textContent = groups.length ? "" : "条件に合う駅はありません。";
    stationsSection.hidden = false;
  }

  stationsTable.querySelector("thead").addEventListener("input", applyStationQuery);
  stationsTable.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (!th || e.target.closest("input, select")) return;
    const k = th.dataset.sort;
    // 同じ列なら向きを反対に
    stationQuery.sortDir = stationQuery.sortKey === k ? -stationQuery.sortDir : SORT_FIRST_DESC.includes(k) ? -1 : 1;
    stationQuery.sortKey = k;
    applyStationQuery();
  });
  document.getElementById("cr-q-clear").addEventListener("click", () => {
    for (const el of stationsTable.querySelectorAll("thead input, thead select")) el.value = "";
    stationQuery.sortKey = "minutes";
    stationQuery.sortDir = 1;
    applyStationQuery();
  });

  // ---- 表示する列の選択 ----
  // n は表の何列目か（1列目の駅は常に出す）。選んだ内容はこのブラウザに覚えておく
  const COLUMNS = [
    { n: 2, label: "目的地まで", sort: "minutes", filter: "cr-q-minutes" },
    { n: 3, label: "安全な範囲", sort: "safe", filter: "cr-q-safe", hazardOnly: true },
    { n: 4, label: "乗り換え", sort: "transfers", filter: "cr-q-transfers" },
    { n: 5, label: "経路", sort: "via", filter: "cr-q-via" },
    { n: 6, label: "地価", sort: "land", filter: "cr-q-land" },
    { n: 7, label: "人口 2050年", sort: "pop", filter: "cr-q-pop" },
    { n: 8, label: "揺れやすさ", sort: "ground", filter: "cr-q-ground" },
    { n: 9, label: "乗降客数", sort: "passengers", filter: "cr-q-passengers" },
  ];
  const COLUMNS_KEY = "commute-range-hidden-columns";
  let hiddenColumns = new Set();
  try {
    hiddenColumns = new Set(JSON.parse(localStorage.getItem(COLUMNS_KEY) || "[]"));
  } catch {}

  const columnsBox = document.getElementById("cr-columns");
  for (const c of COLUMNS) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(c.n);
    box.checked = !hiddenColumns.has(c.n);
    label.append(box, c.label);
    columnsBox.appendChild(label);
    box.addEventListener("change", () => {
      if (box.checked) {
        hiddenColumns.delete(c.n);
      } else {
        hiddenColumns.add(c.n);
        // 見えない列で絞り込んだり並べ替えたりしたままにしない
        document.getElementById(c.filter).value = "";
        if (stationQuery.sortKey === c.sort) {
          stationQuery.sortKey = "minutes";
          stationQuery.sortDir = 1;
        }
      }
      try {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify([...hiddenColumns]));
      } catch {}
      applyColumns();
      applyStationQuery();
    });
  }

  function applyColumns() {
    for (const c of COLUMNS) stationsTable.classList.toggle(`hide-${c.n}`, hiddenColumns.has(c.n));
    // 「安全な範囲」は災害リスクで除外しているときだけ意味があるので、それ以外は選べないようにする
    const safeBox = columnsBox.querySelector('input[value="3"]');
    safeBox.disabled = !state.hazardLevel;
    safeBox.parentElement.classList.toggle("is-disabled", !state.hazardLevel);
    safeBox.parentElement.title = state.hazardLevel ? "" : "「災害リスク」で除外しているときに表示されます";
    // 表の最小の幅は、表示している列の数に合わせる（狭い画面では横にスクロールする）
    const visible = COLUMNS.filter((c) => !hiddenColumns.has(c.n) && (!c.hazardOnly || state.hazardLevel)).length;
    stationsTable.style.minWidth = `${8 + visible * 6}rem`;
    // 「◯分以内」の絞り込みは、目的地が複数あるときはいちばん遠い目的地で見る
    document.getElementById("cr-q-minutes").title = multi() ? "いちばん遠い目的地までの時間で絞り込みます" : "";
  }
  applyColumns();

  // 駅から歩いて住める範囲のうち、災害リスクで除外されずに残る場所の割合
  function safeText(g) {
    if (g.safeShare === undefined) return "確認中…";
    return `${Math.round(g.safeShare * 100)}%`;
  }

  function openStationPopup(g) {
    const box = document.createElement("div");
    box.className = "cr-popup";
    const routes = state.dests
      .map((d, k) => {
        const head = multi()
          ? `<p class="cr-popup__time">${LETTERS[k]}「${escapeHtml(d.label)}」まで約${Math.round(g.minutesBy[k])}分</p>`
          : `<p class="cr-popup__time">${escapeHtml(g.name)}駅から約${Math.round(g.minutes)}分</p>`;
        const items = routeItems(d, g.stationBy[k]);
        if (g.stationBy[k] !== g.station) {
          // 目的地によって、同じ駅の別の路線（ホーム）から乗るほうが早いことがある
          items.unshift(`${escapeHtml(state.graph.stations[g.stationBy[k]].name)}駅（${escapeHtml(shortName(state.graph.lines[state.graph.stations[g.stationBy[k]].line][0]))}）から`);
        }
        return head + `<ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;
      })
      .join("");
    box.innerHTML =
      (multi() ? `<p class="cr-popup__name">${escapeHtml(g.name)}駅</p>` : "") +
      (state.hazardLevel && g.safeShare !== undefined
        ? `<p class="cr-popup__risk">駅から歩いて住める範囲のうち、災害リスクで除外されない場所: 約${Math.round(g.safeShare * 100)}%</p>`
        : "") +
      routes +
      stationDetailsHtml(g);
    L.popup({ offset: [0, -4], maxWidth: 320 }).setLatLng([g.lat, g.lon]).setContent(box).openOn(map);
  }

  function stationDetailsHtml(g) {
    const rows = [];
    if (g.landPrice) rows.push(`住宅地の地価（駅の近くの公示地価の中央値）: 坪${landText(g)}（1m²あたり${(g.landPrice / 10000).toFixed(1)}万円）`);
    if (g.popChange !== null && g.popChange !== undefined) rows.push(`駅から1km以内の人口の見通し: 2020年→2050年で${popText(g)}`);
    if (g.arv) {
      const liq = g.liquefaction ? `、${LIQUEFACTION_LABELS[g.liquefaction]}` : "";
      rows.push(`地盤: 揺れやすさ（地盤増幅率）${g.arv.toFixed(2)}・${shakeLabel(g.arv)}${liq}${g.landform ? `（${escapeHtml(g.landform)}）` : ""}`);
    }
    if (g.passengers) {
      const ch = g.passengersChange === null || g.passengersChange === undefined ? "" : `、2019年度比 ${percentText(g.passengersChange)}`;
      rows.push(`乗降客数: 1日 ${g.passengers.toLocaleString("ja-JP")}人（2024年度${ch}）`);
    }
    return rows.length ? `<ul class="cr-popup__info">${rows.map((r) => `<li>${r}</li>`).join("")}</ul>` : "";
  }

  // ---- 徒歩・自転車・車（Valhalla） ----

  async function fetchIsochrone(d) {
    const body = {
      locations: [{ lat: d.lat, lon: d.lon }],
      costing: state.mode,
      contours: [d.limit / 3, (d.limit * 2) / 3, d.limit].map((time) => ({ time: Math.round(time * 10) / 10 })),
      polygons: true,
      reverse: true, // 「ここから行ける範囲」ではなく「ここへ来られる範囲」
    };
    const res = await fetch(VALHALLA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function computeReach() {
    const id = ++state.requestId;
    setStatus("計算中です…");
    let geos;
    try {
      // 公開サーバーに負担をかけないよう、目的地ごとに順番に問い合わせる
      geos = [];
      for (const d of state.dests) geos.push(await fetchIsochrone(d));
    } catch (err) {
      if (id !== state.requestId) return;
      setStatus(`範囲を計算できませんでした（${err.message}）。公開サーバーが混んでいる可能性があります。少し待ってからもう一度試してください。`, true);
      return;
    }
    if (id !== state.requestId) return; // あとから別の条件で計算し直した
    state.dests.forEach((d, k) => (d.geo = geos[k]));
    reachTiles.redraw();
    setStatus(roadStatus());
  }

  function roadStatus() {
    const all = multi() ? "（すべてを満たす場所）" : "";
    return `${destsText()}${all}、${MODE_LABELS[state.mode]}の範囲です${hazardSuffix()}。`;
  }

  function clearReach() {
    state.requestId++;
    for (const d of state.dests) d.geo = null;
    reachTiles.redraw();
  }

  const HAZARD_LABELS = ["", "危険度の高い場所を除外", "中程度以上の危険がある場所を除外", "災害の想定がある場所をすべて除外"];
  function hazardSuffix() {
    return state.hazardLevel ? `（${HAZARD_LABELS[state.hazardLevel]}）` : "";
  }

  // ---- 全体の流れ ----

  function update() {
    saveToUrl();
    renderDests();
    renderLegend();
    applyColumns();
    if (!state.dests.length) {
      clearReach();
      clearRail();
      stationsSection.hidden = true;
      setStatus("地図をクリックするか、駅名・住所で目的地を決めてください。");
      return;
    }
    if (state.mode === "rail") {
      clearReach();
      if (!state.graph) {
        setStatus("電車のデータを読み込み中です…");
        return; // 読み込みが終わったら loadRail から呼び直す
      }
      computeRail();
    } else {
      clearRail();
      computeReach();
    }
  }

  // 目的地を足す（4か所まで）。上限時間は、ひとつ前の目的地と同じにしておく
  function addDest(lat, lon, label, limit) {
    if (state.dests.length >= MAX_DESTS) {
      setStatus(`目的地は${MAX_DESTS}か所までです。どれかを消してから足してください。`, true);
      return;
    }
    const last = state.dests[state.dests.length - 1];
    const d = { lat, lon, label: label || MAP_POINT_LABEL, limit: limit || (last ? last.limit : DEFAULT_LIMIT) };
    d.marker = L.marker([lat, lon], { draggable: true, icon: destIcon("?") }).addTo(map);
    d.marker.on("dragend", () => {
      const ll = d.marker.getLatLng();
      d.lat = ll.lat;
      d.lon = ll.lng;
      d.label = MAP_POINT_LABEL;
      update();
    });
    state.dests.push(d);
    destInput.value = "";
    map.closePopup();
    update();
  }

  function removeDest(d) {
    d.marker.remove();
    state.dests.splice(state.dests.indexOf(d), 1);
    map.closePopup();
    update();
  }

  function destIcon(letter) {
    return L.divIcon({
      className: "cr-dest-pin",
      html: `<span>${letter}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  // 目的地の一覧（記号・名前・上限時間・消すボタン）。地図の印の記号もここでそろえる
  function renderDests() {
    destsList.innerHTML = "";
    state.dests.forEach((d, k) => {
      const letter = multi() ? LETTERS[k] : "";
      // 目的地が1つのときはふつうのピン、複数のときは A〜D の印にする
      d.marker.setIcon(letter ? destIcon(letter) : new L.Icon.Default());
      d.marker.options.title = `目的地${letter}（ドラッグで動かせます）`;
      const li = document.createElement("li");
      li.className = "cr-dest";
      const name = document.createElement("span");
      name.className = "cr-dest__name";
      name.innerHTML = `${letter ? `<span class="cr-dest__letter">${letter}</span>` : ""}${escapeHtml(d.label)}`;
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${d.label}までの片道の上限`);
      for (const m of LIMIT_OPTIONS) {
        const o = document.createElement("option");
        o.value = String(m);
        o.textContent = `${m}分以内`;
        if (m === d.limit) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener("change", () => {
        d.limit = Number(select.value);
        update();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cr-dest__remove";
      del.textContent = "×";
      del.title = "この目的地を消す";
      del.setAttribute("aria-label", `${d.label}を消す`);
      del.addEventListener("click", () => removeDest(d));
      li.append(name, select, del);
      destsList.appendChild(li);
    });
    destsBox.hidden = !state.dests.length;
    destInput.placeholder = state.dests.length
      ? state.dests.length >= MAX_DESTS
        ? `目的地は${MAX_DESTS}か所までです`
        : "目的地を追加（駅名か住所）"
      : "駅名か住所（例: 大阪、京都市下京区烏丸通）";
  }

  function renderLegend() {
    if (!state.dests.length) {
      legendEl.hidden = true;
      return;
    }
    const outline = `<br><span class="cr-legend__row"><span class="cr-legend__line"></span>範囲の境目</span>`;
    const stationsHint =
      state.mode === "rail" && !map.hasLayer(stationLayer) ? `<span class="cr-legend__note">駅の点は拡大すると表示します</span>` : "";
    const note =
      outline +
      stationsHint +
      (state.filteredStations ? `<span class="cr-legend__note">一覧で絞り込んだ駅の周りだけ表示中</span>` : "");
    if (multi()) {
      // 目的地ごとに上限が違うので、上限に対する割合で表す
      const labels = ["上限の1/3以内", "上限の2/3以内", "上限まで"];
      legendEl.innerHTML =
        `<span class="cr-legend__title">いちばん遠い目的地まで</span>` +
        labels.map((t, i) => `<span class="cr-legend__row"><span class="cr-swatch" style="background:${onLightMap(i)}"></span>${t}</span>`).join("<br>") +
        note +
        `<span class="cr-legend__note">すべての目的地に時間内で着ける場所</span>`;
    } else {
      const l = state.dests[0].limit;
      const edges = [0, Math.round(l / 3), Math.round((l * 2) / 3), l];
      legendEl.innerHTML =
        `<span class="cr-legend__title">目的地までの時間</span>` +
        BAND_COLORS.map(
          (c, i) =>
            `<span class="cr-legend__row"><span class="cr-swatch" style="background:${onLightMap(i)}"></span>${
              i === 0 ? "" : edges[i]
            }〜${edges[i + 1]}分</span>`
        ).join("<br>") +
        note;
    }
    legendEl.hidden = false;
  }

  // 凡例の色は、地図（白っぽい地理院の淡色地図）に半透明で重なったときの見え方に合わせる
  function onLightMap(band) {
    const mix = BAND_RGB[band].map((v) => Math.round(v * REACH_OPACITY + 255 * (1 - REACH_OPACITY)));
    return `rgb(${mix.join(",")})`;
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", !!isError);
  }

  // ---- 地図のクリック: その地点からの時間を出す ----

  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (!state.dests.length) {
      addDest(lat, lng);
      return;
    }
    const box = document.createElement("div");
    box.className = "cr-popup";
    box.innerHTML = popupHtml(lat, lng);
    const risk = document.createElement("p");
    risk.className = "cr-popup__risk";
    risk.textContent = "災害リスクを確認中…";
    box.appendChild(risk);
    if (state.dests.length < MAX_DESTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `ここを目的地に追加（${LETTERS[state.dests.length]}）`;
      btn.addEventListener("click", () => addDest(lat, lng));
      box.appendChild(btn);
    }
    const popup = L.popup().setLatLng(e.latlng).setContent(box).openOn(map);
    Hazard.risksAt(lat, lng, map.getZoom()).then((risks) => {
      risk.textContent = risks.length
        ? "この地点の想定: " + risks.map((r) => (r.text ? `${r.label} ${r.text}` : r.label)).join("、")
        : "この地点に、洪水・高潮・津波・土砂災害の想定はありません（ハザードマップの範囲で）。";
      const threshold = 4 - state.hazardLevel;
      if (state.hazardLevel && risks.some((r) => r.sev >= threshold)) risk.textContent += "（除外の対象）";
      popup.update();
    });
  });

  // クリックした地点から各目的地までの時間と経路
  function popupHtml(lat, lon) {
    const walk = (m) => Math.max(1, Math.round(m));
    const parts = state.dests.map((d, k) => {
      const name = multi() ? `${LETTERS[k]}「${escapeHtml(d.label)}」まで` : "";
      if (state.mode === "rail" && d.result) {
        const r = Rail.timeFromPoint(state.graph, d.result, d, lat, lon);
        if (r.minutes > d.limit) return `<p class="cr-popup__time">${name}${d.limit}分では着きません</p>`;
        if (r.station < 0) return `<p class="cr-popup__time">${name}約${walk(r.minutes)}分</p><ol><li>目的地まで歩く</li></ol>`;
        const s = state.graph.stations[r.station];
        const toStation = Rail.walkMin(Rail.metersBetween(lat, lon, s.lat, s.lon), state.graph.params);
        const items = [`${escapeHtml(s.name)}駅まで歩く（約${walk(toStation)}分）`].concat(routeItems(d, r.station));
        return `<p class="cr-popup__time">${name}約${Math.round(r.minutes)}分</p><ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;
      }
      if (d.geo) {
        const inside = (d.geo.features || []).filter((f) => containsPoint(f.geometry, lon, lat)).map((f) => f.properties.contour);
        if (!inside.length) return `<p class="cr-popup__time">${name}${d.limit}分では着きません</p>`;
        return `<p class="cr-popup__time">${name}約${Math.round(Math.min(...inside))}分以内</p>`;
      }
      return "";
    });
    return parts.join("");
  }

  // 駅（ホーム）から目的地 d までの手順を、表示用の文の配列にする
  function routeItems(d, station) {
    const walk = (m) => Math.max(1, Math.round(m));
    const items = [];
    for (const step of Rail.describeRoute(state.graph, d.result, station)) {
      if (step.type === "ride") {
        items.push(`${escapeHtml(shortName(step.service))}で${escapeHtml(step.to)}まで`);
      } else if (step.type === "walk") {
        items.push(`${escapeHtml(step.to)}駅まで歩いて乗り換え`);
      } else if (step.type === "walk-to-dest") {
        items.push(`目的地まで歩く（約${walk(step.minutes - state.graph.params.exitMin)}分）`);
      }
    }
    return items;
  }

  function containsPoint(geometry, x, y) {
    const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polys.some((rings) => {
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      return inside;
    });
  }

  // データの正式名（事業者名＋法律上の路線名）を、ふだんの呼び方に寄せる
  const SHORT_NAMES = [
    [/西日本旅客鉄道 /g, "JR "],
    [/大阪市高速電気軌道 \d号線\((.+?)\)/g, "Osaka Metro $1"],
    [/大阪市高速電気軌道 /g, "Osaka Metro "],
    [/近畿日本鉄道 /g, "近鉄 "],
    [/南海電気鉄道 /g, "南海 "],
    [/京阪電気鉄道 /g, "京阪 "],
    [/阪神電気鉄道 /g, "阪神 "],
    [/阪急電鉄 /g, "阪急 "],
    [/山陽電気鉄道 /g, "山陽電鉄 "],
    [/北大阪急行電鉄 南北線/g, "北急"], // 「北大阪急行」だと「阪急」で絞り込んだときに当たってしまう
    [/京都市 /g, "京都市営地下鉄 "],
    [/神戸市 /g, "神戸市営地下鉄 "],
  ];
  function shortName(name) {
    return SHORT_NAMES.reduce((s, [re, to]) => s.replace(re, to), name);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---- 目的地の検索: まず駅名、見つからなければ住所（国土地理院）。見つかった場所を目的地に足す ----

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = destInput.value.trim();
    if (!q) return;
    if (state.dests.length >= MAX_DESTS) {
      setStatus(`目的地は${MAX_DESTS}か所までです。どれかを消してから足してください。`, true);
      return;
    }
    const station = findStation(q);
    if (station) {
      addDest(station.lat, station.lon, station.label);
      map.setView([station.lat, station.lon], Math.max(map.getZoom(), 12));
      return;
    }
    setStatus("住所を探しています…");
    try {
      const res = await fetch(ADDRESS_SEARCH_URL + encodeURIComponent(q));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!list.length) {
        setStatus(`「${q}」は見つかりませんでした。別の書き方を試すか、地図をクリックしてください。`, true);
        return;
      }
      const [lon, lat] = list[0].geometry.coordinates;
      addDest(lat, lon, list[0].properties.title || q);
      map.setView([lat, lon], Math.max(map.getZoom(), 13));
    } catch (err) {
      setStatus(`住所を検索できませんでした（${err.message}）。地図をクリックして目的地を選んでください。`, true);
    }
  });

  function findStation(q) {
    if (!state.graph) return null;
    const name = q.replace(/駅$/, "");
    const hits = state.graph.stations.filter((s) => s.name === name);
    if (!hits.length) return null;
    // 同じ名前の駅が離れた場所に複数ある（例: 京都府と兵庫県）ことがあるので、最初に見つかった駅の近くだけ平均する
    const first = hits[0];
    const group = hits.filter((s) => Rail.metersBetween(s.lat, s.lon, first.lat, first.lon) < 1000);
    return {
      lat: group.reduce((a, s) => a + s.lat, 0) / group.length,
      lon: group.reduce((a, s) => a + s.lon, 0) / group.length,
      label: `${name}駅`,
    };
  }

  // ---- 条件をURLに残す（ブックマークや共有で同じ地図を開けるように） ----
  // 目的地は d=緯度,経度,上限（分）,名前 を目的地の数だけ並べる

  function saveToUrl() {
    const params = new URLSearchParams();
    for (const d of state.dests) {
      const parts = [d.lat.toFixed(5), d.lon.toFixed(5), String(d.limit)];
      if (d.label !== MAP_POINT_LABEL) parts.push(d.label);
      params.append("d", parts.join(","));
    }
    params.set("mode", state.mode);
    if (state.maxTransfers !== null) params.set("transfers", String(state.maxTransfers));
    if (state.hazardLevel) params.set("hazard", String(state.hazardLevel));
    history.replaceState(null, "", "?" + params.toString());
  }

  function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    if (MODE_LABELS[params.get("mode")]) state.mode = params.get("mode");
    const transfers = params.get("transfers");
    if (["0", "1", "2"].includes(transfers)) state.maxTransfers = Number(transfers);
    modeSelect.value = state.mode;
    transfersSelect.value = state.maxTransfers === null ? "" : String(state.maxTransfers);
    transfersSelect.disabled = state.mode !== "rail";
    const hazard = params.get("hazard");
    if (["1", "2", "3"].includes(hazard)) state.hazardLevel = Number(hazard);
    hazardSelect.value = String(state.hazardLevel);

    const found = [];
    for (const v of params.getAll("d").slice(0, MAX_DESTS)) {
      const [la, lo, lim, ...name] = v.split(",");
      const lat = Number(la);
      const lon = Number(lo);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      found.push({ lat, lon, limit: LIMIT_OPTIONS.includes(Number(lim)) ? Number(lim) : DEFAULT_LIMIT, label: name.join(",") || MAP_POINT_LABEL });
    }
    // 目的地が1つだったころの形（lat=&lon=&limit=&name=）でも開けるようにする
    if (!found.length && params.has("lat")) {
      const lat = Number(params.get("lat"));
      const lon = Number(params.get("lon"));
      const lim = Number(params.get("limit"));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        found.push({ lat, lon, limit: LIMIT_OPTIONS.includes(lim) ? lim : DEFAULT_LIMIT, label: params.get("name") || MAP_POINT_LABEL });
      }
    }
    if (!found.length) return;
    // 1つずつ足すと毎回計算し直すので、まとめて入れてから1回だけ計算する
    for (const f of found) {
      const d = { ...f };
      d.marker = L.marker([f.lat, f.lon], { draggable: true, icon: destIcon("?") }).addTo(map);
      d.marker.on("dragend", () => {
        const ll = d.marker.getLatLng();
        d.lat = ll.lat;
        d.lon = ll.lng;
        d.label = MAP_POINT_LABEL;
        update();
      });
      state.dests.push(d);
    }
    if (found.length === 1) map.setView([found[0].lat, found[0].lon], 12);
    else map.fitBounds(L.latLngBounds(found.map((f) => [f.lat, f.lon])).pad(0.5));
    update();
  }

  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    transfersSelect.disabled = state.mode !== "rail"; // 乗り換えは電車のときだけ意味がある
    update();
  });
  transfersSelect.addEventListener("change", () => {
    state.maxTransfers = transfersSelect.value === "" ? null : Number(transfersSelect.value);
    update();
  });
  hazardSelect.addEventListener("change", () => {
    state.hazardLevel = Number(hazardSelect.value);
    if (state.mode === "rail") {
      update();
      return;
    }
    // 徒歩・自転車・車は範囲を取り直さず、塗り直すだけ
    saveToUrl();
    reachTiles.redraw();
    if (state.dests.length && state.dests.every((d) => d.geo)) setStatus(roadStatus());
  });

  // ---- 電車のデータの読み込み ----

  async function loadRail() {
    try {
      // 駅ごとの情報（乗降客数・地価・将来人口・地盤）は、読めなくても電車の計算は続ける
      const infoPromise = fetch(INFO_URL)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.info = await infoPromise;
      state.graph = Rail.build(data);
      const lats = state.graph.stations.map((s) => s.lat);
      const lons = state.graph.stations.map((s) => s.lon);
      state.railBounds = {
        south: Math.min(...lats),
        north: Math.max(...lats),
        west: Math.min(...lons),
        east: Math.max(...lons),
      };
      if (state.dests.length && state.mode === "rail") update();
    } catch (err) {
      setStatus(`電車のデータを読み込めませんでした（${err.message}）。徒歩・自転車・車は使えます。`, true);
    }
  }

  loadFromUrl();
  renderDests();
  renderLegend();
  loadRail();
})();
