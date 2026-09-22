'use strict';

/*
 * 中世攻城戦（仮称）— ロジック検証用プロトタイプ
 *
 * 現時点の範囲:
 *   - 盤面生成（鏡写し対称）、移動、戦闘、資源、城塞、視野（森の隠蔽）
 *   - 手番は交互制（本来の「同時発表」は未実装。ロジック検証が目的のため）
 *   - 通信同期・同時発表UIは別増分で追加予定
 */

const CONFIG = {
  ROWS: 11,
  COLS: 9,
  RIVER_ROW: 5,
  BRIDGE_COLS: [2, 6],
  AP_PER_TURN: 4,
  VISION_UNIT: 1,
  VISION_STRUCTURE: 3,
  TERRAIN_WEIGHTS: { plain: 0.6, forest: 0.2, mountain: 0.2 },
  UNIT_STATS: {
    king:     { label: '王', combat: 0, move: 1, range: 1, cost: null },
    infantry: { label: '歩', combat: 3, move: 1, range: 1, cost: { food: 2 } },
    cavalry:  { label: '騎', combat: 4, move: 3, range: 1, cost: { horse: 3 } },
    archer:   { label: '弓', combat: 2, move: 1, range: 2, cost: { wood: 2 } },
  },
  TERRAIN_DEFENSE_BONUS: { mountain: 2, forest: 1, plain: 0, bridge: 0, river: 0, settlement: 0 },
  SETTLEMENT_INCOME: { food: 2, wood: 1, horse: 1 },
  RECRUIT_AP: 2,
  FORTRESS_AP: 2,
  FORTRESS_MAX_LEVEL: 3,
};

function fortressCost(nextLevel) {
  return { food: nextLevel * 3, wood: nextLevel * 3 };
}

const SIDES = ['A', 'B'];
const OPPONENT = { A: 'B', B: 'A' };

let state = null;

function key(r, c) { return r + ',' + c; }

function makeTile(terrain) {
  return { terrain, owner: null, isHome: false };
}

function mirrorRow(r) { return CONFIG.ROWS - 1 - r; }

function weightedTerrain() {
  const roll = Math.random();
  const w = CONFIG.TERRAIN_WEIGHTS;
  if (roll < w.plain) return 'plain';
  if (roll < w.plain + w.forest) return 'forest';
  return 'mountain';
}

function generateBoard() {
  const board = [];
  for (let r = 0; r < CONFIG.ROWS; r++) {
    board.push(new Array(CONFIG.COLS).fill(null));
  }

  // 中央行は川。橋のマスだけ通行可能
  for (let c = 0; c < CONFIG.COLS; c++) {
    const isBridge = CONFIG.BRIDGE_COLS.includes(c);
    board[CONFIG.RIVER_ROW][c] = makeTile(isBridge ? 'bridge' : 'river');
  }

  // 上半分をランダム生成し、下半分へ鏡写し
  const homeCol = Math.floor(CONFIG.COLS / 2);
  const neutralCols = [2, CONFIG.COLS - 3];
  for (let r = 0; r < CONFIG.RIVER_ROW; r++) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      let terrain = weightedTerrain();
      if (r === 0 && c === homeCol) terrain = 'settlement';
      if ((r === CONFIG.RIVER_ROW - 1) && neutralCols.includes(c)) terrain = 'settlement';
      const tile = makeTile(terrain);
      board[r][c] = tile;
      board[mirrorRow(r)][c] = makeTile(terrain);
    }
  }

  // 本拠地の所有権を設定（Bは盤面上側、Aは下側）
  board[0][homeCol].owner = 'B';
  board[0][homeCol].isHome = true;
  board[mirrorRow(0)][homeCol].owner = 'A';
  board[mirrorRow(0)][homeCol].isHome = true;

  return board;
}

function tileAt(r, c) {
  if (r < 0 || r >= CONFIG.ROWS || c < 0 || c >= CONFIG.COLS) return null;
  return state.board[r][c];
}

function unitAt(r, c) {
  return state.units.find(u => u.alive && u.r === r && u.c === c) || null;
}

function passable(r, c) {
  const t = tileAt(r, c);
  if (!t) return false;
  return t.terrain !== 'river';
}

function createUnit(side, type, r, c) {
  const id = side + '-' + type + '-' + Math.random().toString(36).slice(2, 7);
  state.units.push({ id, side, type, r, c, alive: true });
  return id;
}

function setupInitialUnits() {
  const homeCol = Math.floor(CONFIG.COLS / 2);
  const rowB = 1, rowA = mirrorRow(1);
  createUnit('B', 'king', rowB, homeCol);
  createUnit('B', 'infantry', rowB, homeCol - 1);
  createUnit('B', 'infantry', rowB, homeCol + 1);
  createUnit('A', 'king', rowA, homeCol);
  createUnit('A', 'infantry', rowA, homeCol - 1);
  createUnit('A', 'infantry', rowA, homeCol + 1);
}

function newGame() {
  state = {
    board: generateBoard(),
    units: [],
    resources: { A: { food: 5, wood: 5, horse: 3 }, B: { food: 5, wood: 5, horse: 3 } },
    fortress: {}, // "r,c" -> level(1-3)
    turn: 1,
    active: 'A',
    ap: CONFIG.AP_PER_TURN,
    viewMode: 'true',
    selected: null, // unitId
    log: [],
    winner: null,
  };
  setupInitialUnits();
  collectIncome('A');
  collectIncome('B');
  logMsg('新しい盤面を生成しました。Aの手番です。');
  render();
}

function logMsg(msg) {
  state.log.unshift(msg);
  if (state.log.length > 40) state.log.pop();
}

function settlementCount(side) {
  let count = 0;
  for (let r = 0; r < CONFIG.ROWS; r++) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      const t = state.board[r][c];
      if (t.terrain === 'settlement' && t.owner === side) count++;
    }
  }
  return count;
}

function collectIncome(side) {
  const count = settlementCount(side);
  for (const res in CONFIG.SETTLEMENT_INCOME) {
    state.resources[side][res] += CONFIG.SETTLEMENT_INCOME[res] * count;
  }
  return count;
}

// --- 視野: 森にいるユニットのみ隠蔽対象。それ以外の地形・建物・盤面は常に見える ---
function visionSources(side) {
  const sources = [];
  for (const u of state.units) {
    if (u.alive && u.side === side) sources.push({ r: u.r, c: u.c, radius: CONFIG.VISION_UNIT });
  }
  for (let r = 0; r < CONFIG.ROWS; r++) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      const t = state.board[r][c];
      const hasFortress = !!state.fortress[key(r, c)];
      if ((t.terrain === 'settlement' && t.owner === side) || (hasFortress && ownerOfTile(r, c) === side)) {
        sources.push({ r, c, radius: CONFIG.VISION_STRUCTURE });
      }
    }
  }
  return sources;
}

function ownerOfTile(r, c) {
  const u = unitAt(r, c);
  if (u) return u.side;
  return state.board[r][c].owner;
}

function isTileVisibleTo(side, r, c) {
  const sources = visionSources(side);
  for (const s of sources) {
    const dist = Math.max(Math.abs(s.r - r), Math.abs(s.c - c));
    if (dist <= s.radius) return true;
  }
  return false;
}

function isUnitVisibleTo(unit, viewerSide) {
  if (unit.side === viewerSide) return true;
  const t = state.board[unit.r][unit.c];
  if (t.terrain !== 'forest') return true; // 森以外は常に見える
  return isTileVisibleTo(viewerSide, unit.r, unit.c);
}

// --- 移動範囲探索（BFS） ---
function reachableTiles(unit) {
  const stats = CONFIG.UNIT_STATS[unit.type];
  const start = key(unit.r, unit.c);
  const dist = new Map([[start, 0]]);
  const queue = [[unit.r, unit.c]];
  const result = [];
  while (queue.length) {
    const [r, c] = queue.shift();
    const d = dist.get(key(r, c));
    if (d >= stats.move) continue;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (!passable(nr, nc)) continue;
      const k = key(nr, nc);
      if (dist.has(k)) continue;
      if (unitAt(nr, nc)) continue; // ユニットがいるマスは通過・進入不可
      dist.set(k, d + 1);
      result.push([nr, nc]);
      queue.push([nr, nc]);
    }
  }
  return result;
}

function attackableTiles(unit) {
  const stats = CONFIG.UNIT_STATS[unit.type];
  const targets = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of dirs) {
    for (let d = 1; d <= stats.range; d++) {
      const nr = unit.r + dr * d, nc = unit.c + dc * d;
      const target = unitAt(nr, nc);
      if (target && target.side !== unit.side) {
        // 弓兵以外は射程内に他ユニットが挟まると届かない想定にせず、素直に射程分先まで届く
        targets.push([nr, nc]);
      }
    }
  }
  return targets;
}

function combatPower(unit, defending) {
  const stats = CONFIG.UNIT_STATS[unit.type];
  let power = stats.combat;
  if (defending) {
    const t = state.board[unit.r][unit.c];
    power += CONFIG.TERRAIN_DEFENSE_BONUS[t.terrain] || 0;
    const fLevel = state.fortress[key(unit.r, unit.c)] || 0;
    power += fLevel;
  }
  return power;
}

function resolveCombat(attacker, defender) {
  const atk = combatPower(attacker, false);
  const def = combatPower(defender, true);
  if (atk > def) {
    defender.alive = false;
    logMsg(`${sideLabel(attacker.side)}の${CONFIG.UNIT_STATS[attacker.type].label}が${sideLabel(defender.side)}の${CONFIG.UNIT_STATS[defender.type].label}を撃破（${atk} vs ${def}）`);
    if (defender.type === 'king') {
      state.winner = attacker.side;
      logMsg(`${sideLabel(defender.side)}の王が討たれた。${sideLabel(attacker.side)}の勝利。`);
    }
    // 歩兵・騎兵はそのマスへ進出、弓兵は射程攻撃なので進出しない
    if (CONFIG.UNIT_STATS[attacker.type].range === 1) {
      attacker.r = defender.r;
      attacker.c = defender.c;
      const destTile = state.board[attacker.r][attacker.c];
      if (destTile.terrain === 'settlement' && destTile.owner !== attacker.side) {
        destTile.owner = attacker.side;
        logMsg(`${sideLabel(attacker.side)}が集落を占拠した。`);
      }
    }
  } else {
    logMsg(`${sideLabel(attacker.side)}の${CONFIG.UNIT_STATS[attacker.type].label}の攻撃は防がれた（${atk} vs ${def}）`);
  }
}

function sideLabel(side) { return side === 'A' ? 'A軍' : 'B軍'; }

function spendResources(side, cost) {
  for (const res in cost) state.resources[side][res] -= cost[res];
}

function canAfford(side, cost) {
  for (const res in cost) if (state.resources[side][res] < cost[res]) return false;
  return true;
}

function recruitUnit(type) {
  const side = state.active;
  const stats = CONFIG.UNIT_STATS[type];
  const homeTile = findOwnedSettlementSelected();
  if (!homeTile) { logMsg('集落マスを選択してから編成してください。'); return; }
  if (unitAt(homeTile.r, homeTile.c)) { logMsg('そのマスには既にユニットがいます。'); return; }
  if (state.ap < CONFIG.RECRUIT_AP) { logMsg('行動力が足りません。'); return; }
  if (!canAfford(side, stats.cost)) { logMsg('資源が足りません。'); return; }
  spendResources(side, stats.cost);
  state.ap -= CONFIG.RECRUIT_AP;
  createUnit(side, type, homeTile.r, homeTile.c);
  logMsg(`${sideLabel(side)}が${stats.label}を編成した。`);
  render();
}

function findOwnedSettlementSelected() {
  if (!state.selectedTile) return null;
  const [r, c] = state.selectedTile;
  const t = state.board[r][c];
  if (t.terrain === 'settlement' && t.owner === state.active) return { r, c };
  return null;
}

function buildFortress() {
  const side = state.active;
  const sel = state.selected;
  if (!sel) { logMsg('城塞を建てるユニットを選択してください。'); return; }
  const unit = state.units.find(u => u.id === sel);
  if (!unit || unit.side !== side) return;
  const k = key(unit.r, unit.c);
  const current = state.fortress[k] || 0;
  if (current >= CONFIG.FORTRESS_MAX_LEVEL) { logMsg('これ以上強化できません。'); return; }
  const cost = fortressCost(current + 1);
  if (state.ap < CONFIG.FORTRESS_AP) { logMsg('行動力が足りません。'); return; }
  if (!canAfford(side, cost)) { logMsg('資源が足りません。'); return; }
  spendResources(side, cost);
  state.ap -= CONFIG.FORTRESS_AP;
  state.fortress[k] = current + 1;
  logMsg(`${sideLabel(side)}が城塞レベル${current + 1}を建設した。`);
  render();
}

function endTurn() {
  state.active = OPPONENT[state.active];
  state.ap = CONFIG.AP_PER_TURN;
  state.selected = null;
  state.selectedTile = null;
  if (state.active === 'A') state.turn++;
  const income = collectIncome(state.active);
  logMsg(`--- ${sideLabel(state.active)}の手番（第${state.turn}ターン）。集落${income}か所から収入。---`);
  render();
}

// --- UI ---
function onCellClick(r, c) {
  if (state.winner) return;
  state.selectedTile = [r, c];
  const clickedUnit = unitAt(r, c);

  if (state.selected) {
    const unit = state.units.find(u => u.id === state.selected);
    if (unit && unit.side === state.active) {
      const reach = reachableTiles(unit).some(([rr, cc]) => rr === r && cc === c);
      const targets = attackableTiles(unit).some(([rr, cc]) => rr === r && cc === c);
      if (targets && clickedUnit && clickedUnit.side !== state.active) {
        if (state.ap < 1) { logMsg('行動力が足りません。'); render(); return; }
        state.ap -= 1;
        resolveCombat(unit, clickedUnit);
        state.selected = null;
        render();
        return;
      }
      if (reach && !clickedUnit) {
        if (state.ap < 1) { logMsg('行動力が足りません。'); render(); return; }
        state.ap -= 1;
        unit.r = r; unit.c = c;
        const destTile = state.board[r][c];
        if (destTile.terrain === 'settlement' && destTile.owner !== unit.side) {
          destTile.owner = unit.side;
          logMsg(`${sideLabel(unit.side)}が集落を占拠した。`);
        }
        state.selected = null;
        render();
        return;
      }
    }
  }

  if (clickedUnit && clickedUnit.side === state.active && isUnitVisibleTo(clickedUnit, state.active)) {
    state.selected = clickedUnit.id;
  } else {
    state.selected = null;
  }
  render();
}

function terrainLabel(t) {
  return { plain: '平地', forest: '森', mountain: '山', river: '川', bridge: '橋', settlement: '集落' }[t] || t;
}

function render() {
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${CONFIG.COLS}, 1fr)`;
  board.innerHTML = '';

  const reach = state.selected ? reachableTiles(state.units.find(u => u.id === state.selected)) : [];
  const atk = state.selected ? attackableTiles(state.units.find(u => u.id === state.selected)) : [];

  for (let r = 0; r < CONFIG.ROWS; r++) {
    for (let c = 0; c < CONFIG.COLS; c++) {
      const t = state.board[r][c];
      const cell = document.createElement('div');
      cell.className = 'cell terrain-' + t.terrain;
      if (t.owner) cell.classList.add('owner-' + t.owner);
      if (reach.some(([rr, cc]) => rr === r && cc === c)) cell.classList.add('reach');
      if (atk.some(([rr, cc]) => rr === r && cc === c)) cell.classList.add('attackable');
      if (state.selectedTile && state.selectedTile[0] === r && state.selectedTile[1] === c) cell.classList.add('selected-tile');

      const fLevel = state.fortress[key(r, c)];
      if (fLevel) {
        const badge = document.createElement('span');
        badge.className = 'fortress-badge';
        badge.textContent = '城' + fLevel;
        cell.appendChild(badge);
      }

      const u = unitAt(r, c);
      if (u) {
        const visible = state.viewMode === 'true' || isUnitVisibleTo(u, state.viewMode);
        if (visible) {
          const mark = document.createElement('div');
          mark.className = 'unit side-' + u.side + (u.id === state.selected ? ' unit-selected' : '');
          mark.textContent = CONFIG.UNIT_STATS[u.type].label;
          mark.title = `${sideLabel(u.side)} / ${CONFIG.UNIT_STATS[u.type].label} (${terrainLabel(t.terrain)})`;
          cell.appendChild(mark);
        }
      }

      cell.addEventListener('click', () => onCellClick(r, c));
      board.appendChild(cell);
    }
  }

  document.getElementById('turn-indicator').textContent = `第${state.turn}ターン / ${sideLabel(state.active)}の手番`;
  document.getElementById('ap-indicator').textContent = `残り行動力: ${state.ap} / ${CONFIG.AP_PER_TURN}`;
  document.getElementById('res-A').textContent = fmtRes('A');
  document.getElementById('res-B').textContent = fmtRes('B');
  document.getElementById('income-A').textContent = fmtIncome('A');
  document.getElementById('income-B').textContent = fmtIncome('B');
  document.getElementById('log').innerHTML = state.log.map(m => `<li>${m}</li>`).join('');

  document.getElementById('winner-banner').textContent = state.winner ? `${sideLabel(state.winner)}の勝利！` : '';
  document.getElementById('winner-banner').hidden = !state.winner;

  const viewSelect = document.getElementById('view-mode');
  if (viewSelect.value !== state.viewMode) viewSelect.value = state.viewMode;
}

const RES_LABEL = { food: '食料', wood: '木材', horse: '馬' };

function fmtRes(side) {
  const r = state.resources[side];
  return `食料${r.food} / 木材${r.wood} / 馬${r.horse}`;
}

function fmtIncome(side) {
  const count = settlementCount(side);
  const parts = Object.keys(CONFIG.SETTLEMENT_INCOME)
    .map(res => `${RES_LABEL[res]}+${CONFIG.SETTLEMENT_INCOME[res] * count}`)
    .join(' ');
  return `(集落${count}つ → 次の手番開始時に ${parts})`;
}

function fmtCost(cost) {
  if (!cost) return 'コストなし';
  return Object.entries(cost).map(([res, amt]) => `${RES_LABEL[res]}${amt}`).join('・');
}

// ユニット表と資源説明、編成ボタンの文言は CONFIG の数値からその場で生成する（表示と実際の数値のズレを防ぐ）
function setupStaticUI() {
  const tbody = document.querySelector('#unit-table tbody');
  for (const type of ['king', 'infantry', 'cavalry', 'archer']) {
    const s = CONFIG.UNIT_STATS[type];
    const row = document.createElement('tr');
    const cost = type === 'king' ? '初期配置のみ' : fmtCost(s.cost);
    row.innerHTML = `<td>${s.label}</td><td>${s.move}</td><td>${s.combat}</td><td>${s.range}</td><td>${cost}</td>`;
    tbody.appendChild(row);
  }

  document.querySelectorAll('[data-recruit]').forEach(btn => {
    const type = btn.dataset.recruit;
    const s = CONFIG.UNIT_STATS[type];
    btn.textContent = `${s.label}を編成（${fmtCost(s.cost)}・AP${CONFIG.RECRUIT_AP}）`;
  });

  const incomeParts = Object.keys(CONFIG.SETTLEMENT_INCOME)
    .map(res => `${RES_LABEL[res]}+${CONFIG.SETTLEMENT_INCOME[res]}`)
    .join(' ');
  document.getElementById('income-rule').textContent =
    `集落1つにつき、所有側の手番が始まるたびに ${incomeParts} が入る（占拠した集落の数だけ加算）。`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-end-turn').addEventListener('click', endTurn);
  document.getElementById('btn-new-game').addEventListener('click', newGame);
  document.getElementById('btn-fortress').addEventListener('click', buildFortress);
  document.querySelectorAll('[data-recruit]').forEach(btn => {
    btn.addEventListener('click', () => recruitUnit(btn.dataset.recruit));
  });
  document.getElementById('view-mode').addEventListener('change', (e) => {
    state.viewMode = e.target.value;
    render();
  });
  setupStaticUI();
  newGame();
});
