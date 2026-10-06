// 家康の憂鬱（apps/ieyasu/）を自動で遊ばせて、幕府が何年続くかを数える開発用ツール。
// サイトの公開には関係しない。仕組みや数値（engine.js の CONFIG、cards.js）を直したあと、
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
//                   money  … 出来事ではいつもいちばんお金になる選択肢を選ぶ（ほかは basic と同じ）。
//                            これが basic より大きく長持ちするなら、お金だけ見れば勝てる釣り合いになっている
//   --seed N    : 乱数の種の始まり（同じ種なら同じ結果になる）
//   --fuseki F  : プロローグの「最後の布石」。random / gosanke / kinzan / konin（初期値: random）
//
// ブラウザ用のスクリプトのうち、データ（cards.js）とルール（engine.js）だけを読み込んで動かす。画面（game.js）は使わない。
// ゲームの中の関数は、engine.js の最後にある window.IEYASU_ENGINE から呼んでいる。
// 周回をまたいで残る栄誉は、1回ごとに空から始める（遺訓は選ばない）。

import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP_DIR = new URL("../apps/ieyasu/", import.meta.url);
const CODE = ["cards.js", "engine.js"].map((file) => [file, readFileSync(new URL(file, APP_DIR), "utf8")]);
const FOUNDED = 1603;
const MAX_YEARS = 600; // これより長く続いたら打ち切る

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
  const context = vm.createContext({ console, Math: math, localStorage: memoryStorage() });
  context.window = context;
  for (const [file, code] of CODE) vm.runInContext(code, context, { filename: file });
  const dev = context.IEYASU_ENGINE;
  dev.loadOrNew(); // 保存データはないので、はじめから
  return { dev, data: context.IEYASU_DATA, rand: math.random };
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
    marry: (g) => Math.floor(g.rand() * g.dev.state.oku.offers.length),
    boost: () => false,
    testament: (g) => Math.floor(g.rand() * g.dev.state.succession.offers.length),
    wish: (g, offers) => Math.floor(g.rand() * offers.length),
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
      // 不満を漏らしている役職の家臣は、金に余裕があれば加増して引き留める
      for (const r of [...s.retainers]) {
        if (r.unhappy && r.post && s.fin.cash > 100) dev.raise(r.id);
      }
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
      // 普請：進めているものがなく、金に余裕があれば、始められる最初の普請を、いちばん向いた奉行で始める
      const work = dev.projectOptions().find((def) => s.fin.cash >= dev.projectCost(def) + 100);
      if (work) dev.startProject(work.id, dev.bestBugyo(work)?.id);
      // 借入を返す
      while (s.fin.debt > 0 && s.fin.cash > 150) dev.repay();
      // 大奥：金に余裕があれば側室を1人迎え、苦しければ暇を出す
      const o = s.oku;
      if (o.concubines < 1 && s.fin.cash > 150 && s.shogun.age <= 45 && s.heirs.length < dev.CONFIG.MAX_HEIRS) dev.addConcubine();
      else if (o.concubines > 0 && (s.fin.cash < 40 || s.shogun.age > 55)) dev.removeConcubine();
      // 年ごろの姫は、大名家へ嫁がせる
      for (let i = s.daughters.length - 1; i >= 0; i--) {
        if (s.daughters[i].age >= dev.CONFIG.DAUGHTER_MARRY_AGE && s.fin.cash > 80) dev.marryDaughter(i, "daimyo");
      }
      // 若君の枠が埋まっていたら、素質の低い若君を養子に出して枠を空ける。
      // 血筋がいちばん上がる御三家・御三卿へ出す（上がらなければ大名家へ）
      if (s.heirs.length >= dev.CONFIG.MAX_HEIRS && s.fin.cash > 50) {
        const kaku = (h) => sum3(h.stats);
        const weakest = s.heirs.reduce((w, h, i) => (kaku(h) < kaku(s.heirs[w]) ? i : w), 0);
        const heir = s.heirs[weakest];
        if ((heir.stars || 3) <= 2) {
          const gain = (b) => sum3(dev.projectedBlood(b, heir)) - sum3(b.blood);
          const best = s.branches.reduce((a, b) => (gain(b) > gain(a) ? b : a), s.branches[0]);
          dev.adoptOut(weakest, best && gain(best) >= 1 ? best.id : "daimyo");
        }
      }
      // 老いた将軍は、成人した若君がいれば隠居させる
      if (s.shogun.age >= 62 && dev.canRetire()) dev.retire();
    },
    // 異国船：金に余裕があれば、勝負ごとに軍資金を投じる
    boost(g) {
      const s = g.dev.state;
      const ship = g.data.ships[s.battle.ship];
      return s.fin.cash >= g.dev.boostCost(ship) + 60;
    },
    // 縁談：金に余裕があれば、能力（と特技）のいちばん良い姫を選ぶ。なければ安い家臣の娘
    marry(g) {
      const s = g.dev.state;
      const offers = s.oku.offers;
      if (s.fin.cash < 60) return offers.findIndex((b) => b.kind === "kashin");
      const score = (b) => sum3(b.stats) + (b.skill ? 3 : 0);
      return offers.reduce((best, b, i) => (score(b) > score(offers[best]) ? i : best), 0);
    },
    // 跡継ぎ：能力の合計がいちばん高い者。幼い者と、若君をさしおく分家の者は少し割り引く
    crown(g) {
      const { candidates: list, mode } = g.dev.state.succession;
      const score = (c) => sum3(c.stats) - (c.age < g.dev.CONFIG.ADULT_AGE ? 8 : 0) - (c.branchId && mode === "heirs" ? 5 : 0);
      return list.reduce((best, c, i) => (score(c) > score(list[best]) ? i : best), 0);
    },
  },
};

// 選択肢の「お金の値打ち」：現金＋毎年の収入を10年ぶん＋石高（年貢をおよそ10年ぶん）。借りる金は少し割り引く
function moneyValue(e) {
  return (e.ryo || 0) - (e.borrow ? 0.3 * e.borrow : 0) + (e.trade || 0) * 10 + (e.mine || 0) * 8
    + (e.kokudaka || 0) * 2.5 + (e.rice || 0) - (e.ooku || 0) * 10;
}

// money … 出来事では、いつもいちばんお金になる選択肢を選ぶ（ほかは basic と同じ）。
// 威光・民心・朝廷を見ずにお金だけで勝ててしまわないかを確かめるための遊び方
POLICIES.money = {
  ...POLICIES.basic,
  choose: (g, card) => card.options.reduce((best, o, i) => (moneyValue(o.effects) > moneyValue(card.options[best].effects) ? i : best), 0),
};

// cards.js だけを読み込んだデータ（損のない選択肢を数えるため）
function g0Data() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(CODE.find(([f]) => f === "cards.js")[1], ctx);
  return ctx.IEYASU_DATA;
}

// お金がいちばん増える選択肢なのに、ゲージを1つも下げず、成否の判定も、あとで来る続きの出来事（flag）もないカード。
// こういう「損のない正解」が多いと、お金だけ見て選べば勝ててしまう。お金が増えないもの（0以下）は数えない
function lossFree(data) {
  return data.cards.filter((card) => {
    const best = card.options.reduce((b, o, i) => (moneyValue(o.effects) > moneyValue(card.options[b].effects) ? i : b), 0);
    const o = card.options[best];
    const hurts = ["ikou", "minshin", "chotei"].some((k) => (o.effects[k] || 0) < 0);
    return moneyValue(o.effects) > 0 && !hurts && !o.check && !o.flag && !(o.effects.stress > 0) && !(o.effects.health < 0)
      && !(o.effects.borrow < 0); // 借入の返済は、いま現金を払うので「損のない」には数えない
  }).map((card) => card.id);
}

function playOne(seed, policy, fuseki) {
  const g = createGame(seed);
  const { dev, data } = g;
  const counts = { succession: {}, shogunKaku: [], warned: 0, left: 0, candidates: [], raises: 0,
    wives: {}, stars: [0, 0, 0, 0, 0, 0], daughters: 0, meddle: 0, balancedYears: 0, lowYears: 0, gaugeSum: 0, shipsArrived: [], ending: null,
    events: 0, repeats: 0, talks: 0, purse: {}, ratings: [], ends: {} };
  // 決算報告の「その年の出来事」から数える
  const NOTE_PATTERNS = { warned: /不満を漏らしている/, left: /見切りをつけて去った/ };

  // プロローグの「最後の布石」（制度か、遺訓のような始まりの効果）
  const base = data.prologue.find((p) => p.choices).choices.filter((c) => !c.unlock);
  const choice = fuseki === "random"
    ? base[Math.floor(g.rand() * base.length)]
    : base.find((c) => c.institution === fuseki || c.bonus === fuseki);
  if (!choice) throw new Error(`布石が見つからない: ${fuseki}`);
  if (choice.institution) dev.state.institutions.push(choice.institution);
  if (choice.bonus) dev.state.legacy = choice.bonus;
  dev.startMain();
  counts.shogunKaku.push(sum3(dev.state.shogun.stats));

  for (let step = 0; step < 100000; step++) {
    const s = dev.state;
    if (s.phase === "over" || s.year - FOUNDED >= MAX_YEARS) break;
    if (s.phase === "event") {
      const card = data.cards.find((c) => c.id === s.card.id);
      if (card.id === "branch-meddle") counts.meddle += 1;
      // 同じ回の中で、前に見た出来事がまた出たか
      counts.events += 1;
      if (s.seen[card.id] !== undefined) counts.repeats += 1;
      dev.choose(policy.choose(g, card));
    } else if (s.phase === "result") {
      s.phase = "manage";
      s.result = null;
    } else if (s.phase === "manage") {
      policy.manage(g);
      if (dev.state.phase === "manage") {
        dev.endYear();
        if (counts.firstKien === undefined && dev.state.kien > 0) counts.firstKien = dev.state.year - 1 - FOUNDED;
        // 年の暮れの現金と借入（開府100年・200年のようすを見る）
        const closed = dev.state.year - 1 - FOUNDED;
        if (closed === 100 || closed === 200) counts.purse[closed] = { cash: dev.state.fin.cash, debt: dev.state.fin.debt };
        if (dev.branchesBalanced()) counts.balancedYears += 1;
        // 威光・民心・朝廷のいちばん低いもの（20を切った年の数と、ならした値）
        const lowest = Math.min(...Object.values(dev.state.gauges));
        if (lowest < 20) counts.lowYears += 1;
        counts.gaugeSum += lowest;
        const report = dev.state.report;
        if (report) {
          for (const note of report.notes) {
            for (const [key, re] of Object.entries(NOTE_PATTERNS)) if (re.test(note)) counts[key] += 1;
          }
          for (const b of report.births || []) {
            if (b.sex === "f") counts.daughters += 1;
            else counts.stars[b.stars] += 1;
          }
          if (dev.state.nextPhase !== "succession") counts.candidates.push(dev.state.candidates.length);
        }
      }
    } else if (s.phase === "marriage") {
      const i = policy.marry(g);
      if (i < 0) {
        dev.declineMarriage();
      } else {
        const kind = s.oku.offers[i].kind;
        counts.wives[kind] = (counts.wives[kind] || 0) + 1;
        dev.marry(i);
      }
    } else if (s.phase === "ship") {
      const b = s.battle;
      if (!b.done) {
        if (b.round === 0 && b.results.length === 0) counts.shipsArrived.push(g.data.ships[b.ship].id);
        dev.fight(policy.boost(g));
      } else {
        dev.closeBattle();
      }
    } else if (s.phase === "ending") {
      counts.ending = s.year - FOUNDED;
      dev.continueAfterEnding();
    } else if (s.phase === "report") {
      dev.closeReport();
    } else if (s.phase === "talk") {
      // 時代の章・史実の節目の掛け合い（読むだけ）
      counts.talks += 1;
      dev.closeTalk();
    } else if (s.phase === "enthrone") {
      // 宣下の表紙。宿願を選ぶ（候補がなければ、掲げずに始める）
      const offers = s.reign.wishOffers || [];
      dev.chooseWish(offers.length ? (policy.wish ? policy.wish(g, offers) : 0) : null);
    } else if (s.phase === "reignEnd") {
      // 御治世の評定と遺言
      const sc = s.succession;
      if (sc.rating) counts.ratings.push(sc.rating);
      counts.ends[sc.reason] = (counts.ends[sc.reason] || 0) + 1;
      dev.chooseTestament(policy.testament ? policy.testament(g) : 0);
    } else if (s.phase === "succession") {
      const { mode, candidates } = s.succession;
      const pickIndex = policy.crown(g);
      const c = candidates[pickIndex];
      const key = mode === "dispute" ? "dispute" : !c.branchId ? "heir" : mode === "heirs" ? "bypass" : "branch";
      counts.succession[key] = (counts.succession[key] || 0) + 1;
      dev.crown(pickIndex);
      counts.shogunKaku.push(sum3(dev.state.shogun.stats));
    } else {
      throw new Error(`知らない場面: ${s.phase}`);
    }
  }

  const s = dev.state;
  const causes = [];
  if (s.phase === "over") {
    for (const [key, label] of [["ikou", "威光"], ["minshin", "民心"], ["chotei", "朝廷"]]) {
      if (s.gauges[key] <= dev.CONFIG.CRISIS_SAFE) causes.push(label);
    }
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
    warned: counts.warned,
    left: counts.left,
    raises: s.retainers.reduce((sum, r) => sum + (r.raises || 0), 0),
    candidates: avg(counts.candidates),
    renowned: (s.renownSeen || []).length,
    wives: counts.wives,
    stars: counts.stars,
    daughters: counts.daughters,
    meddle: counts.meddle,
    balancedYears: counts.balancedYears,
    lowYears: counts.lowYears,
    gaugeAvg: counts.gaugeSum / Math.max(1, s.year - 1637),
    sankeKaku: s.branches ? avg(s.branches.filter((b) => b.kind === "sanke").map((b) => sum3(b.blood))) : 0,
    kyo: s.branches ? s.branches.some((b) => b.kind === "kyo") : false,
    shipsArrived: counts.shipsArrived,
    shipsWon: s.ships ? s.ships.won : [],
    ending: counts.ending,
    blackFall: s.overReason === "black",
    repeatRate: counts.repeats / Math.max(1, counts.events),
    talks: counts.talks,
    kien: s.kien || 0,
    purse: counts.purse,
    ratings: counts.ratings,
    kakun: Object.values(s.kakun || {}).reduce((a, b) => a + b, 0),
    projects: (s.projectsDone || []).map((p) => p.total),
    projectsByYear: (s.projectsDone || []).filter((p) => p.year <= 1853).length,
    ends: counts.ends,
    firstKien: counts.firstKien,
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
  const SUCC_LABELS = { heir: "若君から", bypass: "若君をさしおいて分家から", branch: "分家から（若君なし）", dispute: "跡目争い" };

  console.log(`家康の憂鬱 自動プレイ ${n}回（遊び方: ${args.policy}、布石: ${args.fuseki}、種: ${args.seed}〜${args.seed + n - 1}）`);
  console.log(`続いた年数（開府から）: 平均 ${Math.round(avg(years))} / 中央 ${quantile(years, 0.5)} / 下位10% ${quantile(years, 0.1)} / 上位10% ${quantile(years, 0.9)} / 最短 ${years[0]} / 最長 ${years[n - 1]}`);
  console.log(`史実（265年）を超えた: ${pct(years.filter((y) => y > 265).length, n)}　${MAX_YEARS}年で打ち切り: ${pct(n - fallen.length, n)}`);
  console.log(`倒れたときに尽きていたもの: ${Object.entries(causeCount).map(([c, k]) => `${c} ${pct(k, fallen.length)}`).join(" / ") || "なし"}`);
  console.log(`威光・民心・朝廷のいちばん低いもの: ならして ${avg(results.map((r) => r.gaugeAvg)).toFixed(0)}　20を切った年 ${(avg(results.map((r) => r.lowYears / Math.max(1, r.years - 34))) * 100).toFixed(0)}%`);
  console.log(`将軍の代: 平均 ${avg(results.map((r) => r.gen)).toFixed(1)}　就任時の能力の合計: 平均 ${avg(results.flatMap((r) => r.shogunKaku)).toFixed(1)}`);
  console.log(`代替わりの形: ${Object.entries(succ).map(([m, k]) => `${SUCC_LABELS[m] || m} ${pct(k, succTotal)}`).join(" / ")}`);
  console.log(`生まれた若君: 1回あたり平均 ${avg(results.map((r) => r.heirsBorn)).toFixed(1)}人　栄誉: 平均 ${avg(results.map((r) => r.honors)).toFixed(1)}`);
  if (results.some((r) => r.candidates)) {
    const per100 = (key) => (avg(results.map((r) => (r[key] / Math.max(1, r.years)) * 100))).toFixed(1);
    console.log(`登用の候補: 毎年平均 ${avg(results.map((r) => r.candidates)).toFixed(2)}人　名のある人物: 1回あたり平均 ${avg(results.map((r) => r.renowned)).toFixed(1)}人`);
    console.log(`家臣の不満: 100年あたり 不満 ${per100("warned")}回 / 去った ${per100("left")}人　最後に残った家臣の加増: 平均 ${avg(results.map((r) => r.raises)).toFixed(1)}回`);
  }
  const starTotal = [0, 0, 0, 0, 0, 0];
  for (const r of results) (r.stars || []).forEach((k, i) => { starTotal[i] += k; });
  const sons = starTotal.reduce((a, b) => a + b, 0);
  if (sons > 0) {
    const wives = {};
    for (const r of results) for (const [kind, k] of Object.entries(r.wives || {})) wives[kind] = (wives[kind] || 0) + k;
    const WIFE_LABELS = { kuge: "公家の姫", daimyo: "大名の姫", kashin: "家臣の娘" };
    const wifeTotal = Object.values(wives).reduce((a, b) => a + b, 0);
    console.log(`若君の素質: ${[1, 2, 3, 4, 5].map((s) => `★${s} ${pct(starTotal[s], sons)}`).join(" / ")}　姫: 1回あたり平均 ${avg(results.map((r) => r.daughters)).toFixed(1)}人`);
    console.log(`正室: ${Object.entries(wives).map(([k, n]) => `${WIFE_LABELS[k] || k} ${pct(n, wifeTotal)}`).join(" / ")}（1回あたり平均 ${(wifeTotal / n).toFixed(1)}人）`);
  }
  if (results.some((r) => r.sankeKaku)) {
    const per100 = (key) => (avg(results.map((r) => (r[key] / Math.max(1, r.years)) * 100))).toFixed(1);
    console.log(`御三家: 終わりの血筋の格 平均 ${avg(results.map((r) => r.sankeKaku)).toFixed(1)}　釣り合っていた年 ${per100("balancedYears")}%　横やり 100年あたり ${per100("meddle")}回　御三卿を立てた ${pct(results.filter((r) => r.kyo).length, n)}`);
  }
  if (results.some((r) => r.shipsArrived && r.shipsArrived.length)) {
    const line = ["white", "red", "black"].map((id, i) => {
      const came = results.filter((r) => r.shipsArrived.includes(id)).length;
      const won = results.filter((r) => r.shipsWon.includes(id)).length;
      return `${["白船", "赤船", "黒船"][i]} 来た${pct(came, n)}・勝ち${came ? pct(won, came) : "—"}`;
    }).join(" / ");
    const endings = results.filter((r) => r.ending !== null).map((r) => r.ending);
    console.log(`異国船: ${line}　黒船に屈して倒幕 ${pct(results.filter((r) => r.blackFall).length, n)}　結末（黒船を退けた）${pct(endings.length, n)}${endings.length ? `（平均 開府${Math.round(avg(endings))}年）` : ""}`);
  }
  const ratings = results.flatMap((r) => r.ratings);
  if (ratings.length) {
    const titles = {};
    for (const x of ratings) titles[x.title] = (titles[x.title] || 0) + 1;
    const ends = {};
    for (const r of results) for (const [k, v] of Object.entries(r.ends)) ends[k] = (ends[k] || 0) + v;
    const endTotal = Object.values(ends).reduce((a, b) => a + b, 0);
    console.log(`御治世の評定: 平均${avg(ratings.map((x) => x.total)).toFixed(1)}/40　在位 平均${avg(ratings.map((x) => x.years)).toFixed(1)}年　`
      + Object.entries(titles).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, ratings.length)}`).join(' / '));
    const wished = ratings.filter((x) => x.wish);
    const byWish = {};
    for (const x of wished) {
      byWish[x.wish.label] = byWish[x.wish.label] || [0, 0];
      byWish[x.wish.label][0] += 1;
      if (x.wish.done) byWish[x.wish.label][1] += 1;
    }
    console.log(`宿願: 果たした ${pct(wished.filter((x) => x.wish.done).length, Math.max(1, wished.length))}（`
      + Object.entries(byWish).map(([k, [all, done]]) => `${k} ${pct(done, all)}`).join('・') + `）　終わりの家訓 平均${avg(results.map((r) => r.kakun)).toFixed(1)}段`);
    console.log(`代の終わり方: 病に伏したのち ${pct(ends.death || 0, endTotal)} / にわかに ${pct(ends.sudden || 0, endTotal)} / 職を譲る ${pct(ends.retire || 0, endTotal)}`);
  }
  const works = results.flatMap((r) => r.projects);
  if (works.length) {
    console.log(`普請: 1回あたり平均${avg(results.map((r) => r.projects.length)).toFixed(1)}件（1853年までに${avg(results.map((r) => r.projectsByYear)).toFixed(1)}件）　評定 平均${avg(works).toFixed(1)}/40`);
  }
  const kienGames = results.filter((r) => r.kien > 0);
  for (const y of [100, 200]) {
    const list = results.map((r) => r.purse[y]).filter(Boolean);
    if (list.length) console.log(`開府${y}年の暮れ（届いた${pct(list.length, n)}）: 現金 平均${Math.round(avg(list.map((x) => x.cash)))}万両・中央${Math.round(quantile(list.map((x) => x.cash).sort((a, b) => a - b), 0.5))}　借入 平均${Math.round(avg(list.map((x) => x.debt)))}万両`);
  }
  console.log(`借金の棒引き（棄捐令）: 命じた回 ${pct(kienGames.length, n)}　1回あたり平均 ${avg(results.map((r) => r.kien)).toFixed(1)}回${kienGames.length ? `（はじめて命じた年 平均 開府${Math.round(avg(kienGames.map((r) => r.firstKien)))}年）` : ""}`);
  console.log(`出来事: 前に見たものの再登場 ${pct(avg(results.map((r) => r.repeatRate)) * 100, 100)}　時代の章・史実の節目の掛け合い: 1回あたり平均 ${avg(results.map((r) => r.talks)).toFixed(1)}回`);
  console.log(`損のない選択肢（いちばんお金になり、威光・民心・朝廷を下げず、成否の判定も続きの出来事もないもの）: ${lossFree(g0Data()).join('、') || 'なし'}`);
  console.log(`（${((Date.now() - started) / 1000).toFixed(1)}秒）`);
}

main();
