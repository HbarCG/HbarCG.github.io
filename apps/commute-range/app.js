(function () {
  "use strict";

  const Rail = window.CommuteRail;
  const Hazard = window.CommuteHazard;

  const DATA_URL = "/apps/commute-range/data/kansai.json";
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
    for (const s of state.railSources) {
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
      if (t <= limit) sources.push({ lat: graph.stations[i].lat, lon: graph.stations[i].lon, t, maxWalk });
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
    // 災害リスクで除外するときは、駅の場所が除外の対象になる駅を一覧と地図から外す（タイルの読み込みを待つ）
    renderStations([]);
    stationsNote.textContent = "駅の災害リスクを確認中です…";
    setStatus(railStatus(null));
    const threshold = 4 - state.hazardLevel;
    Promise.all(groups.map((g) => Hazard.risksAt(g.lat, g.lon, 13))).then((risksList) => {
      if (id !== state.stationsRequestId) return; // あとから別の条件で計算し直した
      const kept = groups.filter((g, k) => !risksList[k].some((r) => r.sev >= threshold));
      renderStations(kept);
      setStatus(railStatus(kept.length, groups.length - kept.length));
    });
  }

  function railStatus(count, removed) {
    const { dest, limit } = state;
    const transfers =
      state.maxTransfers === null ? "" : state.maxTransfers === 0 ? "・乗り換えなし" : `・乗り換え${state.maxTransfers}回まで`;
    const stations =
      count === null ? "駅の災害リスクを確認中…" : removed ? `駅 ${count}。ほかに駅の場所が除外の対象の駅が ${removed}` : `駅 ${count}`;
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
        continue;
      }
      const rides = Rail.describeRoute(graph, railResult, i).filter((step) => step.type === "ride");
      groups.push({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        station: i,
        minutes: railResult.time[i],
        lines: [line],
        transfers: Math.max(0, rides.length - 1),
        via: rides.map((r) => shortName(r.service)).join(" → "),
      });
    }
    return groups;
  }

  function renderStations(groups) {
    stationLayer.clearLayers();
    if (!groups.length) {
      stationsSection.hidden = state.mode === "rail" && !!state.dest ? false : true;
      stationsBody.innerHTML = "";
      stationsCount.textContent = "";
      stationsNote.textContent = state.mode === "rail" ? "範囲内に駅はありません。" : "";
      return;
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
          )}</span></th><td class="cr-num">${Math.round(g.minutes)}分</td><td class="cr-num">${
            g.transfers
          }回</td><td class="cr-via">${g.via ? escapeHtml(g.via) : "徒歩"}</td></tr>`
      )
      .join("");
    stationsBody.onclick = stationsBody.onkeydown = (e) => {
      if (e.type === "keydown" && e.key !== "Enter") return;
      const row = e.target.closest("tr[data-k]");
      if (!row) return;
      const g = groups[Number(row.dataset.k)];
      map.setView([g.lat, g.lon], Math.max(map.getZoom(), 13));
      openStationPopup(g);
      document.getElementById("cr-map").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    stationsCount.textContent = `（${groups.length}駅）`;
    stationsNote.textContent = "";
    stationsSection.hidden = false;
  }

  function openStationPopup(g) {
    const box = document.createElement("div");
    box.className = "cr-popup";
    box.innerHTML =
      `<p class="cr-popup__time">${escapeHtml(g.name)}駅から約${Math.round(g.minutes)}分</p>` +
      `<ol>${routeItems(g.station).map((t) => `<li>${t}</li>`).join("")}</ol>`;
    L.popup({ offset: [0, -4] }).setLatLng([g.lat, g.lon]).setContent(box).openOn(map);
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
      ).join("<br>");
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
    [/北大阪急行電鉄 南北線/g, "北大阪急行"],
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
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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
