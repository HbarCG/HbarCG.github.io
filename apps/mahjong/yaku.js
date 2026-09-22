'use strict';

/*
 * 完成手の分解・役判定・符計算・点数計算。
 * このファイルは状態を持たない純粋関数のみで構成する。
 *
 * v1スコープ外（意図的に未実装、将来対応）:
 *   半荘/オーラス延長、喰いタンOFF等のローカルルール切替、天和/地和/人和、
 *   流し満貫、ダブルリーチ（通常リーチ扱い）、喰い替え禁止、四槓散了、
 *   小四喜/大四喜/字一色/清老頭/緑一色/四槓子（役満は国士無双・四暗刻・大三元のみ）、
 *   槍槓・嶺上開花の専用役（ロン/カンのルール自体は実装するが、専用の1翻役は付与しない
 *   ため、他に役が無い槍槓・嶺上ツモは役なしとして成立しない場合がある）、
 *   三暗刻（四暗刻が崩れた場合のフォールバック役は無し）。
 */

const YAKU_ID = {
  menzenTsumo: 1, riichi: 2, ippatsu: 3, tanyao: 4, pinfu: 5,
  yakuhai: 6, honitsu: 7, chinitsu: 8, toitoi: 9, chanta: 10,
  junchan: 11, iipeikou: 12, sanshokuDoujun: 13, sanshokuDoukou: 14,
  ittsu: 15, chiitoitsu: 16, kokushi: 17, suuankou: 18, daisangen: 19,
};

function isWindType(type) { return type >= 27 && type <= 30; }
function isDragonType(type) { return type >= 31 && type <= 33; }

function roundUp100(n) { return Math.ceil(n / 100) * 100; }

function computeBasePoints(han, fu, isYakuman, yakumanMultiplier) {
  if (isYakuman) return 8000 * yakumanMultiplier;
  if (han >= 13) return 8000; // 数え役満
  if (han >= 11) return 6000; // 三倍満
  if (han >= 8) return 4000; // 倍満
  if (han >= 6) return 3000; // 跳満
  if (han === 5) return 2000; // 満貫
  let base = fu * Math.pow(2, 2 + han);
  if (base > 2000) base = 2000;
  return base;
}

function limitNameFor(han, fu, isYakuman, yakumanMultiplier) {
  if (isYakuman) return yakumanMultiplier >= 2 ? 'ダブル役満' : '役満';
  if (han >= 13) return '数え役満';
  if (han >= 11) return '三倍満';
  if (han >= 8) return '倍満';
  if (han >= 6) return '跳満';
  if (han === 5) return '満貫';
  const base = fu * Math.pow(2, 2 + han);
  if (base > 2000) return '満貫';
  return null;
}

function computePayments(basePoints, isDealer, winMethod, honba) {
  const honbaRon = honba * 300;
  const honbaTsumoEach = honba * 100;
  if (winMethod === 'ron') {
    const total = roundUp100(basePoints * (isDealer ? 6 : 4)) + honbaRon;
    return { type: 'ron', total };
  }
  if (isDealer) {
    const each = roundUp100(basePoints * 2) + honbaTsumoEach;
    return { type: 'tsumo', fromEach: each, total: each * 3 };
  }
  const fromDealer = roundUp100(basePoints * 2) + honbaTsumoEach;
  const fromNonDealer = roundUp100(basePoints * 1) + honbaTsumoEach;
  return { type: 'tsumo', fromDealer, fromNonDealer, total: fromDealer + fromNonDealer * 2 };
}

// 完全一致（余りなし）の標準形分解を全て列挙する。
function enumerateStandardDecompositions(counts, needSets) {
  const results = [];
  function rec(c, i, sets, pairType) {
    while (i < TILE_TYPE_COUNT && c[i] === 0) i++;
    if (i === TILE_TYPE_COUNT) {
      if (sets.length === needSets && pairType !== null) {
        results.push({ sets: sets.slice(), pairType });
      }
      return;
    }
    const rank0 = i % 9;
    const isSuit = i < 27;

    if (c[i] >= 3 && sets.length < needSets) {
      c[i] -= 3;
      sets.push({ kind: 'triplet', type: i });
      rec(c, i, sets, pairType);
      sets.pop();
      c[i] += 3;
    }
    if (isSuit && rank0 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && sets.length < needSets) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      sets.push({ kind: 'sequence', type: i });
      rec(c, i, sets, pairType);
      sets.pop();
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2 && pairType === null) {
      c[i] -= 2;
      rec(c, i, sets, i);
      c[i] += 2;
    }
  }
  rec(counts.slice(), 0, [], null);
  return results;
}

function isChiitoitsuShape(counts) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < TILE_TYPE_COUNT; i++) {
    if (counts[i] === 2) pairs++;
    if (counts[i] > 0) kinds++;
    if (counts[i] === 1 || counts[i] === 3 || counts[i] === 4) return false;
  }
  return pairs === 7 && kinds === 7;
}

function isKokushiShape(counts) {
  const yaochuu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  let total = 0, pairCount = 0;
  for (let i = 0; i < TILE_TYPE_COUNT; i++) {
    if (counts[i] === 0) continue;
    if (!yaochuu.includes(i)) return false;
    total += counts[i];
    if (counts[i] === 2) pairCount++;
    if (counts[i] > 2) return false;
  }
  return total === 14 && pairCount === 1;
}

// 和了牌がどのブロックで完成したかによる待ちの形を判定する。
// block: {kind:'sequence', type} | {kind:'triplet', type} | {kind:'pair', type}
function classifyWait(block, winningType) {
  if (block.kind === 'pair') return 'tanki';
  if (block.kind === 'triplet') return 'shanpon';
  const r = block.type;
  const pos = winningType - r;
  if (pos === 1) return 'kanchan';
  if (pos === 0) return (r % 9 === 6) ? 'penchan' : 'ryanmen';
  return (r % 9 === 0) ? 'penchan' : 'ryanmen';
}

function meldFu(meld) {
  const type = tileType(meld.tiles[0]);
  const simple = !isYaochuuType(type);
  if (meld.kind === 'chi') return 0;
  if (meld.kind === 'ankan') return simple ? 16 : 32;
  if (meld.kind === 'minkan' || meld.kind === 'kakan') return simple ? 8 : 16;
  // pon (open triplet)
  return simple ? 2 : 4;
}

function isMenzenHand(melds) {
  return melds.every((m) => m.kind === 'ankan');
}

// 標準形の1つの分解＋和了ブロック候補を評価して役・符・翻を求める。戻り値はnull=役なし。
function evaluateStandardCandidate(ctx, decomposition, winningBlockIndex) {
  const { melds, winningTile, winMethod, seatWindType, roundWindType, riichi, ippatsu, isDealer } = ctx;
  const winningType = tileType(winningTile);
  const isMenzen = isMenzenHand(melds);
  const allSets = decomposition.sets;
  const winningBlock = winningBlockIndex === -1
    ? { kind: 'pair', type: decomposition.pairType }
    : { kind: allSets[winningBlockIndex].kind === 'sequence' ? 'sequence' : 'triplet', type: allSets[winningBlockIndex].type };
  const waitType = classifyWait(winningBlock, winningType);

  const yaku = [];
  let han = 0;

  // --- 役判定 ---
  if (isMenzen && winMethod === 'tsumo') { yaku.push(['門前清自摸和', 1]); han += 1; }
  if (riichi) { yaku.push(['リーチ', 1]); han += 1; }
  if (ippatsu) { yaku.push(['一発', 1]); han += 1; }

  const allTypes = [];
  for (const s of allSets) {
    if (s.kind === 'sequence') allTypes.push(s.type, s.type + 1, s.type + 2);
    else allTypes.push(s.type, s.type, s.type);
  }
  allTypes.push(decomposition.pairType, decomposition.pairType);
  for (const m of melds) {
    if (m.kind === 'chi') {
      const types = m.tiles.map(tileType).sort((a, b) => a - b);
      allTypes.push(...types);
    } else {
      const t = tileType(m.tiles[0]);
      allTypes.push(t, t, t);
    }
  }

  const tanyao = allTypes.every((t) => !isYaochuuType(t));
  if (tanyao) { yaku.push(['タンヤオ', 1]); han += 1; }

  const pinfu = isMenzen
    && allSets.every((s) => s.kind === 'sequence')
    && melds.length === 0
    && !isDragonType(decomposition.pairType)
    && decomposition.pairType !== seatWindType
    && decomposition.pairType !== roundWindType
    && waitType === 'ryanmen';
  if (pinfu) { yaku.push(['平和', 1]); han += 1; }

  let yakuhaiHan = 0;
  const triplets = [
    ...allSets.filter((s) => s.kind === 'triplet').map((s) => ({ type: s.type, concealed: true })),
    ...melds.filter((m) => m.kind !== 'chi').map((m) => ({ type: tileType(m.tiles[0]), concealed: m.kind === 'ankan' })),
  ];
  for (const t of triplets) {
    if (isDragonType(t.type)) yakuhaiHan += 1;
    if (t.type === roundWindType) yakuhaiHan += 1;
    if (t.type === seatWindType) yakuhaiHan += 1;
  }
  if (yakuhaiHan > 0) { yaku.push(['役牌', yakuhaiHan]); han += yakuhaiHan; }

  const suits = new Set(allTypes.map((t) => suitOfType(t)));
  const hasHonor = allTypes.some((t) => isHonorType(t));
  const suitOnly = [...suits].filter((s) => s !== 'z');
  if (suitOnly.length === 1) {
    if (hasHonor) {
      const h = isMenzen ? 3 : 2;
      yaku.push(['混一色', h]); han += h;
    } else {
      const h = isMenzen ? 6 : 5;
      yaku.push(['清一色', h]); han += h;
    }
  }

  const toitoi = allSets.every((s) => s.kind === 'triplet') && melds.every((m) => m.kind !== 'chi');
  if (toitoi) { yaku.push(['対々和', 2]); han += 2; }

  const blockContainsTerminalOrHonor = (typesInBlock) => typesInBlock.some((t) => isYaochuuType(t));
  const blocksForChanta = [];
  for (const s of allSets) {
    blocksForChanta.push(s.kind === 'sequence' ? [s.type, s.type + 1, s.type + 2] : [s.type]);
  }
  blocksForChanta.push([decomposition.pairType]);
  for (const m of melds) {
    blocksForChanta.push(m.kind === 'chi' ? m.tiles.map(tileType) : [tileType(m.tiles[0])]);
  }
  const chantaShape = blocksForChanta.every((b) => blockContainsTerminalOrHonor(b));
  if (chantaShape) {
    const junchanShape = !hasHonor;
    if (junchanShape) {
      const h = isMenzen ? 3 : 2;
      yaku.push(['純全帯幺九', h]); han += h;
    } else {
      const h = isMenzen ? 2 : 1;
      yaku.push(['混全帯幺九', h]); han += h;
    }
  }

  if (isMenzen) {
    const seqStarts = allSets.filter((s) => s.kind === 'sequence').map((s) => s.type);
    const seen = new Set();
    let iipeikou = false;
    for (const t of seqStarts) {
      if (seen.has(t)) iipeikou = true;
      seen.add(t);
    }
    if (iipeikou) { yaku.push(['一盃口', 1]); han += 1; }
  }

  const allSequences = [
    ...allSets.filter((s) => s.kind === 'sequence').map((s) => ({ type: s.type })),
    ...melds.filter((m) => m.kind === 'chi').map((m) => ({ type: Math.min(...m.tiles.map(tileType)) })),
  ];
  const rankOfSeq = (t) => t % 9;
  const suitOfSeq = (t) => suitOfType(t);
  for (const t of allSequences) {
    if (rankOfSeq(t.type) !== 0) continue;
    const rank = rankOfSeq(t.type);
    const hasP = allSequences.some((x) => suitOfSeq(x.type) === 'p' && rankOfSeq(x.type) === rank);
    const hasS = allSequences.some((x) => suitOfSeq(x.type) === 's' && rankOfSeq(x.type) === rank);
    const hasM = allSequences.some((x) => suitOfSeq(x.type) === 'm' && rankOfSeq(x.type) === rank);
    if (hasP && hasS && hasM) {
      const h = isMenzen ? 2 : 1;
      yaku.push(['三色同順', h]); han += h;
      break;
    }
  }
  for (const t of triplets) {
    if (isHonorType(t.type)) continue;
    const rank = t.type % 9;
    const suitStart = Math.floor(t.type / 9) * 9;
    const hasAllThree = [0, 9, 18].every((base) => triplets.some((x) => x.type === base + rank));
    if (hasAllThree) { yaku.push(['三色同刻', 2]); han += 2; break; }
  }

  for (const base of [0, 9, 18]) {
    const has123 = allSequences.some((s) => s.type === base);
    const has456 = allSequences.some((s) => s.type === base + 3);
    const has789 = allSequences.some((s) => s.type === base + 6);
    if (has123 && has456 && has789) {
      const h = isMenzen ? 2 : 1;
      yaku.push(['一気通貫', h]); han += h;
      break;
    }
  }

  // --- 役満チェック ---
  const concealedTriplets = triplets.filter((t) => t.concealed);
  let isYakuman = false;
  let yakumanMultiplier = 1;
  const yakumanYaku = [];
  if (concealedTriplets.length === 4 && allSets.filter((s) => s.kind === 'triplet').length + melds.filter((m) => m.kind === 'ankan').length === 4) {
    const winCompletesShanpon = waitType === 'shanpon' && winMethod === 'ron';
    if (!winCompletesShanpon) {
      isYakuman = true;
      if (waitType === 'tanki') yakumanMultiplier = 2;
      yakumanYaku.push(['四暗刻' + (yakumanMultiplier === 2 ? '単騎' : ''), 13 * yakumanMultiplier]);
    }
  }
  const dragonTriplets = triplets.filter((t) => isDragonType(t.type));
  if (new Set(dragonTriplets.map((t) => t.type)).size === 3) {
    isYakuman = true;
    yakumanYaku.push(['大三元', 13]);
  }

  if (isYakuman) {
    return {
      yaku: yakumanYaku,
      han: yakumanYaku.reduce((a, y) => a + y[1], 0),
      fu: 0,
      isYakuman: true,
      yakumanMultiplier: Math.max(1, ...yakumanYaku.map((y) => (y[1] > 13 ? 2 : 1))),
    };
  }

  if (yaku.length === 0) return null; // 役なし

  // --- 符計算 ---
  let fu = 20;
  if (isMenzen && winMethod === 'ron') fu += 10;
  if (winMethod === 'tsumo' && !pinfu) fu += 2;

  if (isDragonType(decomposition.pairType)) fu += 2;
  if (decomposition.pairType === roundWindType) fu += 2;
  if (decomposition.pairType === seatWindType) fu += 2;

  allSets.forEach((s, idx) => {
    if (s.kind === 'sequence') return;
    const simple = !isYaochuuType(s.type);
    let value = simple ? 4 : 8;
    if (idx === winningBlockIndex && waitType === 'shanpon' && winMethod === 'ron') value = simple ? 2 : 4;
    fu += value;
  });
  for (const m of melds) fu += meldFu(m);

  if (waitType === 'kanchan' || waitType === 'penchan' || waitType === 'tanki') fu += 2;

  if (pinfu) {
    fu = winMethod === 'tsumo' ? 20 : 30;
  } else {
    fu = Math.ceil(fu / 10) * 10;
  }

  return { yaku, han, fu, isYakuman: false, yakumanMultiplier: 1 };
}

function countDora(allTileIds, doraIndicatorIds) {
  let count = 0;
  for (const indicator of doraIndicatorIds) {
    const doraType = doraTypeFromIndicator(indicator);
    for (const id of allTileIds) {
      if (tileType(id) === doraType) count++;
    }
  }
  return count;
}

function countAkaDora(allTileIds) {
  return allTileIds.filter(isRedFive).length;
}

// メインエントリ: 和了判定・役・符・点数を計算する。役なしならnullを返す。
function evaluateWin(input) {
  const {
    concealedTiles, winningTile, winMethod, melds,
    seatWindType, roundWindType, isDealer,
    riichi, ippatsu, doraIndicators, uraDoraIndicators,
  } = input;

  const meldCount = melds.length;
  const counts = toCounts(concealedTiles);
  const allTileIds = concealedTiles.concat(...melds.map((m) => m.tiles));

  // 国士無双
  if (meldCount === 0 && isKokushiShape(counts)) {
    // 和了牌を1枚除いた13枚で13種全て揃っていれば13面待ち
    const yaochuu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
    const withoutWin = concealedTiles.slice();
    withoutWin.splice(withoutWin.indexOf(winningTile), 1);
    const preCounts = toCounts(withoutWin);
    const thirteenWait = yaochuu.every((t) => preCounts[t] >= 1);
    const multiplier = thirteenWait ? 2 : 1;
    return {
      yaku: [[thirteenWait ? '国士無双十三面' : '国士無双', 13 * multiplier]],
      han: 13 * multiplier, fu: 0, isYakuman: true, yakumanMultiplier: multiplier,
      doraHan: 0, akaHan: 0, uraDoraHan: 0,
      basePoints: computeBasePoints(0, 0, true, multiplier),
      limitName: multiplier >= 2 ? 'ダブル役満' : '役満',
    };
  }

  // 七対子
  if (meldCount === 0 && isChiitoitsuShape(counts)) {
    const dora = countDora(allTileIds, doraIndicators);
    const aka = countAkaDora(allTileIds);
    const ura = riichi ? countDora(allTileIds, uraDoraIndicators) : 0;
    const han = 2 + dora + aka + ura;
    const fu = 25;
    const basePoints = computeBasePoints(han, fu, false, 1);
    return {
      yaku: [['七対子', 2]], han, fu, isYakuman: false, yakumanMultiplier: 1,
      doraHan: dora, akaHan: aka, uraDoraHan: ura,
      basePoints, limitName: limitNameFor(han, fu, false, 1),
    };
  }

  // 標準形
  const needSets = 4 - meldCount;
  const decompositions = enumerateStandardDecompositions(counts, needSets);
  const winningType = tileType(winningTile);
  let best = null;

  for (const decomposition of decompositions) {
    const candidateIndexes = [];
    decomposition.sets.forEach((s, idx) => {
      if (s.kind === 'triplet' && s.type === winningType) candidateIndexes.push(idx);
      if (s.kind === 'sequence' && winningType >= s.type && winningType <= s.type + 2) candidateIndexes.push(idx);
    });
    if (decomposition.pairType === winningType) candidateIndexes.push(-1);

    for (const idx of candidateIndexes) {
      const result = evaluateStandardCandidate(
        { melds, winningTile, winMethod, seatWindType, roundWindType, riichi, ippatsu, isDealer },
        decomposition, idx
      );
      if (!result) continue;
      const dora = result.isYakuman ? 0 : countDora(allTileIds, doraIndicators);
      const aka = result.isYakuman ? 0 : countAkaDora(allTileIds);
      const ura = result.isYakuman ? 0 : (riichi ? countDora(allTileIds, uraDoraIndicators) : 0);
      const totalHan = result.han + dora + aka + ura;
      const basePoints = computeBasePoints(totalHan, result.fu, result.isYakuman, result.yakumanMultiplier);
      const full = {
        yaku: result.yaku, han: totalHan, fu: result.fu,
        isYakuman: result.isYakuman, yakumanMultiplier: result.yakumanMultiplier,
        doraHan: dora, akaHan: aka, uraDoraHan: ura,
        basePoints, limitName: limitNameFor(totalHan, result.fu, result.isYakuman, result.yakumanMultiplier),
      };
      if (!best || full.basePoints > best.basePoints || (full.basePoints === best.basePoints && full.han > best.han)) {
        best = full;
      }
    }
  }

  return best;
}
