'use strict';

/*
 * 麻雀ゲーム本体: state管理・ターン進行・DOM描画・イベント配線。
 * 牌モデル/シャンテン/役判定/AI/棋譜生成のロジックは他ファイルに委譲し、
 * このファイルは「それらを呼び出して1局・1半荘を進める」ことに専念する。
 *
 * 席は常に seat0=人間, seat1-3=CPU固定（席そのものは回転しない。
 * 親（oya）だけが局ごとにseat間を巡回する）。
 */

const STARTING_SCORE = 25000;

const urlParams = new URLSearchParams(location.search);
const CONFIG = {
  cpuLevel: Number(urlParams.get('level')) || 3,
  readingDepth: urlParams.has('depth') ? Number(urlParams.get('depth')) : 1,
  autoHuman: urlParams.get('auto') === '1', // デバッグ用: 人間もAIが操作する自動対局モード
};

let state = null;
let discardResolver = null;
let selectedTile = null; // 打牌前に1回タップして選んでいる手牌
let promptResolver = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
// CPU手番の最小待ち時間（演出ではなく、進行が速すぎて読めなくなるのを防ぐため）。
// 自動対局デバッグモード(?auto=1)では動作確認を速くするため短縮する。
function thinkDelay() { return CONFIG.autoHuman ? 1 : 350; }
// CPUが鳴いた・リーチしたときに、宣言を見せてから打牌するまでの待ち時間
function announceDelay() { return CONFIG.autoHuman ? 1 : 900; }

function seatWindType(seat) { return 27 + ((seat - state.oya + 4) % 4); }

function newPlayer(seat) {
  return {
    seat,
    hand: [],
    melds: [],
    discards: [],
    riichi: false,
    ippatsuWindow: false,
    furitenPermanent: false,
    furitenTemp: false,
    tenpaiTurn: null, // 何巡目(自分の打牌の枚数)から聴牌しているか。0は配牌から。局の終わりに公開する
    riichiTurn: null,
    score: STARTING_SCORE,
  };
}

// ---------------------------------------------------------------------------
// 対局セットアップ
// ---------------------------------------------------------------------------

function initMatch() {
  state = {
    players: [newPlayer(0), newPlayer(1), newPlayer(2), newPlayer(3)],
    oya: 0,
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    roundWindType: 27, // 東風戦固定
    wall: [],
    wallIndex: 0,
    rinshanTiles: [],
    rinshanIndex: 0,
    doraIndicators: [],
    doraRevealed: 1,
    uraDoraIndicators: [],
    lastDrawnTile: null,
    kifuLines: [],
    gameOver: false,
    eventLog: [],
    callAnnounce: null, // 卓上に出している宣言 { seat, text, meldIndex }
    reveal: null, // 局が終わって全員の手牌を公開している間 { winners, winTile }
  };
  const names = ['あなた', 'CPU1', 'CPU2', 'CPU3'];
  state.kifuLines.push(kifuHeader(names));
}

function setupHand() {
  const deck = buildShuffledDeck();
  const dealt = dealFromDeck(deck);
  for (let s = 0; s < 4; s++) {
    state.players[s].hand = sortTilesByType(dealt.hands[s]);
    state.players[s].melds = [];
    state.players[s].discards = [];
    state.players[s].riichi = false;
    state.players[s].riichiSidewaysPending = false;
    state.players[s].ippatsuWindow = false;
    state.players[s].furitenPermanent = false;
    state.players[s].furitenTemp = false;
    state.players[s].tenpaiTurn = null;
    state.players[s].riichiTurn = null;
    recordTenpaiTurn(s);
  }
  state.wall = dealt.liveWall;
  state.wallIndex = 0;
  state.rinshanTiles = dealt.rinshanTiles;
  state.rinshanIndex = 0;
  state.doraIndicators = dealt.doraIndicators;
  state.doraRevealed = 1;
  state.uraDoraIndicators = dealt.uraDoraIndicators;
  state.lastDrawnTile = null;
  state.lastDiscardSeat = null;
  state.discardCount = 0;
  state.callAnnounce = null;
  state.reveal = null;

  state.kifuLines.push(kifuInit({
    kyoku: state.kyoku, honba: state.honba, kyotaku: state.kyotaku,
    doraIndicators: state.doraIndicators, scores: state.players.map((p) => p.score),
    oya: state.oya, hands: state.players.map((p) => p.hand),
  }));
  pushLog(`--- 東${state.kyoku}局 ${state.honba}本場 ---`);
}

// ---------------------------------------------------------------------------
// 山・ドラ
// ---------------------------------------------------------------------------

function drawFromWall() {
  if (state.wallIndex >= state.wall.length) return null;
  return state.wall[state.wallIndex++];
}

function drawFromRinshan() {
  if (state.rinshanIndex >= state.rinshanTiles.length) return null;
  return state.rinshanTiles[state.rinshanIndex++];
}

function revealNewDora() {
  if (state.doraRevealed < state.doraIndicators.length) {
    state.doraRevealed++;
    state.kifuLines.push(kifuDora(state.doraIndicators[state.doraRevealed - 1]));
  }
}

// ---------------------------------------------------------------------------
// 手牌操作ヘルパー
// ---------------------------------------------------------------------------

function removeIdsFromHand(seat, ids) {
  const player = state.players[seat];
  for (const id of ids) {
    const idx = player.hand.indexOf(id);
    if (idx !== -1) player.hand.splice(idx, 1);
  }
}

function addToHand(seat, tileId) {
  state.players[seat].hand.push(tileId);
  state.players[seat].hand = sortTilesByType(state.players[seat].hand);
}

function buildAiContext(seat) {
  return {
    selfSeat: seat,
    selfHand: state.players[seat].hand,
    selfRiichi: state.players[seat].riichi,
    isDealer: seat === state.oya,
    seatWindType: seatWindType(seat),
    roundWindType: state.roundWindType,
    discardsBySeat: state.players.map((p) => p.discards),
    meldsBySeat: state.players.map((p) => p.melds),
    riichiBySeat: state.players.map((p) => p.riichi),
    riichiTurnBySeat: state.players.map((p) => p.riichiTurn),
    dealerSeat: state.oya,
    wallRemaining: state.wall.length - state.wallIndex,
    scores: state.players.map((p) => p.score),
    kyoku: state.kyoku,
    honba: state.honba,
    kyotaku: state.kyotaku,
    doraIndicators: state.doraIndicators.slice(0, state.doraRevealed),
  };
}

function buildWinContext(seat, winningTile, winMethod) {
  const player = state.players[seat];
  const concealedTiles = winMethod === 'ron' ? player.hand.concat([winningTile]) : player.hand.slice();
  return {
    concealedTiles,
    winningTile,
    winMethod,
    melds: player.melds,
    seatWindType: seatWindType(seat),
    roundWindType: state.roundWindType,
    isDealer: seat === state.oya,
    riichi: player.riichi,
    ippatsu: player.ippatsuWindow,
    doraIndicators: state.doraIndicators.slice(0, state.doraRevealed),
    uraDoraIndicators: player.riichi ? state.uraDoraIndicators.slice(0, state.doraRevealed) : [],
  };
}

// CPUが和了するかどうか（オーラスでラス確定の和了を見逃すことがある。ai.js の decideWin）
function cpuTakesWin(seat, winningTile, winMethod, fromSeat) {
  const result = evaluateWin(buildWinContext(seat, winningTile, winMethod));
  return decideWin(CONFIG.cpuLevel, buildAiContext(seat), result.basePoints, winMethod, fromSeat);
}

function canTsumo(seat) {
  return evaluateWin(buildWinContext(seat, state.lastDrawnTile.tile, 'tsumo')) !== null;
}

function canRon(seat, tileId) {
  const player = state.players[seat];
  if (player.furitenPermanent || player.furitenTemp) return false;
  return evaluateWin(buildWinContext(seat, tileId, 'ron')) !== null;
}

function computeWaitTypes(seat) {
  const player = state.players[seat];
  const counts = toCounts(player.hand);
  if (computeShanten(counts, player.melds.length) !== 0) return [];
  return ukeireTypes(counts, player.melds.length);
}

function updateFuriten(seat) {
  const player = state.players[seat];
  const waits = computeWaitTypes(seat);
  const discardedTypes = player.discards.map((d) => tileType(d.tile));
  const nowFuriten = waits.some((t) => discardedTypes.includes(t));
  if (nowFuriten) player.furitenPermanent = true;
  if (!player.riichi) {
    // リーチ中でなければ、自分の打牌で一時フリテンは解消される
    player.furitenTemp = false;
    if (!nowFuriten) player.furitenPermanent = false;
  }
}

// 打牌のたびに呼び、聴牌に入った巡目を記録する（聴牌を崩したら記録を消し、入り直した巡目を残す）
function recordTenpaiTurn(seat) {
  const player = state.players[seat];
  const tenpai = computeShanten(toCounts(player.hand), player.melds.length) === 0;
  if (!tenpai) player.tenpaiTurn = null;
  else if (player.tenpaiTurn === null) player.tenpaiTurn = player.discards.length;
}

function breakAllIppatsu() {
  for (const p of state.players) p.ippatsuWindow = false;
}

// ---------------------------------------------------------------------------
// 鳴き・槓のオプション列挙
// ---------------------------------------------------------------------------

function getPonOption(seat, tileId) {
  const type = tileType(tileId);
  const same = state.players[seat].hand.filter((id) => tileType(id) === type);
  if (same.length < 2) return null;
  const used = same.slice(0, 2);
  return { kind: 'pon', tiles: used, resultingMeldTiles: [...used, tileId] };
}

function getMinkanOption(seat, tileId) {
  const type = tileType(tileId);
  const same = state.players[seat].hand.filter((id) => tileType(id) === type);
  if (same.length < 3) return null;
  return { kind: 'minkan', tiles: same.slice(0, 3), resultingMeldTiles: [...same.slice(0, 3), tileId] };
}

function getChiOptions(seat, tileId) {
  const type = tileType(tileId);
  if (type >= 27) return [];
  const rank0 = type % 9;
  const suitBase = type - rank0;
  const hand = state.players[seat].hand;
  const findOne = (t) => hand.find((id) => tileType(id) === t);
  const options = [];
  const patterns = [
    [rank0 - 2, rank0 - 1], // 自分が最大 (低,低+1) + 呼ばれた牌
    [rank0 - 1, rank0 + 1], // 自分が中 (低) + (高) + 呼ばれた牌
    [rank0 + 1, rank0 + 2], // 自分が最小 + (高,高+1)
  ];
  for (const [a, b] of patterns) {
    if (a < 0 || b > 8) continue;
    const idA = findOne(suitBase + a);
    const idB = findOne(suitBase + b);
    if (idA !== undefined && idB !== undefined) {
      options.push({ kind: 'chi', tiles: [idA, idB], resultingMeldTiles: sortTilesByType([idA, idB, tileId]) });
    }
  }
  return options;
}

function getAnkanOptions(hand) {
  const counts = toCounts(hand);
  const options = [];
  for (let t = 0; t < TILE_TYPE_COUNT; t++) {
    if (counts[t] === 4) {
      const tiles = hand.filter((id) => tileType(id) === t);
      options.push({ kind: 'ankan', type: t, tiles });
    }
  }
  return options;
}

function getKakanOptions(hand, melds) {
  const options = [];
  melds.forEach((m, meldIndex) => {
    if (m.kind !== 'pon') return;
    const type = tileType(m.tiles[0]);
    const extra = hand.find((id) => tileType(id) === type);
    if (extra !== undefined) options.push({ kind: 'kakan', meldIndex, type, tiles: [extra] });
  });
  return options;
}

// ---------------------------------------------------------------------------
// 人間の入力待ち（Promiseベース）／自動モードではAIが即答する
// ---------------------------------------------------------------------------

function waitForHumanDiscard(riichiTiles) {
  selectedTile = null;
  render({ discardable: riichiTiles || state.players[0].hand.slice() });
  return new Promise((resolve) => { discardResolver = resolve; });
}

// 誤タップ防止のため、1回目のタップでは牌を選んで浮かせるだけにし、
// 選んでいる牌をもう一度タップしたときに捨てる。
function onHandTileClick(tileId) {
  if (!discardResolver) return;
  if (selectedTile !== tileId) {
    selectedTile = tileId;
    for (const btn of el('mj-human-hand').children) {
      btn.classList.toggle('mj-tile--selected', Number(btn.dataset.tile) === tileId);
    }
    return;
  }
  selectedTile = null;
  const r = discardResolver;
  discardResolver = null;
  r(tileId);
}

// promptText: 文字列、または文字列と { tile: 牌ID } を並べた配列（牌は絵で表示する）
// choices: { label, value, meld? }。meld があるときは鳴いた後の副露の形をボタンに絵で添える
function askHuman(promptText, choices) {
  return new Promise((resolve) => {
    promptResolver = resolve;
    renderPrompt(promptText, choices);
  });
}

function onPromptChoice(value) {
  if (promptResolver) {
    const r = promptResolver;
    promptResolver = null;
    clearPrompt();
    r(value);
  }
}

async function waitForContinue(message) {
  if (CONFIG.autoHuman) { await sleep(50); return; }
  await askHuman(message + '（続けるにはボタンを押してください）', [{ label: '次へ', value: true }]);
}

// ---------------------------------------------------------------------------
// 打牌選択・リーチ判定
// ---------------------------------------------------------------------------

function riichiEligible(seat) {
  const player = state.players[seat];
  if (player.riichi) return false;
  if (player.melds.some((m) => m.kind !== 'ankan')) return false; // 副露があれば不可(暗槓は可)
  if (player.score < 1000) return false;
  if (state.wall.length - state.wallIndex < 4) return false;
  const meldCount = player.melds.length;
  return player.hand.some((id) => {
    const remaining = player.hand.filter((x) => x !== id);
    return computeShanten(toCounts(remaining), meldCount) === 0;
  });
}

function tenpaiPreservingTiles(seat) {
  const player = state.players[seat];
  const meldCount = player.melds.length;
  return player.hand.filter((id) => {
    const remaining = player.hand.filter((x) => x !== id);
    return computeShanten(toCounts(remaining), meldCount) === 0;
  });
}

async function getDiscard(seat) {
  const player = state.players[seat];
  const isHuman = seat === 0 && !CONFIG.autoHuman;

  if (player.riichi) {
    // リーチ中はツモ切り固定
    return state.lastDrawnTile.tile;
  }

  const eligible = riichiEligible(seat);
  let wantsRiichi = false;

  if (isHuman) {
    if (eligible) {
      wantsRiichi = await askHuman('リーチしますか？', [{ label: 'リーチ', value: true }, { label: 'リーチしない', value: false }]);
    }
    const pool = wantsRiichi ? tenpaiPreservingTiles(seat) : null;
    const tile = await waitForHumanDiscard(pool);
    if (wantsRiichi) await declareRiichi(seat);
    return tile;
  }

  // CPU / 自動人間
  await sleep(thinkDelay());
  const ctx = buildAiContext(seat);
  const tile = chooseDiscard(player.hand, player.melds, CONFIG.cpuLevel, CONFIG.readingDepth, ctx);
  if (eligible) {
    // 打牌後も聴牌しているときだけ、リーチするかを判断する
    const rest = player.hand.filter((x) => x !== tile);
    if (computeShanten(toCounts(rest), player.melds.length) === 0
        && decideRiichi(CONFIG.cpuLevel, rest, player.melds, ctx)) {
      await declareRiichi(seat);
    }
  }
  return tile;
}

async function declareRiichi(seat) {
  const player = state.players[seat];
  player.riichi = true;
  player.riichiTurn = player.discards.length + 1; // 宣言牌はこれから河に出る
  player.ippatsuWindow = true;
  player.score -= 1000;
  state.kyotaku += 1;
  pushLog(`${seatLabel(seat)}がリーチ`);
  await announceCall(seat, 'リーチ', null);
}

// 鳴き・槓・リーチの宣言を、宣言した人の河の上に表示する（次の人がツモるまで残す）。
// CPUの場合は、見落とさないよう少し待ってから次の動作に進む。
// meldIndex: その宣言でできた副露の位置（副露を枠で囲む）。リーチは null。
async function announceCall(seat, text, meldIndex) {
  state.callAnnounce = { seat, text, meldIndex };
  if (seat === 0 && !CONFIG.autoHuman) return; // 自分の宣言は待たずに進める（次の描画で表示される）
  render();
  await sleep(announceDelay());
}

// ---------------------------------------------------------------------------
// 槓の判断
// ---------------------------------------------------------------------------

async function maybeDeclareKan(seat) {
  const player = state.players[seat];
  if (player.riichi) return null; // リーチ後の槓（既存手牌そのままの暗槓のみ本来は可だが、v1では簡略化し不可とする）
  const ankanOpts = getAnkanOptions(player.hand);
  const kakanOpts = getKakanOptions(player.hand, player.melds);
  const options = [...ankanOpts, ...kakanOpts];
  if (options.length === 0) return null;

  const isHuman = seat === 0 && !CONFIG.autoHuman;
  if (isHuman) {
    const choices = options.map((o, i) => ({
      label: o.kind === 'ankan' ? '暗槓' : '加槓',
      value: i,
      meld: o.kind === 'ankan'
        ? { kind: 'ankan', tiles: o.tiles, calledTile: null, calledFrom: null }
        : Object.assign({}, player.melds[o.meldIndex], { kind: 'kakan', tiles: [...player.melds[o.meldIndex].tiles, ...o.tiles] }),
    }));
    choices.push({ label: '槓しない', value: -1 });
    const choice = await askHuman('槓できます', choices);
    return choice === -1 ? null : options[choice];
  }

  await sleep(thinkDelay());
  return decideKan(options, player.hand, player.melds, CONFIG.cpuLevel, buildAiContext(seat));
}

async function performKan(seat, kanOption) {
  const player = state.players[seat];
  if (kanOption.kind === 'ankan') {
    removeIdsFromHand(seat, kanOption.tiles);
    player.melds.push({ kind: 'ankan', tiles: kanOption.tiles, calledTile: null, calledFrom: null });
    state.kifuLines.push(kifuCall(seat, 'ankan', kanOption.tiles, seat));
    breakAllIppatsu();
    revealNewDora();
    pushLog(`${seatLabel(seat)}が暗槓`);
    await announceCall(seat, 'カン', player.melds.length - 1);
    return false;
  }
  // kakan
  removeIdsFromHand(seat, kanOption.tiles);
  const meld = player.melds[kanOption.meldIndex];
  const chankanTile = kanOption.tiles[0];

  const chankanSeats = [];
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    if (canRon(s, chankanTile)) chankanSeats.push(s);
  }
  if (chankanSeats.length > 0) {
    const decisions = await Promise.all(chankanSeats.map((s) => askRon(s, chankanTile, seat)));
    const takers = chankanSeats.filter((s, i) => decisions[i]);
    if (takers.length > 0) {
      // 槍槓: 加槓自体は成立させず、牌を差し戻す
      addToHand(seat, chankanTile);
      return { seats: takers, tile: chankanTile };
    }
  }

  meld.kind = 'kakan';
  meld.tiles = [...meld.tiles, chankanTile];
  state.kifuLines.push(kifuCall(seat, 'kakan', meld.tiles, seat));
  breakAllIppatsu();
  revealNewDora();
  pushLog(`${seatLabel(seat)}が加槓`);
  await announceCall(seat, 'カン', kanOption.meldIndex);
  return false;
}

// ---------------------------------------------------------------------------
// 他家の反応（ロン／ポン・カン／チー）
// ---------------------------------------------------------------------------

async function askRon(seat, tileId, fromSeat) {
  if (seat === 0 && !CONFIG.autoHuman) {
    return await askHuman([`${seatLabel(fromSeat)}の`, { tile: tileId }, 'にロンできます'], [{ label: 'ロン', value: true }, { label: '見送る', value: false }]);
  }
  await sleep(thinkDelay());
  return cpuTakesWin(seat, tileId, 'ron', fromSeat);
}

async function askPonKan(seat, ponOpt, kanOpt, tileId, fromSeat) {
  const isHuman = seat === 0 && !CONFIG.autoHuman;
  if (isHuman) {
    const choices = [];
    if (ponOpt) choices.push({ label: 'ポン', value: 'pon', meld: callPreviewMeld(ponOpt, tileId, fromSeat) });
    if (kanOpt) choices.push({ label: 'カン', value: 'kan', meld: callPreviewMeld(kanOpt, tileId, fromSeat) });
    choices.push({ label: 'しない', value: null });
    const choice = await askHuman([`${seatLabel(fromSeat)}の`, { tile: tileId }, 'にポン/カンできます'], choices);
    if (choice === 'pon') return ponOpt;
    if (choice === 'kan') return kanOpt;
    return null;
  }
  await sleep(thinkDelay());
  const options = [ponOpt, kanOpt].filter(Boolean);
  return decideCall(options, state.players[seat].hand, state.players[seat].melds, CONFIG.cpuLevel, buildAiContext(seat));
}

async function askChi(seat, options, tileId, fromSeat) {
  const isHuman = seat === 0 && !CONFIG.autoHuman;
  if (isHuman) {
    const choices = options.map((o, i) => ({ label: 'チー', value: i, meld: callPreviewMeld(o, tileId, fromSeat) }));
    choices.push({ label: 'しない', value: -1 });
    const choice = await askHuman([`${seatLabel(fromSeat)}の`, { tile: tileId }, 'にチーできます'], choices);
    return choice === -1 ? null : options[choice];
  }
  await sleep(thinkDelay());
  return decideCall(options, state.players[seat].hand, state.players[seat].melds, CONFIG.cpuLevel, buildAiContext(seat));
}

// 鳴きの選択肢に添える「鳴いた後の副露」。performCall で作る副露と同じ形にする
function callPreviewMeld(call, tileId, fromSeat) {
  return { kind: call.kind, tiles: call.resultingMeldTiles, calledTile: tileId, calledFrom: fromSeat };
}

async function offerReactions(discarderSeat, tileId) {
  const ronSeats = [];
  for (let offset = 1; offset < 4; offset++) {
    const s = (discarderSeat + offset) % 4;
    if (canRon(s, tileId)) ronSeats.push(s);
  }
  if (ronSeats.length > 0) {
    const decisions = await Promise.all(ronSeats.map((s) => askRon(s, tileId, discarderSeat)));
    const takers = ronSeats.filter((s, i) => decisions[i]);
    if (takers.length > 0) return { type: 'ron', seats: takers };
    // ロンを見送った場合は一時フリテン
    for (const s of ronSeats) state.players[s].furitenTemp = true;
  }

  for (let offset = 1; offset < 4; offset++) {
    const s = (discarderSeat + offset) % 4;
    const ponOpt = getPonOption(s, tileId);
    const kanOpt = getMinkanOption(s, tileId);
    if (ponOpt || kanOpt) {
      const decision = await askPonKan(s, ponOpt, kanOpt, tileId, discarderSeat);
      if (decision) return { type: 'call', seat: s, call: decision };
    }
  }

  const shimocha = (discarderSeat + 1) % 4;
  const chiOpts = getChiOptions(shimocha, tileId);
  if (chiOpts.length > 0) {
    const decision = await askChi(shimocha, chiOpts, tileId, discarderSeat);
    if (decision) return { type: 'call', seat: shimocha, call: decision };
  }

  return { type: 'none' };
}

async function performCall(seat, call, fromSeat, tileId) {
  const meld = { kind: call.kind, tiles: call.resultingMeldTiles, calledTile: tileId, calledFrom: fromSeat };
  removeIdsFromHand(seat, call.tiles);
  state.players[seat].melds.push(meld);
  const lastDiscard = state.players[fromSeat].discards[state.players[fromSeat].discards.length - 1];
  if (lastDiscard) {
    lastDiscard.calledBy = seat;
    if (lastDiscard.sideways) state.players[fromSeat].riichiSidewaysPending = true;
  }
  state.kifuLines.push(kifuCall(seat, call.kind, meld.tiles, fromSeat));
  breakAllIppatsu();
  if (call.kind === 'minkan') revealNewDora();
  const callText = call.kind === 'pon' ? 'ポン' : call.kind === 'chi' ? 'チー' : 'カン';
  pushLog(`${seatLabel(seat)}が${callText}（${seatLabel(fromSeat)}の${tileLabel(tileId)}）`);
  await announceCall(seat, callText, state.players[seat].melds.length - 1);
}

// ---------------------------------------------------------------------------
// 打牌フェーズ（槓判定 → 打牌 → 反応待ち）
// ---------------------------------------------------------------------------

async function discardPhase(seat) {
  const kan = await maybeDeclareKan(seat);
  if (kan) {
    const chankan = await performKan(seat, kan);
    render();
    if (chankan) return { result: 'ron', seats: chankan.seats, fromSeat: seat, tile: chankan.tile };
    const rtile = drawFromRinshan();
    if (rtile === null) return { result: 'ryuukyoku' };
    state.lastDrawnTile = { seat, tile: rtile };
    addToHand(seat, rtile);
    state.kifuLines.push(kifuDraw(seat, rtile));
    render();
    if (canTsumo(seat)) {
      const take = (seat === 0 && !CONFIG.autoHuman)
        ? await askHuman('嶺上ツモできます', [{ label: 'ツモ', value: true }, { label: '見送る', value: false }])
        : cpuTakesWin(seat, state.lastDrawnTile.tile, 'tsumo', seat);
      if (take) return { result: 'tsumo', seat };
    }
    return await discardPhase(seat);
  }

  const player = state.players[seat];
  const wasRiichi = player.riichi;
  const discardTile = await getDiscard(seat);
  removeIdsFromHand(seat, [discardTile]);
  const tsumogiri = state.lastDrawnTile && state.lastDrawnTile.seat === seat && state.lastDrawnTile.tile === discardTile;
  // リーチ宣言牌は河に横向きで置く。宣言牌が鳴かれた場合は次の捨て牌を横向きにする(実卓の慣習)。
  const sideways = (!wasRiichi && player.riichi) || player.riichiSidewaysPending;
  player.riichiSidewaysPending = false;
  // order: 局の中で何枚目の打牌か（リーチ後に通った牌をCPUが読むため）
  player.discards.push({ tile: discardTile, tsumogiri, calledBy: null, sideways, order: state.discardCount++ });
  state.lastDiscardSeat = seat;
  state.kifuLines.push(kifuDiscard(seat, discardTile, tsumogiri));
  updateFuriten(seat);
  recordTenpaiTurn(seat);
  render();

  const reaction = await offerReactions(seat, discardTile);
  if (reaction.type === 'ron') return { result: 'ron', seats: reaction.seats, fromSeat: seat, tile: discardTile };
  if (reaction.type === 'call') return { result: 'call', seat: reaction.seat, call: reaction.call, fromSeat: seat, tile: discardTile };
  return { result: 'next' };
}

async function takeTurn(seat) {
  state.callAnnounce = null; // 次の人がツモったら宣言の表示は消す
  const tile = drawFromWall();
  if (tile === null) return { result: 'ryuukyoku' };
  state.lastDrawnTile = { seat, tile };
  addToHand(seat, tile);
  state.kifuLines.push(kifuDraw(seat, tile));
  render();

  if (canTsumo(seat)) {
    const take = (seat === 0 && !CONFIG.autoHuman)
      ? await askHuman('ツモできます', [{ label: 'ツモ', value: true }, { label: '見送る', value: false }])
      : cpuTakesWin(seat, state.lastDrawnTile.tile, 'tsumo', seat);
    if (take) {
      const wasIppatsu = state.players[seat].ippatsuWindow;
      if (state.players[seat].riichi) state.players[seat].ippatsuWindow = false;
      state.players[seat]._usedIppatsu = wasIppatsu;
      return { result: 'tsumo', seat };
    }
  }
  if (state.players[seat].riichi) state.players[seat].ippatsuWindow = false;

  return await discardPhase(seat);
}

async function takeTurnAfterCall(seat) {
  return await discardPhase(seat);
}

async function takeTurnAfterKanCall(seat) {
  const rtile = drawFromRinshan();
  if (rtile === null) return { result: 'ryuukyoku' };
  state.lastDrawnTile = { seat, tile: rtile };
  addToHand(seat, rtile);
  state.kifuLines.push(kifuDraw(seat, rtile));
  render();
  if (canTsumo(seat)) {
    const take = (seat === 0 && !CONFIG.autoHuman)
      ? await askHuman('嶺上ツモできます', [{ label: 'ツモ', value: true }, { label: '見送る', value: false }])
      : cpuTakesWin(seat, state.lastDrawnTile.tile, 'tsumo', seat);
    if (take) return { result: 'tsumo', seat };
  }
  return await discardPhase(seat);
}

// ---------------------------------------------------------------------------
// 局の決着
// ---------------------------------------------------------------------------

function seatLabel(seat) { return seat === 0 ? 'あなた' : `CPU${seat}`; }

function pushLog(text) {
  state.eventLog.push(text);
  renderLog();
}

function finishKyoku(repeatDealer, resetHonba) {
  state.honba = resetHonba ? 0 : state.honba + 1;
  if (!repeatDealer) {
    state.oya = (state.oya + 1) % 4;
    state.kyoku += 1;
  }
  if (state.players.some((p) => p.score < 0)) state.gameOver = true;
  if (state.kyoku > 4) state.gameOver = true;
}

async function settleTsumo(seat) {
  const player = state.players[seat];
  const ctx = buildWinContext(seat, state.lastDrawnTile.tile, 'tsumo');
  const result = evaluateWin(ctx);
  const isDealer = seat === state.oya;
  const payments = computePayments(result.basePoints, isDealer, 'tsumo', state.honba);

  let total = 0;
  const deltas = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const pay = isDealer ? payments.fromEach : (s === state.oya ? payments.fromDealer : payments.fromNonDealer);
    state.players[s].score -= pay;
    deltas[s] -= pay;
    total += pay;
  }
  const kyotakuBonus = state.kyotaku * 1000;
  const totalGain = total + kyotakuBonus;
  player.score += totalGain;
  deltas[seat] = totalGain;
  state.kyotaku = 0;

  state.kifuLines.push(kifuAgari({
    who: seat, fromWho: seat, handTiles: player.hand, melds: player.melds,
    machi: state.lastDrawnTile.tile, fu: result.fu, points: total, limitName: result.limitName,
    yakuList: result.yaku, doraHan: result.doraHan, akaHan: result.akaHan, uraDoraHan: result.uraDoraHan,
    scoreDeltas: deltas,
  }));

  pushLog(`${seatLabel(seat)}がツモ和了（${result.han}翻${result.fu}符 ${totalGain}点）`);
  state.reveal = { winners: [seat], winTile: state.lastDrawnTile.tile };
  renderHandResult({ seats: [seat], result, total: totalGain, method: 'ツモ', tile: state.lastDrawnTile.tile });
  await waitForContinue('局が終了しました');
  finishKyoku(isDealer, !isDealer);
}

async function settleRon(outcome) {
  const deltas = [0, 0, 0, 0];
  const results = [];
  // 供託は放銃者に最も近い(下家側の)和了者が総取り
  const priority = outcome.seats.slice().sort((a, b) => {
    const da = (a - outcome.fromSeat + 4) % 4;
    const db = (b - outcome.fromSeat + 4) % 4;
    return da - db;
  });
  let kyotakuGiven = false;

  for (const seat of outcome.seats) {
    const ctx = buildWinContext(seat, outcome.tile, 'ron');
    const result = evaluateWin(ctx);
    const isDealer = seat === state.oya;
    const payments = computePayments(result.basePoints, isDealer, 'ron', state.honba);
    state.players[outcome.fromSeat].score -= payments.total;
    deltas[outcome.fromSeat] -= payments.total;
    let gain = payments.total;
    if (!kyotakuGiven && seat === priority[0]) { gain += state.kyotaku * 1000; kyotakuGiven = true; }
    state.players[seat].score += gain;
    deltas[seat] += gain;
    results.push({ seat, result, points: payments.total });

    state.kifuLines.push(kifuAgari({
      who: seat, fromWho: outcome.fromSeat, handTiles: state.players[seat].hand, melds: state.players[seat].melds,
      machi: outcome.tile, fu: result.fu, points: payments.total, limitName: result.limitName,
      yakuList: result.yaku, doraHan: result.doraHan, akaHan: result.akaHan, uraDoraHan: result.uraDoraHan,
      scoreDeltas: deltas,
    }));
    pushLog(`${seatLabel(seat)}がロン和了（${result.han}翻${result.fu}符 ${payments.total}点、${seatLabel(outcome.fromSeat)}から）`);
  }
  state.kyotaku = 0;
  state.reveal = { winners: outcome.seats, winTile: outcome.tile };

  renderHandResult({ seats: outcome.seats, results, method: 'ロン', fromSeat: outcome.fromSeat, tile: outcome.tile });
  await waitForContinue('局が終了しました');
  const dealerWon = outcome.seats.includes(state.oya);
  finishKyoku(dealerWon, !dealerWon);
}

async function settleRyuukyoku() {
  const tenpaiSeats = [];
  for (let s = 0; s < 4; s++) {
    const p = state.players[s];
    if (computeShanten(toCounts(p.hand), p.melds.length) === 0) tenpaiSeats.push(s);
  }
  const noten = 4 - tenpaiSeats.length;
  const deltas = [0, 0, 0, 0];
  if (tenpaiSeats.length > 0 && noten > 0) {
    const gainPerTenpai = 3000 / tenpaiSeats.length;
    const payPerNoten = 3000 / noten;
    for (let s = 0; s < 4; s++) {
      if (tenpaiSeats.includes(s)) { state.players[s].score += gainPerTenpai; deltas[s] += gainPerTenpai; }
      else { state.players[s].score -= payPerNoten; deltas[s] -= payPerNoten; }
    }
  }
  state.kifuLines.push(kifuRyuukyoku({ kyoku: state.kyoku, honba: state.honba, scoreDeltas: deltas, tenpaiSeats }));
  pushLog(`流局（聴牌: ${tenpaiSeats.map(seatLabel).join('、') || 'なし'}）`);
  state.reveal = { winners: [], winTile: null };
  renderHandResult({ ryuukyoku: true, tenpaiSeats });
  await waitForContinue('流局しました');
  const dealerTenpai = tenpaiSeats.includes(state.oya);
  finishKyoku(dealerTenpai, false);
}

// ---------------------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------------------

async function playHand() {
  setupHand();
  hideBanner();
  render();
  let seat = state.oya;
  let outcome = await takeTurn(seat);
  for (;;) {
    if (outcome.result === 'ryuukyoku') { await settleRyuukyoku(); return; }
    if (outcome.result === 'tsumo') { await settleTsumo(outcome.seat); return; }
    if (outcome.result === 'ron') { await settleRon(outcome); return; }
    if (outcome.result === 'call') {
      await performCall(outcome.seat, outcome.call, outcome.fromSeat, outcome.tile);
      render();
      seat = outcome.seat;
      outcome = (outcome.call.kind === 'minkan') ? await takeTurnAfterKanCall(seat) : await takeTurnAfterCall(seat);
      continue;
    }
    seat = (seat + 1) % 4;
    outcome = await takeTurn(seat);
  }
}

async function runMatch() {
  initMatch();
  while (!state.gameOver) {
    await playHand();
  }
  render();
  const text = buildKifuText(state.kifuLines.concat([kifuFooter()]));
  renderFinalResult(text);
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

function renderPrompt(promptText, choices) {
  const box = el('mj-prompt');
  box.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'mj-prompt-text';
  const parts = Array.isArray(promptText) ? promptText : [promptText];
  for (const part of parts) {
    if (typeof part === 'string') p.appendChild(document.createTextNode(part));
    else p.appendChild(makeTile(part.tile, { classes: ['mj-prompt-target'] }));
  }
  box.appendChild(p);
  const row = document.createElement('div');
  row.className = 'mj-prompt-buttons';
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = c.label;
    if (c.meld) {
      btn.classList.add('mj-prompt-call');
      btn.appendChild(buildMeldElement(c.meld, 0));
    }
    btn.addEventListener('click', () => onPromptChoice(c.value));
    row.appendChild(btn);
  }
  box.appendChild(row);
  box.hidden = false;
}

function clearPrompt() {
  const box = el('mj-prompt');
  box.innerHTML = '';
  box.hidden = true;
}

// 牌1枚分の要素を作る。牌の大きさは親要素のCSS変数 --tw で決まる。
// opts.tag: 'span'(既定) か 'button' / opts.side: 横向き / opts.classes: 追加クラス
function makeTile(id, opts) {
  const o = opts || {};
  const node = document.createElement(o.tag || 'span');
  if (o.tag === 'button') node.type = 'button';
  const cls = ['mj-tile'];
  if (o.side) cls.push('mj-tile--side');
  if (o.classes) cls.push(...o.classes);
  node.className = cls.join(' ');
  node.setAttribute('aria-label', tileLabel(id));
  node.appendChild(buildTileArt(id));
  return node;
}

function makeBackTile() {
  const node = document.createElement('span');
  node.className = 'mj-tile mj-tile--back';
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// 自分の手牌。ツモ直後(14枚目がある状態)は、ツモった牌を右端に少し離して置く。
function renderHandRow(containerId, tiles, opts) {
  const box = el(containerId);
  box.innerHTML = '';
  const drawn = state.lastDrawnTile;
  let ordered = tiles;
  let drawnId = null;
  if (drawn && drawn.seat === 0 && tiles.length % 3 === 2 && tiles.includes(drawn.tile)) {
    drawnId = drawn.tile;
    ordered = tiles.filter((id) => id !== drawnId).concat([drawnId]);
  }
  const discardable = opts && opts.discardable;
  for (const id of ordered) {
    const classes = [];
    if (id === drawnId) classes.push('mj-tile--drawn');
    const enabled = Boolean(discardable && discardable.includes(id));
    if (discardable && !enabled) classes.push('mj-tile--locked');
    if (enabled && id === selectedTile) classes.push('mj-tile--selected');
    const btn = makeTile(id, { tag: 'button', classes });
    btn.dataset.tile = String(id);
    btn.disabled = !enabled;
    if (enabled) btn.addEventListener('click', () => onHandTileClick(id));
    box.appendChild(btn);
  }
  box.parentElement.classList.toggle('mj-hand-area--turn', Boolean(discardable));
}

// 河は実卓と同じく 6枚・6枚・残り全部 の3段で並べる。
function renderPond(containerId, discards, isLastDiscarder) {
  const box = el(containerId);
  box.innerHTML = '';
  const rows = [discards.slice(0, 6), discards.slice(6, 12), discards.slice(12)];
  rows.forEach((rowDiscards, r) => {
    if (rowDiscards.length === 0) return;
    const row = document.createElement('div');
    row.className = 'mj-pond-row';
    rowDiscards.forEach((d, i) => {
      const isLast = isLastDiscarder && r * 6 + i === discards.length - 1 && d.calledBy === null;
      const classes = [];
      if (d.tsumogiri) classes.push('mj-tile--tsumogiri');
      if (d.calledBy !== null) classes.push('mj-tile--called');
      if (isLast) classes.push('mj-tile--last');
      row.appendChild(makeTile(d.tile, { side: d.sideways, classes }));
    });
    box.appendChild(row);
  });
}

// 鳴いた牌を「誰から鳴いたか」がわかる位置に横向きで置く（実卓の置き方）。
//   上家から → 左端 / 対面から → 左から2枚目 / 下家から → 右端
// 暗槓は両端を裏向き、加槓は横向きの牌の上に足した牌を重ねる。
function buildMeldElement(meld, seat) {
  const wrap = document.createElement('span');
  wrap.className = 'mj-meld';
  wrap.setAttribute('aria-label', meldKindLabel(meld.kind));

  if (meld.kind === 'ankan') {
    wrap.appendChild(makeBackTile());
    wrap.appendChild(makeTile(meld.tiles[1]));
    wrap.appendChild(makeTile(meld.tiles[2]));
    wrap.appendChild(makeBackTile());
    return wrap;
  }

  const tiles = meld.tiles.slice();
  let addedTile = null;
  if (meld.kind === 'kakan') addedTile = tiles.pop();
  const calledIdx = tiles.indexOf(meld.calledTile);
  const others = tiles.filter((_, i) => i !== calledIdx);

  let called;
  if (addedTile !== null) {
    called = document.createElement('span');
    called.className = 'mj-tile-stack';
    called.appendChild(makeTile(addedTile, { side: true }));
    called.appendChild(makeTile(meld.calledTile, { side: true }));
  } else {
    called = makeTile(meld.calledTile, { side: true });
  }

  const relative = (meld.calledFrom - seat + 4) % 4; // 1=下家 2=対面 3=上家
  const pos = relative === 3 ? 0 : relative === 2 ? 1 : others.length;
  const nodes = others.map((t) => makeTile(t));
  nodes.splice(pos, 0, called);
  for (const n of nodes) wrap.appendChild(n);
  return wrap;
}

function meldKindLabel(kind) {
  switch (kind) {
    case 'pon': return 'ポン';
    case 'chi': return 'チー';
    case 'minkan': return '明槓';
    case 'ankan': return '暗槓';
    case 'kakan': return '加槓';
    default: return kind;
  }
}

function renderMelds(containerId, melds, seat) {
  const box = el(containerId);
  box.innerHTML = '';
  const a = state.callAnnounce;
  melds.forEach((m, i) => {
    const meldEl = buildMeldElement(m, seat);
    // 今鳴いたばかりの副露は枠で囲み、どこに増えたかわかるようにする
    if (a && a.seat === seat && a.meldIndex === i) meldEl.classList.add('mj-meld--new');
    box.appendChild(meldEl);
  });
}

function renderCallAnnounce() {
  const box = el('mj-call');
  const a = state.callAnnounce;
  box.hidden = !a;
  box.className = a ? `mj-call mj-call--seat-${a.seat}` : 'mj-call';
  box.innerHTML = '';
  if (!a) return;
  const who = document.createElement('span');
  who.className = 'mj-call-who';
  who.textContent = seatLabel(a.seat);
  const what = document.createElement('span');
  what.className = 'mj-call-what';
  what.textContent = a.text;
  box.append(who, what);
}

// CPUの手牌は裏向きで枚数分並べる。ツモ直後はツモ牌を少し離す。
function renderBacks(containerId, count, justDrew) {
  const box = el(containerId);
  box.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const back = makeBackTile();
    if (justDrew && i === count - 1) back.classList.add('mj-tile--drawn');
    box.appendChild(back);
  }
}

function renderInfo() {
  // 対局終了時は kyoku が5になるので、表示は東4局で止める
  el('mj-round').textContent = `東${Math.min(state.kyoku, 4)}局`;
  el('mj-round-sub').textContent = `${state.honba}本場・供託${state.kyotaku}`;
  el('mj-wall-count').textContent = `残り ${Math.max(0, state.wall.length - state.wallIndex)}枚`;

  // ドラ表示牌は5枚分の枠を置き、まだめくられていない分は裏向きにする
  const dora = el('mj-dora');
  dora.innerHTML = '';
  state.doraIndicators.forEach((id, i) => {
    dora.appendChild(i < state.doraRevealed ? makeTile(id) : makeBackTile());
  });

  for (let s = 0; s < 4; s++) {
    const p = state.players[s];
    const wind = el(`mj-wind-${s}`);
    wind.textContent = tileTypeLabel(seatWindType(s));
    wind.classList.toggle('mj-plate-wind--oya', s === state.oya);
    wind.title = s === state.oya ? '親' : '';
    el(`mj-score-${s}`).textContent = String(p.score);
    seatElement(s).classList.toggle('mj-seat--riichi', p.riichi);
  }
}

function seatElement(seat) {
  return document.querySelector(`.mj-seat[data-seat="${seat}"]`);
}

function renderCpu(seat) {
  const p = state.players[seat];
  const justDrew = Boolean(state.lastDrawnTile && state.lastDrawnTile.seat === seat && p.hand.length % 3 === 2);
  renderBacks(`mj-cpu-${seat}-hand`, p.hand.length, justDrew);
  renderPond(`mj-cpu-${seat}-pond`, p.discards, state.lastDiscardSeat === seat);
  renderMelds(`mj-cpu-${seat}-melds`, p.melds, seat);
}

// 今の手番（直前に牌を引いた席）を卓上で目立たせ、初めて見る人でも
// 「今どこが動いているか」がひと目でわかるようにする。
function renderActiveSeat() {
  const activeSeat = state.lastDrawnTile ? state.lastDrawnTile.seat : null;
  for (let s = 0; s < 4; s++) {
    seatElement(s).classList.toggle('mj-seat--active', s === activeSeat);
  }
}

function render(opts) {
  if (!state) return;
  renderInfo();
  renderHandRow('mj-human-hand', state.players[0].hand, opts);
  renderPond('mj-human-pond', state.players[0].discards, state.lastDiscardSeat === 0);
  renderMelds('mj-human-melds', state.players[0].melds, 0);
  for (let s = 1; s < 4; s++) renderCpu(s);
  renderActiveSeat();
  renderCallAnnounce();
  renderAssist();
}

// ---------------------------------------------------------------------------
// 補助情報（向聴数・待ち牌の残り枚数・和了時の役と翻）
// 計算は assist.js。ここでは今の局面を渡して結果を手牌の下に並べる。
// ---------------------------------------------------------------------------

const ASSIST_STORAGE_KEY = 'mj-assist-visible';

function loadAssistVisible() {
  try {
    return localStorage.getItem(ASSIST_STORAGE_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

function saveAssistVisible(visible) {
  try {
    localStorage.setItem(ASSIST_STORAGE_KEY, visible ? '1' : '0');
  } catch (e) {
    // 保存できない環境（プライベートブラウズ等）では毎回既定の「表示」に戻るだけ
  }
}

// 和了したときの評価を「3翻40符 満貫（リーチ・タンヤオ・ドラ1）」の形の文字列にする
function assistWinText(r) {
  if (!r) return '役なし';
  const names = r.yaku.map((y) => y[0]);
  if (r.isYakuman) return `${r.limitName}（${names.join('・')}）`;
  if (r.doraHan > 0) names.push(`ドラ${r.doraHan}`);
  if (r.akaHan > 0) names.push(`赤${r.akaHan}`);
  const limit = r.limitName ? ` ${r.limitName}` : '';
  return `${r.han}翻${r.fu}符${limit}（${names.join('・')}）`;
}

function assistLine(parent, className, text) {
  const node = document.createElement('p');
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

// 待ち牌の一覧。1行 = 待ち牌1種（牌・残り枚数・ロン/ツモ時の役と翻）
function buildAssistWaitList(waits, visibleCounts) {
  const list = document.createElement('ul');
  list.className = 'mj-assist-waits';
  for (const w of waits) {
    const li = document.createElement('li');
    li.className = 'mj-assist-wait';
    const head = document.createElement('span');
    head.className = 'mj-assist-wait-head';
    head.appendChild(makeTile(w.type * 4 + 1));
    const left = document.createElement('span');
    left.className = 'mj-assist-left';
    left.textContent = `残り${Math.max(0, 4 - visibleCounts[w.type])}枚`;
    head.appendChild(left);
    li.appendChild(head);
    const detail = document.createElement('span');
    detail.className = 'mj-assist-wait-detail';
    assistLine(detail, '', `ロン: ${assistWinText(w.ron)}`);
    assistLine(detail, '', `ツモ: ${assistWinText(w.tsumo)}`);
    li.appendChild(detail);
    list.appendChild(li);
  }
  return list;
}

function assistRemaining(waits, visibleCounts) {
  return waits.reduce((sum, w) => sum + Math.max(0, 4 - visibleCounts[w.type]), 0);
}

function assistShantenText(shanten) {
  return shanten === 0 ? '聴牌' : `${shanten}向聴`;
}

function renderAssist() {
  const box = el('mj-assist');
  const visible = el('mj-assist-toggle').checked;
  box.hidden = !visible;
  box.innerHTML = '';
  if (!visible) return;

  const player = state.players[0];
  const doraIndicators = state.doraIndicators.slice(0, state.doraRevealed);
  const info = analyzeHandAssist(player.hand, {
    melds: player.melds,
    seatWindType: seatWindType(0),
    roundWindType: state.roundWindType,
    isDealer: state.oya === 0,
    riichi: player.riichi,
    doraIndicators,
  });
  const visibleCounts = countVisibleTypes(
    player.hand,
    state.players.map((p) => p.discards),
    state.players.map((p) => p.melds),
    doraIndicators
  );
  const ownDiscardTypes = player.discards.map((d) => tileType(d.tile));
  const isFuriten = (waits, extraType) => waits.some((w) => w.type === extraType || ownDiscardTypes.includes(w.type));

  if (info.phase === 'wait') {
    if (info.shanten > 0) {
      assistLine(box, 'mj-assist-summary', assistShantenText(info.shanten));
      return;
    }
    let summary = `聴牌　待ち${info.waits.length}種・残り${assistRemaining(info.waits, visibleCounts)}枚`;
    if (player.furitenTemp || isFuriten(info.waits, null)) summary += '　フリテン（ロン不可）';
    assistLine(box, 'mj-assist-summary', summary);
    box.appendChild(buildAssistWaitList(info.waits, visibleCounts));
    return;
  }

  // 打牌前（14枚）: 一番良い打牌をしたあとの向聴数と、聴牌になる打牌ごとの待ち
  if (info.complete) assistLine(box, 'mj-assist-summary', '和了形です');
  if (info.options.length === 0) {
    assistLine(box, 'mj-assist-summary', `打牌後 ${assistShantenText(info.shanten)}`);
    return;
  }
  assistLine(box, 'mj-assist-summary', `聴牌になる打牌 ${info.options.length}通り（残り枚数の多い順）`);
  const options = info.options
    .map((o) => Object.assign({ remaining: assistRemaining(o.waits, visibleCounts) }, o))
    .sort((a, b) => b.remaining - a.remaining);
  for (const o of options) {
    const section = document.createElement('div');
    section.className = 'mj-assist-option';
    const head = document.createElement('p');
    head.className = 'mj-assist-option-head';
    head.appendChild(document.createTextNode('打'));
    head.appendChild(makeTile(o.discard));
    let text = `待ち${o.waits.length}種・残り${o.remaining}枚`;
    if (isFuriten(o.waits, tileType(o.discard))) text += '　フリテン';
    head.appendChild(document.createTextNode(text));
    section.appendChild(head);
    section.appendChild(buildAssistWaitList(o.waits, visibleCounts));
    box.appendChild(section);
  }
}

function renderLog() {
  const box = el('mj-log');
  box.innerHTML = '';
  for (const line of state.eventLog.slice(-30)) {
    const li = document.createElement('li');
    li.textContent = line;
    box.appendChild(li);
  }
  box.scrollTop = box.scrollHeight;
}

function hideBanner() {
  const box = el('mj-banner');
  box.innerHTML = '';
  box.hidden = true;
}

function bannerLine(box, text, className) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  box.appendChild(p);
}

// 和了した手を「手牌 ＋ 和了牌(少し離す) ＋ 副露」の並びで表示する。
// winTile が null のときは和了牌なしで、手牌と副露だけを並べる（和了していない人の公開用）。
function bannerHand(box, seat, winTile) {
  const player = state.players[seat];
  const hand = sortTilesByType(player.hand.filter((id) => id !== winTile));
  const row = document.createElement('div');
  row.className = 'mj-banner-hand';
  for (const id of hand) row.appendChild(makeTile(id));
  if (winTile !== null) row.appendChild(makeTile(winTile, { classes: ['mj-tile--drawn', 'mj-tile--last'] }));
  for (const m of player.melds) {
    const meldEl = buildMeldElement(m, seat);
    meldEl.classList.add('mj-banner-meld');
    row.appendChild(meldEl);
  }
  box.appendChild(row);
}

function yakuText(result) {
  return result.yaku.map((y) => y[0]).join('・');
}

function renderHandResult(info) {
  const box = el('mj-banner');
  box.innerHTML = '';
  box.hidden = false;
  if (info.ryuukyoku) {
    bannerLine(box, '流局', 'mj-banner-title');
    bannerLine(box, `聴牌: ${info.tenpaiSeats.map(seatLabel).join('、') || 'なし'}`, 'mj-banner-detail');
  } else if (info.method === 'ツモ') {
    const seat = info.seats[0];
    const r = info.result;
    bannerLine(box, `${seatLabel(seat)} ツモ`, 'mj-banner-title');
    bannerHand(box, seat, info.tile);
    bannerLine(box, yakuText(r), 'mj-banner-detail');
    bannerLine(box, `${r.han}翻${r.fu}符　${info.total}点`, 'mj-banner-points');
  } else {
    for (const { seat, result, points } of info.results) {
      bannerLine(box, `${seatLabel(seat)} ロン（${seatLabel(info.fromSeat)}から）`, 'mj-banner-title');
      bannerHand(box, seat, info.tile);
      bannerLine(box, yakuText(result), 'mj-banner-detail');
      bannerLine(box, `${result.han}翻${result.fu}符　${points}点`, 'mj-banner-points');
    }
  }
  bannerReveal(box);
}

// 局の終わりに全員の手牌と聴牌状況を公開する（相手の手を読む練習の答え合わせ用）。
// 和了した人の手牌はすでに上に出しているので、状況の行だけにする。
function bannerReveal(box) {
  const section = document.createElement('div');
  section.className = 'mj-banner-reveal';
  bannerLine(section, '全員の手牌', 'mj-banner-reveal-title');
  for (let s = 0; s < 4; s++) {
    bannerLine(section, `${seatLabel(s)}：${tenpaiStatusText(s)}`, 'mj-banner-status');
    if (!state.reveal.winners.includes(s)) bannerHand(section, s, null);
  }
  box.appendChild(section);
}

// 和了牌を除いた手牌（ツモ和了した人は手牌に和了牌が入っているので取り除く）
function handBeforeWin(seat) {
  const hand = state.players[seat].hand.slice();
  const r = state.reveal;
  if (r && r.winners.includes(seat) && hand.length % 3 === 2) hand.splice(hand.indexOf(r.winTile), 1);
  return hand;
}

// 例:「聴牌（6巡目から・ダマ）待ち 3p 6p」「ノーテン（1向聴）」
function tenpaiStatusText(seat) {
  const p = state.players[seat];
  const hand = handBeforeWin(seat);
  const shanten = computeShanten(toCounts(hand), p.melds.length);
  if (shanten > 0) return `ノーテン（${shanten}向聴）`;
  const notes = [];
  if (p.tenpaiTurn !== null) notes.push(p.tenpaiTurn === 0 ? '配牌から' : `${p.tenpaiTurn}巡目から`);
  if (p.riichi) notes.push(`${p.riichiTurn}巡目にリーチ`);
  else if (p.melds.some((m) => m.kind !== 'ankan')) notes.push('副露');
  else notes.push('ダマ');
  const waits = tenpaiWaitTypes(hand, p.melds.length).map(tileTypeLabel);
  return `聴牌（${notes.join('・')}）待ち ${waits.join(' ') || 'なし'}`;
}

function renderFinalResult(kifuText) {
  const box = el('mj-banner');
  box.innerHTML = '';
  box.hidden = false;
  bannerLine(box, '対局終了', 'mj-banner-title');
  state.players
    .map((p, s) => ({ s, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .forEach((r, i) => bannerLine(box, `${i + 1}位　${seatLabel(r.s)}　${r.score}点`, 'mj-banner-detail'));
  el('mj-kifu-text').value = kifuText;
}

// ---------------------------------------------------------------------------
// 局面のコピー（途中経過をAIに相談する用）。文字にする処理は position.js。
// 他家の手牌は、局が終わって公開したあと（state.reveal があるとき）だけ含める。
// ---------------------------------------------------------------------------

const SEAT_RELATIONS = ['自分', '下家', '対面', '上家'];

function currentHandLog() {
  let start = 0;
  state.eventLog.forEach((line, i) => { if (line.startsWith('--- ')) start = i + 1; });
  return state.eventLog.slice(start);
}

function buildPositionView() {
  const revealed = Boolean(state.reveal);
  const drawn = state.lastDrawnTile;
  return {
    roundLabel: `東${Math.min(state.kyoku, 4)}局`,
    honba: state.honba,
    kyotaku: state.kyotaku,
    wallRemaining: Math.max(0, state.wall.length - state.wallIndex),
    doraIndicators: state.doraIndicators.slice(0, state.doraRevealed),
    revealed,
    players: state.players.map((p, s) => {
      const showHand = s === 0 || revealed;
      const justDrew = Boolean(drawn && drawn.seat === s && p.hand.length % 3 === 2 && p.hand.includes(drawn.tile));
      return {
        name: s === 0 ? 'あなた' : `${seatLabel(s)}・${SEAT_RELATIONS[s]}`,
        wind: tileTypeLabel(seatWindType(s)),
        isDealer: s === state.oya,
        score: p.score,
        turn: p.discards.length,
        riichi: p.riichi,
        hand: showHand ? p.hand : null,
        drawnTile: showHand && justDrew ? drawn.tile : null,
        status: revealed ? tenpaiStatusText(s) : null,
        melds: p.melds.map((m) => ({
          label: meldKindLabel(m.kind),
          tiles: m.tiles,
          fromName: m.calledFrom === null ? null : seatLabel(m.calledFrom),
        })),
        discards: p.discards.map((d) => ({
          tile: d.tile,
          tsumogiri: d.tsumogiri,
          sideways: d.sideways,
          calledByName: d.calledBy === null ? null : seatLabel(d.calledBy),
        })),
      };
    }),
    log: currentHandLog(),
  };
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

function bootstrap() {
  el('mj-level').value = String(CONFIG.cpuLevel);
  el('mj-depth').value = String(CONFIG.readingDepth);
  el('mj-level').addEventListener('change', (e) => { CONFIG.cpuLevel = Number(e.target.value); });
  el('mj-depth').addEventListener('change', (e) => { CONFIG.readingDepth = Number(e.target.value); });
  el('mj-assist-toggle').checked = loadAssistVisible();
  el('mj-assist-toggle').addEventListener('change', (e) => {
    saveAssistVisible(e.target.checked);
    renderAssist();
  });
  el('mj-new-game').addEventListener('click', () => {
    el('mj-banner').hidden = true;
    el('mj-kifu-text').value = '';
    runMatch();
  });
  el('mj-copy-position').addEventListener('click', async (e) => {
    if (!state) return;
    const btn = e.currentTarget;
    const ok = await copyTextToClipboard(buildPositionText(buildPositionView()));
    btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    setTimeout(() => { btn.textContent = '局面をコピー'; }, 2000);
  });
  el('mj-copy-kifu').addEventListener('click', async () => {
    const ok = await copyTextToClipboard(el('mj-kifu-text').value);
    el('mj-copy-status').textContent = ok ? 'コピーしました' : 'コピーに失敗しました。テキストエリアから手動で選択してください';
  });
  runMatch();
}

document.addEventListener('DOMContentLoaded', bootstrap);
