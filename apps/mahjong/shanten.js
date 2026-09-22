'use strict';

/*
 * シャンテン数計算。
 * counts は34種の枚数配列（副露牌は含まない、手牌のうち面前部分のみ）。
 * meldCount は既に確定している副露セット数（0〜4）。
 * このファイルは状態を持たない純粋関数のみで構成する。
 */

// 標準形（4面子1雀頭）のシャンテンに寄与する分解を全探索する。
// leaves に {sets, partials, hasPair} を積む。counts は破壊的に使うが呼び出し後に復元する。
function collectStandardLeaves(counts, startIndex, sets, partials, hasPair, leaves) {
  let i = startIndex;
  while (i < TILE_TYPE_COUNT && counts[i] === 0) i++;
  if (i === TILE_TYPE_COUNT) {
    leaves.push({ sets, partials, hasPair });
    return;
  }

  const rank0 = i % 9;
  const isSuit = i < 27;

  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    collectStandardLeaves(counts, i, sets + 1, partials, hasPair, leaves);
    counts[i] += 3;
  }
  // 順子
  if (isSuit && rank0 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    collectStandardLeaves(counts, i, sets + 1, partials, hasPair, leaves);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  // 対子＝雀頭
  if (counts[i] >= 2 && !hasPair) {
    counts[i] -= 2;
    collectStandardLeaves(counts, i, sets, partials, true, leaves);
    counts[i] += 2;
  }
  // 対子＝塔子（将来の刻子候補）として温存
  if (counts[i] >= 2) {
    counts[i] -= 2;
    collectStandardLeaves(counts, i, sets, partials + 1, hasPair, leaves);
    counts[i] += 2;
  }
  // 両面/辺張塔子 (i, i+1)
  if (isSuit && rank0 <= 7 && counts[i + 1] > 0) {
    counts[i]--; counts[i + 1]--;
    collectStandardLeaves(counts, i, sets, partials + 1, hasPair, leaves);
    counts[i]++; counts[i + 1]++;
  }
  // 嵌張塔子 (i, i+2)
  if (isSuit && rank0 <= 6 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 2]--;
    collectStandardLeaves(counts, i, sets, partials + 1, hasPair, leaves);
    counts[i]++; counts[i + 2]++;
  }
  // 孤立牌として1枚だけ消費（どのブロックにも使わない）
  counts[i]--;
  collectStandardLeaves(counts, i, sets, partials, hasPair, leaves);
  counts[i]++;
}

function shantenStandard(counts, meldCount) {
  const needSets = 4 - meldCount;
  const leaves = [];
  collectStandardLeaves(counts.slice(), 0, 0, 0, false, leaves);
  let best = Infinity;
  for (const leaf of leaves) {
    const sets = Math.min(leaf.sets, needSets);
    const usablePartials = Math.min(leaf.partials, needSets - sets);
    const shanten = 2 * needSets - 2 * sets - usablePartials - (leaf.hasPair ? 1 : 0);
    if (shanten < best) best = shanten;
  }
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
