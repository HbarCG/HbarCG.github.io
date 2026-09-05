(function () {
  "use strict";

  const DEFAULT_CENTER = [35.6812, 139.7671]; // 東京駅
  const DEFAULT_ZOOM = 10;
  const DATA_ZOOM = 10; // 高解像度降水ナウキャストの最大ネイティブズーム
  const TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
  const LIST_REFRESH_MS = 5 * 60 * 1000; // データ更新間隔(5分)に合わせて時刻一覧を取り直す
  const FRAME_MS_BASE = 500; // 1倍速のときの1コマあたりの表示時間
  const PREFETCH_CONCURRENCY = 6;

  // 気象庁ホームページの配色設定指針(降水量・解析雨量・レーダー/ナウキャスト, mm/h)
  const COLOR_TABLE = [
    { rgb: [180, 0, 104], label: "80以上" },
    { rgb: [255, 40, 0], label: "50~80" },
    { rgb: [255, 153, 0], label: "30~50" },
    { rgb: [250, 245, 0], label: "20~30" },
    { rgb: [0, 65, 255], label: "10~20" },
    { rgb: [33, 140, 255], label: "5~10" },
    { rgb: [160, 210, 255], label: "1~5" },
    { rgb: [242, 242, 255], label: "0~1" },
  ];
  const COLOR_MATCH_THRESHOLD = 60; // ユークリッド距離の許容値(アンチエイリアス誤差を吸収)

  const statusEl = document.getElementById("rr-status");
  const playBtn = document.getElementById("rr-play");
  const slider = document.getElementById("rr-slider");
  const speedButtons = Array.from(document.querySelectorAll("[data-speed]"));

  const map = L.map("rr-map");
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // 「地図の表示範囲(zoom/center)」はLeafletのmapオブジェクトが自律的に管理する。
  // 「時間軸の現在位置」はこのtimelineだけが持ち、互いのstateを直接参照しない。
  const timeline = {
    times: [], // 古い→新しい順の [{basetime, validtime}, ...]
    index: 0,
    playing: false,
    speed: 1,
  };

  let playTimerId = null;
  const pixelTileCache = new Map(); // クリック判定用(URL -> Promise<CanvasRenderingContext2D>)

  function tileUrlFor(t, z, x, y) {
    return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${t.basetime}/none/${t.validtime}/surf/hrpns/${z}/${x}/${y}.png`;
  }

  function formatJmaTime(str) {
    const y = str.slice(0, 4);
    const mo = str.slice(4, 6);
    const d = str.slice(6, 8);
    const h = str.slice(8, 10);
    const mi = str.slice(10, 12);
    return `${y}/${mo}/${d} ${h}:${mi}`;
  }

  // タイムラインの現在フレームだけを見て降水タイルを返すレイヤー。
  // redraw()は現在の地図表示範囲にあるタイルだけを再取得するため、
  // パン/ズーム中でも全体再読み込みにはならない。
  const RainTileLayer = L.TileLayer.extend({
    getTileUrl: function (coords) {
      const t = timeline.times[timeline.index];
      if (!t) {
        return "";
      }
      return tileUrlFor(t, coords.z, coords.x, coords.y);
    },
  });

  const rainLayer = new RainTileLayer("", {
    maxNativeZoom: DATA_ZOOM,
    maxZoom: 18,
    opacity: 0.65,
    attribution: '<a href="https://www.jma.go.jp/" target="_blank" rel="noopener">気象庁</a>',
  }).addTo(map);

  function updateStatusLabel() {
    const t = timeline.times[timeline.index];
    if (!t) {
      return;
    }
    const isLive = timeline.index === timeline.times.length - 1;
    statusEl.textContent = `表示時刻: ${formatJmaTime(t.validtime)}${isLive ? "（最新）" : ""}`;
  }

  function renderFrame() {
    rainLayer.redraw();
    slider.value = String(timeline.index);
    updateStatusLabel();
  }

  function scheduleNextFrame() {
    clearTimeout(playTimerId);
    if (!timeline.playing || timeline.times.length === 0) {
      return;
    }
    const delay = FRAME_MS_BASE / timeline.speed;
    playTimerId = setTimeout(() => {
      timeline.index = (timeline.index + 1) % timeline.times.length;
      renderFrame();
      scheduleNextFrame();
    }, delay);
  }

  function play() {
    if (timeline.times.length === 0) {
      return;
    }
    timeline.playing = true;
    playBtn.textContent = "⏸";
    playBtn.setAttribute("aria-label", "一時停止");
    scheduleNextFrame();
  }

  function pause() {
    timeline.playing = false;
    clearTimeout(playTimerId);
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "再生");
  }

  playBtn.addEventListener("click", () => {
    if (timeline.playing) {
      pause();
    } else {
      play();
    }
  });

  slider.addEventListener("input", () => {
    pause();
    timeline.index = Number(slider.value);
    renderFrame();
  });

  speedButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      timeline.speed = Number(btn.dataset.speed);
      speedButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (timeline.playing) {
        scheduleNextFrame();
      }
    });
  });

  async function loadTimesList() {
    try {
      const res = await fetch(TIMES_URL);
      const data = await res.json();
      const hadTimes = timeline.times.length > 0;
      const wasAtLive = !hadTimes || timeline.index === timeline.times.length - 1;

      timeline.times = data;
      slider.max = String(Math.max(0, timeline.times.length - 1));

      if (!hadTimes || wasAtLive) {
        timeline.index = timeline.times.length - 1; // 初回、またはライブ追従中は最新へ
      } else {
        timeline.index = Math.min(timeline.index, timeline.times.length - 1);
      }

      renderFrame();
      prefetchTimeline();
    } catch (err) {
      statusEl.textContent = "降水データの取得に失敗しました。時間をおいて再読み込みしてください。";
    }
  }

  function initView() {
    if (!navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 11);
      },
      () => {
        // 位置情報取得に失敗した場合は東京都心のデフォルト表示のまま
      },
      { timeout: 5000 }
    );
  }

  // --- プリフェッチ: 現在の表示範囲について、全時刻分のタイルをあらかじめ読み込み、
  //     ブラウザのHTTPキャッシュに載せておく(タイルはCache-Control: max-age=86400)。
  //     再生時はredraw()がこのキャッシュから即座に画像を得られるため、コマ送りのカクつきを防ぐ。
  function tileXYAt(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
    return { x, y, n };
  }

  function visibleTileKeys() {
    const zoom = Math.min(map.getZoom(), DATA_ZOOM);
    const bounds = map.getBounds();
    const nw = tileXYAt(bounds.getNorth(), bounds.getWest(), zoom);
    const se = tileXYAt(bounds.getSouth(), bounds.getEast(), zoom);
    const n = nw.n;
    const keys = [];
    for (let x = Math.max(0, nw.x - 1); x <= Math.min(n - 1, se.x + 1); x++) {
      for (let y = Math.max(0, nw.y - 1); y <= Math.min(n - 1, se.y + 1); y++) {
        keys.push({ z: zoom, x, y });
      }
    }
    return keys;
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  let prefetchToken = 0;
  async function prefetchTimeline() {
    const myToken = ++prefetchToken;
    const tiles = visibleTileKeys();
    const jobs = [];
    for (const t of timeline.times) {
      for (const tile of tiles) {
        jobs.push(tileUrlFor(t, tile.z, tile.x, tile.y));
      }
    }
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        if (myToken !== prefetchToken) {
          return; // 新しい表示範囲用のプリフェッチに切り替わったので打ち切り
        }
        const url = jobs[cursor++];
        await preloadImage(url);
      }
    }
    const workers = [];
    for (let i = 0; i < PREFETCH_CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  let moveDebounceId = null;
  map.on("moveend zoomend", () => {
    clearTimeout(moveDebounceId);
    moveDebounceId = setTimeout(prefetchTimeline, 400);
  });

  // --- クリックした地点の推定降水強度をポップアップ表示 ---
  function getTileCanvasCtx(url) {
    if (pixelTileCache.has(url)) {
      return pixelTileCache.get(url);
    }
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(ctx);
      };
      img.onerror = () => reject(new Error("tile load failed"));
      img.src = url;
    });
    pixelTileCache.set(url, promise);
    return promise;
  }

  function describeIntensity(r, g, b, a) {
    if (a === 0) {
      return "推定降水強度: 0 mm/h（降水なし）";
    }
    let best = null;
    let bestDist = Infinity;
    for (const entry of COLOR_TABLE) {
      const [er, eg, eb] = entry.rgb;
      const dist = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    if (!best || bestDist > COLOR_MATCH_THRESHOLD ** 2) {
      return "推定降水強度: 不明（色の判定範囲外）";
    }
    return `推定降水強度: 約 ${best.label} mm/h`;
  }

  map.on("click", async (e) => {
    const t = timeline.times[timeline.index];
    if (!t) {
      return;
    }
    const { lat, lng } = e.latlng;
    const popup = L.popup()
      .setLatLng(e.latlng)
      .setContent('<div class="rr-popup">読み込み中…</div>')
      .openOn(map);

    try {
      const { x: tileX, y: tileY, n } = tileXYAt(lat, lng, DATA_ZOOM);
      if (tileY < 0 || tileY >= n) {
        throw new Error("out of range");
      }
      const scale = Math.pow(2, DATA_ZOOM) * 256;
      const px = Math.floor((((lng + 180) / 360) * scale) % 256);
      const latRad = (lat * Math.PI) / 180;
      const py = Math.floor((((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale) % 256);

      const url = tileUrlFor(t, DATA_ZOOM, tileX, tileY);
      const ctx = await getTileCanvasCtx(url);
      const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
      const label = formatJmaTime(t.validtime);
      popup.setContent(
        `<div class="rr-popup">${describeIntensity(r, g, b, a)}<br><span style="color:var(--color-text-muted)">表示時刻: ${label}</span></div>`
      );
    } catch (err) {
      popup.setContent('<div class="rr-popup">この地点のデータを取得できませんでした。</div>');
    }
  });

  initView();
  loadTimesList();
  setInterval(loadTimesList, LIST_REFRESH_MS);
})();
