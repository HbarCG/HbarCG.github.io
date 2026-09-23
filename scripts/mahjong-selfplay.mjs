// 麻雀アプリ（apps/mahjong/）のCPU同士を自動で対局させ、強さを比べる開発用ツール。
// サイトの公開には関係しない。CPUの判断の数値（ai.js の AI_PARAMS）を調整するときに使う。
//
// 使い方（リポジトリのルートで実行。Node.js 18以上）:
//   node scripts/mahjong-selfplay.mjs --matches 200
//   node scripts/mahjong-selfplay.mjs --matches 200 --a '{"level":5,"depth":3}' \
//     --b '{"level":5,"depth":3,"params":{"riichiMinValue":250}}'
//
// A と B を1卓に2人ずつ（A,B,A,B の席順）座らせて東風戦を打たせる。
// 同じ山で席を入れ替えた対局（B,A,B,A）も必ず打つので、配牌の運の差がある程度打ち消される。
//   --matches N : 山の数（実際の対局数はその2倍）
//   --jobs N    : 同時に動かす数（初期値: CPUのコア数 - 1）
//   --seed N    : 乱数の種の始まり（同じ種なら同じ山になる）
//   --a / --b   : {"level":1〜5, "depth":0〜3, "params":{AI_PARAMS の上書き}}
//
// ブラウザ用のスクリプトをそのまま読み込み、画面の描画だけ何もしない関数に差し替えて動かす。

import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import vm from "node:vm";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const APP_DIR = new URL("../apps/mahjong/", import.meta.url);
const SCRIPTS = ["tiles.js", "shanten.js", "yaku.js", "assist.js", "eval.js", "ai.js", "kifu.js", "position.js", "game.js"];

// 何を読んでも何を呼んでもエラーにならない、画面（document など）の代わり
function dummy() {
  return new Proxy(function () {}, {
    get(_, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => "";
      if (key === "then") return undefined;
      return dummy();
    },
    set() { return true; },
    apply() { return dummy(); },
  });
}

// 種から決まる乱数（mulberry32）
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) deepMerge(target[key], value);
    else target[key] = value;
  }
}

function createGame() {
  const math = Object.create(Math);
  const context = vm.createContext({
    console, Math: math, URLSearchParams, setTimeout, Promise,
    document: dummy(), window: dummy(), localStorage: dummy(), navigator: dummy(),
    location: { search: "?auto=1" },
  });
  for (const file of SCRIPTS) {
    const code = readFileSync(new URL(file, APP_DIR), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  // 描画と待ち時間を省く
  context.sleep = () => Promise.resolve();
  for (const name of ["render", "renderLog", "renderHandResult", "renderFinalResult", "hideBanner", "renderPrompt", "clearPrompt"]) {
    context[name] = () => {};
  }
  return { context, math };
}

// 席ごとに違うレベル・数値で判断させる（CONFIG.cpuLevel は全員共通なので、ここで差し替える）
function installSeatAi(context, seatAi) {
  const ai = {};
  for (const name of ["chooseDiscard", "decideCall", "decideRiichi", "decideKan", "decideWin"]) ai[name] = context[name];
  const params = vm.runInContext("AI_PARAMS", context);
  const baseParams = JSON.parse(JSON.stringify(params));
  const withSeat = (ctx, fn) => {
    const seat = seatAi[ctx.selfSeat];
    deepMerge(params, JSON.parse(JSON.stringify(baseParams)));
    deepMerge(params, seat.params);
    return fn(seat);
  };
  context.chooseDiscard = (hand, melds, level, depth, ctx) => withSeat(ctx, (s) => ai.chooseDiscard(hand, melds, s.level, s.depth, ctx));
  context.decideCall = (options, hand, melds, level, ctx) => withSeat(ctx, (s) => ai.decideCall(options, hand, melds, s.level, ctx));
  context.decideRiichi = (level, hand, melds, ctx) => withSeat(ctx, (s) => ai.decideRiichi(s.level, hand, melds, ctx));
  context.decideKan = (options, hand, melds, level, ctx) => withSeat(ctx, (s) => ai.decideKan(options, hand, melds, s.level, ctx));
  context.decideWin = (level, ctx, basePoints, method, fromSeat) => withSeat(ctx, (s) => ai.decideWin(s.level, ctx, basePoints, method, fromSeat));
}

// 1つの山で、席順を入れ替えて2回打つ。結果は A/B それぞれの 順位・点数・和了・放銃
async function playSeed(seed, a, b) {
  const results = [];
  for (const seats of [[a, b, a, b], [b, a, b, a]]) {
    const { context, math } = createGame();
    math.random = seededRandom(seed);
    installSeatAi(context, seats);
    await context.runMatch();
    const scores = vm.runInContext("state.players.map((p) => p.score)", context);
    const log = vm.runInContext("state.eventLog", context);
    const seatOf = (label) => (label === "あなた" ? 0 : Number(label.slice(3)));
    const wins = [0, 0, 0, 0];
    const dealIns = [0, 0, 0, 0];
    for (const line of log) {
      let m = line.match(/^(あなた|CPU\d)がロン和了.*、(あなた|CPU\d)から/);
      if (m) { wins[seatOf(m[1])]++; dealIns[seatOf(m[2])]++; }
      m = line.match(/^(あなた|CPU\d)がツモ和了/);
      if (m) wins[seatOf(m[1])]++;
    }
    for (let seat = 0; seat < 4; seat++) {
      const rank = 1 + [0, 1, 2, 3].filter((s) => s !== seat
        && (scores[s] > scores[seat] || (scores[s] === scores[seat] && s < seat))).length;
      results.push({ side: seats[seat].side, rank, score: scores[seat], wins: wins[seat], dealIns: dealIns[seat] });
    }
  }
  return results;
}

function summarize(results, side) {
  const rows = results.filter((r) => r.side === side);
  const n = rows.length;
  const mean = (key) => rows.reduce((sum, r) => sum + r[key], 0) / n;
  const rankMean = mean("rank");
  const rankSd = Math.sqrt(rows.reduce((sum, r) => sum + (r.rank - rankMean) ** 2, 0) / n);
  return {
    n,
    rank: rankMean,
    rankSe: rankSd / Math.sqrt(n),
    score: mean("score"),
    wins: rows.reduce((sum, r) => sum + r.wins, 0),
    dealIns: rows.reduce((sum, r) => sum + r.dealIns, 0),
  };
}

if (isMainThread) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []));
  const matches = Number(args.matches || 100);
  const jobs = Math.max(1, Math.min(matches, Number(args.jobs || cpus().length - 1)));
  const firstSeed = Number(args.seed || 1);
  const a = Object.assign({ level: 5, depth: 3, params: {} }, JSON.parse(args.a || "{}"), { side: "A" });
  const b = Object.assign({ level: 5, depth: 3, params: {} }, JSON.parse(args.b || "{}"), { side: "B" });

  const seeds = Array.from({ length: matches }, (_, i) => firstSeed + i);
  const started = Date.now();
  const chunks = Array.from({ length: jobs }, (_, j) => seeds.filter((_, i) => i % jobs === j));
  const all = (await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { seeds: chunk, a, b } });
    worker.on("message", resolve);
    worker.on("error", reject);
  })))).flat();

  console.log(`山 ${matches} × 席替え2回 = ${matches * 2} 対局（${((Date.now() - started) / 1000).toFixed(0)}秒）`);
  for (const [side, cfg] of [["A", a], ["B", b]]) {
    const s = summarize(all, side);
    console.log(`${side} ${JSON.stringify({ level: cfg.level, depth: cfg.depth, params: cfg.params })}`);
    console.log(`  平均順位 ${s.rank.toFixed(3)}（±${s.rankSe.toFixed(3)}） 平均点 ${s.score.toFixed(0)} 和了 ${s.wins} 放銃 ${s.dealIns}`);
  }
} else {
  const { seeds, a, b } = workerData;
  const results = [];
  for (const seed of seeds) results.push(...await playSeed(seed, a, b));
  parentPort.postMessage(results);
}
