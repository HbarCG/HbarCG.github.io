// 家康の憂鬱（apps/ieyasu/）を自動で遊ばせて、幕府が何年続くかを数える開発用ツール。
// サイトの公開には関係しない。仕組みや数値（game.js の CONFIG、cards.js）を直したあと、
// 釣り合いが崩れていないかを確かめるのに使う。
//
// 使い方（リポジトリのルートで実行。Node.js 18以上）:
//   node scripts/ieyasu-selfplay.mjs --games 300
//   node scripts/ieyasu-selfplay.mjs --games 300 --policy basic --seed 7
//
//   --games N   : 遊ばせる回数（初期値: 300）
//   --policy P  : 遊び方（初期値: random）
//                   random … 何も考えずに選ぶ。出来事はでたらめに選び、空いた役職だけは埋める
//                   basic  … ひととおり考えて選ぶ。将軍の好みに合う裁き、若君の教育、制度の整備、借入の返済、隠居
//   --seed N    : 乱数の種の始まり（同じ種なら同じ結果になる）
//   --fuseki F  : プロローグの「最後の布石」。random / gosanke / kinzan / konin（初期値: random）
//
// ブラウザ用のスクリプトをそのまま読み込み、画面（document など）だけ何もしない物に差し替えて動かす。
// ゲームの中の関数は、game.js の最後にある window.IEYASU_DEV から呼んでいる。
// 周回をまたいで残る栄誉は、1回ごとに空から始める（遺訓は選ばない）。

import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP_DIR = new URL("../apps/ieyasu/", import.meta.url);
const CODE = ["art.js", "cards.js", "game.js"].map((file) => [file, readFileSync(new URL(file, APP_DIR), "utf8")]);
const FOUNDED = 1603;
const MAX_YEARS = 600; // これより長く続いたら打ち切る

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

// localStorage の代わり（1回ごとに空から始める）
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function createGame(seed) {
  const math = Object.create(Math);
  math.random = seededRandom(seed);
  const context = vm.createContext({ console, Math: math, document: dummy(), localStorage: memoryStorage() });
  context.window = context;
  context.confirm = () => true;
  context.scrollTo = () => {};
  context.scrollY = 0;
  context.innerHeight = 800;
  for (const [file, code] of CODE) vm.runInContext(code, context, { filename: file });
  return { dev: context.IEYASU_DEV, data: context.IEYASU_DATA, rand: math.random };
}

const sum3 = (st) => st.seimu + st.bui + st.jintoku;

// 空いた役職を埋める。控えの家臣が足りなければ、登用の候補から召し抱える
function fillPosts(g) {
  const s = g.dev.state;
  const vacant = () => g.dev.POSTS.filter((p) => !s.retainers.some((r) => r.post === p.id)).length;
  const reserve = () => s.retainers.filter((r) => !r.post).length;
  while (vacant() > reserve() && s.candidates.length > 0 && s.retainers.length < g.dev.CONFIG.MAX_RETAINERS) {
    g.dev.hire(0);
  }
  if (vacant() > 0 && reserve() > 0) g.dev.autoAssign();
}

const POLICIES = {
  random: {
    choose: (g, card) => Math.floor(g.rand() * card.options.length),
    manage: (g) => fillPosts(g),
    crown: () => 0,
  },
  basic: {
    choose(g, card) {
      const trait = g.dev.state.shogun.trait;
      const liked = card.options.findIndex((o) => o.tag === trait);
      return liked >= 0 ? liked : Math.floor(g.rand() * card.options.length);
    },
    manage(g) {
      const { dev, data } = g;
      const s = dev.state;
      // 腕の立つ候補は、空きがあれば召し抱えておく
      s.candidates
        .map((c, i) => ({ i, best: Math.max(...Object.values(c.stats)) }))
        .filter((c) => c.best >= 14)
        .reverse()
        .forEach((c) => { if (s.retainers.length < 10) dev.hire(c.i); });
      fillPosts(g);
      // 若君の教育（いちばん低い能力を伸ばす）
      s.heirs.forEach((h, i) => {
        if (h.age >= dev.CONFIG.TEACH_AGE_LIMIT || s.fin.cash < dev.teachCost() + 60) return;
        const stat = ["seimu", "bui", "jintoku"].reduce((a, b) => (h.stats[b] < h.stats[a] ? b : a));
        dev.teach(i, stat);
      });
      // 余裕があれば制度を整える
      for (const inst of data.institutions) {
        if (inst.prologueOnly || !dev.institutionStatus(inst).ok) continue;
        if (s.fin.cash - (inst.ryo || 0) < 80) continue;
        dev.establish(inst.id);
      }
      // 借入を返す
      while (s.fin.debt > 0 && s.fin.cash > 150) dev.repay();
      // 老いた将軍は、成人した若君がいれば隠居させる
      if (s.shogun.age >= 62 && dev.canRetire()) dev.retire();
    },
    crown(g) {
      const list = g.dev.state.succession.candidates;
      const adult = (c) => c.age >= g.dev.CONFIG.ADULT_AGE;
      return list.reduce((best, c, i) => {
        const b = list[best];
        if (adult(c) !== adult(b)) return adult(c) ? i : best;
        return sum3(c.stats) > sum3(b.stats) ? i : best;
      }, 0);
    },
  },
};

function playOne(seed, policy, fuseki) {
  const g = createGame(seed);
  const { dev, data } = g;
  const counts = { succession: {}, shogunKaku: [] };

  // プロローグの「最後の布石」
  const base = data.prologue.find((p) => p.choices).choices.filter((c) => !c.unlock);
  const choice = fuseki === "random"
    ? base[Math.floor(g.rand() * base.length)]
    : base.find((c) => c.institution === fuseki);
  if (!choice) throw new Error(`布石が見つからない: ${fuseki}`);
  dev.state.institutions.push(choice.institution);
  dev.startMain();
  counts.shogunKaku.push(sum3(dev.state.shogun.stats));

  for (let step = 0; step < 100000; step++) {
    const s = dev.state;
    if (s.phase === "over" || s.year - FOUNDED >= MAX_YEARS) break;
    if (s.phase === "event") {
      const card = data.cards.find((c) => c.id === s.card.id);
      dev.choose(policy.choose(g, card));
    } else if (s.phase === "result") {
      s.phase = "manage";
      s.result = null;
    } else if (s.phase === "manage") {
      policy.manage(g);
      if (dev.state.phase === "manage") dev.endYear();
    } else if (s.phase === "report") {
      dev.closeReport();
    } else if (s.phase === "succession") {
      const mode = s.succession.mode;
      counts.succession[mode] = (counts.succession[mode] || 0) + 1;
      dev.crown(policy.crown(g));
      counts.shogunKaku.push(sum3(dev.state.shogun.stats));
    } else {
      throw new Error(`知らない場面: ${s.phase}`);
    }
  }

  const s = dev.state;
  const limit = Math.round(s.fin.lastRevenue * dev.CONFIG.DEBT_LIMIT);
  const causes = [];
  if (s.phase === "over") {
    for (const [key, label] of [["ikou", "威光"], ["minshin", "民心"], ["chotei", "朝廷"]]) {
      if (s.gauges[key] <= dev.CONFIG.CRISIS_SAFE) causes.push(label);
    }
    if (s.fin.debt > limit) causes.push("財政");
  }
  return {
    years: s.year - FOUNDED,
    over: s.phase === "over",
    causes,
    gen: s.shogun.gen,
    succession: counts.succession,
    shogunKaku: counts.shogunKaku,
    heirsBorn: s.family.filter((p) => p.childName).length,
    honors: s.honors.length,
  };
}

function parseArgs(argv) {
  const args = { games: 300, policy: "random", seed: 1, fuseki: "random" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in args)) throw new Error(`知らない指定: ${argv[i]}`);
    args[key] = typeof args[key] === "number" ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!POLICIES[args.policy]) throw new Error(`知らない遊び方: ${args.policy}`);
  return args;
}

const pct = (n, total) => `${Math.round((n / total) * 100)}%`;
const avg = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const results = [];
  for (let i = 0; i < args.games; i++) results.push(playOne(args.seed + i, POLICIES[args.policy], args.fuseki));

  const n = results.length;
  const years = results.map((r) => r.years).sort((a, b) => a - b);
  const fallen = results.filter((r) => r.over);
  const causeCount = {};
  for (const r of fallen) for (const c of r.causes) causeCount[c] = (causeCount[c] || 0) + 1;
  const succ = {};
  for (const r of results) for (const [mode, k] of Object.entries(r.succession)) succ[mode] = (succ[mode] || 0) + k;
  const succTotal = Object.values(succ).reduce((a, b) => a + b, 0);
  const SUCC_LABELS = { heirs: "若君から", gosanke: "御三家から", dispute: "跡目争い" };

  console.log(`家康の憂鬱 自動プレイ ${n}回（遊び方: ${args.policy}、布石: ${args.fuseki}、種: ${args.seed}〜${args.seed + n - 1}）`);
  console.log(`続いた年数（開府から）: 平均 ${Math.round(avg(years))} / 中央 ${quantile(years, 0.5)} / 下位10% ${quantile(years, 0.1)} / 上位10% ${quantile(years, 0.9)} / 最短 ${years[0]} / 最長 ${years[n - 1]}`);
  console.log(`史実（265年）を超えた: ${pct(years.filter((y) => y > 265).length, n)}　${MAX_YEARS}年で打ち切り: ${pct(n - fallen.length, n)}`);
  console.log(`倒れたときに尽きていたもの: ${Object.entries(causeCount).map(([c, k]) => `${c} ${pct(k, fallen.length)}`).join(" / ") || "なし"}`);
  console.log(`将軍の代: 平均 ${avg(results.map((r) => r.gen)).toFixed(1)}　就任時の能力の合計: 平均 ${avg(results.flatMap((r) => r.shogunKaku)).toFixed(1)}`);
  console.log(`代替わりの形: ${Object.entries(succ).map(([m, k]) => `${SUCC_LABELS[m] || m} ${pct(k, succTotal)}`).join(" / ")}`);
  console.log(`生まれた若君: 1回あたり平均 ${avg(results.map((r) => r.heirsBorn)).toFixed(1)}人　栄誉: 平均 ${avg(results.map((r) => r.honors)).toFixed(1)}`);
  console.log(`（${((Date.now() - started) / 1000).toFixed(1)}秒）`);
}

main();
