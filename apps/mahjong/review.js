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

// 警戒している相手の説明（例: 「CPU2（リーチ）」「CPU3（2副露）」「CPU1（1副露・暗槓1）」）。
// 暗槓は門前のままなので副露とは分けて書く（CPUの警戒度の計算＝ai.js の threatOf では暗槓も数に入れている）。
// 副露も暗槓もリーチもないのに警戒しているのは、終盤で聴牌の見込みがある（ダマの可能性）とき
function reviewThreatText(threat, ctx) {
  const name = `CPU${threat.seat}`;
  if (ctx.riichiBySeat[threat.seat]) return `${name}（リーチ）`;
  const melds = ctx.meldsBySeat[threat.seat];
  const ankan = melds.filter((m) => m.kind === 'ankan').length;
  const parts = [];
  if (melds.length > ankan) parts.push(`${melds.length - ankan}副露`);
  if (ankan > 0) parts.push(`暗槓${ankan}`);
  return parts.length === 0 ? `${name}（ダマの可能性）` : `${name}（${parts.join('・')}）`;
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

// 相談用のコピー（position.js）に添える、打牌の候補ごとの数字。答え合わせと同じ計算を、手牌の全種類について行う。
// 同じ牌種は1回だけ調べる（赤5と普通の5はドラの数が変わるので別扱い）。
// 並び順: お手本のAIの打牌を先頭に、残りは 打牌後の向聴数の小さい順 → 受け入れの多い順。
// 戻り値: { aiTile, candidates: reviewDescribe の結果に isAi を足したものの配列, threats }
function adviceCandidates(hand, melds, ctx) {
  const aiTile = chooseDiscard(hand, melds, REVIEW_LEVEL, REVIEW_DEPTH, ctx);
  const evaluator = evaluatorFor(ctx, REVIEW_LEVEL);
  const danger = dangerFunction(ctx, REVIEW_LEVEL, REVIEW_DEPTH);
  const evalHand = evalHandFromTiles(hand, melds);
  const visibleCounts = visibleCountsOf(ctx);
  const keyOf = (id) => `${tileType(id)}${isRedFive(id) ? 'r' : ''}`;

  const seen = new Set();
  const candidates = [];
  for (const id of sortTilesByType(hand)) {
    if (seen.has(keyOf(id))) continue;
    seen.add(keyOf(id));
    const d = reviewDescribe(id, evaluator, evalHand, danger, visibleCounts, ctx);
    d.isAi = keyOf(id) === keyOf(aiTile);
    candidates.push(d);
  }
  candidates.sort((a, b) => (b.isAi - a.isAi) || (a.shanten - b.shanten) || (b.ukeire.total - a.ukeire.total));
  const threats = danger ? threatsFor(ctx, REVIEW_LEVEL).map((t) => reviewThreatText(t, ctx)) : [];
  return { aiTile, candidates, threats };
}

// ---------------------------------------------------------------------------
// 鳴きの答え合わせ。ポン・チー・カンができたときに、自分の選択（鳴く／鳴かない）と
// お手本のAI（ai.js の decideCall をレベル5で呼ぶ）の選択を比べる。
// ---------------------------------------------------------------------------

// 鳴きの呼び名（ポン・チー・カン）
function reviewCallLabel(opt) {
  if (!opt) return '鳴かない';
  return opt.kind === 'pon' ? 'ポン' : opt.kind === 'chi' ? 'チー' : 'カン';
}

// 評価値の数字の書き方（10以上は整数、それ未満は小数1桁）
function reviewValueFormat(v) {
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
}

// 1つの選択（opt が null なら鳴かない）について、比べる数字をまとめる。
// 鳴いた場合の向聴数・評価値は「鳴いて、一番よい牌を1枚切ったあと」の値
function reviewDescribeCall(opt, evaluator, hand, melds) {
  const after = opt ? evalHandAfterCall(hand, melds, opt) : evalHandFromTiles(hand, melds);
  return {
    option: opt,
    shanten: evaluator.shantenOf(after),
    value: evaluator.evaluate(after),
    yakuShanten: evaluator.yakuShanten(after), // 役に向かう向聴数（役の見込みがなければ Infinity）
  };
}

// お手本のAIがなぜその選択をしたか。ai.js の decideCallByEval の判断の順番に合わせて文を選ぶ。
// none: 鳴かない場合、ai: AIの選択、alt: AIが見送った鳴きのうち説明に使うもの（AIが鳴くときは null）。
// 評価値は、三向聴以上では別の数え方（役に向かう有効牌の数）になるので、二向聴以内のときだけ文に出す
function reviewCallReason(none, ai, alt, info) {
  const s = (x) => (x === 0 ? '聴牌' : `${x}向聴`);
  const v = reviewValueFormat;
  if (info.formal) {
    return '流局間際なので、役がなくても聴牌になる鳴きをします（形式聴牌で、流局時のノーテン罰符を避けます）。';
  }
  if (none.shanten >= 3) {
    if (ai.option) {
      return '手はまだ遠い（3向聴以上）ですが、この鳴きで役（役牌・タンヤオ・対々和・染め手）に近づくので鳴きます。';
    }
    if (info.facingThreat) return '手がまだ遠く、リーチ（か、それに近い相手）を受けているので鳴きません。';
    return '手がまだ遠い（3向聴以上）うちは、役のある形に近づく鳴き（役牌のポンなど）だけをします。'
      + 'この鳴きでは、役のある形（門前のままの手や七対子も含む）への向聴数が進まないので見送ります。';
  }
  if (ai.option) {
    const progress = ai.shanten < none.shanten ? `向聴数が${s(none.shanten)}→${s(ai.shanten)}に進み、` : '';
    return `鳴くと${progress}評価値が${v(none.value)}→${v(ai.value)}に上がるので鳴きます。`;
  }
  if (alt.shanten >= 3) return '鳴いても手が遠い（3向聴以上）ままなので鳴きません。';
  if (info.facingThreat && alt.value > none.value) {
    const min = alt.shanten === 0 ? AI_PARAMS.callUnderThreat.tenpai : AI_PARAMS.callUnderThreat.notTenpai;
    return 'リーチ（か、それに近い相手）を受けているので、安い仕掛けはしません'
      + `（鳴いた後の評価値${v(alt.value)}。この状況では${min}以上の手でないと鳴きません）。`;
  }
  if (alt.shanten >= none.shanten) {
    return `鳴いても向聴数が進まない（${s(none.shanten)}のまま）うえに、評価値が${v(none.value)}→${v(alt.value)}に下がるので鳴きません。`;
  }
  if (alt.yakuShanten > alt.shanten) {
    return `鳴くと向聴数は${s(none.shanten)}→${s(alt.shanten)}に進みますが、役のない形になります`
      + `（評価値${v(none.value)}→${v(alt.value)}）。役がないと和了できないので鳴きません。`;
  }
  return `鳴くと向聴数は${s(none.shanten)}→${s(alt.shanten)}に進みますが、評価値は${v(none.value)}→${v(alt.value)}に下がります。`
    + '打点（門前ならリーチ・ツモ）や手の広さを失う分のほうが大きい、という判断です。';
}

// 鳴きの答え合わせ。hand・melds は鳴く前の手牌、options はその場で選べた鳴き
// （game.js が合法性を確かめたもの）、chosen は自分が選んだ鳴き（鳴かなかったときは null）。
// ctx は ai.js と同じ盤面情報（game.js の buildAiContext）。
// 戻り値: { same, mine, ai, none, all, reason, threats }
//   mine / ai / none（鳴かない場合）/ all（options の順）は reviewDescribeCall の結果
function reviewCall(hand, melds, options, chosen, ctx) {
  const aiOpt = decideCall(options, hand, melds, REVIEW_LEVEL, ctx);
  const evaluator = evaluatorFor(ctx, REVIEW_LEVEL);
  const describe = (opt) => reviewDescribeCall(opt, evaluator, hand, melds);
  const none = describe(null);
  const all = options.map(describe);
  const pick = (opt) => (opt ? all[options.indexOf(opt)] : none);
  const mine = pick(chosen);
  const ai = pick(aiOpt);

  // AIが鳴かないときに理由の説明に使う鳴き: 自分が鳴いたならその鳴き、そうでなければ評価値が一番高い鳴き
  let alt = null;
  if (!aiOpt) alt = chosen ? mine : all.reduce((a, b) => (b.value > a.value ? b : a));

  const facingThreat = facingStrongThreat(ctx, REVIEW_LEVEL);
  // 形式聴牌の鳴き（ai.js の decideCallByEval の最初の判断）を選んだか
  const formal = Boolean(aiOpt) && aiOpt.kind !== 'minkan' && !facingThreat && none.shanten >= 1
    && ctx.wallRemaining <= AI_PARAMS.formalTenpaiWall && ai.shanten === 0 && ai.value <= none.value;
  const threats = facingThreat
    ? threatsFor(ctx, REVIEW_LEVEL)
      .filter((t) => t.weight >= AI_PARAMS.threat.strongWeight)
      .map((t) => reviewThreatText(t, ctx))
    : [];
  return {
    same: aiOpt === chosen,
    mine,
    ai,
    none,
    all,
    reason: reviewCallReason(none, ai, alt, { facingThreat, formal }),
    threats,
  };
}
