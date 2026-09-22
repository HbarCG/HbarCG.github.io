'use strict';

/*
 * 牌のデータモデル。
 * 牌ID: 0〜135（天鳳と同じ体系）。
 *   type = floor(id / 4)  … 0〜33 の牌種
 *     0-8   = 1m〜9m
 *     9-17  = 1p〜9p
 *     18-26 = 1s〜9s
 *     27-33 = 東南西北白發中
 *   copy = id % 4         … 同じ牌種の4枚のうち何枚目か
 * 赤ドラ: 各色5の copy=0 (type*4+0) を赤5固定とする（5m=16, 5p=52, 5s=88）。
 * このファイルは状態を持たない純粋関数のみで構成する。
 */

const TILE_TYPE_COUNT = 34;
const RED_FIVE_IDS = [16, 52, 88]; // 5m, 5p, 5s の copy=0

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];

function tileType(id) {
  return Math.floor(id / 4);
}

function tileCopy(id) {
  return id % 4;
}

function isRedFive(id) {
  return RED_FIVE_IDS.includes(id);
}

function isHonorType(type) {
  return type >= 27;
}

function isTerminalType(type) {
  if (type >= 27) return false;
  const rank0 = type % 9; // 0-indexed rank within suit
  return rank0 === 0 || rank0 === 8;
}

function isYaochuuType(type) {
  return isHonorType(type) || isTerminalType(type);
}

function suitOfType(type) {
  if (type < 9) return 'm';
  if (type < 18) return 'p';
  if (type < 27) return 's';
  return 'z';
}

// 1-indexed rank within suit (honors: 1=東..7=中)
function rankOfType(type) {
  if (type < 27) return (type % 9) + 1;
  return type - 27 + 1;
}

function tileTypeLabel(type) {
  const suit = suitOfType(type);
  if (suit === 'z') return HONOR_NAMES[type - 27];
  return `${rankOfType(type)}${suit}`;
}

function tileLabel(id) {
  const type = tileType(id);
  const label = tileTypeLabel(type);
  return isRedFive(id) ? `${label}(赤)` : label;
}


function sortTilesByType(tiles) {
  return tiles.slice().sort((a, b) => {
    const ta = tileType(a);
    const tb = tileType(b);
    if (ta !== tb) return ta - tb;
    return tileCopy(a) - tileCopy(b);
  });
}

function toCounts(tiles) {
  const counts = new Array(TILE_TYPE_COUNT).fill(0);
  for (const id of tiles) counts[tileType(id)]++;
  return counts;
}

function shuffleArray(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildShuffledDeck() {
  const ids = [];
  for (let i = 0; i < 136; i++) ids.push(i);
  return shuffleArray(ids);
}

// 山から13枚ずつ4人に配り、王牌14枚を切り出す。
// 王牌の内訳: 先頭4枚=嶺上牌、次5枚=ドラ表示牌、次5枚=裏ドラ表示牌。
function dealFromDeck(deck) {
  const hands = [[], [], [], []];
  let idx = 0;
  for (let p = 0; p < 4; p++) {
    for (let i = 0; i < 13; i++) hands[p].push(deck[idx++]);
  }
  const deadWall = deck.slice(idx, idx + 14);
  idx += 14;
  const liveWall = deck.slice(idx);
  return {
    hands,
    rinshanTiles: deadWall.slice(0, 4),
    doraIndicators: deadWall.slice(4, 9),
    uraDoraIndicators: deadWall.slice(9, 14),
    liveWall,
  };
}

// ドラ表示牌からドラの牌種を求める（表示牌の次の牌がドラ）。
function doraTypeFromIndicator(indicatorId) {
  const type = tileType(indicatorId);
  const suit = suitOfType(type);
  if (suit === 'z') {
    if (type <= 30) {
      // 東南西北 (27-30) は東→南→西→北→東 と巡回
      return 27 + ((type - 27 + 1) % 4);
    }
    // 白發中 (31-33) は白→發→中→白 と巡回
    return 31 + ((type - 31 + 1) % 3);
  }
  const suitStart = Math.floor(type / 9) * 9;
  const rank0 = type % 9;
  return suitStart + ((rank0 + 1) % 9);
}
