(function () {
  "use strict";

  const DEFAULT_CENTER = [35.6812, 139.7671]; // 東京駅
  const DEFAULT_ZOOM = 10;
  const DATA_ZOOM = 10; // 高解像度降水ナウキャストの最大ネイティブズーム
  const TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
  const REFRESH_MS = 5 * 60 * 1000; // データ更新間隔(5分)に合わせてポーリング

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

  const map = L.map("rr-map");
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let currentBasetime = null;
  let currentValidtime = null;
  let rainLayer = null;
  const tileCache = new Map();

  function tileUrl(z, x, y) {
    return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${currentBasetime}/none/${currentValidtime}/surf/hrpns/${z}/${x}/${y}.png`;
  }

  function formatJmaTime(str) {
    const y = str.slice(0, 4);
    const mo = str.slice(4, 6);
    const d = str.slice(6, 8);
    const h = str.slice(8, 10);
    const mi = str.slice(10, 12);
    return `${y}/${mo}/${d} ${h}:${mi}`;
  }

  async function loadLatestRainLayer() {
    try {
      const res = await fetch(TIMES_URL);
      const times = await res.json();
      const latest = times[times.length - 1];
      if (latest.basetime === currentBasetime && latest.validtime === currentValidtime) {
        return; // 更新なし
      }
      currentBasetime = latest.basetime;
      currentValidtime = latest.validtime;
      tileCache.clear();

      if (rainLayer) {
        map.removeLayer(rainLayer);
      }
      rainLayer = L.tileLayer(tileUrl("{z}", "{x}", "{y}"), {
        maxNativeZoom: DATA_ZOOM,
        maxZoom: 18,
        opacity: 0.65,
        attribution: '<a href="https://www.jma.go.jp/" target="_blank" rel="noopener">気象庁</a>',
      }).addTo(map);

      statusEl.textContent = `表示時刻: ${formatJmaTime(currentValidtime)}（気象庁 高解像度降水ナウキャスト・最新実況）`;
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

  function getTileCanvasCtx(url) {
    if (tileCache.has(url)) {
      return tileCache.get(url);
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
    tileCache.set(url, promise);
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

  function latLngToTilePixel(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const xtile = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const ytile = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
    const tileX = Math.floor(xtile);
    const tileY = Math.floor(ytile);
    const px = Math.floor((xtile - tileX) * 256);
    const py = Math.floor((ytile - tileY) * 256);
    return { tileX, tileY, px, py, n };
  }

  map.on("click", async (e) => {
    if (!currentBasetime) {
      return;
    }
    const { lat, lng } = e.latlng;
    const popup = L.popup()
      .setLatLng(e.latlng)
      .setContent('<div class="rr-popup">読み込み中…</div>')
      .openOn(map);

    try {
      const { tileX, tileY, px, py, n } = latLngToTilePixel(lat, lng, DATA_ZOOM);
      if (tileY < 0 || tileY >= n) {
        throw new Error("out of range");
      }
      const url = tileUrl(DATA_ZOOM, tileX, tileY);
      const ctx = await getTileCanvasCtx(url);
      const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
      const label = formatJmaTime(currentValidtime);
      popup.setContent(
        `<div class="rr-popup">${describeIntensity(r, g, b, a)}<br><span style="color:var(--color-text-muted)">表示時刻: ${label}</span></div>`
      );
    } catch (err) {
      popup.setContent('<div class="rr-popup">この地点のデータを取得できませんでした。</div>');
    }
  });

  initView();
  loadLatestRainLayer();
  setInterval(loadLatestRainLayer, REFRESH_MS);
})();
