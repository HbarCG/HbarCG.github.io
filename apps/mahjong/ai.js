'use strict';

/*
 * CPU思考ルーチン。ルールベース（学習なし）。
 * レベル(1-5)と読みの深さ(0-3)の2軸で調整する。読みの深さはレベル4以上でのみ使う。
 *
 *   レベル1 : 向聴数が一番進む牌からランダムに切る。鳴かない
 *   レベル2 : 向聴数が同じ中で、役牌・タンヤオ・染め手の芽を残す（簡易採点）
 *   レベル3 : 電脳麻将の評価値で打牌・鳴き・槓・リーチを決める（eval.js）。降りない
 *   レベル4 : ＋押し引き。リーチ者への危険度と手の評価値を比べて、見合わなければ降りる
 *             ＋点数状況（オーラスの順位を意識した手作り・押し引き・リーチ判断・ラス確の見逃し）
 *             ＋終盤（形式聴牌を取る鳴き、河底で振り込まない、降りても聴牌をなるべく崩さない）
 *   レベル5 : ＋向聴戻し（高い手・広い手に組み直す）
 *             ＋リーチしていない相手の読み（副露の数・巡目・手出しから聴牌の見込みと打点を推定し、
 *               染め手の仕掛けにはその色を警戒する）
 *             ＋リーチを受けているときは待ちの少ない手をダマにして降りられるようにする
 *
 * レベル3以上の判断（危険度・鳴き・槓など）は電脳麻将の思考ルーチンを移植したもの。
 * 移植元: kobalab/majiang-ai  Copyright (c) 2021 Satoshi Kobayashi  MIT License
 * ライセンス本文は同じフォルダの LICENSE-majiang-ai.txt を参照。
 *
 * このファイルの関数は game.js から渡される「読み取り専用の盤面情報」(ctx) を
 * 参照するのみで、状態を直接書き換えない（計算結果の置き場として ctx.evaluator だけ使う）。
 */

// 判断に使う数値。scripts/mahjong-selfplay.mjs の自己対戦で比べて決める。
const AI_PARAMS = {
  // 評価値がこれ未満ならリーチしない（電脳麻将と同じ350）
  riichiMinValue: 350,
  // 押し引き（eval.js の evalChooseDiscard が使う。初期値は電脳麻将と同じ）
  fold: {
    never: 13.0, // 危険度がこれ以上の牌は切らない
    high: 8.0, // 手が遠い・安いときは、危険度がこれ以上の牌を切らない
    low: 3.2, // 危険度がこれ未満の牌を「安全な牌」とみなす
    weakValue: 80, // 一向聴・二向聴で評価値がこれ未満なら「安い手」
    strongValue: 750, // 一向聴・二向聴で評価値がこれ以上なら「押せる手」
    tenpaiWeakValue: 50, // 聴牌で評価値がこれ未満なら「安い手」
  },
  // リーチを受けているときに鳴く評価値の下限（電脳麻将と同じ）
  callUnderThreat: { notTenpai: 750, tenpai: 250 },
  // オーラスの順位の価値（点数に換算。1位〜4位）。和了で順位が変わるときにこの差を足す
  rankValue: [15000, 5000, -5000, -15000],
  // オーラスの危険度の倍率。トップ目（2位との差が topLead 以上）は降りやすく、ラス目は押しやすく
  topLead: 8000,
  topDangerScale: 1.5,
  lastDangerScale: 0.6,
  // 山がこの枚数以下なら、形式聴牌を取るための鳴きをする
  formalTenpaiWall: 8,
  // リーチしていない相手の読み（レベル5）
  threat: {
    // 副露の数（0〜3）ごとの、聴牌している見込み [序盤(5巡目まで), 中盤(11巡目まで), 終盤]
    tenpaiByMelds: [[0, 0.05, 0.2], [0.05, 0.2, 0.4], [0.2, 0.45, 0.65], [0.6, 0.8, 0.9]],
    tedashiBonus: 0.1, // 6巡目以降、直近2打のどちらかが手出しの中張牌なら聴牌の見込みを足す
    doraValue: 0.3, // 副露にドラ・赤5が1枚あるごとに打点の倍率を足す
    focusValue: 0.5, // 染め手の仕掛けなら打点の倍率を足す
    maxValue: 2.5,
    minWeight: 0.3, // 聴牌の見込み×打点の倍率 がこれ以上の相手を警戒する
    strongWeight: 0.8, // これ以上ならリーチと同じように扱う（鳴き・槓を控える）
    focusIn: 2, // 染め手の相手には、その色と字牌の危険度をこの倍率にする
    focusOut: 0.3, // ほかの色はこの倍率にする
  },
};

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
// 点数状況（レベル4以上。オーラスだけ使う）
// ---------------------------------------------------------------------------

// 順位（1〜4）。同点は起家（席0）に近い人を上にする
function rankOf(seat, scores) {
  let rank = 1;
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    if (scores[s] > scores[seat] || (scores[s] === scores[seat] && s < seat)) rank++;
  }
  return rank;
}

function isAllLast(ctx) {
  return ctx.kyoku >= 4;
}

// 自分が和了したあとの全員の点数。ron のときは fromSeat が払う。
function scoresAfterWin(ctx, basePoints, method, fromSeat) {
  const scores = ctx.scores.slice();
  const me = ctx.selfSeat;
  const isDealer = me === ctx.dealerSeat;
  const pay = computePayments(basePoints, isDealer, method, ctx.honba);
  if (method === 'ron') {
    scores[fromSeat] -= pay.total;
    scores[me] += pay.total;
  } else {
    for (let s = 0; s < 4; s++) {
      if (s === me) continue;
      const p = isDealer ? pay.fromEach : (s === ctx.dealerSeat ? pay.fromDealer : pay.fromNonDealer);
      scores[s] -= p;
      scores[me] += p;
    }
  }
  scores[me] += ctx.kyotaku * 1000;
  return scores;
}

// オーラスの和了の価値 = もらえる点数 ＋ 順位が上がるならその差（AI_PARAMS.rankValue）。
// これを評価値に使うと、ラス目は逆転できる高い手を、トップ目は早い手を目指すようになる。
function placementWinValue(ctx, level) {
  if (level < 4 || !isAllLast(ctx)) return null;
  const me = ctx.selfSeat;
  const rankNow = rankOf(me, ctx.scores);
  return (basePoints) => {
    const scores = scoresAfterWin(ctx, basePoints, 'tsumo');
    const rankAfter = rankOf(me, scores);
    return scores[me] - ctx.scores[me] + AI_PARAMS.rankValue[rankAfter - 1] - AI_PARAMS.rankValue[rankNow - 1];
  };
}

// オーラスの危険度の倍率。トップ目で2位と離れていれば降りやすく、ラス目は押しやすくする
// （ラス目は放銃しても順位が下がらない）。
function placementDangerScale(ctx) {
  if (!isAllLast(ctx)) return 1;
  const me = ctx.selfSeat;
  const rank = rankOf(me, ctx.scores);
  if (rank === 4) return AI_PARAMS.lastDangerScale;
  if (rank === 1) {
    const second = Math.max(...ctx.scores.filter((_, s) => s !== me));
    if (ctx.scores[me] - second >= AI_PARAMS.topLead) return AI_PARAMS.topDangerScale;
  }
  return 1;
}

// 和了するかどうか。オーラスで子が和了すると対局が終わるので、
// 和了してもラスのままなら見逃して逆転を狙う（レベル4以上）。
function decideWin(level, ctx, basePoints, method, fromSeat) {
  if (level < 4 || !isAllLast(ctx) || ctx.selfSeat === ctx.dealerSeat) return true;
  return rankOf(ctx.selfSeat, scoresAfterWin(ctx, basePoints, method, fromSeat)) !== 4;
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
function evaluatorFor(ctx, level) {
  if (!ctx.evaluator) {
    ctx.evaluator = createEvaluator({
      visibleCounts: visibleCountsOf(ctx),
      visibleRed: visibleRedFives(ctx),
      wallRemaining: ctx.wallRemaining,
      seatWindType: ctx.seatWindType,
      roundWindType: ctx.roundWindType,
      isDealer: ctx.isDealer,
      doraIndicators: ctx.doraIndicators,
      winValue: placementWinValue(ctx, level),
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
// 相手の読み
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

// 染め手の仕掛け: 副露が1色（＋字牌）だけで、その色を河にほとんど捨てていなければ、その色（0〜2）
function focusSuitOf(opp, ctx) {
  const melds = ctx.meldsBySeat[opp];
  const suits = new Set();
  for (const m of melds) {
    const t = tileType(m.tiles[0]);
    if (t < 27) suits.add(Math.floor(t / 9));
  }
  if (suits.size !== 1) return null;
  const suit = [...suits][0];
  const discards = ctx.discardsBySeat[opp];
  const inSuit = discards.filter((d) => tileType(d.tile) < 27 && Math.floor(tileType(d.tile) / 9) === suit).length;
  return discards.length >= 4 && inSuit <= 1 ? suit : null;
}

// 相手の怖さ。weight = 聴牌している見込み(0〜1) × 打点の倍率。リーチ者は1。
// focusSuit: 染め手の仕掛けならその色
function threatOf(opp, ctx) {
  if (ctx.riichiBySeat[opp]) return { seat: opp, weight: 1, focusSuit: null };
  const T = AI_PARAMS.threat;
  const melds = ctx.meldsBySeat[opp];
  const discards = ctx.discardsBySeat[opp];
  const turn = discards.length;

  let tenpai = 1;
  if (melds.length < 4) {
    const phase = turn <= 5 ? 0 : turn <= 11 ? 1 : 2;
    tenpai = T.tenpaiByMelds[melds.length][phase];
  }
  // 中盤以降に手出しで中張牌を切った＝手が進んでいる気配
  if (turn >= 6 && discards.slice(-2).some((d) => {
    const t = tileType(d.tile);
    return !d.tsumogiri && t < 27 && t % 9 >= 2 && t % 9 <= 6;
  })) {
    tenpai = Math.min(1, tenpai + T.tedashiBonus);
  }

  let value = 1;
  const doraTypes = ctx.doraIndicators.map(doraTypeFromIndicator);
  for (const m of melds) {
    for (const id of m.tiles) {
      if (doraTypes.includes(tileType(id))) value += T.doraValue;
      if (isRedFive(id)) value += T.doraValue;
    }
  }
  const focusSuit = focusSuitOf(opp, ctx);
  if (focusSuit !== null) value += T.focusValue;
  value = Math.min(value, T.maxValue);

  return { seat: opp, weight: tenpai * value, focusSuit };
}

// 警戒する相手。レベル4はリーチ者だけ、レベル5はリーチしていない人も読む。
function threatsFor(ctx, level) {
  const result = [];
  for (let s = 0; s < 4; s++) {
    if (s === ctx.selfSeat) continue;
    if (ctx.riichiBySeat[s]) result.push(threatOf(s, ctx));
    else if (level >= 5) {
      const t = threatOf(s, ctx);
      if (t.weight >= AI_PARAMS.threat.minWeight) result.push(t);
    }
  }
  return result;
}

// リーチ（か、リーチ並みに怖い相手）を受けているか。鳴き・槓を控える判断に使う
function facingStrongThreat(ctx, level) {
  if (level < 4) return false;
  return threatsFor(ctx, level).some((t) => t.weight >= AI_PARAMS.threat.strongWeight);
}

// 相手 opp に対する、牌種ごとの危険度（電脳麻将の suan_weixian）。
// 待ちの形ごとに「その牌で当たりうる組み合わせ」を点数にして足す:
//   単騎・シャンポン: 見えていない枚数で 0〜3（字牌で3枚残りは8）
//   両面: 10（1・9側の辺張になる 3・7 は3）。スジ（現物の3つ隣）なら0
//   嵌張: 3
// 読みの深さで使う情報を段階的に増やす（電脳麻将はすべて使う＝深さ3に相当。ワンチャンスはこのアプリで追加）:
//   0: 何も読まない（牌の位置だけ）  1: ＋現物
//   2: ＋スジ・見えている枚数       3: ＋壁（ノーチャンスなら両面なし、ワンチャンスなら半分）
// focusSuit があれば（染め手の仕掛け）、その色と字牌を重く、ほかの色を軽くする。
function dangerTableAgainst(opp, ctx, readingDepth, rest, myCounts, focusSuit) {
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
    if (focusSuit !== null) {
      const inFocus = t >= 27 || Math.floor(t / 9) === focusSuit;
      score *= inFocus ? AI_PARAMS.threat.focusIn : AI_PARAMS.threat.focusOut;
    }
    table[t] = score;
  }
  return table;
}

// 牌種ごとの危険度を返す関数。警戒する相手がいなければ null。
// 相手ごとに合計が100になるよう割合にし（親は1.5倍、リーチしていない相手は怖さ weight 倍）、
// 相手の中で一番危ない値を使う（電脳麻将と同じ）。オーラスは順位で倍率をかける。
function dangerFunction(ctx, level, readingDepth) {
  const threats = threatsFor(ctx, level);
  if (threats.length === 0) return null;
  const rest = visibleCountsOf(ctx).map((v) => Math.max(0, 4 - v));
  const myCounts = toCounts(ctx.selfHand);
  const scale = placementDangerScale(ctx);
  const worst = new Array(TILE_TYPE_COUNT).fill(0);
  for (const threat of threats) {
    const table = dangerTableAgainst(threat.seat, ctx, readingDepth, rest, myCounts, threat.focusSuit);
    const sum = table.reduce((a, b) => a + b, 0) || 1;
    const factor = 100 / sum * (threat.seat === ctx.dealerSeat ? 1.5 : 1) * threat.weight * scale;
    for (let t = 0; t < TILE_TYPE_COUNT; t++) {
      worst[t] = Math.max(worst[t], table[t] * factor);
    }
  }
  return (type) => worst[type];
}

// ---------------------------------------------------------------------------
// 打牌
// ---------------------------------------------------------------------------

function chooseDiscard(hand, melds, level, readingDepth, ctx) {
  if (level >= 3) {
    const evaluator = evaluatorFor(ctx, level);
    const evalHand = evalHandFromTiles(hand, melds);
    const danger = level >= 4 ? dangerFunction(ctx, level, readingDepth) : null;

    // 河底（最後の打牌）は、もう和了の見込みがないので一番安全な牌を切る（同じなら聴牌を崩さない牌）
    if (danger && ctx.wallRemaining === 0) {
      let best = null;
      let bestKey = null;
      for (const d of evalDiscardCandidates(evalHand)) {
        const key = [danger(d.type), evaluator.shantenOf(evalDiscard(evalHand, d.type, d.red))];
        if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
          best = d; bestKey = key;
        }
      }
      return tileIdForChoice(hand, best.type, best.red);
    }

    const choice = evalChooseDiscard(evaluator, evalHand, danger, {
      allowBacktrack: level >= 5,
      fold: AI_PARAMS.fold,
    });
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

// ロンで和了したときの順位（払う人によって変わるので、一番悪い場合）
function worstRankAfterRon(ctx, waits) {
  let worst = 1;
  for (const w of waits) {
    for (let s = 0; s < 4; s++) {
      if (s === ctx.selfSeat) continue;
      worst = Math.max(worst, rankOf(ctx.selfSeat, scoresAfterWin(ctx, w.ron.basePoints, 'ron', s)));
    }
  }
  return worst;
}

// リーチするかどうか。handAfter は打牌後の手牌（聴牌している13枚相当）。
//   レベル1-2 : 聴牌したら即リーチ
//   レベル3以上: 評価値が AI_PARAMS.riichiMinValue 未満（待ちが少ない・残りツモが少ない）ならダマ。
//               どの待ちでも役があり、ダマで満貫以上が確定しているならダマ
//   レベル4以上: オーラスで役があるなら、ダマで1位になれる（すでにトップ目）ならダマ、
//               リーチで順位がもっと上がるならリーチ、上がらないならダマ
//   レベル5    : 他家のリーチを受けていて、役があり待ちが残り2枚以下ならダマ
//                （リーチすると降りられなくなるため）
function decideRiichi(level, handAfter, melds, ctx) {
  if (level <= 2) return true;

  const waitCtx = {
    melds,
    seatWindType: ctx.seatWindType,
    roundWindType: ctx.roundWindType,
    isDealer: ctx.isDealer,
    riichi: false,
    doraIndicators: ctx.doraIndicators,
  };
  const waits = evaluateWaits(handAfter, waitCtx);
  const hasYakuOnAllWaits = waits.length > 0 && waits.every((w) => w.ron);
  // 打牌前の手牌で数えると、これから切る牌も「見えている」側に入る
  const visible = visibleCountsOf(ctx);
  const remaining = waits.reduce((sum, w) => sum + Math.max(0, 4 - visible[w.type]), 0);

  if (level >= 4 && isAllLast(ctx) && hasYakuOnAllWaits && remaining > 0) {
    const rankNow = rankOf(ctx.selfSeat, ctx.scores);
    const damaRank = worstRankAfterRon(ctx, waits);
    if (rankNow === 1 || damaRank === 1) return false;
    const riichiWaits = evaluateWaits(handAfter, Object.assign({}, waitCtx, { riichi: true }));
    return worstRankAfterRon(ctx, riichiWaits) < damaRank;
  }

  if (evaluatorFor(ctx, level).evaluate(evalHandFromTiles(handAfter, melds)) < AI_PARAMS.riichiMinValue) return false;
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
//   レベル4以上は、流局間際なら役がなくても聴牌になる鳴きをする（形式聴牌でノーテン罰符を避ける）
function decideCallByEval(options, hand, melds, level, ctx) {
  const evaluator = evaluatorFor(ctx, level);
  const current = evalHandFromTiles(hand, melds);
  const shanten = evaluator.shantenOf(current);
  const facingThreat = facingStrongThreat(ctx, level);

  if (level >= 4 && !facingThreat && shanten >= 1 && ctx.wallRemaining <= AI_PARAMS.formalTenpaiWall) {
    const formal = options.find((opt) => opt.kind !== 'minkan'
      && evaluator.shantenOf(evalHandAfterCall(hand, melds, opt)) === 0);
    if (formal) return formal;
  }

  if (shanten < 3) {
    let best = null;
    let max = evaluator.evaluate(current);
    for (const opt of options) {
      const after = evalHandAfterCall(hand, melds, opt);
      const x = evaluator.shantenOf(after);
      if (x >= 3) continue;
      const value = evaluator.evaluate(after);
      if (facingThreat) {
        if (x > 0 && value < AI_PARAMS.callUnderThreat.notTenpai) continue;
        if (x === 0 && value < AI_PARAMS.callUnderThreat.tenpai) continue;
      }
      if (value - max > EVAL_EPSILON) { max = value; best = opt; }
    }
    return best;
  }

  if (facingThreat) return null;
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
//     レベル4以上は、リーチ（並みに怖い相手）を受けていて聴牌していなければ槓しない（新ドラを乗せないため）
function decideKan(options, hand, melds, level, ctx) {
  if (options.length === 0 || level === 1) return null;
  if (level === 2) return options[0];

  const evaluator = evaluatorFor(ctx, level);
  const current = evalHandFromTiles(hand, melds);
  const shanten = evaluator.shantenOf(current);
  if (facingStrongThreat(ctx, level) && shanten > 0) return null;

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
