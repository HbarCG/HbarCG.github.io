'use strict';

/*
 * 手牌の評価値。CPU（レベル3以上）の打牌・鳴き・槓・リーチの判断に使う。
 *
 * 電脳麻将の思考ルーチン（kobalab/majiang-ai の lib/player.js・lib/suanpai.js）の考え方を、
 * このアプリの牌の表し方（牌種0〜33の枚数配列）に合わせて移植したもの。
 * 数値のしきい値（WIDTH、牌価値の倍率など）は電脳麻将と同じにしてある。
 *
 * 移植元: kobalab/majiang-ai  Copyright (c) 2021 Satoshi Kobayashi  MIT License
 * ライセンス本文は同じフォルダの LICENSE-majiang-ai.txt を参照。
 *
 * 評価値は「この手をこのまま進めたとき、どれくらい点数を稼げそうか」を表す数:
 *   聴牌          : 待ち牌ごとに「和了したときの点数 × その牌を引ける見込み」を足す
 *   一向聴・二向聴: 有効牌ごとに「引いて一番よい打牌をしたあとの評価値 × 引ける見込み」を足す
 *                   （ポン・チーで進める見込みも加える）
 *   三向聴以上    : 遠すぎて点数までは読めないので、役に向かう有効牌の枚数を数える
 *   「引ける見込み」= 見えていない枚数 × 残りツモ回数 ÷ 見えていない牌の総数
 * 和了したときの点数は、面前ならリーチをかけた前提で、ツモ和了として計算する（裏ドラ・一発は数えない）。
 *
 * 赤5は、普通の5とは別の牌として「引ける見込み」を数える（引いたら1翻増えるため）。
 *
 * このファイルは状態を持たない。createEvaluator() が返すオブジェクトは1回の判断の間だけ使い、
 * 計算結果を覚えておく（同じ形を何度も計算しないため）。
 *
 * ---------------------------------------------------------------------------
 * 移植元のライセンス表示（MIT License）
 *
 * Copyright (c) 2021 Satoshi Kobayashi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ---------------------------------------------------------------------------
 */

// 向聴数ごとの割り算の値（電脳麻将と同じ）。遠い手ほど「引いてから先」が不確かなので割り引く。
const EVAL_WIDTH = [8, 8 * 4, 8 * 4 * 2];
const EVAL_EPSILON = 0.0000001;
const FIVE_TYPES = [4, 13, 22]; // 5m, 5p, 5s

// 評価に使う手牌:
//   counts : 面前部分の34種の枚数（副露は含まない）
//   aka    : 面前部分にある赤5の枚数 [萬, 筒, 索]（0か1）
//   melds  : 副露（{kind, tiles}。tiles は牌ID）。仮に鳴いた場合の副露も入る
//   zimo   : 14枚目として引いた牌 { type, red }（打牌前の形のときだけ）
// 面前の枚数を3で割った余りが2なら「打牌前（14枚相当）」、1なら「打牌後（13枚相当）」。
function evalHandFromTiles(tileIds, melds) {
  const aka = [0, 0, 0];
  for (const id of tileIds) {
    const k = RED_FIVE_IDS.indexOf(id);
    if (k !== -1) aka[k] = 1;
  }
  return { counts: toCounts(tileIds), aka, melds, zimo: null };
}

function isDiscardPhase(hand) {
  let n = 0;
  for (const c of hand.counts) n += c;
  return n % 3 === 2;
}

function fiveSuitIndex(type) { return FIVE_TYPES.indexOf(type); }

// 牌を1枚捨てた手。赤5を捨てるかどうかは red で指定する。
function evalDiscard(hand, type, red) {
  const counts = hand.counts.slice();
  counts[type]--;
  const aka = hand.aka.slice();
  if (red) aka[fiveSuitIndex(type)] = 0;
  return { counts, aka, melds: hand.melds, zimo: null };
}

function evalDraw(hand, type, red) {
  const counts = hand.counts.slice();
  counts[type]++;
  const aka = hand.aka.slice();
  if (red) aka[fiveSuitIndex(type)] = 1;
  return { counts, aka, melds: hand.melds, zimo: { type, red } };
}

// 打牌の候補。同じ牌種は1回だけ調べる。5は普通の5があればそれを捨て、赤5しかないときだけ赤5を捨てる。
function evalDiscardCandidates(hand) {
  const result = [];
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (hand.counts[t] === 0) continue;
    const k = fiveSuitIndex(t);
    const onlyRed = k !== -1 && hand.aka[k] === 1 && hand.counts[t] === 1;
    result.push({ type: t, red: onlyRed });
  }
  return result;
}

// 牌種から、手牌に含める牌IDを作る（赤5を持っていれば赤5のIDを使う）。
function evalTileIdsForType(type, count, hasRed) {
  const copies = hasRed ? [0, 1, 2, 3] : [1, 2, 3, 0];
  return copies.slice(0, count).map((c) => type * 4 + c);
}

// 副露を1つ作る（仮に鳴いた場合用）。手牌から使う牌を取り除いた手を返す。
//   pon: types=[t,t]、chi: types=[a,b]（鳴いた牌 calledType を足して順子になる2枚）
function evalCall(hand, kind, types, calledType) {
  const counts = hand.counts.slice();
  const aka = hand.aka.slice();
  const tiles = [];
  for (const t of types) {
    counts[t]--;
    const k = fiveSuitIndex(t);
    // 赤5は、手に残る5がなくなるときだけ副露に回す（残せるなら手に残す）
    if (k !== -1 && aka[k] === 1 && counts[t] === 0) {
      aka[k] = 0;
      tiles.push(t * 4);
    } else {
      tiles.push(t * 4 + 1 + (tiles.length % 3));
    }
  }
  tiles.push(calledType * 4 + 3);
  return { counts, aka, melds: hand.melds.concat([{ kind, tiles }]), zimo: null };
}

// 副露を計算結果の覚え書きの鍵にする。順子は一番小さい牌で表す（tiles[0] は鳴いた牌の位置によって
// 変わるので、456と567のように別の順子が同じ鍵にならないようにする）。赤5を含むかどうかも区別する
function evalMeldKey(melds) {
  return melds.map((m) => {
    const low = Math.min(...m.tiles.map(tileType));
    return m.kind[0] + low + (m.tiles.some(isRedFive) ? 'r' : '');
  }).join(',');
}

// options:
//   visibleCounts : 自分から見えている牌の枚数（34種、assist.js の countVisibleTypes）
//   visibleRed    : 見えている赤5 [萬, 筒, 索]（0か1）
//   wallRemaining : 山の残り枚数（全員のツモの残り）
//   seatWindType, roundWindType, isDealer, doraIndicators
//   winValue      : （省略可）和了の価値を点数から計算し直す関数 (basePoints) => 価値。
//                   オーラスで順位を意識するときに使う。省略時はツモ和了の点数そのもの
function createEvaluator(options) {
  const rest = options.visibleCounts.map((v) => Math.max(0, 4 - v));
  const restRed = [0, 1, 2].map((k) => (options.visibleRed[k] ? 0 : 1));
  let restTotal = rest.reduce((a, b) => a + b, 0);
  let draws = options.wallRemaining;
  const doraTypes = options.doraIndicators.map(doraTypeFromIndicator);

  const evalCache = new Map();
  const pointCache = new Map();
  const shantenCache = new Map();

  // ---- 見えていない牌の枚数 ----------------------------------------------------

  // 普通の牌（5なら赤でない5）と赤5を分けた残り枚数
  function restOf(type, red) {
    const k = fiveSuitIndex(type);
    if (k === -1) return rest[type];
    return red ? restRed[k] : Math.max(0, rest[type] - restRed[k]);
  }
  // その牌を引ける見込み（電脳麻将の Paishu.val）
  function drawWeight(type, red) {
    if (draws <= 0 || restTotal <= 0) return 0;
    return restOf(type, red) * draws / restTotal;
  }
  // 自分が1枚引いたことにする（1巡進む＝全員で4回ツモが減る）
  function takeTile(type, red) {
    rest[type]--;
    if (red) restRed[fiveSuitIndex(type)]--;
    restTotal--;
    draws -= 4;
  }
  function returnTile(type, red) {
    rest[type]++;
    if (red) restRed[fiveSuitIndex(type)]++;
    restTotal++;
    draws += 4;
  }

  // ---- 向聴数 ------------------------------------------------------------------

  function shantenOf(hand) {
    const key = hand.counts.join('') + '|' + hand.melds.length;
    let s = shantenCache.get(key);
    if (s === undefined) {
      s = computeShanten(hand.counts, hand.melds.length);
      shantenCache.set(key, s);
    }
    return s;
  }

  function isMenzen(hand) {
    return hand.melds.every((m) => m.kind === 'ankan');
  }

  function yakuhaiTypes() {
    return [31, 32, 33, options.roundWindType, options.seatWindType];
  }

  // 役を意識した向聴数（電脳麻将の Player.xiangting）。
  // 面前・役牌・タンヤオ・対々和・染め手のうち、一番近いものの向聴数。どれも無理なら Infinity。
  function yakuShanten(hand) {
    const meldCount = hand.melds.length;
    const meldTypes = hand.melds.map((m) => m.tiles.map(tileType));
    let best = Infinity;

    if (isMenzen(hand)) best = Math.min(best, shantenOf(hand));

    // 役牌: 刻子（か副露）があればその向聴数。対子なら、ポンしたとして1つ足す
    let hasYakuhai = false;
    let ponPair = null;
    for (const t of yakuhaiTypes()) {
      if (hand.counts[t] >= 3) hasYakuhai = true;
      else if (hand.counts[t] === 2 && rest[t] > 0) ponPair = t;
      if (meldTypes.some((types) => types[0] === t)) hasYakuhai = true;
    }
    if (hasYakuhai) best = Math.min(best, shantenOf(hand));
    else if (ponPair !== null) {
      const counts = hand.counts.slice();
      counts[ponPair] -= 2;
      best = Math.min(best, computeShanten(counts, meldCount + 1) + 1);
    }

    // タンヤオ（喰いタンあり）: 副露に么九牌がなければ、么九牌を除いて数える
    if (!meldTypes.some((types) => types.some(isYaochuuType))) {
      const counts = hand.counts.map((c, t) => (isYaochuuType(t) ? 0 : c));
      best = Math.min(best, computeShanten(counts, meldCount));
    }

    // 対々和: 副露がすべて刻子・槓子なら、刻子と対子の数で数える
    if (hand.melds.every((m) => m.kind !== 'chi')) {
      let sets = meldCount;
      let pairs = 0;
      for (const c of hand.counts) {
        if (c >= 3) sets++;
        else if (c === 2) pairs++;
      }
      if (sets + pairs > 5) pairs = 5 - sets;
      best = Math.min(best, 8 - sets * 2 - pairs);
    }

    // 染め手: 副露がその色か字牌だけなら、ほかの色を除いて数える
    for (let suit = 0; suit < 3; suit++) {
      const inSuit = (t) => t >= 27 || Math.floor(t / 9) === suit;
      if (meldTypes.some((types) => !inSuit(types[0]))) continue;
      const counts = hand.counts.map((c, t) => (inSuit(t) ? c : 0));
      best = Math.min(best, computeShanten(counts, meldCount));
    }
    return best;
  }

  // ---- 有効牌 ------------------------------------------------------------------

  // 13枚相当の手で、引くと向聴数が下がる牌種（電脳麻将の Util.tingpai）
  function usefulTypes(hand, shantenFn) {
    const base = shantenFn(hand);
    const result = [];
    for (let t = 0; t < TILE_TYPE_COUNT; t++) {
      if (hand.counts[t] >= 4) continue;
      hand.counts[t]++;
      const s = shantenFn(hand);
      hand.counts[t]--;
      if (s < base) result.push(t);
    }
    return result;
  }

  // 有効牌を、赤5と普通の5に分けて並べる
  function withRedFives(types) {
    const result = [];
    for (const t of types) {
      if (fiveSuitIndex(t) !== -1) result.push({ type: t, red: true });
      result.push({ type: t, red: false });
    }
    return result;
  }

  // 実際に残っている有効牌の枚数（赤5も含む）
  function usefulCount(hand) {
    return usefulTypes(hand, shantenOf).reduce((sum, t) => sum + rest[t], 0);
  }

  function ponTypes(hand, t) {
    return hand.counts[t] >= 2 ? [[t, t]] : [];
  }
  function chiTypes(hand, t) {
    if (t >= 27) return [];
    const r = t % 9;
    const result = [];
    for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      if (r + a < 0 || r + b > 8) continue;
      if (hand.counts[t + a] > 0 && hand.counts[t + b] > 0) result.push([t + a, t + b]);
    }
    return result;
  }

  // 役を意識した有効牌。遠い手（三向聴以上）の評価に使う。
  // 鳴いたほうが進む牌には印をつける（ポンで進む=pon、チーで進む=chi）
  function yakuUsefulTypes(hand) {
    const base = yakuShanten(hand);
    const result = [];
    for (const t of usefulTypes(hand, yakuShanten)) {
      if (base > 0) {
        if (ponTypes(hand, t).some((types) => yakuShanten(evalCall(hand, 'pon', types, t)) < base)) {
          result.push({ type: t, via: 'pon' });
          continue;
        }
        if (chiTypes(hand, t).some((types) => yakuShanten(evalCall(hand, 'chi', types, t)) < base)) {
          result.push({ type: t, via: 'chi' });
          continue;
        }
      }
      result.push({ type: t, via: null });
    }
    return result;
  }

  // ---- 和了したときの点数 ------------------------------------------------------

  // 和了形になった手（14枚相当、zimo が和了牌）をツモ和了したときの点数。役がなければ0。
  function winPoints(hand) {
    const key = hand.counts.join('') + hand.aka.join('') + '|' + evalMeldKey(hand.melds)
      + '|' + hand.zimo.type + (hand.zimo.red ? 'r' : '');
    const cached = pointCache.get(key);
    if (cached !== undefined) return cached;

    const tiles = [];
    for (let t = 0; t < TILE_TYPE_COUNT; t++) {
      if (hand.counts[t] === 0) continue;
      const k = fiveSuitIndex(t);
      tiles.push(...evalTileIdsForType(t, hand.counts[t], k !== -1 && hand.aka[k] === 1));
    }
    const winType = hand.zimo.type;
    const winningTile = hand.zimo.red ? winType * 4 : tiles.find((id) => tileType(id) === winType && !isRedFive(id))
      ?? winType * 4;
    const result = evaluateWin({
      concealedTiles: tiles,
      winningTile,
      winMethod: 'tsumo',
      melds: hand.melds,
      seatWindType: options.seatWindType,
      roundWindType: options.roundWindType,
      isDealer: options.isDealer,
      riichi: isMenzen(hand),
      ippatsu: false,
      doraIndicators: options.doraIndicators,
      uraDoraIndicators: [],
    });
    let points = 0;
    if (result) {
      points = options.winValue
        ? options.winValue(result.basePoints)
        : computePayments(result.basePoints, options.isDealer, 'tsumo', 0).total;
    }
    pointCache.set(key, points);
    return points;
  }

  // ---- 評価値 ------------------------------------------------------------------

  // back: 向聴戻しを調べているときの「さっき捨てた牌種」。それを引き直す進め方は数えない。
  function evaluate(hand, back) {
    const shanten = shantenOf(hand);
    // 和了形は和了牌で点数（符や平和）が変わるので、引いた牌も区別する
    const complete = shanten === -1 && hand.zimo !== null;
    let key = hand.counts.join('') + hand.aka.join('') + '|' + evalMeldKey(hand.melds);
    if (complete) key += '|' + hand.zimo.type + (hand.zimo.red ? 'r' : '');
    if (back !== undefined) key += ':' + back;
    const cached = evalCache.get(key);
    if (cached !== undefined) return cached;

    let value = 0;
    if (complete) {
      value = winPoints(hand);
    } else if (isDiscardPhase(hand)) {
      // 打牌前: 向聴数を落とさない打牌のうち、一番よいもの
      for (const d of evalDiscardCandidates(hand)) {
        const after = evalDiscard(hand, d.type, d.red);
        if (shantenOf(after) > shanten) continue;
        const v = evaluate(after, back);
        if (v > value) value = v;
      }
    } else if (shanten < 3) {
      for (const p of withRedFives(usefulTypes(hand, shantenOf))) {
        if (p.type === back) { value = 0; break; }
        if (restOf(p.type, p.red) === 0) continue;
        takeTile(p.type, p.red);
        let v = evaluate(evalDraw(hand, p.type, p.red), back);
        if (back === undefined && shanten > 0) v += evaluateCall(hand, p.type, back);
        returnTile(p.type, p.red);
        value += v * drawWeight(p.type, p.red);
      }
      value /= EVAL_WIDTH[shanten];
    } else {
      // 赤5も普通の5も同じ重みなので、牌種ごとの残り枚数（赤5込み）で数える
      for (const u of yakuUsefulTypes(hand)) {
        const count = rest[u.type];
        if (count === 0) continue;
        value += count * (u.via === 'pon' ? 4 : u.via === 'chi' ? 2 : 1);
      }
    }

    evalCache.set(key, value);
    return value;
  }

  // 有効牌 type をポン・チーで手に入れた場合の評価（電脳麻将の eval_fulou）。
  // ポンは3人から、チーは上家からだけ出るので、ポンを重く数える。
  function evaluateCall(hand, type, back) {
    const shanten = shantenOf(hand);
    let ponMax = 0;
    for (const types of ponTypes(hand, type)) {
      const after = evalCall(hand, 'pon', types, type);
      if (shantenOf(after) >= shanten) continue;
      ponMax = Math.max(ponMax, evaluate(after, back));
    }
    let chiMax = 0;
    for (const types of chiTypes(hand, type)) {
      const after = evalCall(hand, 'chi', types, type);
      if (shantenOf(after) >= shanten) continue;
      chiMax = Math.max(chiMax, evaluate(after, back));
    }
    return ponMax > chiMax ? ponMax * 3 : ponMax * 2 + chiMax;
  }

  // 向聴戻しをした手（13枚相当）の評価（電脳麻将の eval_backtrack）。
  // 戻した牌を引き直す進め方は数えず、評価値が min を超える進め方だけを数える。
  function evaluateBacktrack(hand, back, min) {
    const shanten = shantenOf(hand);
    if (shanten >= EVAL_WIDTH.length) return 0;
    let value = 0;
    for (const p of withRedFives(usefulTypes(hand, shantenOf))) {
      if (p.type === back) continue;
      if (restOf(p.type, p.red) === 0) continue;
      takeTile(p.type, p.red);
      const v = evaluate(evalDraw(hand, p.type, p.red), back);
      returnTile(p.type, p.red);
      if (v - min > EVAL_EPSILON) value += v * drawWeight(p.type, p.red);
    }
    return value / EVAL_WIDTH[shanten];
  }

  // ---- 牌の価値（打牌の順番決め） ----------------------------------------------

  // 同じ評価値の打牌が並んだときに、価値の低い牌から切るための値（電脳麻将の paijia）。
  // その牌が面子・塔子になりうる組み合わせの数を、ドラ・役牌・染め手で重み付けする。
  function tileValue(type, red) {
    const doraWeight = (t) => {
      let w = 1;
      for (const d of doraTypes) if (d === t) w *= 2;
      return w;
    };
    let value;
    if (type >= 27) {
      value = rest[type] * doraWeight(type);
      if (type === options.roundWindType) value *= 2;
      if (type === options.seatWindType) value *= 2;
      if (type >= 31) value *= 2;
    } else {
      const r = type % 9; // 0〜8
      const base = type - r;
      const num = (i) => rest[base + i];
      const w = (i) => (i < 0 || i > 8 ? 0 : doraWeight(base + i));
      const left = r - 2 >= 0 ? Math.min(num(r - 2), num(r - 1)) : 0;
      const center = r - 1 >= 0 && r + 1 <= 8 ? Math.min(num(r - 1), num(r + 1)) : 0;
      const right = r + 2 <= 8 ? Math.min(num(r + 1), num(r + 2)) : 0;
      const counts = [left, Math.max(left, center), num(r), Math.max(center, right), right];
      value = counts[0] * w(r - 2) + counts[1] * w(r - 1) + counts[2] * w(r)
        + counts[3] * w(r + 1) + counts[4] * w(r + 2);
      const k = Math.floor(type / 9);
      if (restRed[k] > 0) {
        // 赤5が残っていれば、その5を使える形も少し価値を足す
        if (r === 6) value += Math.min(restRed[k], counts[0]) * w(r - 2);
        if (r === 5) value += Math.min(restRed[k], counts[1]) * w(r - 1);
        if (r === 4) value += Math.min(restRed[k], counts[2]) * w(r);
        if (r === 3) value += Math.min(restRed[k], counts[3]) * w(r + 1);
        if (r === 2) value += Math.min(restRed[k], counts[4]) * w(r + 2);
      }
      if (red) value *= 2;
    }
    return value * doraWeight(type);
  }

  // 手牌の形に合わせた牌の価値（電脳麻将の make_paijia）。染め手に向かっている色や字牌は高く見る。
  function tileValueFor(hand) {
    const suitCount = [0, 0, 0, 0];
    let winds = 0;
    let dragons = 0;
    for (let t = 0; t < TILE_TYPE_COUNT; t++) {
      suitCount[Math.floor(t / 9)] += hand.counts[t];
      if (t >= 27 && t <= 30) winds += hand.counts[t];
      if (t >= 31) dragons += hand.counts[t];
    }
    for (const m of hand.melds) {
      const t = tileType(m.tiles[0]);
      suitCount[Math.floor(t / 9)] += 3;
      if (t >= 27 && t <= 30) winds += 3;
      if (t >= 31) dragons += 3;
    }
    const maxSuit = Math.max(suitCount[0], suitCount[1], suitCount[2]);
    return (type, red) => {
      let factor = 1;
      if (type >= 27 && type <= 30 && winds >= 9) factor = 8;
      else if (type >= 31 && dragons >= 6) factor = 8;
      else if (type >= 27 && maxSuit + suitCount[3] >= 10) factor = 4;
      else if (type < 27 && suitCount[Math.floor(type / 9)] + suitCount[3] >= 10) factor = 2;
      return tileValue(type, red) * factor;
    };
  }

  return {
    shantenOf, yakuShanten, evaluate, evaluateBacktrack, usefulCount, tileValueFor, isMenzen,
  };
}

// 打牌を選ぶ（電脳麻将の select_dapai）。
//   hand   : 打牌前の手（evalHandFromTiles で作ったもの）
//   danger : 牌種ごとの危険度を返す関数（押し引きをしないなら null）。電脳麻将の weixian と同じ尺度
//   options.allowBacktrack : 向聴戻しも考えるか
//   options.fold : 押し引きのしきい値（ai.js の AI_PARAMS.fold。電脳麻将の値が初期値）
// 戻り値: { type, red, value }（value は打牌後の評価値）
function evalChooseDiscard(evaluator, hand, danger, options) {
  const candidates = evalDiscardCandidates(hand);
  const shanten = evaluator.shantenOf(hand);
  const fold = options.fold;

  // 一番安全な牌（危険な相手がいるときだけ）。同じ安全度なら向聴数が落ちない牌を選ぶ
  let safest = null;
  let minDanger = Infinity;
  let safestShanten = Infinity;
  if (danger) {
    for (const d of candidates) {
      const w = danger(d.type);
      const s = evaluator.shantenOf(evalDiscard(hand, d.type, d.red));
      if (w < minDanger || (w === minDanger && s < safestShanten)) {
        minDanger = w; safest = d; safestShanten = s;
      }
    }
  }

  const valueOf = evaluator.tileValueFor(hand);
  // 価値の低い牌から順に調べる（評価値が同じなら先に調べた牌を切る）
  const ordered = candidates.slice().reverse()
    .sort((a, b) => valueOf(a.type, a.red) - valueOf(b.type, b.red));

  let chosen = safest;
  let max = -1;
  let minUseful = 0;
  const backtrack = [];
  for (const d of ordered) {
    if (!chosen) chosen = d;
    const after = evalDiscard(hand, d.type, d.red);
    if ((shanten > 2 && evaluator.yakuShanten(after) > shanten) || evaluator.shantenOf(after) > shanten) {
      if (safest) continue;
      if (shanten < 2) backtrack.push(d);
      continue;
    }

    const value = evaluator.evaluate(after);
    const useful = evaluator.usefulCount(after);

    // 押し引き: 安全な牌より危ない牌は、手の価値に見合うときだけ切る
    //   危険度 never 以上は切らない。手が遠い・安いときは high 以上を切らず、安全な牌（low 未満）があれば降りる
    if (danger && danger(d.type) > minDanger) {
      const w = danger(d.type);
      if (w >= fold.never) continue;
      if (shanten > 2 || (shanten > 0 && value < fold.weakValue)) {
        if (w >= fold.high) continue;
        if (minDanger < fold.low) continue;
      } else if ((shanten > 0 && value < fold.strongValue) || (shanten === 0 && value < fold.tenpaiWeakValue)) {
        if (w >= fold.high) continue;
        if (minDanger < fold.low && w >= fold.low) continue;
      }
    }

    if (value - max > EVAL_EPSILON) {
      max = value;
      chosen = d;
      minUseful = useful * 6;
    }
  }

  // 向聴戻し: 有効牌が今の6倍以上あり、戻したほうが高い手になりそうなら戻す
  if (options.allowBacktrack) {
    const bestSoFar = max;
    for (const d of backtrack) {
      const after = evalDiscard(hand, d.type, d.red);
      if (evaluator.usefulCount(after) < minUseful) continue;
      const value = evaluator.evaluateBacktrack(after, d.type, bestSoFar * 2);
      if (value - max > EVAL_EPSILON) {
        max = value;
        chosen = d;
      }
    }
  }

  return { type: chosen.type, red: chosen.red, value: max };
}
