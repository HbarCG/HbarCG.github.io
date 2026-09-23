'use strict';

/*
 * 打牌の答え合わせ。自分が捨てた牌と「お手本のAI」が選ぶ牌を比べて、違いの理由を数字で示す。
 *
 * お手本のAIは、CPUの一番強い設定（レベル5・読みの深さ3）と同じ判断をする（ai.js の chooseDiscard）。
 * 比べる項目:
 *   打牌後の向聴数 / 受け入れ（向聴数が進む牌の種類と、見えていない枚数） /
 *   評価値（eval.js。打点と和了しやすさをまとめた目安） / 危険度（警戒する相手がいるときだけ）
 * 理由の文章はAIに書かせず、これらの数字の比較から決まった文を選ぶ。
 *
 * 表示は game.js が担当し、このファイルは状態を持たない関数だけで構成する。
 */

const REVIEW_LEVEL = 5;
const REVIEW_DEPTH = 3;

// 評価値の差がこの割合より小さければ「ほぼ同じ」とみなす
const REVIEW_CLOSE_RATIO = 0.05;

// 危険度（電脳麻将と同じ尺度）を言葉にする。区切りは ai.js の AI_PARAMS.fold に合わせる
function reviewDangerLabel(w) {
  if (w === 0) return '安全';
  if (w < AI_PARAMS.fold.low) return '比較的安全';
  if (w < AI_PARAMS.fold.high) return 'やや危険';
  if (w < AI_PARAMS.fold.never) return '危険';
  return 'かなり危険';
}

// 危険度の段階（0: 安全な牌 / 1: やや危険 / 2: 危険 / 3: かなり危険）。理由の文で「差がある」とみなす単位。
// 「安全」と「比較的安全」はCPUの押し引きでも同じ扱いなので区別しない
function reviewDangerClass(w) {
  if (w < AI_PARAMS.fold.low) return 0;
  if (w < AI_PARAMS.fold.high) return 1;
  if (w < AI_PARAMS.fold.never) return 2;
  return 3;
}

// 打牌後の手（13枚相当）で、引くと向聴数が進む牌種と、その見えていない枚数の合計
function reviewUkeire(counts, meldCount, shanten, visibleCounts) {
  const types = [];
  let total = 0;
  const work = counts.slice();
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (work[t] >= 4) continue;
    work[t]++;
    if (computeShanten(work, meldCount) < shanten) {
      types.push(t);
      total += Math.max(0, 4 - visibleCounts[t]);
    }
    work[t]--;
  }
  return { types, total };
}

// 警戒している相手の説明（例: 「CPU2（リーチ）」「CPU3（2副露）」）。
// 副露もリーチもないのに警戒しているのは、終盤で聴牌の見込みがある（ダマの可能性）とき
function reviewThreatText(threat, ctx) {
  const name = `CPU${threat.seat}`;
  if (ctx.riichiBySeat[threat.seat]) return `${name}（リーチ）`;
  const melds = ctx.meldsBySeat[threat.seat].length;
  return melds === 0 ? `${name}（ダマの可能性）` : `${name}（${melds}副露）`;
}

// 1枚の打牌について、比べる数字をまとめる
function reviewDescribe(tileId, evaluator, evalHand, danger, visibleCounts, ctx) {
  const type = tileType(tileId);
  const after = evalDiscard(evalHand, type, isRedFive(tileId));
  const shanten = evaluator.shantenOf(after);
  const ukeire = reviewUkeire(after.counts, after.melds.length, shanten, visibleCounts);
  const safeFrom = [];
  if (danger) {
    for (let s = 0; s < 4; s++) {
      if (s !== ctx.selfSeat && ctx.riichiBySeat[s] && safeTypesAgainst(s, ctx).has(type)) safeFrom.push(`CPU${s}`);
    }
  }
  return {
    tile: tileId,
    shanten,
    ukeire,
    value: evaluator.evaluate(after),
    danger: danger ? danger(type) : null,
    safeFrom, // リーチ者のうち、この牌が現物になっている相手
  };
}

// 自分とAIの打牌の違いを、理由の文にする
function reviewReason(mine, ai) {
  if (mine.shanten > ai.shanten) {
    return `あなたの打牌は向聴数が戻ります（打牌後 ${ai.shanten}→${mine.shanten}向聴）。`
      + '手が遠くなるので、はっきりした理由（安全・打点）がなければ損です。';
  }
  if (mine.shanten < ai.shanten) {
    if (ai.danger !== null && ai.danger < mine.danger) {
      return 'AIは向聴数を落としてでも、安全な牌を選びました（降り）。'
        + 'この手の価値では、危ない牌を切って押すほどではないという判断です。';
    }
    return 'AIは向聴数を1つ戻して、より広い・高い形に組み直しました（向聴戻し）。';
  }

  const ukeireDiff = ai.ukeire.total - mine.ukeire.total;
  if (ai.danger !== null && reviewDangerClass(ai.danger) < reviewDangerClass(mine.danger)) {
    if (ukeireDiff < 0) {
      return `AIは受け入れを${-ukeireDiff}枚減らしてでも、危険度の低い牌を選びました（回し打ち）。`
        + '警戒している相手に対して、あなたの牌は危険度が高めです。';
    }
    if (ukeireDiff > 0) return `AIの牌は受け入れが${ukeireDiff}枚多く、しかも危険度が低い牌です。`;
    return '受け入れは同じで、AIの牌のほうが危険度が低いです。';
  }
  if (ai.danger !== null && reviewDangerClass(ai.danger) > reviewDangerClass(mine.danger)) {
    return 'AIは危険度が上がっても押しました。手の価値（評価値）が危険に見合うという判断です。';
  }
  if (ukeireDiff > 0) {
    return `AIの打牌のほうが受け入れが${ukeireDiff}枚多い、広い形です。`;
  }
  const close = Math.abs(ai.value - mine.value) <= Math.max(ai.value, mine.value) * REVIEW_CLOSE_RATIO;
  if (close) {
    return '評価値はほぼ同じです。どちらを切っても大差ありません'
      + '（同じくらいなら、AIは後で使いにくい牌から切ります）。';
  }
  if (ukeireDiff < 0) {
    return `受け入れはあなたのほうが${-ukeireDiff}枚多いですが、AIは打点やその先の形（良形・役・ドラ）を重く見ました。`;
  }
  return '受け入れは同じですが、AIの打牌のほうが打点やその先の形（良形・役・ドラ）の見込みが高いです。';
}

// 打牌の答え合わせ。hand は打牌前の手牌、discardTile は自分が捨てた牌。
// ctx は ai.js と同じ盤面情報（game.js の buildAiContext）。打牌前に作ったものを渡す。
// 戻り値: { same, mine, ai, reason, threats }
function reviewDiscard(hand, melds, discardTile, ctx) {
  const aiTile = chooseDiscard(hand, melds, REVIEW_LEVEL, REVIEW_DEPTH, ctx);
  const evaluator = evaluatorFor(ctx, REVIEW_LEVEL);
  const danger = dangerFunction(ctx, REVIEW_LEVEL, REVIEW_DEPTH);
  const evalHand = evalHandFromTiles(hand, melds);
  const visibleCounts = visibleCountsOf(ctx);

  const mine = reviewDescribe(discardTile, evaluator, evalHand, danger, visibleCounts, ctx);
  const same = tileType(aiTile) === tileType(discardTile) && isRedFive(aiTile) === isRedFive(discardTile);
  const ai = same ? mine : reviewDescribe(aiTile, evaluator, evalHand, danger, visibleCounts, ctx);
  const threats = danger ? threatsFor(ctx, REVIEW_LEVEL).map((t) => reviewThreatText(t, ctx)) : [];
  return { same, mine, ai, reason: same ? null : reviewReason(mine, ai), threats };
}
