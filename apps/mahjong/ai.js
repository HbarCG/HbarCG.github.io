'use strict';

/*
 * CPU思考ルーチン。ルールベース（学習なし）。
 * レベル(1-5)と読みの深さ(0-3)の2軸で調整する。読みの深さはレベル4以上でのみ使う。
 *
 *   レベル1 : 向聴数が一番進む牌からランダムに切る。鳴かない
 *   レベル2 : 向聴数が同じ中で、役牌・タンヤオ・染め手の芽を残す（簡易採点）
 *   レベル3 : 電脳麻将の評価値で打牌・鳴き・槓・リーチを決める（eval.js）。降りない
 *   レベル4 : ＋押し引き。リーチ者への危険度と手の評価値を比べて、見合わなければ降りる
 *   レベル5 : ＋向聴戻し（高い手・広い手に組み直す）、副露3つの人も警戒する、
 *             リーチを受けているときは待ちの少ない手をダマにして降りられるようにする
 *
 * このファイルの関数は game.js から渡される「読み取り専用の盤面情報」(ctx) を
 * 参照するのみで、状態を直接書き換えない（計算結果の置き場として ctx.evaluator だけ使う）。
 */

function isYakuhaiType(type, seatWindType, roundWindType) {
  return isDragonType(type) || type === seatWindType || type === roundWindType;
}

function handValueTypes(hand, melds) {
  const types = hand.map(tileType);
  for (const m of melds) types.push(...m.tiles.map(tileType));
  return types;
}

// レベル2向け: 手牌の「価値」を簡易採点する（役牌温存・タンヤオ整合・染め手の芽）。
function estimateHandValue(hand, melds, seatWindType, roundWindType) {
  const counts = toCounts(hand);
  let value = 0;
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (counts[t] === 0) continue;
    const yakuhai = isYakuhaiType(t, seatWindType, roundWindType);
    if (yakuhai && counts[t] >= 3) value += 8;
    else if (yakuhai && counts[t] === 2) value += 6;
    else if (yakuhai && counts[t] === 1) value += 1;
  }
  const allTypes = handValueTypes(hand, melds);
  const tanyaoOk = allTypes.every((t) => !isYaochuuType(t));
  if (tanyaoOk) value += 4;
  const suitCounts = { m: 0, p: 0, s: 0, z: 0 };
  for (const t of allTypes) suitCounts[suitOfType(t)]++;
  const total = allTypes.length || 1;
  const dominant = Math.max(suitCounts.m, suitCounts.p, suitCounts.s);
  if (dominant / total >= 0.7) value += 3; // 混一色/清一色の芽
  return value;
}

// ---------------------------------------------------------------------------
// 盤面から評価値の計算を準備する
// ---------------------------------------------------------------------------

// 自分から見えている赤5 [萬, 筒, 索]
function visibleRedFives(ctx) {
  const seen = new Set(ctx.selfHand);
  for (const discards of ctx.discardsBySeat) {
    for (const d of discards) if (d.calledBy === null) seen.add(d.tile);
  }
  for (const melds of ctx.meldsBySeat) {
    for (const m of melds) for (const id of m.tiles) seen.add(id);
  }
  for (const id of ctx.doraIndicators) seen.add(id);
  return RED_FIVE_IDS.map((id) => (seen.has(id) ? 1 : 0));
}

function visibleCountsOf(ctx) {
  return countVisibleTypes(ctx.selfHand, ctx.discardsBySeat, ctx.meldsBySeat, ctx.doraIndicators);
}

// 1回の判断（打牌とリーチ判断など）の間は同じ計算結果を使い回す
function evaluatorFor(ctx) {
  if (!ctx.evaluator) {
    ctx.evaluator = createEvaluator({
      visibleCounts: visibleCountsOf(ctx),
      visibleRed: visibleRedFives(ctx),
      wallRemaining: ctx.wallRemaining,
      seatWindType: ctx.seatWindType,
      roundWindType: ctx.roundWindType,
      isDealer: ctx.isDealer,
      doraIndicators: ctx.doraIndicators,
    });
  }
  return ctx.evaluator;
}

// 評価値で選んだ牌種を、実際の牌IDに戻す（赤5を切るのは red のときだけ）
function tileIdForChoice(hand, type, red) {
  if (red) return hand.find((id) => tileType(id) === type && isRedFive(id));
  return hand.find((id) => tileType(id) === type && !isRedFive(id))
    ?? hand.find((id) => tileType(id) === type);
}

function othersInRiichi(ctx) {
  return ctx.riichiBySeat.some((r, s) => r && s !== ctx.selfSeat);
}

// ---------------------------------------------------------------------------
// 危険度（レベル4以上の押し引き）
// ---------------------------------------------------------------------------

// 相手 opp に通っている牌種（現物）。自分で捨てた牌と、リーチ後に誰かが捨てて通った牌。
function safeTypesAgainst(opp, ctx) {
  const safe = new Set(ctx.discardsBySeat[opp].map((d) => tileType(d.tile)));
  const riichiTurn = ctx.riichiTurnBySeat[opp];
  if (riichiTurn !== null) {
    const declared = ctx.discardsBySeat[opp][riichiTurn - 1];
    if (declared) {
      for (const discards of ctx.discardsBySeat) {
        for (const d of discards) if (d.order >= declared.order) safe.add(tileType(d.tile));
      }
    }
  }
  return safe;
}

// 相手 opp に対する、牌種ごとの危険度（電脳麻将の suan_weixian）。
// 待ちの形ごとに「その牌で当たりうる組み合わせ」を点数にして足す:
//   単騎・シャンポン: 見えていない枚数で 0〜3（字牌で3枚残りは8）
//   両面: 10（1・9側の辺張になる 3・7 は3）。スジ（現物の3つ隣）なら0
//   嵌張: 3
// 読みの深さで使う情報を段階的に増やす（電脳麻将はすべて使う＝深さ3に相当。ワンチャンスはこのアプリで追加）:
//   0: 何も読まない（牌の位置だけ）  1: ＋現物
//   2: ＋スジ・見えている枚数       3: ＋壁（ノーチャンスなら両面なし、ワンチャンスなら半分）
function dangerTableAgainst(opp, ctx, readingDepth, rest, myCounts) {
  const safe = readingDepth >= 1 ? safeTypesAgainst(opp, ctx) : new Set();
  const isSafe = (t) => safe.has(t);
  const table = new Array(TILE_TYPE_COUNT).fill(0);
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (isSafe(t)) continue;
    // 単騎・シャンポン
    const left = readingDepth >= 2 ? rest[t] - (myCounts[t] ? 0 : 1) : 3;
    let score = left === 3 ? (t >= 27 ? 8 : 3) : left === 2 ? 3 : left === 1 ? 1 : 0;
    if (t < 27) {
      const r = t % 9; // 0〜8
      // 壁: 両面の相方になる2枚のうち少ないほうの残り枚数
      const wall = (a, b) => (readingDepth >= 3 ? Math.min(rest[t + a], rest[t + b]) : 4);
      const ryanmen = (a, b, sujiOffset, penchan) => {
        const w = wall(a, b);
        if (w === 0) return 0;
        const base = penchan ? 3 : readingDepth >= 2 && isSafe(t + sujiOffset) ? 0 : 10;
        return w === 1 ? base / 2 : base;
      };
      if (r - 2 >= 0) score += ryanmen(-2, -1, -3, r - 2 === 0);
      if (r - 1 >= 0 && r + 1 <= 8) score += wall(-1, 1) === 0 ? 0 : 3;
      if (r + 2 <= 8) score += ryanmen(1, 2, 3, r + 2 === 8);
    }
    table[t] = score;
  }
  return table;
}

// 警戒する相手: リーチ者。レベル5は副露が3つ以上ある人（ほぼ聴牌）も警戒する。
function threatSeats(ctx, level) {
  const seats = [];
  for (let s = 0; s < 4; s++) {
    if (s === ctx.selfSeat) continue;
    if (ctx.riichiBySeat[s]) seats.push(s);
    else if (level >= 5 && ctx.meldsBySeat[s].length >= 3) seats.push(s);
  }
  return seats;
}

// 牌種ごとの危険度を返す関数。警戒する相手がいなければ null。
// 相手ごとに合計が100になるよう割合にし（親は1.5倍）、相手の中で一番危ない値を使う（電脳麻将と同じ）。
function dangerFunction(ctx, level, readingDepth) {
  const seats = threatSeats(ctx, level);
  if (seats.length === 0) return null;
  const rest = visibleCountsOf(ctx).map((v) => Math.max(0, 4 - v));
  const myCounts = toCounts(ctx.selfHand);
  const worst = new Array(TILE_TYPE_COUNT).fill(0);
  for (const opp of seats) {
    const table = dangerTableAgainst(opp, ctx, readingDepth, rest, myCounts);
    const sum = table.reduce((a, b) => a + b, 0) || 1;
    const dealerFactor = opp === ctx.dealerSeat ? 1.5 : 1;
    for (let t = 0; t < TILE_TYPE_COUNT; t++) {
      worst[t] = Math.max(worst[t], table[t] / sum * 100 * dealerFactor);
    }
  }
  return (type) => worst[type];
}

// ---------------------------------------------------------------------------
// 打牌
// ---------------------------------------------------------------------------

function chooseDiscard(hand, melds, level, readingDepth, ctx) {
  if (level >= 3) {
    const danger = level >= 4 ? dangerFunction(ctx, level, readingDepth) : null;
    const choice = evalChooseDiscard(evaluatorFor(ctx), evalHandFromTiles(hand, melds), danger, level >= 5);
    return tileIdForChoice(hand, choice.type, choice.red);
  }

  const meldCount = melds.length;
  let bestShanten = Infinity;
  const shantenByTile = new Map();
  for (const id of hand) {
    const remaining = hand.filter((x) => x !== id);
    const s = computeShanten(toCounts(remaining), meldCount);
    shantenByTile.set(id, s);
    if (s < bestShanten) bestShanten = s;
  }
  const pool = hand.filter((id) => shantenByTile.get(id) === bestShanten);

  if (level === 1) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // レベル2: 同シャンテン内で価値の高い形を残す（＝価値の低い牌から切る）
  let best = pool[0];
  let bestValue = -Infinity;
  for (const id of pool) {
    const remaining = hand.filter((x) => x !== id);
    const v = estimateHandValue(remaining, melds, ctx.seatWindType, ctx.roundWindType);
    if (v > bestValue) { bestValue = v; best = id; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// リーチ
// ---------------------------------------------------------------------------

// リーチするかどうか。handAfter は打牌後の手牌（聴牌している13枚相当）。
//   レベル1-2 : 聴牌したら即リーチ
//   レベル3以上: 評価値が350未満（待ちが少ない・残りツモが少ない）ならダマ（電脳麻将と同じ）。
//               どの待ちでも役があり、ダマで満貫以上が確定しているならダマ
//   レベル5    : 他家のリーチを受けていて、役があり待ちが残り2枚以下ならダマ
//                （リーチすると降りられなくなるため）
function decideRiichi(level, handAfter, melds, ctx) {
  if (level <= 2) return true;

  if (evaluatorFor(ctx).evaluate(evalHandFromTiles(handAfter, melds)) < 350) return false;

  const waits = evaluateWaits(handAfter, {
    melds,
    seatWindType: ctx.seatWindType,
    roundWindType: ctx.roundWindType,
    isDealer: ctx.isDealer,
    riichi: false,
    doraIndicators: ctx.doraIndicators,
  });
  const hasYakuOnAllWaits = waits.length > 0 && waits.every((w) => w.ron);
  // 打牌前の手牌で数えると、これから切る牌も「見えている」側に入る
  const visible = visibleCountsOf(ctx);
  const remaining = waits.reduce((sum, w) => sum + Math.max(0, 4 - visible[w.type]), 0);

  if (hasYakuOnAllWaits && Math.min(...waits.map((w) => w.ron.basePoints)) >= 2000) return false;
  if (level === 5 && hasYakuOnAllWaits && remaining <= 2 && othersInRiichi(ctx)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 鳴き（ポン/チー/大明槓）
// ---------------------------------------------------------------------------

// options は game.js が合法性を検証済みの候補配列。
// 各option: {kind:'pon'|'chi'|'minkan', tiles:[使用する手牌side ids], resultingMeldTiles:[...]}
function decideCall(options, hand, melds, level, ctx) {
  if (options.length === 0) return null;
  if (level === 1) return null; // レベル1は鳴かない
  if (level >= 3) return decideCallByEval(options, hand, melds, level, ctx);

  // レベル2: 向聴数が進み、役が残りそうな鳴きだけする
  const meldCount = melds.length;
  const currentShanten = computeShanten(toCounts(hand), meldCount);
  let bestOption = null;
  let bestScore = -Infinity;
  for (const opt of options) {
    const remainingHand = hand.filter((id) => !opt.tiles.includes(id));
    const newShanten = computeShanten(toCounts(remainingHand), meldCount + 1);
    if (newShanten >= currentShanten) continue; // シャンテンが進まない鳴きはしない

    const wouldBreakTanyao = opt.resultingMeldTiles.some((id) => isYaochuuType(tileType(id)));
    const isYakuhaiMeld = opt.kind === 'pon' && isYakuhaiType(tileType(opt.resultingMeldTiles[0]), ctx.seatWindType, ctx.roundWindType);

    if (wouldBreakTanyao && !isYakuhaiMeld) {
      // 役が残らなくなる鳴きは避ける
      const stillHasYaku = estimateHandValue(remainingHand, melds.concat([{ tiles: opt.resultingMeldTiles }]), ctx.seatWindType, ctx.roundWindType) > 0;
      if (!stillHasYaku) continue;
    }

    let score = (currentShanten - newShanten) * 10;
    if (isYakuhaiMeld) score += 8;
    if (!wouldBreakTanyao) score += 3;

    if (score > bestScore) { bestScore = score; bestOption = opt; }
  }
  return bestOption;
}

// 鳴いた後の手（評価用）
function evalHandAfterCall(hand, melds, opt) {
  const remaining = hand.filter((id) => !opt.tiles.includes(id));
  return evalHandFromTiles(remaining, melds.concat([{ kind: opt.kind, tiles: opt.resultingMeldTiles }]));
}

// レベル3以上（電脳麻将の select_fulou）:
//   二向聴以内 : 鳴いたほうが評価値が上がるなら鳴く。
//                レベル4以上は、リーチを受けているとき評価値が低い鳴き（安い手の仕掛け）はしない
//   三向聴以上 : 役に向かって向聴数が進むポン・チーだけする（役牌のポンなど）。リーチを受けていたら鳴かない
function decideCallByEval(options, hand, melds, level, ctx) {
  const evaluator = evaluatorFor(ctx);
  const current = evalHandFromTiles(hand, melds);
  const shanten = evaluator.shantenOf(current);
  const facingRiichi = level >= 4 && othersInRiichi(ctx);

  if (shanten < 3) {
    let best = null;
    let max = evaluator.evaluate(current);
    for (const opt of options) {
      const after = evalHandAfterCall(hand, melds, opt);
      const x = evaluator.shantenOf(after);
      if (x >= 3) continue;
      const value = evaluator.evaluate(after);
      if (facingRiichi) {
        if (x > 0 && value < 750) continue;
        if (x === 0 && value < 250) continue;
      }
      if (value - max > EVAL_EPSILON) { max = value; best = opt; }
    }
    return best;
  }

  if (facingRiichi) return null;
  const base = evaluator.yakuShanten(current);
  for (const opt of options) {
    if (opt.kind === 'minkan') continue;
    if (evaluator.yakuShanten(evalHandAfterCall(hand, melds, opt)) < base) return opt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 槓（暗槓/加槓）
// ---------------------------------------------------------------------------

// options: game.js の getAnkanOptions / getKakanOptions の結果
//   レベル1  : 槓しない
//   レベル2  : 最初の候補で必ず槓する
//   レベル3以上（電脳麻将の select_gang）:
//     二向聴以内 : 槓しても評価値が下がらないなら槓する
//     三向聴以上 : 役に向かう向聴数が変わらないなら槓する
//     レベル4以上は、リーチを受けていて聴牌していなければ槓しない（新ドラを乗せないため）
function decideKan(options, hand, melds, level, ctx) {
  if (options.length === 0 || level === 1) return null;
  if (level === 2) return options[0];

  const evaluator = evaluatorFor(ctx);
  const current = evalHandFromTiles(hand, melds);
  const shanten = evaluator.shantenOf(current);
  if (level >= 4 && othersInRiichi(ctx) && shanten > 0) return null;

  const afterKan = (opt) => {
    const remaining = hand.filter((id) => !opt.tiles.includes(id));
    const newMelds = opt.kind === 'ankan'
      ? melds.concat([{ kind: 'ankan', tiles: opt.tiles }])
      : melds.map((m, i) => (i === opt.meldIndex ? { kind: 'kakan', tiles: m.tiles.concat(opt.tiles) } : m));
    return evalHandFromTiles(remaining, newMelds);
  };

  if (shanten < 3) {
    let best = null;
    let max = evaluator.evaluate(current);
    for (const opt of options) {
      const after = afterKan(opt);
      if (evaluator.shantenOf(after) >= 3) continue;
      const value = evaluator.evaluate(after);
      if (value - max > -EVAL_EPSILON) { max = value; best = opt; }
    }
    return best;
  }

  const base = evaluator.yakuShanten(current);
  return options.find((opt) => evaluator.yakuShanten(afterKan(opt)) === base) || null;
}
