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

  // 近い → 遠い の3段階（同じ青の濃い → 薄い）。上限時間を3等分して塗り分ける
  const BAND_COLORS = ["#184f95", "#3987e5", "#86b6ef"];
  const BAND_RGB = BAND_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const REACH_OPACITY = 0.5; // 塗りの濃さは pane ごとまとめて下げる（重なっても色が濃くならない）
  const SAMPLE_PX = 2; // 電車の塗りは2pxごとに計算する

  const MODE_LABELS = { rail: "電車＋徒歩", pedestrian: "徒歩", bicycle: "自転車", auto: "車" };

  const form = document.getElementById("cr-form");
  const destInput = document.getElementById("cr-dest");
  const modeSelect = document.getElementById("cr-mode");
  const limitSelect = document.getElementById("cr-limit");
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
    dest: null, // { lat, lon, label }
    mode: "rail",
    limit: 30,
    maxTransfers: null, // 乗り換えの上限（null なら制限なし）。電車のときだけ使う
    hazardLevel: 0, // 災害リスクで除外する段階（0 なら除外しない。hazard.js を参照）
    graph: null,
    railBounds: null, // 電車のデータがある範囲
    railResult: null,
    railSources: [], // 塗りに使う { lat, lon, t }（駅と目的地）
    reachGeo: null, // Valhalla の結果（GeoJSON）
    requestId: 0,
    stationsRequestId: 0,
  };

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
      const drawn = state.mode === "rail" ? drawRailTile(tile, coords, size.x) : drawRoadTile(tile, coords, size.x);
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

  let destMarker = null;

  // 範囲内の駅の点。数百個になることがあるので canvas で描く
  map.createPane("stations");
  map.getPane("stations").style.zIndex = 450;
  const stationRenderer = L.canvas({ pane: "stations", padding: 0.5 });
  const stationLayer = L.layerGroup().addTo(map);

  // ---- 電車の塗り ----

  // タイル内の各点について「いちばん早く目的地に着ける駅（または目的地まで直接歩く）」の時間を出し、段階の色で塗る
  // 何か描いたら true を返す
  function drawRailTile(canvas, coords, size) {
    if (!state.railResult || !state.railSources.length) return false;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
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
    const limit = state.limit;

    // このタイルに届く駅だけに絞る（残り時間で歩ける距離がタイルにかかるもの）
    const near = [];
    // 一覧で駅を絞り込んでいるときは、絞り込んだ駅の周りだけを塗る（目的地まで直接歩く範囲は塗らない）
    const only = state.filteredStations;
    for (const s of state.railSources) {
      if (only && (s.i === undefined || !only.has(s.i))) continue;
      const reach = Math.min(limit - s.t, s.maxWalk) / minPerMeter;
      const dx = Math.max(west - s.lon, 0, s.lon - east) * kx;
      const dy = Math.max(south - s.lat, 0, s.lat - north) * ky;
      if (dx * dx + dy * dy <= reach * reach) near.push(s);
    }
    if (!near.length) return false;
    near.sort((a, b) => a.t - b.t);

    const band1 = limit / 3;
    const band2 = (limit * 2) / 3;
    for (let sy = 0; sy < size; sy += SAMPLE_PX) {
      const lat = latAt(y0 + sy + SAMPLE_PX / 2);
      for (let sx = 0; sx < size; sx += SAMPLE_PX) {
        const lon = lonAt(x0 + sx + SAMPLE_PX / 2);
        let best = Infinity;
        for (const s of near) {
          if (s.t >= best) break; // t の小さい順に並べてあるので、ここから先は更新されない
          const dx = (lon - s.lon) * kx;
          const dy = (lat - s.lat) * ky;
          const walk = Math.sqrt(dx * dx + dy * dy) * minPerMeter;
          if (walk > s.maxWalk) continue;
          const t = s.t + walk;
          if (t < best) best = t;
        }
        if (best > limit) continue;
        const rgb = BAND_RGB[best <= band1 ? 0 : best <= band2 ? 1 : 2];
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

  // Valhalla の範囲（GeoJSON の多角形）をタイルに描く。大きい範囲から順に重ね、内側（近い）ほど上に来るようにする
  function drawRoadTile(canvas, coords, size) {
    if (!state.reachGeo) return false;
    const ctx = canvas.getContext("2d");
    const scale = 256 * Math.pow(2, coords.z);
    const x0 = coords.x * size;
    const y0 = coords.y * size;
    const toPx = ([lon, lat]) => {
      const s = Math.sin((lat * Math.PI) / 180);
      return [((lon + 180) / 360) * scale - x0, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale - y0];
    };
    const features = (state.reachGeo.features || []).slice().sort((a, b) => b.properties.contour - a.properties.contour);
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
      ctx.fillStyle = BAND_COLORS[bandOf(f.properties.contour)];
      ctx.fill("evenodd");
    }
    return features.length > 0;
  }

  function inRailArea(lat, lon) {
    const b = state.railBounds;
    return b && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  }

  function computeRail() {
    const { dest, limit, graph } = state;
    state.railResult = Rail.timesTo(graph, dest.lat, dest.lon, limit, state.maxTransfers);
    // 目的地へ直接歩くのは上限時間まで、駅まで歩くのは maxStationWalkMin まで
    const sources = [{ lat: dest.lat, lon: dest.lon, t: 0, maxWalk: limit }];
    const maxWalk = graph.params.maxStationWalkMin;
    for (let i = 0; i < graph.n; i++) {
      const t = state.railResult.time[i];
      if (t <= limit) sources.push({ i, lat: graph.stations[i].lat, lon: graph.stations[i].lon, t, maxWalk });
    }
    state.railSources = sources;
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
        const radius = Math.min(limit - g.minutes, p.maxStationWalkMin) / minPerMeter;
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

  function railStatus(count, removed) {
    const { dest, limit } = state;
    const transfers =
      state.maxTransfers === null ? "" : state.maxTransfers === 0 ? "・乗り換えなし" : `・乗り換え${state.maxTransfers}回まで`;
    const stations =
      count === null
        ? "駅の周りの災害リスクを確認中…"
        : removed
          ? `駅 ${count}。ほかに、歩いて住める範囲がすべて除外の対象になる駅が ${removed}`
          : `駅 ${count}`;
    const hazard = state.hazardLevel ? `${HAZARD_LABELS[state.hazardLevel]}。` : "";
    let msg = `「${dest.label}」まで${MODE_LABELS.rail}で${limit}分以内${transfers}の範囲です（${hazard}${stations}）。`;
    if (!inRailArea(dest.lat, dest.lon)) {
      msg += " 電車のデータは関西圏だけなので、この目的地では徒歩の範囲しか出ません。";
    }
    return msg;
  }

  function clearRail() {
    state.stationsRequestId++;
    state.railResult = null;
    state.railSources = [];
    reachTiles.redraw();
    renderStations([]);
  }

  // ---- 範囲内の駅の一覧と地図の点 ----

  // データでは駅が路線ごとに分かれているので、同じ名前で近く（500m以内）にある駅を1つにまとめる。
  // 時間はまとめた中でいちばん早い路線のもの
  function groupStations() {
    const { graph, railResult, limit } = state;
    const idx = [];
    for (let i = 0; i < graph.n; i++) {
      if (railResult.time[i] <= limit) idx.push(i);
    }
    idx.sort((a, b) => railResult.time[a] - railResult.time[b]);
    const groups = [];
    for (const i of idx) {
      const s = graph.stations[i];
      const g = groups.find((g) => g.name === s.name && Rail.metersBetween(g.lat, g.lon, s.lat, s.lon) < 500);
      const line = shortName(graph.lines[s.line][0]);
      if (g) {
        if (!g.lines.includes(line)) g.lines.push(line);
        g.members.push(i);
        continue;
      }
      const rides = Rail.describeRoute(graph, railResult, i).filter((step) => step.type === "ride");
      groups.push({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        station: i,
        members: [i],
        minutes: railResult.time[i],
        lines: [line],
        transfers: Math.max(0, rides.length - 1),
        via: rides.map((r) => shortName(r.service)).join(" → "),
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
    members.forEach((i, k) => {
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
    minutes: (g) => g.minutes,
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
    const ch = g.passengersChange === null || g.passengersChange === undefined ? "" : `<span class="cr-sub">2019年比 ${percentText(g.passengersChange)}</span>`;
    return `${n}${ch}`;
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
    renderLegend();
    // 入力のたびに塗り直すと重いので、手が止まってから塗り直す
    clearTimeout(mapFilterTimer);
    mapFilterTimer = setTimeout(() => reachTiles.redraw(), 200);
  }

  function applyStationQuery() {
    const all = state.stationRows || [];
    stationLayer.clearLayers();
    if (!all.length) {
      updateMapFilter(null, []);
      stationsSection.hidden = state.mode === "rail" && !!state.dest ? false : true;
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
        (!q.via || (g.via || "徒歩").includes(q.via)) &&
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
      if (va === null || vb === null) return (va === null) - (vb === null) || a.minutes - b.minutes;
      const c = typeof va === "string" ? va.localeCompare(vb, "ja") : va - vb;
      return c * stationQuery.sortDir || a.minutes - b.minutes;
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
        fillColor: BAND_COLORS[bandOf(g.minutes)],
        fillOpacity: 1,
        bubblingMouseEvents: false, // 点のクリックを、地図のクリック（その地点からの時間）として扱わない
      });
      marker.bindTooltip(`${escapeHtml(g.name)}　約${Math.round(g.minutes)}分`, { direction: "top", offset: [0, -4] });
      marker.on("click", () => openStationPopup(g));
      marker.addTo(stationLayer);
    }
    stationsBody.innerHTML = groups
      .map(
        (g, k) =>
          `<tr data-k="${k}" tabindex="0"><th scope="row"><span class="cr-swatch" style="background:${onLightMap(
            bandOf(g.minutes)
          )}"></span>${escapeHtml(g.name)}<span class="cr-lines">${escapeHtml(
            g.lines.join("、")
          )}</span></th><td class="cr-num">${Math.round(g.minutes)}分</td><td class="cr-num cr-safe">${safeText(
            g
          )}</td><td class="cr-num">${g.transfers}回</td><td class="cr-via">${
            g.via ? escapeHtml(g.via) : "徒歩"
          }</td><td class="cr-num">${landText(g)}</td><td class="cr-num">${popText(g)}</td><td class="cr-num">${groundText(
            g
          )}</td><td class="cr-num">${passengersText(g)}</td></tr>`
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
    box.innerHTML =
      `<p class="cr-popup__time">${escapeHtml(g.name)}駅から約${Math.round(g.minutes)}分</p>` +
      (state.hazardLevel && g.safeShare !== undefined
        ? `<p class="cr-popup__risk">駅から歩いて住める範囲のうち、災害リスクで除外されない場所: 約${Math.round(g.safeShare * 100)}%</p>`
        : "") +
      `<ol>${routeItems(g.station).map((t) => `<li>${t}</li>`).join("")}</ol>` +
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

  async function computeReach() {
    const { dest, limit, mode } = state;
    const id = ++state.requestId;
    setStatus("計算中です…");
    const body = {
      locations: [{ lat: dest.lat, lon: dest.lon }],
      costing: mode,
      contours: [limit / 3, (limit * 2) / 3, limit].map((time) => ({ time: Math.round(time * 10) / 10 })),
      polygons: true,
      reverse: true, // 「ここから行ける範囲」ではなく「ここへ来られる範囲」
    };
    let geo;
    try {
      const res = await fetch(VALHALLA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      geo = await res.json();
    } catch (err) {
      if (id !== state.requestId) return;
      setStatus(`範囲を計算できませんでした（${err.message}）。公開サーバーが混んでいる可能性があります。少し待ってからもう一度試してください。`, true);
      return;
    }
    if (id !== state.requestId) return; // あとから別の条件で計算し直した
    state.reachGeo = geo;
    reachTiles.redraw();
    setStatus(`「${dest.label}」まで${MODE_LABELS[mode]}で${limit}分以内${hazardSuffix()}の範囲です。`);
  }

  function bandOf(minutes) {
    if (minutes <= state.limit / 3 + 0.01) return 0;
    if (minutes <= (state.limit * 2) / 3 + 0.01) return 1;
    return 2;
  }

  function clearReach() {
    state.requestId++;
    state.reachGeo = null;
    reachTiles.redraw();
  }

  const HAZARD_LABELS = ["", "危険度の高い場所を除外", "中程度以上の危険がある場所を除外", "災害の想定がある場所をすべて除外"];
  function hazardSuffix() {
    return state.hazardLevel ? `（${HAZARD_LABELS[state.hazardLevel]}）` : "";
  }

  // ---- 全体の流れ ----

  function update() {
    saveToUrl();
    renderLegend();
    if (!state.dest) return;
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

  function setDest(lat, lon, label) {
    state.dest = { lat, lon, label: label || "地図で選んだ地点" };
    destInput.value = state.dest.label === "地図で選んだ地点" ? "" : state.dest.label;
    if (destMarker) {
      destMarker.setLatLng([lat, lon]);
    } else {
      destMarker = L.marker([lat, lon], { draggable: true, title: "目的地（ドラッグで動かせます）" }).addTo(map);
      destMarker.on("dragend", () => {
        const ll = destMarker.getLatLng();
        setDest(ll.lat, ll.lng, "地図で選んだ地点");
      });
    }
    map.closePopup();
    update();
  }

  function renderLegend() {
    if (!state.dest) {
      legendEl.hidden = true;
      return;
    }
    const l = state.limit;
    const edges = [0, Math.round(l / 3), Math.round((l * 2) / 3), l];
    legendEl.innerHTML =
      `<span class="cr-legend__title">目的地までの時間</span>` +
      BAND_COLORS.map(
        (c, i) =>
          `<span class="cr-legend__row"><span class="cr-swatch" style="background:${onLightMap(i)}"></span>${
            i === 0 ? "" : edges[i]
          }〜${edges[i + 1]}分</span>`
      ).join("<br>") +
      (state.filteredStations ? `<span class="cr-legend__note">一覧で絞り込んだ駅の周りだけ表示中</span>` : "");
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
    if (!state.dest) {
      setDest(lat, lng);
      return;
    }
    const box = document.createElement("div");
    box.className = "cr-popup";
    box.innerHTML = popupHtml(lat, lng);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "ここを目的地にする";
    btn.addEventListener("click", () => setDest(lat, lng));
    const risk = document.createElement("p");
    risk.className = "cr-popup__risk";
    risk.textContent = "災害リスクを確認中…";
    box.appendChild(risk);
    box.appendChild(btn);
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

  function popupHtml(lat, lon) {
    if (state.mode === "rail" && state.railResult) {
      const r = Rail.timeFromPoint(state.graph, state.railResult, state.dest, lat, lon);
      if (r.minutes > state.limit) {
        return `<p class="cr-popup__time">${state.limit}分では着きません</p>`;
      }
      const walk = (m) => Math.max(1, Math.round(m));
      if (r.station < 0) {
        return `<p class="cr-popup__time">約${walk(r.minutes)}分</p><ol><li>目的地まで歩く</li></ol>`;
      }
      const s = state.graph.stations[r.station];
      const toStation = Rail.walkMin(Rail.metersBetween(lat, lon, s.lat, s.lon), state.graph.params);
      const items = [`${escapeHtml(s.name)}駅まで歩く（約${walk(toStation)}分）`].concat(routeItems(r.station));
      return `<p class="cr-popup__time">約${Math.round(r.minutes)}分</p><ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;
    }
    if (state.reachGeo) {
      const inside = (state.reachGeo.features || [])
        .filter((f) => containsPoint(f.geometry, lon, lat))
        .map((f) => f.properties.contour);
      if (!inside.length) return `<p class="cr-popup__time">${state.limit}分では着きません</p>`;
      return `<p class="cr-popup__time">約${Math.round(Math.min(...inside))}分以内</p>`;
    }
    return "";
  }

  // 駅（ホーム）から目的地までの手順を、表示用の文の配列にする
  function routeItems(station) {
    const walk = (m) => Math.max(1, Math.round(m));
    const items = [];
    for (const step of Rail.describeRoute(state.graph, state.railResult, station)) {
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

  // ---- 目的地の検索: まず駅名、見つからなければ住所（国土地理院） ----

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = destInput.value.trim();
    if (!q) return;
    const station = findStation(q);
    if (station) {
      setDest(station.lat, station.lon, station.label);
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
      setDest(lat, lon, list[0].properties.title || q);
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

  function saveToUrl() {
    const params = new URLSearchParams();
    if (state.dest) {
      params.set("lat", state.dest.lat.toFixed(5));
      params.set("lon", state.dest.lon.toFixed(5));
      if (state.dest.label !== "地図で選んだ地点") params.set("name", state.dest.label);
    }
    params.set("mode", state.mode);
    params.set("limit", String(state.limit));
    if (state.maxTransfers !== null) params.set("transfers", String(state.maxTransfers));
    if (state.hazardLevel) params.set("hazard", String(state.hazardLevel));
    history.replaceState(null, "", "?" + params.toString());
  }

  function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    if (MODE_LABELS[params.get("mode")]) state.mode = params.get("mode");
    const limit = Number(params.get("limit"));
    if ([15, 20, 30, 45, 60].includes(limit)) state.limit = limit;
    const transfers = params.get("transfers");
    if (["0", "1", "2"].includes(transfers)) state.maxTransfers = Number(transfers);
    modeSelect.value = state.mode;
    limitSelect.value = String(state.limit);
    transfersSelect.value = state.maxTransfers === null ? "" : String(state.maxTransfers);
    transfersSelect.disabled = state.mode !== "rail";
    const hazard = params.get("hazard");
    if (["1", "2", "3"].includes(hazard)) state.hazardLevel = Number(hazard);
    hazardSelect.value = String(state.hazardLevel);
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (params.has("lat") && Number.isFinite(lat) && Number.isFinite(lon)) {
      map.setView([lat, lon], 12);
      setDest(lat, lon, params.get("name") || "地図で選んだ地点");
    }
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
    if (state.reachGeo) setStatus(`「${state.dest.label}」まで${MODE_LABELS[state.mode]}で${state.limit}分以内${hazardSuffix()}の範囲です。`);
  });
  limitSelect.addEventListener("change", () => {
    state.limit = Number(limitSelect.value);
    update();
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
      if (state.dest && state.mode === "rail") update();
    } catch (err) {
      setStatus(`電車のデータを読み込めませんでした（${err.message}）。徒歩・自転車・車は使えます。`, true);
    }
  }

  loadFromUrl();
  renderLegend();
  loadRail();
})();
