'use strict';

/*
 * 自分の手牌の補助情報（向聴数・待ち牌・待ち牌の残り枚数・和了したときの役と翻）を計算する。
 * 表示は game.js が担当し、このファイルは状態を持たない純粋関数のみで構成する。
 *
 * 注意:
 *   - 役と翻は「今の状態のまま和了した場合」の値。裏ドラ・一発・赤5で和了した場合は含めない。
 *   - 残り枚数は「自分から見えていない枚数」。他家の手牌や山に何枚あるかまではわからないので、
 *     実際に引ける枚数ではなく「残っている可能性のある枚数」になる。
 */

// 自分から見えている牌の枚数を34種ごとに数える。
// 自分の手牌・全員の河・全員の副露・めくれているドラ表示牌。
// 鳴かれた捨て牌は副露側に含まれるので、河の側では数えない（二重に数えないため）。
function countVisibleTypes(ownHand, discardsBySeat, meldsBySeat, doraIndicators) {
  const counts = toCounts(ownHand);
  for (const discards of discardsBySeat) {
    for (const d of discards) {
      if (d.calledBy === null) counts[tileType(d.tile)]++;
    }
  }
  for (const melds of meldsBySeat) {
    for (const m of melds) {
      for (const id of m.tiles) counts[tileType(id)]++;
    }
  }
  for (const id of doraIndicators) counts[tileType(id)]++;
  return counts;
}

// 和了判定に渡すための、その牌種の牌ID。赤5を避け、手牌に無いIDを選ぶ。
function sampleTileIdOfType(type, hand) {
  for (let copy = 1; copy < 4; copy++) {
    const id = type * 4 + copy;
    if (!hand.includes(id)) return id;
  }
  return type * 4 + 1;
}

// 聴牌している手の待ち牌の種類。和了牌になりうるのは「手牌と同じ牌・前後2つ以内の同色の数牌・
// 国士無双用の么九牌」だけなので、34種すべてを調べずに候補を絞って速くする。
function tenpaiWaitTypes(hand, meldCount) {
  const counts = toCounts(hand);
  const candidates = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (counts[t] === 0) continue;
    candidates.add(t);
    if (t >= 27) continue;
    const rank0 = t % 9;
    for (let d = -2; d <= 2; d++) {
      if (rank0 + d >= 0 && rank0 + d <= 8) candidates.add(t + d);
    }
  }
  const result = [];
  for (const t of [...candidates].sort((a, b) => a - b)) {
    if (counts[t] >= 4) continue;
    counts[t]++;
    if (isWinningShape(counts, meldCount)) result.push(t);
    counts[t]--;
  }
  return result;
}

// 和了形かどうか（役の有無は問わない）。computeShanten(...) === -1 と同じ結果になるが、
// 完成形の分解だけを探すのでずっと速い。
function isWinningShape(counts, meldCount) {
  if (meldCount === 0 && (isChiitoitsuShape(counts) || isKokushiShape(counts))) return true;
  return enumerateStandardDecompositions(counts, 4 - meldCount).length > 0;
}

// 聴牌している13枚(副露分を除く)の待ち牌ごとに、ロン/ツモしたときの評価を返す。
// ctx: { melds, seatWindType, roundWindType, isDealer, riichi, doraIndicators }
function evaluateWaits(hand, ctx) {
  const waitTypes = tenpaiWaitTypes(hand, ctx.melds.length);
  return waitTypes.map((type) => {
    const id = sampleTileIdOfType(type, hand);
    const base = {
      concealedTiles: hand.concat([id]),
      winningTile: id,
      melds: ctx.melds,
      seatWindType: ctx.seatWindType,
      roundWindType: ctx.roundWindType,
      isDealer: ctx.isDealer,
      riichi: ctx.riichi,
      ippatsu: false,
      doraIndicators: ctx.doraIndicators,
      uraDoraIndicators: [],
    };
    return {
      type,
      ron: evaluateWin(Object.assign({}, base, { winMethod: 'ron' })),
      tsumo: evaluateWin(Object.assign({}, base, { winMethod: 'tsumo' })),
    };
  });
}

// 手牌の補助情報を計算する。
//   13枚相当(打牌後) → { phase: 'wait', shanten, waits }
//   14枚相当(打牌前) → { phase: 'discard', complete, shanten, options }
//     shanten は「一番良い打牌をしたあとの向聴数」、options は聴牌になる打牌ごとの待ち。
function analyzeHandAssist(hand, ctx) {
  const meldCount = ctx.melds.length;

  if (hand.length % 3 === 1) {
    const shanten = computeShanten(toCounts(hand), meldCount);
    return { phase: 'wait', shanten, waits: shanten === 0 ? evaluateWaits(hand, ctx) : [] };
  }

  const complete = computeShanten(toCounts(hand), meldCount) === -1;
  let best = Infinity;
  const options = [];
  const seen = new Set();
  for (const id of sortTilesByType(hand)) {
    // 同じ牌種は1回だけ調べる（赤5と普通の5はドラの数が変わるので別扱い）
    const key = `${tileType(id)}${isRedFive(id) ? 'r' : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rest = hand.slice();
    rest.splice(rest.indexOf(id), 1);
    const s = computeShanten(toCounts(rest), meldCount);
    if (s < best) best = s;
    if (s === 0) options.push({ discard: id, waits: evaluateWaits(rest, ctx) });
  }
  return { phase: 'discard', complete, shanten: best, options };
}
