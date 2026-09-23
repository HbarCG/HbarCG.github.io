'use strict';

/*
 * CPU思考ルーチン。ルールベース（学習なし）。
 * レベル(1-5)と読みの深さ(0-3)の2軸で調整する。レベル1-3は読みの深さを参照しない
 * （危険牌の読みはレベル4以降でのみ発動する、という意図的な単純化）。
 * リーチ判断は assist.js の evaluateWaits / countVisibleTypes を使う（役・打点・待ちの残り枚数）。
 *
 * このファイルの関数は game.js から渡される「読み取り専用の盤面情報」(gameView) を
 * 参照するのみで、状態を直接書き換えない。
 */

const DANGER = {
  genbutsu: 0,
  suji: 1,
  noChance: 1,
  oneChance: 2,
  kabeDiscount: 1,
  honorOrTerminalBase: 2,
  simpleBase: 4,
};

function isYakuhaiType(type, seatWindType, roundWindType) {
  return isDragonType(type) || type === seatWindType || type === roundWindType;
}

function handValueTypes(hand, melds) {
  const types = hand.map(tileType);
  for (const m of melds) types.push(...m.tiles.map(tileType));
  return types;
}

// 手牌の「価値」を簡易採点する（役牌温存・タンヤオ整合・ドラ枚数の重み付け）。
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

// レベル2-3向け: 打牌候補ごとに「残した場合の手の価値」を採点し、最大のものを残す
// （＝価値の低い牌から切る）。
function scoreKeepValue(candidateDiscard, hand, melds, seatWindType, roundWindType) {
  const remaining = hand.filter((id) => id !== candidateDiscard);
  return estimateHandValue(remaining, melds, seatWindType, roundWindType);
}

function isGenbutsu(type, opponentSeat, ctx) {
  const discards = ctx.discardsBySeat[opponentSeat] || [];
  if (discards.some((d) => tileType(d.tile) === type)) return true;
  // 他家がロンできず見逃した牌（リーチ後に通った牌）も現物扱いにする簡易実装:
  // 全員の捨て牌のうち、その対局者のリーチ以降に捨てられた牌は当たり牌ではない、
  // という厳密な追跡はv1では省略し、当人の捨て牌のみを現物とする。
  return false;
}

function isSuji(type, opponentSeat, ctx) {
  const suit = suitOfType(type);
  if (suit === 'z') return false;
  const rank = rankOfType(type); // 1-indexed
  const suitBase = type - (rank - 1);
  const checkGenbutsu = (r) => r >= 1 && r <= 9 && isGenbutsu(suitBase + (r - 1), opponentSeat, ctx);
  if (rank === 5) return checkGenbutsu(2) && checkGenbutsu(8);
  if (rank <= 3) return checkGenbutsu(rank + 3);
  if (rank >= 7) return checkGenbutsu(rank - 3);
  return checkGenbutsu(rank - 3) && checkGenbutsu(rank + 3);
}

// 場に見えている枚数から、両面待ちが成立しうるか(ワンチャンス/ノーチャンス)を大まかに判定する。
function visibleCount(type, ctx) {
  let count = 0;
  for (const seatDiscards of ctx.discardsBySeat) {
    for (const d of seatDiscards) if (tileType(d.tile) === type) count++;
  }
  for (const seatMelds of ctx.meldsBySeat) {
    for (const m of seatMelds) for (const t of m.tiles) if (tileType(t) === type) count++;
  }
  for (const id of ctx.doraIndicators) if (tileType(id) === type) count++;
  for (const id of ctx.selfHand) if (tileType(id) === type) count++;
  return count;
}

function chanceLevel(type, ctx) {
  const suit = suitOfType(type);
  if (suit === 'z') return 2; // 字牌はワンチャンス概念なし、通常基準のまま
  const rank = rankOfType(type);
  const suitBase = type - (rank - 1);
  // その牌を挟むリャンメン成立に必要な、両隣牌の残り枚数を見る
  let minRemaining = Infinity;
  for (const r of [rank - 1, rank + 1]) {
    if (r < 1 || r > 9) continue;
    const remaining = 4 - visibleCount(suitBase + (r - 1), ctx);
    if (remaining < minRemaining) minRemaining = remaining;
  }
  if (minRemaining <= 0) return 0; // ノーチャンス
  if (minRemaining === 1) return 1; // ワンチャンス
  return 2;
}

function kabeDiscount(type, ctx, opponentSeat) {
  const seatDiscards = ctx.discardsBySeat[opponentSeat] || [];
  const earlyCount = Math.min(6, seatDiscards.length);
  const idxOfType = seatDiscards.findIndex((d) => tileType(d.tile) === type);
  if (idxOfType !== -1 && idxOfType < 3) return 1; // その対局者が序盤に切った筋は多少安全
  const visible = visibleCount(type, ctx);
  if (visible >= 3) return 1; // 場に3枚以上見えている(壁)なら残り枚数から安全度アップ
  return 0;
}

// 中盤以降（捨て牌9枚目以降）に手出しで中張牌(3〜7)を切っていれば、ダマで聴牌している気配とみる。
function looksDamaTenpai(discards) {
  return discards.slice(8).some((d) => {
    if (d.tsumogiri) return false;
    const type = tileType(d.tile);
    if (suitOfType(type) === 'z') return false;
    const rank = rankOfType(type);
    return rank >= 3 && rank <= 7;
  });
}

// 警戒すべき他家。kind は 'riichi'（リーチ者）か 'suspect'（リーチしていないが聴牌していそうな人）。
// suspect: 副露が2つ以上ある（手牌が短く聴牌・一向聴の可能性が高い）か、ダマ聴牌の気配がある。
function threatsBySeat(ctx, selfSeat) {
  const threats = [];
  for (let s = 0; s < 4; s++) {
    if (s === selfSeat) continue;
    if (ctx.riichiBySeat[s]) {
      threats.push({ seat: s, kind: 'riichi' });
    } else if ((ctx.meldsBySeat[s] || []).length >= 2 || looksDamaTenpai(ctx.discardsBySeat[s] || [])) {
      threats.push({ seat: s, kind: 'suspect' });
    }
  }
  return threats;
}

function dangerScoreForTile(tileId, selfSeat, ctx, readingDepth) {
  const type = tileType(tileId);
  const threats = threatsBySeat(ctx, selfSeat).map((t) => t.seat);
  if (threats.length === 0) return 0;
  let worst = -Infinity;
  for (const opp of threats) {
    let score = isYaochuuType(type) ? DANGER.honorOrTerminalBase : DANGER.simpleBase;
    if (readingDepth >= 1 && isGenbutsu(type, opp, ctx)) {
      score = DANGER.genbutsu;
    } else {
      if (readingDepth >= 2) {
        if (isSuji(type, opp, ctx)) score = Math.min(score, DANGER.suji);
        const chance = chanceLevel(type, ctx);
        if (chance === 0) score = Math.min(score, DANGER.noChance);
        else if (chance === 1) score = Math.min(score, DANGER.oneChance);
      }
      if (readingDepth >= 3) {
        score = Math.max(0, score - kabeDiscount(type, ctx, opp));
      }
    }
    if (score > worst) worst = score;
  }
  return worst;
}

// 押し引きの判断（レベル4-5）。true なら降りる。
//   リーチ者がいる   : 聴牌で手の価値が基準以上なら押す。レベル5は一向聴でも高い手なら押す。
//                      それ以外（手が遠い・安い）は降りる。
//   聴牌気配の人だけ : 二向聴以上なら降りる。聴牌・一向聴なら押す。
const FOLD_THRESHOLD_TENPAI = { 4: 4, 5: 6 };
const PUSH_THRESHOLD_ONE_SHANTEN = 8; // 役牌の刻子がある、など高い手の目安

function shouldFold(level, bestShanten, ownValue, threats) {
  if (threats.length === 0) return false;
  const facingRiichi = threats.some((t) => t.kind === 'riichi');
  if (!facingRiichi) return bestShanten >= 2;
  if (bestShanten === 0) return ownValue < FOLD_THRESHOLD_TENPAI[level];
  if (bestShanten === 1 && level === 5) return ownValue < PUSH_THRESHOLD_ONE_SHANTEN;
  return true;
}

// 打牌を1枚選ぶ。
function chooseDiscard(hand, melds, level, readingDepth, ctx) {
  const meldCount = melds.length;
  let bestShanten = Infinity;
  const shantenByTile = new Map();
  for (const id of hand) {
    const remaining = hand.filter((x) => x !== id);
    const s = computeShanten(toCounts(remaining), meldCount);
    shantenByTile.set(id, s);
    if (s < bestShanten) bestShanten = s;
  }
  let pool = hand.filter((id) => shantenByTile.get(id) === bestShanten);

  if (level === 1) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // レベル4-5: 押し引きを判断し、降りるなら一番安全な牌を切る
  // （安全度が同じなら、向聴数が悪くならない牌を優先する）
  if (level >= 4 && !ctx.selfRiichi) {
    const threats = threatsBySeat(ctx, ctx.selfSeat);
    const ownValue = estimateHandValue(hand, melds, ctx.seatWindType, ctx.roundWindType);
    if (shouldFold(level, bestShanten, ownValue, threats)) {
      let safest = hand[0];
      let safestScore = Infinity;
      let safestShanten = Infinity;
      for (const id of hand) {
        const d = dangerScoreForTile(id, ctx.selfSeat, ctx, readingDepth);
        const s = shantenByTile.get(id);
        if (d < safestScore || (d === safestScore && s < safestShanten)) {
          safestScore = d; safestShanten = s; safest = id;
        }
      }
      return safest;
    }
  }

  // レベル2-3: 同シャンテン内で価値の高い形を残す
  let best = pool[0];
  let bestValue = -Infinity;
  for (const id of pool) {
    const v = scoreKeepValue(id, hand, melds, ctx.seatWindType, ctx.roundWindType);
    if (v > bestValue) { bestValue = v; best = id; }
  }
  return best;
}

// リーチするかどうか。handAfter は打牌後の手牌（聴牌している13枚相当）。
//   レベル1-2 : 聴牌したら即リーチ
//   レベル3以上: どの待ちでも役があり、ダマで満貫以上が確定しているならダマ
//   レベル4以上: 待ち牌が場に残っていない（空聴）ならリーチしない
//   レベル5    : 他家のリーチを受けていて、役があり待ちが残り2枚以下ならダマ
//                （リーチすると降りられなくなるため）
function decideRiichi(level, handAfter, melds, ctx) {
  if (level <= 2) return true;

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
  const visible = countVisibleTypes(ctx.selfHand, ctx.discardsBySeat, ctx.meldsBySeat, ctx.doraIndicators);
  const remaining = waits.reduce((sum, w) => sum + Math.max(0, 4 - visible[w.type]), 0);

  if (hasYakuOnAllWaits && Math.min(...waits.map((w) => w.ron.basePoints)) >= 2000) return false;
  if (level >= 4 && remaining === 0) return false;
  if (level === 5 && hasYakuOnAllWaits && remaining <= 2
      && ctx.riichiBySeat.some((r, s) => r && s !== ctx.selfSeat)) return false;
  return true;
}

// 鳴き（ポン/チー）をするかどうか。optionsは game.js が合法性を検証済みの候補配列。
// 各option: {kind:'pon'|'chi', tiles:[使用する手牌side ids], resultingMeldTiles:[...]}
function decideCall(options, hand, melds, level, ctx) {
  if (options.length === 0) return null;
  if (level === 1) return null; // レベル1は鳴かない

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

    if (level >= 2 && wouldBreakTanyao && !isYakuhaiMeld) {
      // 役が残らなくなる鳴みは基本的に避ける(レベル2はここで弾く)
      const stillHasYaku = estimateHandValue(remainingHand, melds.concat([{ tiles: opt.resultingMeldTiles }]), ctx.seatWindType, ctx.roundWindType) > 0;
      if (level === 2 && !stillHasYaku) continue;
    }

    let score = (currentShanten - newShanten) * 10;
    if (isYakuhaiMeld) score += 8;
    if (!wouldBreakTanyao) score += 3;
    if (level >= 5) score += 2; // レベル5はやや積極的に鳴く

    if (score > bestScore) { bestScore = score; bestOption = opt; }
  }
  return bestOption;
}
