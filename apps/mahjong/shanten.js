'use strict';

/*
 * シャンテン数計算。
 * counts は34種の枚数配列（副露牌は含まない、手牌のうち面前部分のみ）。
 * meldCount は既に確定している副露セット数（0〜4）。
 * このファイルは状態を持たない純粋関数のみで構成する。
 */

// 標準形（4面子1雀頭）のシャンテン数。
// 順子は色をまたがないので、萬子・筒子・索子・字牌の4つに分けて「面子・塔子・雀頭」の取り方を調べ、
// 最後に組み合わせる。色ごとの結果は牌の並びをキーにして覚えておく
// （CPUの思考で同じ形を何万回も計算するため。結果は全体をまとめて全探索した場合と同じ）。

const groupPatternCache = new Map();

// 1色分（数牌は9種、字牌は7種）の取り方のうち、ほかの取り方より劣らないものだけを返す。
// 戻り値: [雀頭なしの {sets, partials} の配列, 雀頭ありの {sets, partials} の配列]
function groupPatterns(counts, start, length, isSuit) {
  let key = isSuit ? 1 : 2;
  for (let i = 0; i < length; i++) key = key * 5 + counts[start + i];
  const cached = groupPatternCache.get(key);
  if (cached) return cached;

  const c = counts.slice(start, start + length);
  const found = [[], []];
  const add = (sets, partials, hasPair) => {
    const list = found[hasPair ? 1 : 0];
    if (list.some((x) => x.sets >= sets && x.partials >= partials)) return;
    for (let k = list.length - 1; k >= 0; k--) {
      if (list[k].sets <= sets && list[k].partials <= partials) list.splice(k, 1);
    }
    list.push({ sets, partials });
  };
  const rec = (i, sets, partials, hasPair) => {
    while (i < length && c[i] === 0) i++;
    if (i === length) { add(sets, partials, hasPair); return; }
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3; rec(i, sets + 1, partials, hasPair); c[i] += 3;
    }
    // 順子
    if (isSuit && i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      rec(i, sets + 1, partials, hasPair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      // 対子＝雀頭
      if (!hasPair) { c[i] -= 2; rec(i, sets, partials, true); c[i] += 2; }
      // 対子＝塔子（将来の刻子候補）として温存
      c[i] -= 2; rec(i, sets, partials + 1, hasPair); c[i] += 2;
    }
    // 両面/辺張塔子 (i, i+1)
    if (isSuit && i <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--; rec(i, sets, partials + 1, hasPair); c[i]++; c[i + 1]++;
    }
    // 嵌張塔子 (i, i+2)
    if (isSuit && i <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--; rec(i, sets, partials + 1, hasPair); c[i]++; c[i + 2]++;
    }
    // 孤立牌として1枚だけ消費（どのブロックにも使わない）
    c[i]--; rec(i, sets, partials, hasPair); c[i]++;
  };
  rec(0, 0, 0, false);
  groupPatternCache.set(key, found);
  return found;
}

function shantenStandard(counts, meldCount) {
  const needSets = 4 - meldCount;
  const groups = [
    groupPatterns(counts, 0, 9, true),
    groupPatterns(counts, 9, 9, true),
    groupPatterns(counts, 18, 9, true),
    groupPatterns(counts, 27, 7, false),
  ];
  let best = Infinity;
  // 4つの色の取り方を組み合わせる。雀頭はどれか1色からだけ取る。
  const rec = (g, sets, partials, hasPair) => {
    if (g === groups.length) {
      const usedSets = Math.min(sets, needSets);
      const usablePartials = Math.min(partials, needSets - usedSets);
      const shanten = 2 * needSets - 2 * usedSets - usablePartials - (hasPair ? 1 : 0);
      if (shanten < best) best = shanten;
      return;
    }
    for (const x of groups[g][0]) rec(g + 1, sets + x.sets, partials + x.partials, hasPair);
    if (!hasPair) {
      for (const x of groups[g][1]) rec(g + 1, sets + x.sets, partials + x.partials, true);
    }
  };
  rec(0, 0, 0, false);
  return best;
}

function shantenChiitoitsu(counts, meldCount) {
  if (meldCount > 0) return Infinity; // 七対子は面前限定
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < TILE_TYPE_COUNT; i++) {
    if (counts[i] >= 1) kinds++;
    if (counts[i] >= 2) pairs++;
  }
  pairs = Math.min(pairs, 7);
  return 6 - pairs + Math.max(0, 7 - kinds);
}

function shantenKokushi(counts, meldCount) {
  if (meldCount > 0) return Infinity; // 国士無双は面前限定
  const yaochuu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  let present = 0;
  let hasPair = false;
  for (const t of yaochuu) {
    if (counts[t] >= 1) present++;
    if (counts[t] >= 2) hasPair = true;
  }
  return 13 - present - (hasPair ? 1 : 0);
}

function computeShanten(counts, meldCount) {
  return Math.min(
    shantenStandard(counts, meldCount),
    shantenChiitoitsu(counts, meldCount),
    shantenKokushi(counts, meldCount)
  );
}

// 何を引けばシャンテンが進むか（34種のうちシャンテンを下げる牌種の配列）。
function ukeireTypes(counts, meldCount) {
  const base = computeShanten(counts, meldCount);
  const result = [];
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (counts[t] >= 4) continue;
    counts[t]++;
    const s = computeShanten(counts, meldCount);
    counts[t]--;
    if (s < base) result.push(t);
  }
  return result;
}

function isCompleteHandCounts(counts, meldCount) {
  return computeShanten(counts, meldCount) === -1;
}
