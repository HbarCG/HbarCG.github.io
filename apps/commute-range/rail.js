// Copyright (c) 2026 HbarCG. All rights reserved. 無断での複製・転用を禁じます（apps/commute-range/LICENSE.txt）。
// 通勤圏マップの電車の計算。画面には依存しない（Node からも require できる）。
//
// 時刻表は使わず、「駅間の距離と路線の種類から見積もった所要時間」と「乗るたびの待ち時間」で、
// 各駅から目的地までのおおよその時間を出す。数字はすべて目安で、下の PARAMS で調整できる。
//
// 考え方:
//   - 駅は「ホームにいる状態」と「電車に乗っている状態」に分けて扱う
//   - ホーム → 電車: 待ち時間（改札からホームまでの移動も含む）
//   - 電車 → 次の駅の電車: 停車時間 + 距離 ÷ 路線の速さ
//   - 電車 → ホーム: 0（降りるだけ）
//   - ホーム → 近くの別の駅のホーム: 歩く時間（乗り換え）
//   - 各駅停車のほかに、主な速達列車（EXPRESS_SERVICES）を「停車駅だけを結ぶ別の電車」として足す
//   - 目的地から逆向きにたどり、各駅のホームから目的地までの最短時間を求める
//   - ある地点からの時間 = 地点から駅まで歩く時間 + その駅からの時間（または目的地まで直接歩く時間）
(function (root) {
  "use strict";

  const PARAMS = {
    walkMetersPerMin: 80, // 時速4.8km
    walkDetour: 1.3, // 道は直線ではないので、直線距離をこの倍率で長めに見る
    maxStationWalkMin: 20, // 家から駅まで・駅から目的地まで歩くのはこの時間まで（それ以上は通勤として現実的でない）
    boardWaitMin: 4, // 各駅停車に乗るたびにかかる時間（改札からホームまで＋電車を待つ）
    expressWaitMin: 5, // 速達列車は本数が少ないぶん長めに見る
    exitMin: 1, // 降りてから改札を出るまで
    sameStationTransferMin: 3, // 同じ名前の駅（300m以内）どうしの乗り換えの移動
    transferRadiusM: 500, // 名前が違っても、この距離までの駅は歩いて乗り換えられるとみなす
    dwellMin: 1.1, // 1駅ごとの停車と加減速のぶん
    expressDetour: 1.08, // 速達列車の駅間は直線距離から見積もるので、線路の曲がりのぶん長めに見る
    // 種類ごとの、走っているときの速さの目安（km/h）
    speedKmh: {
      jr: 90,
      private: 85,
      subway: 60,
      newtransit: 50,
      tram: 30,
      cable: 12,
      jrRapid: 110,
      privateExpress: 95,
    },
  };

  // 別の路線に乗り入れて走る電車があり、乗り換えずにそのまま乗っていられる駅。
  // [路線, 路線, 駅名]。路線名はデータ（国土数値情報）の「事業者 路線名」と同じ書き方にする。
  const THROUGH_SERVICES = [
    ["西日本旅客鉄道 東海道線", "西日本旅客鉄道 山陽線", "神戸"],
    ["西日本旅客鉄道 JR東西線", "西日本旅客鉄道 東海道線", "尼崎"],
    ["西日本旅客鉄道 JR東西線", "西日本旅客鉄道 福知山線", "尼崎"],
    ["西日本旅客鉄道 福知山線", "西日本旅客鉄道 東海道線", "尼崎"],
    ["西日本旅客鉄道 JR東西線", "西日本旅客鉄道 片町線", "京橋"],
    ["西日本旅客鉄道 阪和線", "西日本旅客鉄道 関西空港線", "日根野"],
    ["西日本旅客鉄道 阪和線", "西日本旅客鉄道 大阪環状線", "天王寺"],
    ["西日本旅客鉄道 関西線", "西日本旅客鉄道 大阪環状線", "天王寺"],
    ["西日本旅客鉄道 桜島線", "西日本旅客鉄道 大阪環状線", "西九条"],
    ["西日本旅客鉄道 湖西線", "西日本旅客鉄道 東海道線", "山科"],
    ["西日本旅客鉄道 草津線", "西日本旅客鉄道 東海道線", "草津"],
    ["西日本旅客鉄道 おおさか東線", "西日本旅客鉄道 東海道線", "新大阪"],
    ["阪急電鉄 京都線", "阪急電鉄 宝塚線", "十三"],
    ["阪急電鉄 京都線", "阪急電鉄 千里線", "淡路"],
    ["阪急電鉄 神戸線", "阪急電鉄 神戸高速線", "神戸三宮"],
    ["阪神電気鉄道 本線", "阪神電気鉄道 神戸高速線", "元町"],
    ["阪神電気鉄道 本線", "阪神電気鉄道 阪神なんば線", "尼崎"],
    ["阪神電気鉄道 神戸高速線", "山陽電気鉄道 本線", "西代"],
    ["神戸電鉄 有馬線", "神戸電鉄 神戸高速線", "湊川"],
    ["神戸電鉄 有馬線", "神戸電鉄 三田線", "有馬口"],
    ["神戸電鉄 有馬線", "神戸電鉄 粟生線", "鈴蘭台"],
    ["近畿日本鉄道 難波線", "阪神電気鉄道 阪神なんば線", "大阪難波"],
    ["近畿日本鉄道 難波線", "近畿日本鉄道 大阪線", "大阪上本町"],
    ["近畿日本鉄道 大阪線", "近畿日本鉄道 奈良線", "布施"],
    ["近畿日本鉄道 京都線", "近畿日本鉄道 橿原線", "大和西大寺"],
    ["近畿日本鉄道 南大阪線", "近畿日本鉄道 長野線", "古市"],
    ["近畿日本鉄道 けいはんな線", "大阪市高速電気軌道 4号線(中央線)", "長田"],
    ["京都市 烏丸線", "近畿日本鉄道 京都線", "竹田"],
    ["京都市 東西線", "京阪電気鉄道 京津線", "御陵"],
    ["南海電気鉄道 南海本線", "南海電気鉄道 高野線", "岸里玉出"],
    ["南海電気鉄道 高野線", "南海電気鉄道 泉北線", "中百舌鳥"],
    ["南海電気鉄道 南海本線", "南海電気鉄道 空港線", "泉佐野"],
    ["京阪電気鉄道 京阪本線", "京阪電気鉄道 鴨東線", "三条"],
    ["京阪電気鉄道 京阪本線", "京阪電気鉄道 中之島線", "天満橋"],
    ["神戸市 山手線", "神戸市 西神線", "新長田"],
    ["神戸市 西神線", "神戸市 西神延伸線", "名谷"],
    ["神戸市 北神線", "神戸市 山手線", "新神戸"],
    ["北大阪急行電鉄 南北線", "大阪市高速電気軌道 1号線(御堂筋線)", "江坂"],
    ["大阪市高速電気軌道 6号線(堺筋線)", "阪急電鉄 千里線", "天神橋筋六丁目"],
  ];

  // 主な速達列車と、その停車駅（おおよそ。昼間の代表的な停車駅で、時間帯による違いは見ない）。
  // operator: 停車駅を探す事業者（複数の事業者をまたぐものは配列）
  const EXPRESS_SERVICES = [
    {
      name: "JR 新快速",
      operator: ["西日本旅客鉄道"],
      kind: "jrRapid",
      stops: ["草津", "南草津", "石山", "大津", "山科", "京都", "高槻", "新大阪", "大阪", "尼崎", "芦屋", "三ノ宮", "元町", "神戸", "明石", "西明石", "加古川", "姫路"],
    },
    {
      name: "JR 大和路快速",
      operator: ["西日本旅客鉄道"],
      kind: "jrRapid",
      stops: ["天王寺", "久宝寺", "王寺", "法隆寺", "大和小泉", "郡山", "奈良"],
    },
    {
      name: "JR 関空快速・紀州路快速",
      operator: ["西日本旅客鉄道"],
      kind: "jrRapid",
      stops: ["天王寺", "堺市", "三国ヶ丘", "鳳", "和泉府中", "東岸和田", "熊取", "日根野"],
    },
    {
      name: "JR 丹波路快速",
      operator: ["西日本旅客鉄道"],
      kind: "jrRapid",
      stops: ["大阪", "尼崎", "伊丹", "川西池田", "中山寺", "宝塚", "三田"],
    },
    {
      name: "阪急 京都線特急",
      operator: ["阪急電鉄"],
      kind: "privateExpress",
      stops: ["大阪梅田", "十三", "淡路", "茨木市", "高槻市", "長岡天神", "桂", "烏丸", "京都河原町"],
    },
    {
      name: "阪急 神戸線特急",
      operator: ["阪急電鉄"],
      kind: "privateExpress",
      stops: ["大阪梅田", "十三", "西宮北口", "夙川", "岡本", "神戸三宮"],
    },
    {
      name: "阪神 直通特急",
      operator: ["阪神電気鉄道"],
      kind: "privateExpress",
      stops: ["大阪梅田", "尼崎", "甲子園", "西宮", "芦屋", "魚崎", "御影", "神戸三宮", "元町"],
    },
    {
      name: "京阪 特急",
      operator: ["京阪電気鉄道"],
      kind: "privateExpress",
      stops: ["淀屋橋", "北浜", "天満橋", "京橋", "枚方市", "樟葉", "中書島", "丹波橋", "七条", "祇園四条", "三条", "出町柳"],
    },
    {
      name: "近鉄 奈良線快速急行",
      operator: ["近畿日本鉄道"],
      kind: "privateExpress",
      stops: ["大阪難波", "近鉄日本橋", "大阪上本町", "鶴橋", "布施", "生駒", "学園前", "大和西大寺", "新大宮", "近鉄奈良"],
    },
    {
      name: "近鉄 京都線急行",
      operator: ["近畿日本鉄道"],
      kind: "privateExpress",
      stops: ["京都", "竹田", "近鉄丹波橋", "大久保", "新田辺", "新祝園", "高の原", "大和西大寺"],
    },
    {
      name: "近鉄 大阪線急行",
      operator: ["近畿日本鉄道"],
      kind: "privateExpress",
      stops: ["大阪上本町", "鶴橋", "布施", "河内国分", "五位堂", "大和高田", "大和八木", "桜井"],
    },
    {
      name: "南海 本線急行",
      operator: ["南海電気鉄道"],
      kind: "privateExpress",
      stops: ["難波", "新今宮", "天下茶屋", "堺", "羽衣", "泉大津", "岸和田", "貝塚", "泉佐野", "尾崎", "和歌山市"],
    },
    {
      name: "南海 高野線急行",
      operator: ["南海電気鉄道"],
      kind: "privateExpress",
      stops: ["難波", "新今宮", "天下茶屋", "堺東", "北野田", "金剛", "河内長野"],
    },
  ];

  function metersBetween(lat1, lon1, lat2, lon2) {
    // 数十km程度までなので平面近似で十分
    const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    const dx = (lon2 - lon1) * kx;
    const dy = (lat2 - lat1) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function walkMin(meters, params) {
    return (meters * params.walkDetour) / params.walkMetersPerMin;
  }

  function rideMin(kind, meters, params) {
    const kmh = params.speedKmh[kind] || params.speedKmh.private;
    return params.dwellMin + (meters / 1000 / kmh) * 60;
  }

  // data: scripts/commute-rail-build.mjs が作った JSON（lines / stations / links）
  //
  // 戻り値のグラフのノード:
  //   0..n-1       駅のホーム（station = 駅index）
  //   n..2n-1      その駅で各駅停車に乗っている状態
  //   2n..         速達列車に乗っている状態（停車駅ごとに1つ）
  // edges[v] = [[w, 分], ...]
  function build(data, params) {
    params = params || PARAMS;
    const n = data.stations.length;
    const stations = data.stations.map(([line, name, lat, lon]) => ({ line, name, lat, lon }));
    const lineName = (i) => data.lines[stations[i].line][0];

    const nodeStation = []; // ノード -> 駅index
    const nodeService = []; // ノード -> 乗っている電車の名前（ホームは null）
    const edges = [];
    const addNode = (station, service) => {
      nodeStation.push(station);
      nodeService.push(service);
      edges.push([]);
      return nodeStation.length - 1;
    };
    const add = (a, b, min) => edges[a].push([b, min]);

    for (let i = 0; i < n; i++) addNode(i, null);
    for (let i = 0; i < n; i++) addNode(i, lineName(i));

    for (let i = 0; i < n; i++) {
      add(i, n + i, params.boardWaitMin);
      add(n + i, i, 0);
    }
    for (const [a, b, m] of data.links) {
      const t = rideMin(data.lines[stations[a].line][1], m, params);
      add(n + a, n + b, t);
      add(n + b, n + a, t);
    }

    // 駅名 -> 駅index[]
    const byName = new Map();
    stations.forEach((s, i) => {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(i);
    });

    // 直通運転（乗ったまま次の路線に入る）。わずかに時間を足して、同じ時間なら直通しない経路を選ばせる
    const missing = [];
    for (const [la, lb, name] of THROUGH_SERVICES) {
      const cand = byName.get(name) || [];
      const a = cand.find((i) => lineName(i) === la);
      const b = cand.find((i) => lineName(i) === lb);
      if (a === undefined || b === undefined) {
        missing.push(`直通 ${la} / ${lb} / ${name}`);
        continue;
      }
      add(n + a, n + b, 0.01);
      add(n + b, n + a, 0.01);
    }

    // 近くの駅どうしの乗り換え（緯度でざっと絞ってから距離を測る）
    const order = stations.map((s, i) => i).sort((a, b) => stations[a].lat - stations[b].lat);
    const latWindow = params.transferRadiusM / 110540;
    for (let p = 0; p < order.length; p++) {
      const i = order[p];
      const si = stations[i];
      for (let q = p + 1; q < order.length; q++) {
        const j = order[q];
        const sj = stations[j];
        if (sj.lat - si.lat > latWindow) break;
        if (si.line === sj.line) continue;
        const m = metersBetween(si.lat, si.lon, sj.lat, sj.lon);
        const sameName = si.name === sj.name && m <= 300;
        if (!sameName && m > params.transferRadiusM) continue;
        const t = sameName
          ? params.sameStationTransferMin
          : Math.max(params.sameStationTransferMin, walkMin(m, params));
        add(i, j, t);
        add(j, i, t);
      }
    }

    // 速達列車
    for (const svc of EXPRESS_SERVICES) {
      let prev = -1;
      for (const stop of svc.stops) {
        const cand = (byName.get(stop) || []).filter((i) => svc.operator.some((op) => lineName(i).startsWith(op + " ")));
        if (!cand.length) {
          missing.push(`${svc.name} の停車駅 ${stop}`);
          continue;
        }
        const i = cand[0];
        const v = addNode(i, svc.name);
        add(i, v, params.expressWaitMin);
        add(v, i, 0);
        if (prev >= 0) {
          const s0 = stations[nodeStation[prev]];
          const m = metersBetween(s0.lat, s0.lon, stations[i].lat, stations[i].lon) * params.expressDetour;
          const t = rideMin(svc.kind, m, params);
          add(prev, v, t);
          add(v, prev, t);
        }
        prev = v;
      }
    }

    return { n, stations, lines: data.lines, edges, nodeStation, nodeService, params, missing };
  }

  // 目的地 (lat, lon) まで、各ノードから何分かかるかを求める（limitMin を超えたところは打ち切る）。
  // maxTransfers を数で渡すと、乗り換えがその回数以下の経路だけを使う（null なら制限なし）。
  // 直通運転で乗ったまま別の路線に入るのは乗り換えに数えない。
  //
  // 乗り換えを数えるため、「ノード × それまでに乗った回数」を1つの状態として探す（状態 = 回数 * size + ノード）。
  // 戻り値:
  //   time[v]   ノード v から目的地までの最短時間（条件を満たす経路のうち）
  //   state[v]  その最短時間になる状態
  //   next[s]   状態 s から目的地へ向かう次の状態（-1 なら歩いて目的地へ）
  //   stateTime[s]  状態 s から目的地までの時間
  function timesTo(graph, lat, lon, limitMin, maxTransfers) {
    const { n, stations, edges, nodeService, params } = graph;
    const size = edges.length;
    const limited = maxTransfers !== null && maxTransfers !== undefined;
    const layers = limited ? maxTransfers + 2 : 1; // 乗った回数 0..maxTransfers+1
    const stateTime = new Float64Array(size * layers).fill(Infinity);
    const next = new Int32Array(size * layers).fill(-2);

    // 逆向きのグラフ（v -> w の辺を w から v へたどる）
    if (!graph.reverse) {
      graph.reverse = Array.from({ length: size }, () => []);
      for (let v = 0; v < size; v++) {
        for (const [w, t] of edges[v]) graph.reverse[w].push([v, t]);
      }
    }

    const heap = new MinHeap();
    for (let i = 0; i < n; i++) {
      const s = stations[i];
      const walk = walkMin(metersBetween(s.lat, s.lon, lat, lon), params);
      const t = walk + params.exitMin;
      if (walk <= params.maxStationWalkMin && t <= limitMin) {
        stateTime[i] = t;
        next[i] = -1;
        heap.push(t, i);
      }
    }
    while (heap.size) {
      const [t, sw] = heap.pop();
      if (t > stateTime[sw]) continue;
      const layer = Math.floor(sw / size);
      const w = sw - layer * size;
      for (const [v, dt] of graph.reverse[w]) {
        // ホーム → 電車 の辺は「1回乗る」
        const boards = nodeService[v] === null && nodeService[w] !== null;
        const nl = limited && boards ? layer + 1 : layer;
        if (nl >= layers) continue;
        const sv = nl * size + v;
        const nt = t + dt;
        if (nt < stateTime[sv] && nt <= limitMin) {
          stateTime[sv] = nt;
          next[sv] = sw;
          heap.push(nt, sv);
        }
      }
    }

    const time = new Float64Array(size).fill(Infinity);
    const state = new Int32Array(size).fill(-1);
    for (let l = 0; l < layers; l++) {
      for (let v = 0; v < size; v++) {
        const t = stateTime[l * size + v];
        if (t < time[v]) {
          time[v] = t;
          state[v] = l * size + v;
        }
      }
    }
    return { time, state, next, stateTime, size };
  }

  // 地点 (lat, lon) から目的地までの時間と、どの駅から乗るのが最短か（-1 なら目的地まで歩く）
  function timeFromPoint(graph, result, dest, lat, lon) {
    const { n, stations, params } = graph;
    let best = walkMin(metersBetween(lat, lon, dest.lat, dest.lon), params);
    let station = -1;
    for (let i = 0; i < n; i++) {
      const t0 = result.time[i];
      if (t0 >= best) continue;
      const walk = walkMin(metersBetween(lat, lon, stations[i].lat, stations[i].lon), params);
      if (walk > params.maxStationWalkMin) continue;
      const t = t0 + walk;
      if (t < best) {
        best = t;
        station = i;
      }
    }
    return { minutes: best, station };
  }

  // 駅（ホーム）i から目的地までの道のりを、手順の配列にする
  //   { type: "ride", service, from, to }      電車に乗る（service は路線名か速達列車の名前）
  //   { type: "walk", from, to }               別の駅まで歩いて乗り換える
  //   { type: "walk-to-dest", from, minutes }  降りた駅から目的地まで歩く
  function describeRoute(graph, result, i) {
    const { stations, nodeStation, nodeService } = graph;
    const steps = [];
    let s = result.state[i];
    for (let guard = 0; s >= 0 && guard < 100000; guard++) {
      const ns = result.next[s];
      const v = s % result.size;
      if (ns === -1) {
        steps.push({ type: "walk-to-dest", from: stations[nodeStation[v]].name, minutes: result.stateTime[s] });
        break;
      }
      if (ns < 0) break;
      const w = ns % result.size;
      const fromName = stations[nodeStation[v]].name;
      const toName = stations[nodeStation[w]].name;
      const onV = nodeService[v] !== null;
      const onW = nodeService[w] !== null;
      const last = steps[steps.length - 1];
      if (!onV && onW) {
        steps.push({ type: "ride", service: nodeService[w], from: fromName, to: fromName });
      } else if (onV && onW) {
        // 直通運転で別の路線に入ったときは、路線名を「A → B」とつなげる
        if (last && last.type === "ride") {
          if (nodeService[w] !== nodeService[v] && !last.service.endsWith(nodeService[w])) {
            last.service += " → " + nodeService[w];
          }
          last.to = toName;
        }
      } else if (!onV && !onW && fromName !== toName) {
        steps.push({ type: "walk", from: fromName, to: toName });
      }
      s = ns;
    }
    return steps;
  }

  class MinHeap {
    constructor() {
      this.keys = [];
      this.vals = [];
    }
    get size() {
      return this.keys.length;
    }
    push(k, v) {
      const keys = this.keys;
      const vals = this.vals;
      let i = keys.length;
      keys.push(k);
      vals.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = k;
      vals[i] = v;
    }
    pop() {
      const keys = this.keys;
      const vals = this.vals;
      const top = [keys[0], vals[0]];
      const k = keys.pop();
      const v = vals.pop();
      if (keys.length) {
        let i = 0;
        const len = keys.length;
        while (true) {
          let c = 2 * i + 1;
          if (c >= len) break;
          if (c + 1 < len && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= k) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = k;
        vals[i] = v;
      }
      return top;
    }
  }

  const api = {
    PARAMS,
    THROUGH_SERVICES,
    EXPRESS_SERVICES,
    build,
    timesTo,
    timeFromPoint,
    describeRoute,
    metersBetween,
    walkMin,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CommuteRail = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
