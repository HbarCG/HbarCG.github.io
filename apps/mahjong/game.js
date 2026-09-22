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
let promptResolver = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
// CPU手番の最小待ち時間（演出ではなく、進行が速すぎて読めなくなるのを防ぐため）。
// 自動対局デバッグモード(?auto=1)では動作確認を速くするため短縮する。
function thinkDelay() { return CONFIG.autoHuman ? 1 : 350; }

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
    state.players[s].ippatsuWindow = false;
    state.players[s].furitenPermanent = false;
    state.players[s].furitenTemp = false;
  }
  state.wall = dealt.liveWall;
  state.wallIndex = 0;
  state.rinshanTiles = dealt.rinshanTiles;
  state.rinshanIndex = 0;
  state.doraIndicators = dealt.doraIndicators;
  state.doraRevealed = 1;
  state.uraDoraIndicators = dealt.uraDoraIndicators;
  state.lastDrawnTile = null;

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
    seatWindType: seatWindType(seat),
    roundWindType: state.roundWindType,
    discardsBySeat: state.players.map((p) => p.discards),
    meldsBySeat: state.players.map((p) => p.melds),
    riichiBySeat: state.players.map((p) => p.riichi),
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
  renderAll({ discardable: riichiTiles || state.players[0].hand.slice() });
  return new Promise((resolve) => { discardResolver = resolve; });
}

function onHandTileClick(tileId) {
  if (discardResolver) {
    const r = discardResolver;
    discardResolver = null;
    r(tileId);
  }
}

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
  if (eligible) {
    wantsRiichi = decideRiichi(CONFIG.cpuLevel);
  }
  const tile = chooseDiscard(player.hand, player.melds, CONFIG.cpuLevel, CONFIG.readingDepth, ctx);
  if (wantsRiichi) {
    const resultingShanten = computeShanten(toCounts(player.hand.filter((x) => x !== tile)), player.melds.length);
    if (resultingShanten === 0) await declareRiichi(seat);
  }
  return tile;
}

async function declareRiichi(seat) {
  const player = state.players[seat];
  player.riichi = true;
  player.ippatsuWindow = true;
  player.score -= 1000;
  state.kyotaku += 1;
  pushLog(`${seatLabel(seat)}がリーチ`);
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
    const choices = options.map((o, i) => ({ label: `${o.kind === 'ankan' ? '暗槓' : '加槓'}: ${tileTypeLabel(o.type)}`, value: i }));
    choices.push({ label: '槓しない', value: -1 });
    const choice = await askHuman('槓できます', choices);
    return choice === -1 ? null : options[choice];
  }

  await sleep(thinkDelay());
  if (CONFIG.cpuLevel === 1) return null;
  return options[0];
}

async function performKan(seat, kanOption) {
  const player = state.players[seat];
  if (kanOption.kind === 'ankan') {
    removeIdsFromHand(seat, kanOption.tiles);
    player.melds.push({ kind: 'ankan', tiles: kanOption.tiles, calledTile: null, calledFrom: null });
    state.kifuLines.push(kifuCall(seat, 'ankan', kanOption.tiles, seat));
    breakAllIppatsu();
    revealNewDora();
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
  return false;
}

// ---------------------------------------------------------------------------
// 他家の反応（ロン／ポン・カン／チー）
// ---------------------------------------------------------------------------

async function askRon(seat, tileId, fromSeat) {
  if (seat === 0 && !CONFIG.autoHuman) {
    return await askHuman(`${seatLabel(fromSeat)}の${tileLabel(tileId)}にロンできます`, [{ label: 'ロン', value: true }, { label: '見送る', value: false }]);
  }
  await sleep(thinkDelay());
  return true; // CPUは有効なロンを常に取る
}

async function askPonKan(seat, ponOpt, kanOpt, tileId, fromSeat) {
  const isHuman = seat === 0 && !CONFIG.autoHuman;
  if (isHuman) {
    const choices = [];
    if (ponOpt) choices.push({ label: 'ポン', value: 'pon' });
    if (kanOpt) choices.push({ label: 'カン', value: 'kan' });
    choices.push({ label: 'しない', value: null });
    const choice = await askHuman(`${seatLabel(fromSeat)}の${tileLabel(tileId)}にポン/カンできます`, choices);
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
    const choices = options.map((o, i) => ({ label: `チー(${o.resultingMeldTiles.map(tileLabel).join('')})`, value: i }));
    choices.push({ label: 'しない', value: -1 });
    const choice = await askHuman(`${seatLabel(fromSeat)}の${tileLabel(tileId)}にチーできます`, choices);
    return choice === -1 ? null : options[choice];
  }
  await sleep(thinkDelay());
  return decideCall(options, state.players[seat].hand, state.players[seat].melds, CONFIG.cpuLevel, buildAiContext(seat));
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
  if (lastDiscard) lastDiscard.calledBy = seat;
  state.kifuLines.push(kifuCall(seat, call.kind, meld.tiles, fromSeat));
  breakAllIppatsu();
  if (call.kind === 'minkan') revealNewDora();
  pushLog(`${seatLabel(seat)}が${call.kind === 'pon' ? 'ポン' : call.kind === 'chi' ? 'チー' : 'カン'}`);
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
        : true;
      if (take) return { result: 'tsumo', seat };
    }
    return await discardPhase(seat);
  }

  const discardTile = await getDiscard(seat);
  removeIdsFromHand(seat, [discardTile]);
  const tsumogiri = state.lastDrawnTile && state.lastDrawnTile.seat === seat && state.lastDrawnTile.tile === discardTile;
  state.players[seat].discards.push({ tile: discardTile, tsumogiri, calledBy: null });
  state.kifuLines.push(kifuDiscard(seat, discardTile, tsumogiri));
  updateFuriten(seat);
  render();

  const reaction = await offerReactions(seat, discardTile);
  if (reaction.type === 'ron') return { result: 'ron', seats: reaction.seats, fromSeat: seat, tile: discardTile };
  if (reaction.type === 'call') return { result: 'call', seat: reaction.seat, call: reaction.call, fromSeat: seat, tile: discardTile };
  return { result: 'next' };
}

async function takeTurn(seat) {
  const tile = drawFromWall();
  if (tile === null) return { result: 'ryuukyoku' };
  state.lastDrawnTile = { seat, tile };
  addToHand(seat, tile);
  state.kifuLines.push(kifuDraw(seat, tile));
  render();

  if (canTsumo(seat)) {
    const take = (seat === 0 && !CONFIG.autoHuman)
      ? await askHuman('ツモできます', [{ label: 'ツモ', value: true }, { label: '見送る', value: false }])
      : true;
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
      : true;
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
  renderHandResult({ seats: [seat], result, total: totalGain, method: 'ツモ' });
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
    results.push({ seat, result });

    state.kifuLines.push(kifuAgari({
      who: seat, fromWho: outcome.fromSeat, handTiles: state.players[seat].hand, melds: state.players[seat].melds,
      machi: outcome.tile, fu: result.fu, points: payments.total, limitName: result.limitName,
      yakuList: result.yaku, doraHan: result.doraHan, akaHan: result.akaHan, uraDoraHan: result.uraDoraHan,
      scoreDeltas: deltas,
    }));
    pushLog(`${seatLabel(seat)}がロン和了（${result.han}翻${result.fu}符 ${payments.total}点、${seatLabel(outcome.fromSeat)}から）`);
  }
  state.kyotaku = 0;

  renderHandResult({ seats: outcome.seats, results, method: 'ロン', fromSeat: outcome.fromSeat });
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
  p.textContent = promptText;
  box.appendChild(p);
  const row = document.createElement('div');
  row.className = 'mj-prompt-buttons';
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = c.label;
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

function tileButtonClass(id) {
  const type = tileType(id);
  const suit = suitOfType(type);
  const cls = ['mj-tile', `mj-tile--${suit}`];
  if (isRedFive(id)) cls.push('mj-tile--red');
  return cls.join(' ');
}

// 牌1枚分の中身(絵柄+小さいラベル)を組み立てて要素に追加する。
function fillTileElement(node, id) {
  const type = tileType(id);
  node.setAttribute('aria-label', tileLabel(id));
  const glyph = document.createElement('span');
  glyph.className = 'mj-tile-glyph';
  glyph.textContent = tileGlyph(type);
  glyph.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'mj-tile-label';
  label.textContent = tileTypeLabel(type);
  label.setAttribute('aria-hidden', 'true');
  node.appendChild(glyph);
  node.appendChild(label);
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

function renderHandRow(containerId, tiles, opts) {
  const box = el(containerId);
  box.innerHTML = '';
  for (const id of tiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = tileButtonClass(id);
    fillTileElement(btn, id);
    if (opts && opts.discardable) {
      const enabled = opts.discardable.includes(id);
      btn.disabled = !enabled;
      if (enabled) btn.addEventListener('click', () => onHandTileClick(id));
    } else {
      btn.disabled = true;
    }
    box.appendChild(btn);
  }
}

function renderPond(containerId, discards) {
  const box = el(containerId);
  box.innerHTML = '';
  for (const d of discards) {
    const span = document.createElement('span');
    span.className = tileButtonClass(d.tile) + (d.calledBy !== null ? ' mj-tile--called' : '');
    fillTileElement(span, d.tile);
    box.appendChild(span);
  }
}

function renderMelds(containerId, melds) {
  const box = el(containerId);
  box.innerHTML = '';
  for (const m of melds) {
    const wrap = document.createElement('span');
    wrap.className = 'mj-meld';
    const kindEl = document.createElement('span');
    kindEl.className = 'mj-meld-kind';
    kindEl.textContent = meldKindLabel(m.kind);
    wrap.appendChild(kindEl);
    const tilesRow = document.createElement('span');
    tilesRow.className = 'mj-meld-tiles';
    for (const t of m.tiles) {
      const tileSpan = document.createElement('span');
      tileSpan.className = `${tileButtonClass(t)} mj-tile--mini`;
      fillTileElement(tileSpan, t);
      tilesRow.appendChild(tileSpan);
    }
    wrap.appendChild(tilesRow);
    box.appendChild(wrap);
  }
}

function renderInfo() {
  el('mj-round').textContent = `東${state.kyoku}局 ${state.honba}本場 供託${state.kyotaku}本`;
  el('mj-wall-count').textContent = `残り山: ${Math.max(0, state.wall.length - state.wallIndex)}`;
  el('mj-dora').textContent = `ドラ表示: ${state.doraIndicators.slice(0, state.doraRevealed).map(tileLabel).join(' ')}`;
  for (let s = 0; s < 4; s++) {
    const p = state.players[s];
    el(`mj-score-${s}`).textContent = `${seatLabel(s)}${s === state.oya ? '(親)' : ''}: ${p.score}点${p.riichi ? ' [リーチ]' : ''}`;
  }
}

function renderCpu(seat) {
  const p = state.players[seat];
  el(`mj-cpu-${seat}-count`).textContent = `手牌: ${p.hand.length}枚`;
  renderPond(`mj-cpu-${seat}-pond`, p.discards);
  renderMelds(`mj-cpu-${seat}-melds`, p.melds);
}

function render(opts) {
  if (!state) return;
  renderInfo();
  renderHandRow('mj-human-hand', state.players[0].hand, opts);
  renderPond('mj-human-pond', state.players[0].discards);
  renderMelds('mj-human-melds', state.players[0].melds);
  for (let s = 1; s < 4; s++) renderCpu(s);
}

function renderAll(opts) { render(opts); }

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

function renderHandResult(info) {
  const box = el('mj-banner');
  box.hidden = false;
  if (info.ryuukyoku) {
    box.textContent = `流局: 聴牌 ${info.tenpaiSeats.map(seatLabel).join('、') || 'なし'}`;
    return;
  }
  if (info.method === 'ツモ') {
    const r = info.result;
    box.textContent = `${seatLabel(info.seats[0])} ツモ和了 ${r.yaku.map((y) => y[0]).join('・')} ${r.han}翻${r.fu}符 ${info.total}点`;
  } else {
    const parts = info.results.map(({ seat, result }) => `${seatLabel(seat)}: ${result.yaku.map((y) => y[0]).join('・')} ${result.han}翻${result.fu}符`);
    box.textContent = `ロン和了(${seatLabel(info.fromSeat)}から) ${parts.join(' / ')}`;
  }
}

function renderFinalResult(kifuText) {
  const box = el('mj-banner');
  box.hidden = false;
  const ranking = state.players
    .map((p, s) => ({ s, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => `${i + 1}位 ${seatLabel(r.s)}(${r.score}点)`)
    .join(' / ');
  box.textContent = `対局終了: ${ranking}`;
  el('mj-kifu-text').value = kifuText;
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

function bootstrap() {
  el('mj-level').value = String(CONFIG.cpuLevel);
  el('mj-depth').value = String(CONFIG.readingDepth);
  el('mj-level').addEventListener('change', (e) => { CONFIG.cpuLevel = Number(e.target.value); });
  el('mj-depth').addEventListener('change', (e) => { CONFIG.readingDepth = Number(e.target.value); });
  el('mj-new-game').addEventListener('click', () => {
    el('mj-banner').hidden = true;
    el('mj-kifu-text').value = '';
    runMatch();
  });
  el('mj-copy-kifu').addEventListener('click', async () => {
    const ok = await copyTextToClipboard(el('mj-kifu-text').value);
    el('mj-copy-status').textContent = ok ? 'コピーしました' : 'コピーに失敗しました。テキストエリアから手動で選択してください';
  });
  runMatch();
}

document.addEventListener('DOMContentLoaded', bootstrap);
