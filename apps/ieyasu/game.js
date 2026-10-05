// 家康の憂鬱（試作版）の本体。
// 物語・出来事カード・制度のデータは cards.js、イラストは art.js にある。
// ここは「1年の流れ」「お金の帳簿」「組織」「家系図」と、画面の描画を受け持つ。
(() => {
  'use strict';

  const DATA = window.IEYASU_DATA;
  const ART = window.IEYASU_ART;

  const CONFIG = {
    START_YEAR: 1637,       // 本編が始まる年（東照宮完成の翌年）
    BAKUFU_FOUNDED: 1603,   // 幕府を開いた年（何年続いたかの起点）
    ABILITY_MAX: 20,
    ADULT_AGE: 15,          // これ未満で将軍になると「幼い将軍」
    TEACH_AGE_LIMIT: 20,    // この歳までは教育できる
    TEACH_COST: 10,         // 若君の教育費（万両/回）
    MAX_HEIRS: 3,
    HEIR_BIRTH_CHANCE: 0.2,
    CARD_COOLDOWN: 10,      // 同じ出来事は、この年数のあいだ出ない
    CRISIS_YEARS: 3,        // 危機になってから立て直すまでの猶予
    CRISIS_SAFE: 10,        // 威光・民心・朝廷がすべてこれを超え、借入が上限以下なら危機を脱する
    INTEREST: 0.08,         // 借入の利息（年）
    DEBT_LIMIT: 2,          // 借りられる上限は、その年の歳入のこの倍まで
    LOAN_STEP: 20,          // 財務画面で1回に借りる・返す額（万両）
    RICE_STEP: 20,          // 財務画面で1回に売る蔵米（万両ぶん）
    MAX_RETAINERS: 12,
    CANDIDATES: 2,          // 毎年あらわれる登用の候補
    BOOKS_KEPT: 30,         // 決算を何年ぶん残すか
    STRESS_EAGER: -6,       // 将軍の好みに合う裁きをすると、気苦労が減る
    STRESS_RELUCTANT: 6,    // 好みに合わない裁きをすると、気苦労がたまる
    STRESS_DECAY: 2,        // 毎年、自然に減る気苦労
  };

  const STATE_LABELS = { ikou: '威光', minshin: '民心', chotei: '朝廷' };
  const ABILITY_LABELS = { seimu: '政務', bui: '武威', jintoku: '人徳', kenko: '健康' };
  const RETAINER_LABELS = { seimu: '政務', sanyo: '算用', bui: '武威', jinbo: '人望' };
  const TEACH_LABELS = { seimu: '学問', bui: '武芸', jintoku: '人の道', kenko: '養生' };
  const FIN_LABELS = {
    ryo: ['現金', '万両'], borrow: ['借入', '万両'], rice: ['蔵米', '万両'], kokudaka: ['天領の石高', '万石'],
    mine: ['金銀山の産出', '万両/年'], trade: ['運上金・交易', '万両/年'], ooku: ['大奥の費え', '万両/年'],
  };
  const OTHER_LABELS = { jisseki: '実績', health: '将軍の健康', stress: '将軍の気苦労', recruit: '登用の候補', debtCut: '借入の帳消し' };
  const TRAITS = ['慎重', '豪胆', '寛大', '倹約', '華美'];
  const CHILD_NAMES = ['竹千代', '長松', '徳松', '亀松', '鶴松', '国松', '万寿丸', '虎松', '福松', '松千代'];
  // 本編はオリジナルの歴史なので、実在の将軍とは違う名前にする
  const NAME_KANJI = ['信', '昌', '貞', '盛', '隆', '寛', '泰', '弘', '保', '和', '成', '明', '敬', '直', '房',
    '輝', '長', '孝', '正', '清', '時', '邦', '周', '範', '教', '良', '景', '義', '道', '元'];
  const SURNAMES = ['本多', '酒井', '井伊', '土井', '阿部', '堀田', '大久保', '水野', '稲葉', '青山', '戸田', '板倉',
    '牧野', '久世', '秋元', '大岡', '内藤', '鳥居', '榊原', '小笠原', '保科', '安藤', '松浦', '植村', '永井', '太田'];
  const GIVEN = ['正', '忠', '信', '勝', '重', '秀', '直', '利', '政', '清', '長', '元', '之', '次', '則', '経', '隆', '房', '昌', '貞'];
  const GOSANKE = [
    { house: '尾張家', founder: '義直' },
    { house: '紀伊家', founder: '頼宣' },
    { house: '水戸家', founder: '頼房' },
  ];

  // 組織の役職。stat はその役職で使う家臣の能力
  const POSTS = [
    { id: 'roju', name: '老中', stat: 'seimu', desc: '政の要。「政務」で決まる判断を助け、腕が立てば実績も増える。' },
    { id: 'kanjo', name: '勘定奉行', stat: 'sanyo', desc: '金蔵の番人。年貢の取り立てと経費の多さを左右する。' },
    { id: 'machi', name: '町奉行', stat: 'jinbo', desc: '江戸の町と民を治める。毎年の民心と、「人徳」で決まる判断を助ける。' },
    { id: 'ometsuke', name: '大目付', stat: 'bui', desc: '大名を見張る。毎年の威光と、「武威」で決まる判断を助ける。' },
    { id: 'shoshidai', name: '京都所司代', stat: 'seimu', desc: '京で朝廷と向き合う。毎年の朝廷との関係を左右する。' },
    { id: 'jisha', name: '寺社奉行', stat: 'jinbo', desc: '寺社と東照宮を預かる。毎年の威光と民心をわずかに支える。' },
  ];
  const CHECK_POST = { seimu: 'roju', bui: 'ometsuke', jintoku: 'machi' };

  const TABS = [
    { id: 'seimu', icon: '政', label: '政務' },
    { id: 'family', icon: '系', label: '家系図' },
    { id: 'finance', icon: '財', label: '財務' },
    { id: 'org', icon: '組', label: '組織' },
    { id: 'log', icon: '記', label: '記録' },
  ];

  const SAVE_KEY = 'ieyasu-save';
  const BEST_KEY = 'ieyasu-best';
  const TUTORIAL_KEY = 'ieyasu-tutorial-done';
  const HONORS_KEY = 'ieyasu-honors';   // これまでの周回で得た栄誉（周回をまたいで残る）
  const SAVE_VERSION = 2;

  let state = null;
  // 画面だけの状態（保存しない）。coach はチュートリアルの何番目を見せているか
  const ui = { tab: 'seimu', person: null, bookYear: 'now', coach: null, coachLine: 0 };

  // ─────────────────────────────── 小さな道具

  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
  const money = (n) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else if (key === 'onchange') node.addEventListener('change', value);
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key === 'selected') node.selected = Boolean(value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  const $ = (id) => document.getElementById(id);

  function institution(id) {
    return DATA.institutions.find((i) => i.id === id);
  }

  function hasInstitution(id) {
    return state.institutions.includes(id);
  }

  function addLog(text) {
    state.log.unshift({ year: state.year, text });
    state.log = state.log.slice(0, 80);
  }

  function bakufuYears() {
    return state.year - CONFIG.BAKUFU_FOUNDED;
  }

  // 年が進むほど、悪い出来事の痛手が大きくなる
  function difficulty() {
    return 1 + Math.max(0, state.year - CONFIG.START_YEAR) / 150;
  }

  // 物価。年が進むほど上がり、支出（俸禄・費え・出来事の費用）がかさむ。年貢は石高で決まるので物価には追いつかない
  function price() {
    return 1 + Math.max(0, state.year - CONFIG.START_YEAR) / 85;
  }

  function nextId() {
    state.nextId += 1;
    return state.nextId;
  }

  // ─────────────────────────────── 保存

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      // 保存できない環境（プライベートモードなど）でも遊べるようにする
    }
  }

  // あとから増えた項目を、古い保存データにも足しておく
  function migrate(saved) {
    saved.flags = saved.flags || {};
    saved.tension = saved.tension || 0;
    saved.synergies = saved.synergies || [];
    saved.honors = saved.honors || [];
    if (saved.shogun && saved.shogun.stress === undefined) saved.shogun.stress = 0;
    return saved;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && saved.version === SAVE_VERSION) return migrate(saved);
    } catch (e) {
      // 壊れた保存データや古い形式は捨てて、はじめからにする
    }
    return null;
  }

  function loadBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(years) {
    try {
      if (years > loadBest()) localStorage.setItem(BEST_KEY, String(years));
    } catch (e) {
      // 記録できなくてもゲームは続けられる
    }
  }

  function loadHonors() {
    try {
      return JSON.parse(localStorage.getItem(HONORS_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHonor(id) {
    try {
      const all = loadHonors();
      if (!all.includes(id)) localStorage.setItem(HONORS_KEY, JSON.stringify(all.concat(id)));
    } catch (e) {
      // 記録できなくてもゲームは続けられる
    }
  }

  function tutorialDone() {
    try {
      return localStorage.getItem(TUTORIAL_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function markTutorialDone() {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch (e) {
      // 記録できなければ、次に開いたときにもう一度出るだけ
    }
  }

  // ─────────────────────────────── はじまり

  function newGame() {
    state = {
      version: SAVE_VERSION,
      phase: 'prologue',
      prologueStep: 0,
      prologueLine: 0,
      prologueNote: null,
      year: 1616,
      nextId: 0,
      gauges: { ikou: 60, minshin: 55, chotei: 50 },
      fin: { cash: 250, rice: 60, debt: 0, kokudaka: 400, mine: 30, trade: 5, ooku: 10, infra: 200, lastRevenue: 120 },
      jisseki: 0,
      shogun: null,
      heirs: [],
      retainers: [],
      candidates: [],
      institutions: [],
      usedNames: ['家康', '秀忠', '家光'],
      seen: {},
      card: null,
      result: null,
      succession: null,
      crisis: null,
      ledger: { year: CONFIG.START_YEAR, items: [] },
      books: [],
      family: [],
      log: [],
      flags: {},        // 過去の選択の印（数年後の出来事につながる）。値は印をつけた年
      tension: 0,       // 厳しい出来事が続いた度合い。高いほど良い出来事が来やすい
      synergies: [],    // そろった制度の組み合わせ
      honors: [],       // この周回で得た栄誉
      legacy: null,     // 最後の布石で選んだ遺訓（制度でないもの）
      report: null,     // 一年の決算報告
      nextPhase: null,  // 決算報告のあとに進む場面
      yearStart: null,  // 年のはじめの状態（決算報告で増減を出すため）
    };

    // 家系図（史実の部分）
    const ieyasu = addPerson({ name: '家康', born: 1543, parentId: null, trait: '慎重', gen: 1, from: 1603, to: 1605,
      start: { seimu: 18, bui: 18, jintoku: 16 }, note: '幕府を開く。将軍職を秀忠に譲り、大御所として政を見る。' });
    GOSANKE.forEach((g, i) => {
      addPerson({ name: g.founder, born: 1600 + i * 2, parentId: ieyasu.id, house: g.house, note: `${g.house}の祖。` });
    });
    const hidetada = addPerson({ name: '秀忠', born: 1579, parentId: ieyasu.id, trait: '慎重', gen: 2, from: 1605, to: 1623,
      start: { seimu: 12, bui: 9, jintoku: 11 }, note: '将軍職を家光に譲る。' });
    hidetada.end = { ...hidetada.start };
    ieyasu.end = { ...ieyasu.start };
    const iemitsu = addPerson({ name: '家光', born: 1604, parentId: hidetada.id, trait: '華美', gen: 3, from: 1623,
      start: { seimu: 9, bui: 8, jintoku: 7 } });

    state.shogun = {
      personId: iemitsu.id, name: '家光', gen: 3, age: 33, health: 35, startYear: 1623, trait: '華美',
      stats: { seimu: 9, bui: 8, jintoku: 7 }, stress: 0,
    };

    // 家光の時代の家臣たち
    const seeded = [
      { name: '松平信綱', age: 41, stats: { seimu: 17, sanyo: 12, bui: 8, jinbo: 10 }, post: 'roju' },
      { name: '板倉重宗', age: 51, stats: { seimu: 14, sanyo: 9, bui: 7, jinbo: 12 }, post: 'shoshidai' },
      { name: '酒井忠勝', age: 50, stats: { seimu: 13, sanyo: 10, bui: 10, jinbo: 11 }, post: null },
    ];
    for (const r of seeded) state.retainers.push(makeRetainer(r));
    for (const post of ['kanjo', 'machi', 'ometsuke', 'jisha']) {
      const r = makeRetainer();
      r.stats[POSTS.find((p) => p.id === post).stat] = rand(9, 13);
      r.salary = salaryOf(r.stats);
      r.post = post;
      state.retainers.push(r);
    }
    state.candidates = makeCandidates();
    return state;
  }

  function addPerson(p) {
    const added = { id: nextId(), insts: [], ...p };
    state.family.push(added);
    return added;
  }

  function person(id) {
    return state.family.find((p) => p.id === id);
  }

  // 家光が若くして天に昇り、権現様（プレイヤー）が霊体となって江戸城に降りるところから本編が始まる
  function startMain() {
    state.year = CONFIG.START_YEAR;
    state.phase = 'event';
    state.ledger = { year: state.year, items: [] };

    // 家光の忘れ形見（家光の子として家系図に記す）
    const heir = makeHeir('竹千代');
    closeReign('33歳で病に倒れ、天に昇る。霊体となって権現様に付き従う。');
    addLog('家光が天に昇った。権現様は東照宮の力で霊体となり、江戸城に降りた。');

    // 将軍は家光の異母弟・保科正之が継ぐ
    const hidetada = state.family.find((p) => p.name === '秀忠');
    const masayuki = addPerson({ name: '正之', born: 1611, parentId: hidetada.id, house: '保科家', trait: '慎重',
      gen: 4, from: state.year, start: { seimu: 14, bui: 9, jintoku: 13 } });
    state.usedNames.push('正之');
    state.shogun = {
      personId: masayuki.id, name: '正之', gen: 4, age: 26, health: 70, startYear: state.year, trait: '慎重',
      stats: { ...masayuki.start }, stress: 0,
    };
    addLog('家光の異母弟・保科正之が、第4代将軍となった。');
    state.heirs.push(heir);
    addLog(`家光の忘れ形見、若君・${heir.name}が生まれた。`);
    applyLegacy(heir);
    for (const id of state.institutions) applyInstitutionOn(id);
    state.yearStart = snapshot();
    drawCard();
  }

  // 最後の布石で、制度ではなく「遺訓」を選んだときの効果
  function applyLegacy(heir) {
    const bonus = state.legacy;
    if (bonus === 'retainers') {
      for (const r of state.retainers) {
        if (!r.post) continue;
        const stat = POSTS.find((p) => p.id === r.post).stat;
        r.stats[stat] = clamp(r.stats[stat] + 3, 1, CONFIG.ABILITY_MAX);
        r.salary = salaryOf(r.stats);
      }
      addLog('遺訓により、家臣たちはよく鍛えられていた。');
    } else if (bonus === 'treasury') {
      state.fin.cash += 150;
      addLog('遺訓により、金蔵には150万両が蓄えられていた。');
    } else if (bonus === 'heir') {
      for (const k of Object.keys(heir.stats)) heir.stats[k] = clamp(heir.stats[k] + 3, 1, CONFIG.ABILITY_MAX);
      addLog('遺訓により、若君の養育の手はずが整っていた。');
    } else if (bonus === 'kokudaka') {
      state.fin.kokudaka += 60;
      addLog('遺訓により、天下普請で天領の田が広がっていた。');
    }
  }

  // 年のはじめの状態を覚えておく
  function snapshot() {
    return { gauges: { ...state.gauges }, cash: Math.round(state.fin.cash), debt: Math.round(state.fin.debt), net: Math.round(netAssets()) };
  }

  // ─────────────────────────────── 若君と将軍

  function makeHeir(name) {
    const parent = state.shogun.stats;
    const inherit = (v) => clamp(Math.round(v * 0.3) + rand(2, 6), 1, CONFIG.ABILITY_MAX);
    const used = state.heirs.map((h) => h.name);
    const heirName = name || pick(CHILD_NAMES.filter((n) => !used.includes(n)));
    const trait = Math.random() < 0.5 ? state.shogun.trait : pick(TRAITS);
    const p = addPerson({ name: heirName, childName: heirName, born: state.year, parentId: state.shogun.personId, trait });
    return {
      personId: p.id,
      name: heirName,
      age: 0,
      trait,
      stats: {
        seimu: inherit(parent.seimu),
        bui: inherit(parent.bui),
        jintoku: inherit(parent.jintoku),
        kenko: rand(6, 14),
      },
      taughtYear: null,
    };
  }

  function makeShogunName() {
    const unused = NAME_KANJI.map((k) => `家${k}`).filter((n) => !state.usedNames.includes(n));
    const name = unused.length > 0 ? pick(unused) : `家${pick(NAME_KANJI)}`;
    state.usedNames.push(name);
    return name;
  }

  function eldestHeir() {
    return state.heirs.reduce((a, b) => (b.age > a.age ? b : a), state.heirs[0]);
  }

  // ─────────────────────────────── 家臣

  function salaryOf(stats) {
    const sum = Object.values(stats).reduce((a, b) => a + b, 0);
    return Math.max(1, Math.round(sum / 12));
  }

  function makeRetainer(seed = {}) {
    let name = seed.name;
    if (!name) {
      const used = new Set(state.retainers.map((r) => r.name).concat(state.candidates.map((c) => c.name)));
      do {
        name = `${pick(SURNAMES)}${pick(GIVEN)}${pick(GIVEN)}`;
      } while (used.has(name) || name[name.length - 1] === name[name.length - 2]);
    }
    const stats = seed.stats || { seimu: rand(3, 10), sanyo: rand(3, 10), bui: rand(3, 10), jinbo: rand(3, 10) };
    if (!seed.stats) {
      const strong = pick(Object.keys(stats));
      stats[strong] = clamp(stats[strong] + rand(3, 8), 1, CONFIG.ABILITY_MAX);
    }
    const id = nextId();
    return { id, name, age: seed.age || rand(22, 40), stats, salary: salaryOf(stats), post: seed.post || null, seed: id * 7 + name.length };
  }

  function makeCandidates() {
    return Array.from({ length: CONFIG.CANDIDATES }, () => makeRetainer({ age: rand(20, 34) }));
  }

  function holder(postId) {
    return state.retainers.find((r) => r.post === postId) || null;
  }

  // 役職の働きぶり。空席なら 4 として扱う（空席は損）
  function postValue(postId) {
    const h = holder(postId);
    const post = POSTS.find((p) => p.id === postId);
    return h ? h.stats[post.stat] : 4;
  }

  function postBonus(postId, div = 4) {
    return Math.round((postValue(postId) - 10) / div);
  }

  function assign(retainerId, postId) {
    const current = holder(postId);
    if (current) current.post = null;
    const r = state.retainers.find((x) => x.id === retainerId);
    if (r) {
      r.post = postId;
      addLog(`${r.name}を${POSTS.find((p) => p.id === postId).name}に任じた。`);
    }
    commit();
  }

  function autoAssign() {
    for (const post of POSTS) {
      if (holder(post.id)) continue;
      const free = state.retainers.filter((r) => !r.post);
      if (free.length === 0) break;
      const best = free.reduce((a, b) => (b.stats[post.stat] > a.stats[post.stat] ? b : a));
      best.post = post.id;
      addLog(`${best.name}を${post.name}に任じた。`);
    }
    commit();
  }

  function hire(index) {
    if (state.retainers.length >= CONFIG.MAX_RETAINERS) return;
    const c = state.candidates.splice(index, 1)[0];
    state.retainers.push(c);
    addLog(`${c.name}を召し抱えた（俸禄 年${c.salary}万両）。`);
    commit();
  }

  function dismiss(id) {
    const r = state.retainers.find((x) => x.id === id);
    if (!r || !window.confirm(`${r.name}に暇を出しますか？`)) return;
    state.retainers = state.retainers.filter((x) => x.id !== id);
    addLog(`${r.name}に暇を出した。`);
    commit();
  }

  function vacancies() {
    return POSTS.filter((p) => !holder(p.id));
  }

  // ─────────────────────────────── 帳簿

  // cf: 'op'（営業）/ 'inv'（投資）/ 'fin'（財務）
  function book(cf, label, amount) {
    if (amount === 0) return;
    state.ledger.items.push({ cf, label, amount: Math.round(amount) });
  }

  function debtLimit() {
    return Math.round(state.fin.lastRevenue * CONFIG.DEBT_LIMIT);
  }

  function assets() {
    const f = state.fin;
    return [
      { label: '金蔵の現金', value: Math.max(0, Math.round(f.cash)) },
      { label: '蔵米', value: Math.round(f.rice) },
      { label: '金銀山（産出の8年ぶん）', value: Math.round(f.mine * 8) },
      { label: '城・堤・街道などの普請', value: Math.round(f.infra) },
    ];
  }

  function netAssets() {
    return assets().reduce((a, b) => a + b.value, 0) - state.fin.debt;
  }

  function borrow(amount, label = '商人からの借入') {
    state.fin.cash += amount;
    state.fin.debt += amount;
    book('fin', label, amount);
  }

  function repay() {
    const amount = Math.min(CONFIG.LOAN_STEP, state.fin.debt);
    if (amount <= 0 || state.fin.cash < amount) return;
    state.fin.cash -= amount;
    state.fin.debt -= amount;
    book('fin', '借入の返済', -amount);
    addLog(`借入を${amount}万両返した。`);
    commit();
  }

  function borrowMore() {
    if (state.fin.debt + CONFIG.LOAN_STEP > debtLimit()) return;
    borrow(CONFIG.LOAN_STEP);
    addLog(`商人から${CONFIG.LOAN_STEP}万両借りた。`);
    commit();
  }

  function sellRice() {
    const amount = Math.min(CONFIG.RICE_STEP, Math.floor(state.fin.rice));
    if (amount <= 0) return;
    state.fin.rice -= amount;
    state.fin.cash += amount;
    book('op', '蔵米の売却', amount);
    addLog(`蔵米を${amount}万両ぶん売った。`);
    commit();
  }

  // 1年の決算。収入と経常の支出を帳簿につけ、帳簿を締める
  function closeBooks() {
    const f = state.fin;
    const s = state.shogun;
    const inflation = price();
    const kanjo = postValue('kanjo');

    const nengu = Math.round(f.kokudaka * 0.25 * (0.7 + state.gauges.minshin / 400) * (0.9 + s.stats.seimu / 100)
      * (1 + (kanjo - 10) * 0.015) * (hasInstitution('kanjo') ? 1.08 : 1));
    const mine = Math.round(f.mine);
    // 商いは時代とともに大きくなる（交易の上がりは年々増える）
    const trade = Math.round(f.trade * (1 + (state.year - CONFIG.START_YEAR) / 250));
    const costRate = 1 - (kanjo - 10) * 0.01 - (hasInstitution('kanjo') ? 0.05 : 0);
    const hatamoto = Math.round(60 * inflation * costRate);
    const salaries = state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : Math.ceil(r.salary / 2)), 0);
    const ooku = Math.round(f.ooku * inflation * costRate);
    const court = Math.round(5 * inflation * costRate);
    const upkeep = state.institutions.reduce((sum, id) => sum + (institution(id)?.upkeep || 0), 0);
    const interest = Math.round(f.debt * CONFIG.INTEREST);

    const regular = [
      ['op', '年貢', nengu], ['op', '金銀山', mine], ['op', '運上金・交易', trade],
      ['op', '旗本・御家人の俸禄', -hatamoto], ['op', '家臣の俸禄', -salaries], ['op', '大奥の費え', -ooku],
      ['op', '朝廷・寺社への費え', -court], ['op', '制度の維持費', -upkeep], ['fin', '借入の利息', -interest],
    ];
    for (const [cf, label, amount] of regular) {
      f.cash += amount;
      book(cf, label, amount);
    }
    f.lastRevenue = nengu + mine + trade;

    // 現金が尽きたら、商人から借りてしのぐ
    if (f.cash < 0) {
      const need = Math.ceil(-f.cash) + 10;
      borrow(need, '商人からの借入（資金繰り）');
      applyEffects({ ikou: -2 });
      addLog(`金蔵が空になり、商人から${need}万両を借りてしのいだ。`);
    }

    // 資産の目減り（金山は掘るほど細り、蔵米は傷み、普請は古びる）
    f.mine = Math.max(0, f.mine * 0.985);
    f.rice = Math.max(0, f.rice * 0.95);
    f.infra = Math.max(0, f.infra * 0.99);

    const total = (cf) => state.ledger.items.filter((i) => i.cf === cf).reduce((a, b) => a + b.amount, 0);
    state.books.unshift({
      year: state.year, items: state.ledger.items,
      op: total('op'), inv: total('inv'), fin: total('fin'),
      cash: Math.round(f.cash), debt: Math.round(f.debt), net: Math.round(netAssets()),
    });
    state.books = state.books.slice(0, CONFIG.BOOKS_KEPT);
  }

  // ─────────────────────────────── 出来事

  function cardById(id) {
    return DATA.cards.find((c) => c.id === id);
  }

  // 出来事の出やすさ。厳しい出来事が続いたあとは良い出来事が、穏やかな年が続けば厳しい出来事が来やすい
  function cardWeight(card) {
    if (card.trial) return 0.5 + (state.year - card.minYear) / 50;
    let w = card.weight || 1;
    if (card.followUp) w *= 3;
    if (card.tone === 'good') w *= 1 + state.tension * 0.6;
    if (card.tone === 'bad') w /= 1 + state.tension * 0.5;
    return w;
  }

  // 出来事の文中の {roju} などを、いまの役職の家臣の名前に置き換える
  function fillNames(text) {
    return text.replace(/\{(\w+)\}/g, (all, key) => {
      if (key === 'shogun') return state.shogun.name;
      const post = POSTS.find((p) => p.id === key);
      if (!post) return all;
      const h = holder(key);
      return h ? `${post.name}・${h.name}` : `${post.name}（空席）`;
    });
  }

  function drawCard() {
    // cards.js の when(s) は s.shogunate と s.heirs を見る
    const view = { ...state, shogunate: state.gauges };
    const usable = (card, useCooldown) => {
      if (card.minYear && state.year < card.minYear) return false;
      if (card.when && !card.when(view)) return false;
      const last = state.seen[card.id];
      if (last === undefined) return true;
      if (card.once) return false;
      return !useCooldown || state.year - last >= CONFIG.CARD_COOLDOWN;
    };
    let pool = DATA.cards.filter((c) => usable(c, true));
    if (pool.length === 0) pool = DATA.cards.filter((c) => usable(c, false));

    const total = pool.reduce((sum, c) => sum + cardWeight(c), 0);
    let roll = Math.random() * total;
    let chosen = pool[pool.length - 1];
    for (const c of pool) {
      roll -= cardWeight(c);
      if (roll <= 0) { chosen = c; break; }
    }
    state.card = { id: chosen.id };
  }

  function checkAbility(check) {
    const post = CHECK_POST[check.stat];
    const bonus = post ? Math.max(0, Math.floor((postValue(post) - 8) / 3)) : 0;
    return state.shogun.stats[check.stat] + bonus;
  }

  function successChance(check) {
    return clamp(0.5 + (checkAbility(check) - check.dc) * 0.07, 0.15, 0.92);
  }

  function isGuarded(kind) {
    return Boolean(kind) && state.institutions.some((id) => institution(id)?.guards === kind);
  }

  // 費用の見込み（物価を反映）
  function scaledCost(ryo) {
    return ryo < 0 ? Math.round(ryo * price()) : ryo;
  }

  // 効果を反映し、画面に出す「何がどれだけ変わったか」の一覧を返す
  function applyEffects(effects, opts = {}) {
    const changes = [];
    if (!effects) return changes;
    const guarded = isGuarded(opts.kind);
    const f = state.fin;
    for (const [key, raw] of Object.entries(effects)) {
      if (key === 'heir') {
        const heir = eldestHeir();
        if (!heir) continue;
        for (const [stat, v] of Object.entries(raw)) {
          heir.stats[stat] = clamp(heir.stats[stat] + v, 1, CONFIG.ABILITY_MAX);
          changes.push({ label: `${heir.name}の${ABILITY_LABELS[stat]}`, delta: v });
        }
        continue;
      }
      let v = raw;
      let unit = '';
      if (STATE_LABELS[key]) {
        if (v < 0) v = Math.round(v * difficulty());
        if (v < 0 && guarded) v = Math.ceil(v / 2);
        state.gauges[key] = clamp(state.gauges[key] + v, 0, 100);
      } else if (key === 'ryo') {
        v = scaledCost(v);
        if (v < 0 && guarded) v = Math.ceil(v / 2);
        f.cash += v;
        if (opts.invest && v < 0) {
          f.infra += -v;
          book('inv', opts.label || '普請', v);
        } else {
          book('op', opts.label ? `臨時：${opts.label}` : '臨時の出入り', v);
        }
        unit = '万両';
      } else if (key === 'borrow') {
        borrow(v);
        unit = '万両';
      } else if (FIN_LABELS[key]) {
        f[key] = Math.max(0, f[key] + v);
        unit = FIN_LABELS[key][1];
      } else if (key === 'jisseki') {
        state.jisseki = Math.max(0, state.jisseki + v);
      } else if (key === 'health') {
        state.shogun.health = clamp(state.shogun.health + v, 0, 100);
      } else if (key === 'stress') {
        state.shogun.stress = clamp((state.shogun.stress || 0) + v, 0, 100);
      } else if (key === 'recruit') {
        // 腕の立つ若者が、登用の候補に加わる
        for (let i = 0; i < v; i++) {
          const r = makeRetainer({ age: rand(20, 28) });
          const strong = Object.keys(r.stats).reduce((a, b) => (r.stats[b] > r.stats[a] ? b : a));
          r.stats[strong] = clamp(r.stats[strong] + 4, 1, CONFIG.ABILITY_MAX);
          r.salary = salaryOf(r.stats);
          state.candidates.push(r);
        }
        unit = '人';
      } else if (key === 'debtCut') {
        v = Math.min(v, Math.round(f.debt));
        f.debt -= v;
        v = -v;
        unit = '万両';
      } else {
        continue;
      }
      const label = STATE_LABELS[key] || (FIN_LABELS[key] && FIN_LABELS[key][0]) || OTHER_LABELS[key];
      if (v !== 0) changes.push({ label, delta: v, unit });
    }
    return changes;
  }

  function choose(index) {
    const card = cardById(state.card.id);
    const option = card.options[index];

    let success = true;
    if (option.check) success = Math.random() < successChance(option.check);
    const changes = applyEffects(success ? option.effects : option.fail,
      { kind: card.kind, invest: option.invest, label: card.title });

    // 将軍の好みに合う裁きなら、将軍は乗り気で取り組み、経験を積んで育ち、気苦労も減る。
    // 合わない裁きを押しつけると、気苦労がたまる
    const sh = state.shogun;
    const eager = option.tag === sh.trait;
    let growth = null;
    if (eager) {
      sh.stress = clamp((sh.stress || 0) + CONFIG.STRESS_EAGER, 0, 100);
      if (option.grow && sh.stats[option.grow] < CONFIG.ABILITY_MAX) {
        sh.stats[option.grow] += 1;
        growth = `将軍は乗り気で取り組み、${ABILITY_LABELS[option.grow]}が1上がった。気苦労も少し晴れた。`;
      }
    } else if (option.tag) {
      sh.stress = clamp((sh.stress || 0) + CONFIG.STRESS_RELUCTANT, 0, 100);
      growth = `${sh.trait}な将軍は渋々従った（気苦労+${CONFIG.STRESS_RELUCTANT}、いま${sh.stress}）。`;
    }

    // 選択の印（数年後の出来事につながる）
    if (option.flag) state.flags[option.flag] = state.year;
    if (card.clears) delete state.flags[card.clears];
    // 緊張と緩和
    if (card.tone === 'bad' || card.trial) state.tension = Math.min(4, state.tension + 1);
    else if (card.tone === 'good') state.tension = 0;
    else state.tension = Math.max(0, state.tension - 1);

    state.seen[card.id] = state.year;
    state.result = {
      title: card.title,
      choice: option.label,
      text: fillNames(success ? option.text : option.failText),
      failed: !success,
      changes,
      growth,
    };
    addLog(`${card.title}：「${option.label}」${success ? '' : '……しくじった'}`);
    state.phase = 'result';
    commit();
  }

  // ─────────────────────────────── 政務の間（教育・制度・隠居）

  function teachCost() {
    return Math.round(CONFIG.TEACH_COST * price());
  }

  function teach(heirIndex, stat) {
    const heir = state.heirs[heirIndex];
    if (!heir || heir.taughtYear === state.year) return;
    const cost = teachCost();
    state.fin.cash -= cost;
    book('op', '若君の教育費', -cost);
    const gain = 2 + (hasInstitution('gakumon') ? 1 : 0);
    heir.stats[stat] = clamp(heir.stats[stat] + gain, 1, CONFIG.ABILITY_MAX);
    heir.taughtYear = state.year;
    addLog(`若君・${heir.name}に${TEACH_LABELS[stat]}の師をつけた（${ABILITY_LABELS[stat]}+${gain}、${cost}万両）。`);
    commit();
  }

  function institutionCost(inst) {
    return Math.round((inst.ryo || 0) * price());
  }

  function institutionStatus(inst) {
    if (hasInstitution(inst.id)) return { ok: false, reason: '整備済み' };
    if (state.jisseki < inst.cost) return { ok: false, reason: `実績が${inst.cost}必要` };
    for (const [key, min] of Object.entries(inst.requires || {})) {
      if (state.gauges[key] < min) return { ok: false, reason: `${STATE_LABELS[key]}が${min}必要` };
    }
    if (state.fin.cash < institutionCost(inst)) return { ok: false, reason: `現金が${institutionCost(inst)}万両必要` };
    return { ok: true };
  }

  function applyInstitutionOn(id) {
    const on = institution(id)?.on;
    if (on) applyEffects(on);
  }

  function establish(id) {
    const inst = institution(id);
    if (!institutionStatus(inst).ok) return;
    const cost = institutionCost(inst);
    state.jisseki -= inst.cost;
    state.fin.cash -= cost;
    state.fin.infra += cost;
    book('inv', `制度の整備：${inst.name}`, -cost);
    state.institutions.push(id);
    person(state.shogun.personId).insts.push(inst.name);
    applyInstitutionOn(id);
    addLog(`制度「${inst.name}」を整えた。この制度は代をまたいで残る。`);
    checkSynergies();
    commit();
  }

  // 制度の組み合わせがそろったら、隠れた効果が生まれる
  function checkSynergies() {
    for (const syn of DATA.synergies) {
      if (state.synergies.includes(syn.id)) continue;
      if (!syn.needs.every((id) => hasInstitution(id))) continue;
      state.synergies.push(syn.id);
      if (syn.on) applyEffects(syn.on);
      addLog(`組み合わせの妙「${syn.name}」が生まれた。${syn.desc}`);
    }
  }

  // 栄誉。この周回で初めて得たものを返す
  function checkHonors() {
    const view = {
      years: bakufuYears(), gen: state.shogun.gen, shogun: state.shogun, fin: state.fin, gauges: state.gauges,
      institutions: state.institutions.length, synergies: state.synergies.length,
      postsAll: (min) => POSTS.every((p) => postValue(p.id) >= min),
    };
    const earned = [];
    for (const h of DATA.honors) {
      if (state.honors.includes(h.id) || !h.check(view)) continue;
      state.honors.push(h.id);
      saveHonor(h.id);
      earned.push(h);
      addLog(`栄誉「${h.name}」を得た。${h.desc}`);
    }
    return earned;
  }

  function canRetire() {
    return state.heirs.some((h) => h.age >= CONFIG.ADULT_AGE);
  }

  function retire() {
    if (!canRetire()) return;
    if (!window.confirm(`${state.shogun.name}を隠居させ、将軍職を譲りますか？`)) return;
    addLog(`${state.shogun.name}は将軍職を退き、大御所となった。`);
    startSuccession('retire');
    commit();
  }

  // ─────────────────────────────── 年を越す

  function endYear() {
    const s = state.shogun;
    const notes = [];

    // 制度と、制度の組み合わせの効果（毎年）
    for (const id of state.institutions) {
      const yearly = institution(id)?.yearly;
      if (yearly) applyEffects(yearly);
    }
    for (const id of state.synergies) {
      const yearly = DATA.synergies.find((x) => x.id === id)?.yearly;
      if (yearly) applyEffects(yearly);
    }

    // 将軍と役職の働きによる自然な増減。時代が下るほど大名は幕府を恐れなくなる
    const era = Math.floor((state.year - CONFIG.START_YEAR) / 50);
    const drift = {
      ikou: Math.floor(s.stats.bui / 5) - 2 - Math.floor(era / 2) + postBonus('ometsuke') + postBonus('jisha', 8),
      minshin: Math.floor(s.stats.jintoku / 5) - 2 + postBonus('machi') + postBonus('jisha', 8),
      chotei: postBonus('shoshidai') + (state.gauges.chotei > 60 ? -1 : 0),
    };
    // 満ち足りた状態は長続きしない（慢心）
    for (const key of Object.keys(drift)) {
      if (state.gauges[key] > 80) drift[key] -= 2;
    }
    applyEffects(drift);
    state.jisseki += 1 + (s.stats.seimu >= 12 ? 1 : 0) + (postValue('roju') >= 14 ? 1 : 0);

    closeBooks();

    // 家臣が歳をとる。腕は役目の中で磨かれ、老いれば職を辞す
    for (const r of [...state.retainers]) {
      r.age += 1;
      if (r.post && r.age < 45 && Math.random() < 0.3) {
        const stat = POSTS.find((p) => p.id === r.post).stat;
        r.stats[stat] = clamp(r.stats[stat] + 1, 1, CONFIG.ABILITY_MAX);
        r.salary = salaryOf(r.stats);
      }
      if (r.age > 58 && Math.random() < (r.age - 58) * 0.05) {
        state.retainers = state.retainers.filter((x) => x !== r);
        const post = r.post ? `${POSTS.find((p) => p.id === r.post).name}の` : '';
        notes.push(`${post}${r.name}が老いて職を辞した（${r.age}歳）。`);
      }
    }
    state.candidates = makeCandidates();

    // 若君が育つ
    for (const heir of state.heirs) {
      heir.age += 1;
      if (heir.age < CONFIG.ADULT_AGE && Math.random() < 0.5) {
        const stat = pick(['seimu', 'bui', 'jintoku']);
        heir.stats[stat] = clamp(heir.stats[stat] + 1, 1, CONFIG.ABILITY_MAX);
      }
    }

    // 将軍が歳をとる。気苦労がたまっていると体を壊し、城中にも苛立ちが広がる
    s.age += 1;
    if (s.age >= 60) s.health -= 4;
    else if (s.age >= 40) s.health -= 2;
    s.stress = clamp((s.stress || 0) - CONFIG.STRESS_DECAY, 0, 100);
    if (s.stress >= 85) {
      s.health -= 6;
      applyEffects({ ikou: -2 });
      notes.push(`将軍・${s.name}の気苦労が限界に近い。体を壊し、城中にも苛立ちが広がっている。`);
    } else if (s.stress >= 60) {
      s.health -= 3;
      notes.push(`将軍・${s.name}は気苦労がたまり、顔色がすぐれない。`);
    }
    s.health = clamp(s.health, 0, 100);
    const deathChance = 0.005 + Math.max(0, 40 - s.health) * 0.008 + Math.max(0, s.age - 60) * 0.02;
    const died = Math.random() < deathChance;

    // 若君の誕生
    if (!died && s.age >= 16 && s.age <= 55 && state.heirs.length < CONFIG.MAX_HEIRS
        && Math.random() < CONFIG.HEIR_BIRTH_CHANCE) {
      const heir = makeHeir();
      state.heirs.push(heir);
      notes.push(`若君・${heir.name}が生まれた。`);
    }

    // 倒幕の危機
    const broke = state.fin.debt > debtLimit();
    const low = Object.keys(state.gauges).filter((k) => state.gauges[k] <= 0).map((k) => STATE_LABELS[k]);
    if (broke) low.push('財政（借入が上限超え）');
    if (state.crisis) {
      const safe = Object.values(state.gauges).every((v) => v > CONFIG.CRISIS_SAFE) && !broke;
      if (safe) {
        state.crisis = null;
        notes.push('幕府は危機を脱した。');
      } else {
        state.crisis.years -= 1;
        if (state.crisis.years <= 0) {
          notes.forEach(addLog);
          state.year += 1;
          gameOver();
          return;
        }
      }
    } else if (low.length > 0) {
      state.crisis = { years: CONFIG.CRISIS_YEARS };
      notes.push(`${low.join('・')}が尽きた。倒幕の危機！${CONFIG.CRISIS_YEARS}年のうちに立て直さねばならぬ。`);
    }

    notes.forEach(addLog);
    const honors = checkHonors();

    // 一年の決算報告をつくる
    const closed = state.books[0];
    const start = state.yearStart || snapshot();
    state.report = {
      year: state.year,
      op: closed.op, inv: closed.inv, fin: closed.fin, cash: closed.cash, debt: closed.debt,
      netChange: closed.net - start.net,
      gauges: Object.keys(STATE_LABELS).map((k) => ({ key: k, before: start.gauges[k], after: state.gauges[k] })),
      notes: notes.concat(died ? [`将軍・${s.name}が${s.age}歳で世を去った。`] : []),
      honors: honors.map((h) => h.name),
    };

    state.year += 1;
    state.ledger = { year: state.year, items: [] };
    ui.bookYear = String(state.year - 1);

    if (died) {
      addLog(`将軍・${s.name}が${s.age}歳で世を去った。`);
      startSuccession('death');
    } else {
      state.phase = 'event';
      drawCard();
    }
    state.yearStart = snapshot();
    state.nextPhase = state.phase;
    state.phase = 'report';
    commit();
  }

  function closeReport() {
    state.phase = state.nextPhase || 'event';
    state.nextPhase = null;
    state.report = null;
    commit();
  }

  // ─────────────────────────────── 世代交代

  function closeReign(note) {
    const s = state.shogun;
    const p = person(s.personId);
    p.to = state.year;
    p.end = { ...s.stats };
    p.endAge = s.age;
    p.endGauges = { ...state.gauges };
    p.endNet = Math.round(netAssets());
    p.note = note;
  }

  function startSuccession(reason) {
    const s = state.shogun;
    closeReign(reason === 'retire' ? '隠居して大御所となる。' : `${s.age}歳で没する。`);

    let mode = 'heirs';
    let candidates = state.heirs.map((h) => ({ ...h }));
    if (candidates.length === 0) {
      if (hasInstitution('gosanke')) {
        mode = 'gosanke';
        candidates = GOSANKE.map((g) => ({
          name: `${g.house}の若殿`, house: g.house, age: rand(18, 34), trait: pick(TRAITS),
          stats: { seimu: rand(6, 12), bui: rand(6, 12), jintoku: rand(6, 12), kenko: rand(7, 14) },
        }));
      } else {
        mode = 'dispute';
        candidates = [{
          name: '一門の若者', house: '一門', age: rand(16, 30), trait: pick(TRAITS),
          stats: { seimu: rand(3, 8), bui: rand(3, 8), jintoku: rand(3, 8), kenko: rand(5, 12) },
        }];
      }
    }
    state.succession = { reason, mode, candidates };
    state.phase = 'succession';
  }

  function crown(index) {
    const { mode, candidates } = state.succession;
    const c = candidates[index];
    const prev = state.shogun;
    const name = makeShogunName();

    // 家系図に記す。御三家から迎えた人は、その家の祖の下につなぐ
    let p;
    if (c.personId) {
      p = person(c.personId);
    } else {
      const founder = state.family.find((x) => x.house === c.house && !x.gen);
      p = addPerson({ name, born: state.year - c.age, parentId: founder ? founder.id : state.family[0].id, house: c.house, trait: c.trait });
    }
    p.name = name;
    p.gen = prev.gen + 1;
    p.from = state.year;
    p.start = { seimu: c.stats.seimu, bui: c.stats.bui, jintoku: c.stats.jintoku };
    for (const h of state.heirs) {
      if (h.personId !== c.personId) person(h.personId).note = '一門として家を出る。';
    }

    state.shogun = {
      personId: p.id, name, gen: prev.gen + 1, age: c.age, startYear: state.year, trait: c.trait,
      health: clamp(c.stats.kenko * 5, 20, 100),
      stats: { ...p.start }, stress: 0,
    };

    const from = c.house ? `${c.house}から迎えられた` : `若君・${c.name}が`;
    addLog(`${from}${name}が、第${state.shogun.gen}代将軍となった。`);
    if (mode === 'gosanke') {
      applyEffects({ ikou: -3 });
      addLog('本家の血は絶えたが、御三家が幕府をつないだ。');
    } else if (mode === 'dispute') {
      applyEffects({ ikou: -15, minshin: -5 });
      addLog('跡継ぎをめぐって争いが起き、幕府の威光は大きく揺らいだ。');
    }
    if (c.age < CONFIG.ADULT_AGE) {
      applyEffects({ ikou: -8 });
      addLog('幼い将軍に、大名たちは侮りの目を向けている。');
    }

    state.heirs = [];
    state.succession = null;
    state.phase = 'event';
    ui.person = p.id;
    drawCard();
    commit();
  }

  function gameOver() {
    state.phase = 'over';
    closeReign('倒幕により、幕府とともに倒れる。');
    addLog(`倒幕。徳川幕府は${bakufuYears()}年で幕を閉じた。`);
    saveBest(bakufuYears());
    checkHonors();
    commit();
  }

  // ─────────────────────────────── 描画の共通部品

  let lastPhase = null;

  function commit() {
    save();
    render();
    // 場面が変わったら、画面の上に戻す（スマホで下までスクロールしたままにならないように）
    if (state.phase !== lastPhase) {
      if (state.phase === 'prologue') $('stage').scrollIntoView({ block: 'start' });
      else if (ui.tab === 'seimu') scrollToGame();
    }
    lastPhase = state.phase;
  }

  function scrollToGame() {
    const top = $('game').getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top) window.scrollTo(0, top);
  }

  // イラスト（art.js が作る固定のSVG文字列）を入れる箱
  function art(svg, cls) {
    const box = el('div', { class: cls, 'aria-hidden': 'true' });
    box.innerHTML = svg;
    return box;
  }

  function sceneArt(name) {
    return art(ART.scene(name), 'iy-scene');
  }

  // 話し手ごとの顔と名前
  const SPEAKERS = {
    ieyasu: { name: '家康', face: (mood) => ART.ieyasu(mood) },
    iemitsu: { name: '家光', face: () => ART.iemitsu() },
  };

  // 吹き出し。顔の下に話し手の名前を出す
  function says(who, children, mood = 'calm') {
    const speaker = SPEAKERS[who];
    return el('div', { class: `iy-speech iy-speech--${who}` }, [
      el('div', { class: 'iy-speech__who' }, [
        art(speaker.face(mood), 'iy-speech__face'),
        el('span', { class: 'iy-speech__name', text: speaker.name }),
      ]),
      el('div', { class: 'iy-speech__body' }, [].concat(children)),
    ]);
  }

  function ieyasuSays(children, mood = 'calm') {
    return says('ieyasu', children, mood);
  }

  // 霊体の家光のせりふ（チュートリアルとガイドの案内役）
  function iemitsuSays(children) {
    return says('iemitsu', children);
  }

  // cards.js のせりふ（文字列か { who, mood, text }）をそろえる
  function lineOf(line, defaultMood) {
    if (typeof line === 'string') return { who: 'ieyasu', mood: defaultMood || 'calm', text: line };
    return { who: line.who || 'ieyasu', mood: line.mood || defaultMood || 'calm', text: line.text };
  }

  function ieyasuMood() {
    const tight = state.fin.debt > debtLimit() * 0.7 || state.fin.cash < 20;
    return tight || Object.values(state.gauges).some((v) => v <= 25) ? 'worry' : 'calm';
  }

  // 人物の顔。家康・将軍・若君・御三家の人などで描き分ける
  function faceOf(p, small) {
    const cls = `iy-face${small ? ' iy-face--small' : ''}`;
    if (p.gen === 1) return art(ART.ieyasu('calm'), cls);
    if (p.house && !p.gen) return art(ART.retainer(p.id || 0), cls);
    const age = p.age !== undefined ? p.age : state.year - p.born;
    if (!p.gen && age < CONFIG.ADULT_AGE) return art(ART.child(p.trait), cls);
    return art(ART.shogun(p.trait || '慎重'), cls);
  }

  function retainerFace(r, small) {
    return art(ART.retainer(r.seed), `iy-face${small ? ' iy-face--small' : ''}`);
  }

  function statBars(stats, labels, compare) {
    return el('div', { class: 'iy-stats' }, Object.keys(labels).filter((k) => stats[k] !== undefined).map((k) => {
      const fill = el('div', { class: 'iy-bar__fill' });
      fill.style.width = `${(stats[k] / CONFIG.ABILITY_MAX) * 100}%`;
      const diff = compare && compare[k] !== undefined ? stats[k] - compare[k] : 0;
      return el('div', { class: 'iy-bar' }, [
        el('span', { class: 'iy-bar__label', text: labels[k] }),
        el('div', { class: 'iy-bar__track' }, fill),
        el('span', { class: 'iy-bar__value', text: diff ? `${stats[k]}（${signed(diff)}）` : String(stats[k]) }),
      ]);
    }));
  }

  function changeList(changes) {
    if (changes.length === 0) return null;
    return el('ul', { class: 'iy-changes' }, changes.map((c) =>
      el('li', { class: c.delta > 0 ? 'iy-up' : 'iy-down', text: `${c.label} ${signed(c.delta)}${c.unit || ''}` })));
  }

  function panel(title, children, cls = '') {
    return el('section', { class: `iy-panel ${cls}` }, [title ? el('h2', { text: title }) : null].concat(children));
  }

  // ─────────────────────────────── 描画

  function render() {
    const playing = state.phase !== 'prologue';
    $('intro').hidden = playing;
    $('topbar').hidden = !playing;
    $('tabbar').hidden = !playing;
    document.body.classList.toggle('iy-has-tabbar', playing);
    if (!playing) ui.tab = 'seimu';

    renderTopbar();
    renderTabbar();
    for (const tab of TABS) $(`tab-${tab.id}`).hidden = tab.id !== ui.tab;
    const views = { seimu: renderSeimu, family: renderFamily, finance: renderFinance, org: renderOrg, log: renderLog };
    views[ui.tab]();
    if (ui.coach !== null) applySpot();
  }

  function renderTopbar() {
    if (state.phase === 'prologue') return;
    const s = state.shogun;
    const f = state.fin;
    const gauges = Object.entries(STATE_LABELS).map(([key, label]) => {
      const v = state.gauges[key];
      const fill = el('div', { class: 'iy-mini__fill' });
      fill.style.width = `${v}%`;
      return el('div', { class: `iy-mini${v <= 20 ? ' iy-mini--low' : ''}` }, [
        el('span', { class: 'iy-mini__label', text: `${label} ${v}` }),
        el('div', { class: 'iy-mini__track' }, fill),
      ]);
    });
    const overLimit = f.debt > debtLimit();
    $('topbar').replaceChildren(...[
      el('div', { class: 'iy-topbar__row' }, [
        art(ART.shogun(s.trait), 'iy-face iy-face--tiny'),
        el('p', { class: 'iy-topbar__title' }, [
          el('strong', { text: `${state.year}年` }),
          ` 第${s.gen}代 ${s.name}（${s.age}歳）`,
        ]),
        el('button', { type: 'button', class: 'iy-guide-btn', id: 'guide-button', onclick: openGuide }, [
          el('span', { class: 'iy-guide-btn__mark', text: '?' }), 'ガイド',
        ]),
      ]),
      el('div', { class: 'iy-topbar__gauges' }, gauges),
      el('p', { class: 'iy-topbar__money' }, [
        `現金 ${money(f.cash)}万両　`,
        el('span', { class: overLimit ? 'iy-warn' : '', text: `借入 ${money(f.debt)}/${money(debtLimit())}` }),
        `　実績 ${state.jisseki}`,
      ]),
      state.crisis
        ? el('p', { class: 'iy-crisis', role: 'alert', text: `倒幕の危機：あと${state.crisis.years}年で立て直せ（威光・民心・朝廷を${CONFIG.CRISIS_SAFE}より上、借入を上限以下に）` })
        : null,
    ].filter(Boolean));
  }

  function renderTabbar() {
    const alerts = { org: vacancies().length > 0, seimu: ['event', 'succession'].includes(state.phase) };
    $('tabbar').replaceChildren(...TABS.map((t) => el('button', {
      type: 'button',
      class: `iy-tab${ui.tab === t.id ? ' iy-tab--active' : ''}`,
      'data-tab': t.id,
      'aria-current': ui.tab === t.id ? 'page' : 'false',
      onclick: () => { ui.tab = t.id; render(); scrollToGame(); },
    }, [
      el('span', { class: 'iy-tab__icon', text: t.icon }),
      el('span', { class: 'iy-tab__label', text: t.label }),
      alerts[t.id] && ui.tab !== t.id ? el('span', { class: 'iy-tab__dot', 'aria-label': '要対応' }) : null,
    ])));
  }

  // ───── 政務

  function renderSeimu() {
    const views = {
      prologue: viewPrologue, event: viewEvent, result: viewResult,
      manage: viewManage, succession: viewSuccession, over: viewOver, report: viewReport,
    };
    $('stage').replaceChildren(...[].concat(views[state.phase]()).filter(Boolean));
  }

  // プロローグは、せりふを1つずつ「次へ」で送る（prologueLine が何番目か）
  function viewPrologue() {
    const step = DATA.prologue[state.prologueStep];
    const isLastStep = state.prologueStep === DATA.prologue.length - 1;
    const lines = step.text.map((l) => lineOf(l, step.mood));
    const index = Math.min(state.prologueLine || 0, lines.length - 1);
    const atEnd = index === lines.length - 1;
    const nodes = [
      el('p', { class: 'iy-year', text: `${step.year}年` }),
      el('h2', { text: step.title }),
      sceneArt(step.scene),
    ];

    const nextStep = () => {
      state.prologueNote = null;
      state.prologueLine = 0;
      if (isLastStep) startMain();
      else state.prologueStep += 1;
      commit();
      if (isLastStep && !tutorialDone()) startTutorial();
    };

    // 布石を選んだ直後の、家康の一言
    if (state.prologueNote) {
      nodes.push(ieyasuSays(el('p', { class: 'iy-voice', text: state.prologueNote })));
      nodes.push(el('button', { type: 'button', class: 'iy-primary', text: '次へ', onclick: nextStep }));
      return nodes;
    }

    const line = lines[index];
    nodes.push(says(line.who, el('p', { class: 'iy-voice', text: line.text }), line.mood));
    nodes.push(el('p', { class: 'iy-progress', text: `${index + 1} / ${lines.length}` }));

    if (!atEnd) {
      nodes.push(el('button', {
        type: 'button', class: 'iy-primary', text: '次へ',
        onclick: () => { state.prologueLine = index + 1; commit(); },
      }));
    } else if (step.choices) {
      // 栄誉を集めると、新しい布石（遺訓）が選べるようになる
      const honorCount = loadHonors().length;
      const list = el('div', { class: 'iy-options' });
      step.choices.forEach((choice) => {
        const locked = (choice.unlock || 0) > honorCount;
        const desc = choice.desc || institution(choice.institution).desc;
        list.append(el('button', {
          type: 'button', class: `iy-option${locked ? ' iy-option--locked' : ''}`, disabled: locked,
          onclick: () => {
            if (choice.institution) state.institutions.push(choice.institution);
            if (choice.bonus) state.legacy = choice.bonus;
            addLog(`家康、最後の布石として「${choice.label}」を残す。`);
            state.prologueNote = choice.text;
            commit();
          },
        }, [
          choice.unlock ? el('span', { class: 'iy-option__how', text: locked ? `遺訓（栄誉をあと${choice.unlock - honorCount}つ集めると選べる）` : '遺訓（栄誉で解禁）' }) : null,
          el('strong', { text: choice.label }),
          el('span', { class: 'iy-option__hint', text: desc }),
        ]));
      });
      nodes.push(list);
    } else {
      nodes.push(el('button', { type: 'button', class: 'iy-primary', text: isLastStep ? '幕府の経営を始める' : '次へ', onclick: nextStep }));
    }
    if (index > 0) {
      nodes.push(el('button', {
        type: 'button', class: 'iy-back', text: '← ひとつ戻る',
        onclick: () => { state.prologueLine = index - 1; commit(); },
      }));
    }
    return nodes;
  }

  function optionHints(option) {
    const hints = [];
    const ryo = option.effects.ryo;
    if (ryo < 0) hints.push(`費用 約${Math.abs(scaledCost(ryo))}万両${option.invest ? '（投資）' : ''}`);
    if (option.effects.borrow) hints.push(`${option.effects.borrow}万両を借りる`);
    if (option.check) {
      hints.push(`成否は${ABILITY_LABELS[option.check.stat]}しだい（見込み${Math.round(successChance(option.check) * 100)}%）`);
    }
    return hints.join('　');
  }

  function viewEvent() {
    const card = cardById(state.card.id);
    const s = state.shogun;
    const list = el('div', { class: 'iy-options' });
    card.options.forEach((option, i) => {
      const liked = option.tag === s.trait;
      const hint = optionHints(option);
      list.append(el('button', {
        type: 'button', class: `iy-option${liked ? ' iy-option--pick' : ''}`, onclick: () => choose(i),
      }, [
        liked ? el('span', { class: 'iy-option__how', text: '将軍の好み' }) : null,
        el('strong', { text: option.label }),
        hint ? el('span', { class: 'iy-option__hint', text: hint }) : null,
      ]));
    });
    return [
      el('p', { class: 'iy-year', text: `${state.year}年${card.trial ? '　大きな試練' : ''}` }),
      el('h2', { text: card.title }),
      sceneArt(card.scene),
      el('p', { text: fillNames(card.text) }),
      ieyasuSays(el('p', { class: 'iy-voice', text: `「${fillNames(card.ieyasu)}」` }), card.trial ? 'worry' : ieyasuMood()),
      el('div', { class: 'iy-intent' }, [
        art(ART.shogun(s.trait), 'iy-face iy-face--small'),
        el('p', {}, [
          `将軍・${s.name}は${s.trait}な性格。好みに合う裁きなら乗り気で取り組んで育ち、合わなければ気苦労がたまる。`,
          el('span', { class: (s.stress || 0) >= 60 ? 'iy-warn' : 'iy-muted', text: `（気苦労 ${s.stress || 0}）` }),
        ]),
      ]),
      list,
    ];
  }

  function viewResult() {
    const r = state.result;
    const card = cardById(state.card.id);
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: `${r.title}：${r.choice}` }),
      sceneArt(card.scene),
      el('p', { class: r.failed ? 'iy-failed' : '', text: r.text }),
      changeList(r.changes),
      r.growth ? el('p', { class: 'iy-note', text: r.growth }) : null,
      r.failed ? ieyasuSays(el('p', { class: 'iy-voice', text: '「……むう。」' }), 'worry') : null,
      el('button', {
        type: 'button', class: 'iy-primary', text: '政務の間へ',
        onclick: () => { state.phase = 'manage'; state.result = null; commit(); },
      }),
    ];
  }

  function heirCard(heir, index) {
    const canTeach = heir.age < CONFIG.TEACH_AGE_LIMIT;
    const taught = heir.taughtYear === state.year;
    return el('div', { class: 'iy-heir' }, [
      el('div', { class: 'iy-heir__head' }, [
        faceOf(heir),
        el('p', { class: 'iy-heir__name' }, [el('strong', { text: heir.name }), `（${heir.age}歳・${heir.trait}）`]),
      ]),
      statBars(heir.stats, ABILITY_LABELS),
      canTeach
        ? el('p', { class: 'iy-hint', text: taught ? '今年はもう師をつけた。' : `師をつける（教育費 ${teachCost()}万両・1年に1回）` })
        : el('p', { class: 'iy-hint', text: '成人したので、教育は終わった。' }),
      canTeach ? el('div', { class: 'iy-teach' }, Object.keys(TEACH_LABELS).map((stat) => el('button', {
        type: 'button', text: TEACH_LABELS[stat], disabled: taught, onclick: () => teach(index, stat),
      }))) : null,
    ]);
  }

  function viewManage() {
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '政務の間' }),
      el('p', { class: 'iy-hint', text: '若君の教育、制度の整備、代替わりを決める。財務と組織は下のメニューから。終わったら年を越す。' }),
      el('h3', { text: '若君' }),
    ];

    if (state.heirs.length === 0) {
      nodes.push(el('p', { class: 'iy-hint', text: 'まだ若君がいない。将軍が若いうちは、いずれ生まれるだろう。' }));
    } else {
      state.heirs.forEach((h, i) => nodes.push(heirCard(h, i)));
    }
    if (canRetire()) {
      nodes.push(el('button', { type: 'button', class: 'iy-secondary', onclick: retire, text: `${state.shogun.name}を隠居させ、将軍職を譲る` }));
    }

    // 制度の一覧は長いので、たたんでおく。整えられるものがあるときだけ開く
    const insts = DATA.institutions.filter((inst) => !inst.prologueOnly || hasInstitution(inst.id));
    const ready = insts.filter((inst) => institutionStatus(inst).ok).length;
    const owned = insts.filter((inst) => hasInstitution(inst.id)).map((inst) => inst.name);
    nodes.push(el('h3', { text: '制度' }));
    nodes.push(el('p', { class: 'iy-hint', text: `整備済み：${owned.length ? owned.join('、') : 'なし'}` }));
    const list = el('details', { class: 'iy-institutions' });
    if (ready > 0) list.open = true;
    list.append(el('summary', { text: `制度を整える（実績${state.jisseki}・いま整えられるもの${ready}件）` }));
    for (const inst of insts) {
      if (hasInstitution(inst.id)) continue;
      const status = institutionStatus(inst);
      const cost = institutionCost(inst);
      list.append(el('div', { class: 'iy-inst' }, [
        el('p', { class: 'iy-inst__name' }, [el('strong', { text: inst.name }), `（実績${inst.cost}${cost ? `・${cost}万両` : ''}）`]),
        el('p', { class: 'iy-hint', text: inst.desc }),
        el('button', { type: 'button', text: status.ok ? '整える' : status.reason, disabled: !status.ok, onclick: () => establish(inst.id) }),
      ]));
    }
    nodes.push(list);

    // 組み合わせの妙（そろうまでは中身を伏せておく）
    nodes.push(el('h3', { text: `組み合わせの妙（${state.synergies.length} / ${DATA.synergies.length}）` }));
    nodes.push(el('p', { class: 'iy-hint', text: '特定の制度がそろうと、隠れた効果が生まれる。' }));
    nodes.push(el('ul', { class: 'iy-synergies' }, DATA.synergies.map((syn) => {
      const got = state.synergies.includes(syn.id);
      return el('li', { class: got ? 'iy-synergy--got' : '' }, got
        ? [el('strong', { text: syn.name }), `　${syn.desc}`]
        : [el('strong', { text: '？？？' }), `　${syn.hint}`]);
    })));

    if (vacancies().length > 0) {
      nodes.push(el('p', { class: 'iy-warn-box', text: `空いている役職があります（${vacancies().map((p) => p.name).join('・')}）。空席のままだと、その役目の働きが落ちる。` }));
      nodes.push(el('button', { type: 'button', class: 'iy-secondary', text: '組織を開く', onclick: () => { ui.tab = 'org'; render(); scrollToGame(); } }));
    }
    nodes.push(el('button', { type: 'button', class: 'iy-primary', text: '年を越す（決算）', onclick: endYear }));
    return nodes;
  }

  function viewSuccession() {
    const { reason, mode, candidates } = state.succession;
    const intro = {
      heirs: '次の将軍を選ぶ。',
      gosanke: '本家に跡継ぎがいない。御三家から次の将軍を迎える。',
      dispute: '跡継ぎがいない。一門の中から、争いの末に一人が担ぎ出された。',
    }[mode];
    const list = el('div', { class: 'iy-options' });
    candidates.forEach((c, i) => {
      const warn = c.age < CONFIG.ADULT_AGE ? '　幼い将軍になる（威光が下がる）' : '';
      list.append(el('button', { type: 'button', class: 'iy-option iy-option--person', onclick: () => crown(i) }, [
        faceOf({ ...c, id: i + 3 }),
        el('span', { class: 'iy-option__text' }, [
          el('strong', { text: `${c.name}（${c.age}歳・${c.trait}）` }),
          el('span', { text: Object.keys(ABILITY_LABELS).map((k) => `${ABILITY_LABELS[k]}${c.stats[k]}`).join('　') + warn }),
        ]),
      ]));
    });
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: reason === 'retire' ? '将軍職を譲る' : '将軍、世を去る' }),
      sceneArt(reason === 'retire' ? 'hall' : 'sickbed'),
      el('p', { text: intro }),
      list,
    ];
  }

  // 一年の決算報告。数字の増減と、この一年の出来事をまとめて見せる
  function viewReport() {
    const r = state.report;
    const total = r.op + r.inv + r.fin;
    const kpi = (label, value, good) => el('div', {}, [
      el('dt', { text: label }),
      el('dd', { class: good === undefined ? '' : good ? 'iy-up' : 'iy-down', text: value }),
    ]);
    const mood = r.op < 0 || r.gauges.some((g) => g.after <= 20) ? 'worry' : 'calm';
    const comment = r.honors.length ? `栄誉「${r.honors.join('」「')}」とは、めでたい。この調子じゃ。`
      : r.op < 0 ? '年貢と経費だけで赤字じゃ。このままでは金蔵がもたぬぞ。'
        : r.gauges.some((g) => g.after <= 20) ? '数字は持っておるが、足元が危うい。手を打たねば。'
          : 'まずまずの一年じゃった。気を抜くでないぞ。';
    const isSuccession = state.nextPhase === 'succession';
    return [
      el('p', { class: 'iy-year', text: `${r.year}年の暮れ` }),
      el('h2', { text: `${r.year}年の決算` }),
      el('dl', { class: 'iy-kpis' }, [
        kpi('営業の収支', `${money(r.op)}万両`, r.op >= 0),
        kpi('現金の増減', `${money(total)}万両`, total >= 0),
        kpi('純資産の増減', `${money(r.netChange)}万両`, r.netChange >= 0),
        kpi('年末の現金', `${money(r.cash)}万両`),
        kpi('年末の借入', `${money(r.debt)}万両`),
      ]),
      el('ul', { class: 'iy-changes' }, r.gauges.map((g) => {
        const d = g.after - g.before;
        return el('li', { class: d > 0 ? 'iy-up' : d < 0 ? 'iy-down' : '', text: `${STATE_LABELS[g.key]} ${g.after}（${signed(d)}）` });
      })),
      r.honors.length ? el('p', { class: 'iy-honor-line', text: `栄誉を得た：${r.honors.join('、')}` }) : null,
      r.notes.length ? el('ul', { class: 'iy-report-notes' }, r.notes.map((n) => el('li', { text: n }))) : null,
      ieyasuSays(el('p', { class: 'iy-voice', text: comment }), mood),
      el('button', { type: 'button', class: 'iy-primary', text: isSuccession ? '跡継ぎを決める' : '次の年へ', onclick: closeReport }),
    ];
  }

  function viewOver() {
    const years = bakufuYears();
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '倒幕' }),
      sceneArt('fall'),
      el('p', { text: `徳川の幕府は、開府から${years}年で幕を閉じた。最後の将軍は、第${state.shogun.gen}代・${state.shogun.name}。` }),
      ieyasuSays(el('p', { class: 'iy-voice', text: '霊体の権現様は長いため息をつき、家光とともに日光の山へ帰っていった。……次こそは。' }), 'worry'),
      el('p', { class: 'iy-note', text: `これまでの最長記録：${Math.max(years, loadBest())}年（史実の幕府は約265年）。家系図と財務の記録は、このまま見られる。` }),
      el('button', { type: 'button', class: 'iy-primary', text: 'もう一度、最初から', onclick: restart }),
    ];
  }

  // ───── 家系図

  function renderFamily() {
    if (!person(ui.person)) ui.person = state.shogun.personId;
    const selected = person(ui.person);
    const children = (id) => state.family.filter((p) => p.parentId === id).sort((a, b) => a.born - b.born);
    const node = (p) => {
      const isCurrent = p.id === state.shogun.personId && state.phase !== 'over';
      const meta = p.gen ? `第${p.gen}代　${p.from}〜${p.to || '在位中'}` : p.house || `${p.born}年生まれ`;
      const kids = children(p.id);
      return el('li', {}, [
        el('button', {
          type: 'button',
          class: `iy-node${p.gen ? ' iy-node--shogun' : ''}${p.id === selected.id ? ' iy-node--selected' : ''}`,
          onclick: () => { ui.person = p.id; renderFamily(); scrollToGame(); },
        }, [
          faceOf(p, true),
          el('span', { class: 'iy-node__text' }, [
            el('strong', { text: p.name + (isCurrent ? '（当代）' : '') }),
            el('span', { text: meta }),
          ]),
        ]),
        kids.length ? el('ul', {}, kids.map(node)) : null,
      ]);
    };

    $('tab-family').replaceChildren(
      panel('家系図', [
        el('p', { class: 'iy-hint', text: '名前を押すと、その人の記録が上に出る。太枠は将軍になった人。' }),
        detailOf(selected),
        el('ul', { class: 'iy-tree' }, children(null).map(node)),
      ]),
    );
  }

  function detailOf(p) {
    const isCurrent = p.id === state.shogun.personId && state.phase !== 'over';
    const heir = state.heirs.find((h) => h.personId === p.id);
    const facts = [p.gen ? `第${p.gen}代将軍` : '', p.house || '', p.trait ? `性格：${p.trait}` : '', `${p.born}年生まれ`].filter(Boolean);
    const nodes = [
      el('div', { class: 'iy-heir__head' }, [
        faceOf(p),
        el('p', {}, [
          el('strong', { text: p.name }),
          p.childName && p.childName !== p.name ? `（幼名 ${p.childName}）` : '',
          el('br'),
          el('span', { class: 'iy-muted', text: facts.join('・') }),
        ]),
      ]),
    ];
    if (p.gen) {
      nodes.push(el('p', { class: 'iy-hint', text: `在位：${p.from}〜${p.to || '在位中'}年（${(p.to || state.year) - p.from}年）` }));
      if (isCurrent) {
        nodes.push(el('h3', { text: '今の能力（かっこ内は就任時からの伸び）' }));
        nodes.push(statBars(state.shogun.stats, { seimu: '政務', bui: '武威', jintoku: '人徳' }, p.start));
        nodes.push(el('p', { class: 'iy-hint', text: `${state.shogun.age}歳・健康${state.shogun.health}` }));
      } else if (p.end) {
        nodes.push(el('h3', { text: '退任時の能力（かっこ内は就任時からの伸び）' }));
        nodes.push(statBars(p.end, { seimu: '政務', bui: '武威', jintoku: '人徳' }, p.start));
      }
      if (p.insts.length) nodes.push(el('p', { class: 'iy-hint', text: `整えた制度：${p.insts.join('、')}` }));
      if (p.endGauges) {
        nodes.push(el('p', { class: 'iy-hint', text: `退任時の幕府：${Object.entries(STATE_LABELS).map(([k, l]) => `${l}${p.endGauges[k]}`).join('　')}　純資産 ${money(p.endNet)}万両` }));
      }
    } else if (heir) {
      nodes.push(el('h3', { text: '若君の能力' }));
      nodes.push(statBars(heir.stats, ABILITY_LABELS));
    }
    if (p.note) nodes.push(el('p', { class: 'iy-note', text: p.note }));
    return el('div', { class: 'iy-detail' }, nodes);
  }

  // ───── 財務

  function cfTable(items) {
    const sections = [
      ['op', '営業キャッシュフロー（年貢・経費など）'],
      ['inv', '投資キャッシュフロー（普請・制度の整備）'],
      ['fin', '財務キャッシュフロー（借入・返済・利息）'],
    ];
    const rows = [];
    let total = 0;
    for (const [cf, title] of sections) {
      const list = items.filter((i) => i.cf === cf);
      const sum = list.reduce((a, b) => a + b.amount, 0);
      total += sum;
      rows.push(el('tr', { class: 'iy-table__section' }, [el('th', { colspan: '2', text: title })]));
      // 同じ名目はまとめて1行にする
      const merged = new Map();
      for (const i of list) merged.set(i.label, (merged.get(i.label) || 0) + i.amount);
      if (merged.size === 0) rows.push(el('tr', {}, [el('td', { class: 'iy-muted', text: 'なし' }), el('td', { text: '' })]));
      for (const [label, amount] of merged) {
        rows.push(el('tr', {}, [el('td', { text: label }), el('td', { class: amount < 0 ? 'iy-down' : '', text: money(amount) })]));
      }
      rows.push(el('tr', { class: 'iy-table__sub' }, [el('td', { text: '小計' }), el('td', { class: sum < 0 ? 'iy-down' : '', text: money(sum) })]));
    }
    rows.push(el('tr', { class: 'iy-table__total' }, [el('td', { text: '現金の増減' }), el('td', { class: total < 0 ? 'iy-down' : '', text: money(total) })]));
    return el('table', { class: 'iy-table' }, [el('tbody', {}, rows)]);
  }

  function renderFinance() {
    const f = state.fin;
    const assetRows = assets();
    const totalAssets = assetRows.reduce((a, b) => a + b.value, 0);
    const limit = debtLimit();

    // キャッシュフロー計算書（今年の途中経過か、過去の決算）
    const select = el('select', {
      'aria-label': '表示する年',
      onchange: (e) => { ui.bookYear = e.target.value; renderFinance(); },
    }, [el('option', { value: 'now', text: `${state.year}年（今年・途中経過）`, selected: ui.bookYear === 'now' })]
      .concat(state.books.map((b) => el('option', { value: String(b.year), text: `${b.year}年の決算`, selected: ui.bookYear === String(b.year) }))));
    const shown = state.books.find((b) => String(b.year) === ui.bookYear) || state.ledger;

    const bs = el('table', { class: 'iy-table' }, [el('tbody', {}, [
      el('tr', { class: 'iy-table__section' }, [el('th', { colspan: '2', text: '資産' })]),
      ...assetRows.map((a) => el('tr', {}, [el('td', { text: a.label }), el('td', { text: money(a.value) })])),
      el('tr', { class: 'iy-table__sub' }, [el('td', { text: '資産の合計' }), el('td', { text: money(totalAssets) })]),
      el('tr', { class: 'iy-table__section' }, [el('th', { colspan: '2', text: '負債' })]),
      el('tr', {}, [el('td', { text: '商人からの借入' }), el('td', { text: money(f.debt) })]),
      el('tr', { class: 'iy-table__section' }, [el('th', { colspan: '2', text: '純資産' })]),
      el('tr', { class: 'iy-table__total' }, [el('td', { text: '幕府の元手（資産−負債）' }), el('td', { class: netAssets() < 0 ? 'iy-down' : '', text: money(netAssets()) })]),
    ])]);

    const trend = el('table', { class: 'iy-table iy-table--trend' }, [
      el('thead', {}, el('tr', {}, ['年', '営業', '投資', '財務', '現金', '借入'].map((h) => el('th', { text: h })))),
      el('tbody', {}, state.books.slice(0, 12).map((b) => el('tr', {}, [
        el('td', { text: String(b.year) }),
        ...[b.op, b.inv, b.fin, b.cash, b.debt].map((v, i) => el('td', { class: v < 0 && i < 3 ? 'iy-down' : '', text: money(v) })),
      ]))),
    ]);

    $('tab-finance').replaceChildren(...[
      panel('財務', [
        el('p', { class: 'iy-hint', text: '金額の単位はすべて万両。年を越すときに決算をする。' }),
        el('dl', { class: 'iy-kpis' }, [
          ['現金', money(f.cash)], ['借入（上限）', `${money(f.debt)}（${money(limit)}）`], ['純資産', money(netAssets())],
          ['天領の石高', `${Math.round(f.kokudaka)}万石`], ['昨年の歳入', money(f.lastRevenue)], ['大奥の費え', `${Math.round(f.ooku)}/年`],
        ].map(([k, v]) => el('div', {}, [el('dt', { text: k }), el('dd', { text: v })]))),
        state.phase === 'over' ? null : el('div', { class: 'iy-actions' }, [
          el('button', { type: 'button', text: `${CONFIG.LOAN_STEP}万両借りる`, disabled: f.debt + CONFIG.LOAN_STEP > limit, onclick: borrowMore }),
          el('button', { type: 'button', text: `${CONFIG.LOAN_STEP}万両返す`, disabled: f.debt <= 0 || f.cash < Math.min(CONFIG.LOAN_STEP, f.debt), onclick: repay }),
          el('button', { type: 'button', text: '蔵米を売る', disabled: f.rice < 1, onclick: sellRice }),
        ]),
        el('p', { class: 'iy-hint', text: `借入には年${CONFIG.INTEREST * 100}%の利息がつく。借入が上限（歳入の${CONFIG.DEBT_LIMIT}倍）を超えると財政破綻の危機になる。` }),
      ]),
      panel('キャッシュフロー計算書', [select, cfTable(shown.items)]),
      panel('バランスシート（いま）', [bs]),
      state.books.length ? panel('決算の推移', [el('div', { class: 'iy-scroll' }, trend)]) : null,
    ].filter(Boolean));
  }

  // ───── 組織

  function retainerStats(r, highlight) {
    return el('p', { class: 'iy-retainer__stats' }, Object.entries(RETAINER_LABELS).map(([k, l]) =>
      el('span', { class: k === highlight ? 'iy-strong' : '', text: `${l}${r.stats[k]}` })));
  }

  function retainerRow(r, button) {
    return el('div', { class: 'iy-retainer iy-retainer--row' }, [
      retainerFace(r, true),
      el('div', {}, [
        el('p', { class: 'iy-retainer__name', text: `${r.name}（${r.age}歳・俸禄${r.salary}万両）` }),
        retainerStats(r),
      ]),
      button,
    ]);
  }

  function renderOrg() {
    const s = state.shogun;
    const over = state.phase === 'over';
    const salaries = state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : Math.ceil(r.salary / 2)), 0);

    const posts = POSTS.map((post) => {
      const h = holder(post.id);
      const select = el('select', {
        'aria-label': `${post.name}に就ける者`,
        disabled: over,
        onchange: (e) => assign(Number(e.target.value), post.id),
      }, [el('option', { value: '', text: h ? '入れ替える…' : '任じる者を選ぶ…', selected: true, disabled: true })]
        .concat(state.retainers.filter((r) => r !== h).map((r) => el('option', {
          value: String(r.id),
          text: `${r.name}（${RETAINER_LABELS[post.stat]}${r.stats[post.stat]}${r.post ? `・今は${POSTS.find((p) => p.id === r.post).name}` : ''}）`,
        }))));
      return el('div', { class: `iy-post${h ? '' : ' iy-post--vacant'}` }, [
        el('p', { class: 'iy-post__name' }, [el('strong', { text: post.name }), el('span', { class: 'iy-muted', text: `　見る能力：${RETAINER_LABELS[post.stat]}` })]),
        el('p', { class: 'iy-hint', text: post.desc }),
        h
          ? el('div', { class: 'iy-retainer' }, [retainerFace(h, true), el('div', {}, [
            el('p', { class: 'iy-retainer__name', text: `${h.name}（${h.age}歳・俸禄${h.salary}万両）` }),
            retainerStats(h, post.stat),
          ])])
          : el('p', { class: 'iy-warn', text: '空席' }),
        select,
      ]);
    });

    const reserve = state.retainers.filter((r) => !r.post);
    $('tab-org').replaceChildren(
      panel('将軍', [
        el('div', { class: 'iy-heir__head' }, [
          art(ART.shogun(s.trait), 'iy-face'),
          el('p', {}, [el('strong', { text: `第${s.gen}代 ${s.name}` }), `（${s.age}歳・${s.trait}・健康${s.health}）`]),
        ]),
        statBars(s.stats, { seimu: '政務', bui: '武威', jintoku: '人徳' }),
        el('p', { class: (s.stress || 0) >= 60 ? 'iy-warn' : 'iy-hint', text: `気苦労 ${s.stress || 0} / 100（60を超えると体を壊しはじめる。好みに合う裁きや、鷹狩り・湯治で晴れる）` }),
      ]),
      panel('役職', [
        el('p', { class: 'iy-hint', text: `家臣 ${state.retainers.length}人・俸禄の合計 年${salaries}万両（控えの家臣は半額）` }),
        vacancies().length && reserve.length && !over
          ? el('button', { type: 'button', class: 'iy-secondary', text: '空席に、いちばん向いている控えの家臣を就ける', onclick: autoAssign })
          : null,
        ...posts,
      ]),
      panel('控えの家臣', reserve.length
        ? reserve.map((r) => retainerRow(r, el('button', { type: 'button', text: '暇を出す', disabled: over, onclick: () => dismiss(r.id) })))
        : [el('p', { class: 'iy-hint', text: '控えの家臣はいない。' })]),
      panel('登用の候補（今年）', state.candidates.length
        ? state.candidates.map((c, i) => retainerRow(c, el('button', {
          type: 'button', text: '召し抱える', disabled: state.retainers.length >= CONFIG.MAX_RETAINERS || over, onclick: () => hire(i),
        })))
        : [el('p', { class: 'iy-hint', text: '今年の候補はもういない。来年また現れる。' })]),
    );
  }

  // ───── 記録

  function renderLog() {
    $('tab-log').replaceChildren(
      panel('記録', [el('ul', { class: 'iy-log' }, state.log.map((entry) =>
        el('li', {}, [el('span', { class: 'iy-log__year', text: `${entry.year}` }), entry.text])))]),
      panel('栄誉', [
        el('p', { class: 'iy-hint', text: `この周回で ${state.honors.length}、これまでに ${loadHonors().length} / ${DATA.honors.length}。栄誉を集めると、プロローグの「最後の布石」で新しい遺訓が選べるようになる。` }),
        el('ul', { class: 'iy-honors' }, DATA.honors.map((h) => {
          const now = state.honors.includes(h.id);
          const ever = loadHonors().includes(h.id);
          return el('li', { class: now ? 'iy-honor--now' : ever ? 'iy-honor--ever' : '' }, [
            el('strong', { text: ever || now ? h.name : '？？？' }),
            `　${h.desc}${now ? '（この周回で達成）' : ever ? '（以前に達成）' : ''}`,
          ]);
        })),
      ]),
      panel('遊び方', [
        el('p', { class: 'iy-hint', text: 'ルールや画面の見方は、ガイドにまとめてある。上の帯の「ガイド」からも、いつでも開ける。' }),
        el('div', { class: 'iy-actions' }, [
          el('button', { type: 'button', text: 'ガイドを開く', onclick: openGuide }),
          state.phase === 'over' ? null : el('button', { type: 'button', text: 'チュートリアルをもう一度', onclick: startTutorial }),
        ]),
      ]),
      panel(null, [
        el('p', { class: 'iy-hint', text: `進行状況はこの端末のブラウザに自動で保存される。これまでの最長記録：${loadBest()}年` }),
        el('button', {
          type: 'button', class: 'iy-secondary', text: 'はじめからやり直す',
          onclick: () => { if (window.confirm('保存されている進行状況を消して、はじめからやり直しますか？')) restart(); },
        }),
      ]),
    );
  }

  // ───── ガイド（いつでも開ける説明）

  function openGuide() {
    const dialog = $('guide-dialog');
    const sections = DATA.guide.map((sec, i) => {
      const d = el('details', { class: 'iy-guide__section' }, [
        el('summary', { text: sec.title }),
        el('ul', {}, sec.body.map((t) => el('li', { text: t }))),
      ]);
      if (i < 2) d.open = true;
      return d;
    });
    const playing = state.phase !== 'prologue' && state.phase !== 'over';
    dialog.replaceChildren(
      el('div', { class: 'iy-dialog__head' }, [
        el('h2', { text: 'ガイド' }),
        el('button', { type: 'button', class: 'iy-dialog__close', 'aria-label': 'ガイドを閉じる', text: '×', onclick: closeGuide }),
      ]),
      el('div', { class: 'iy-dialog__body' }, [
        iemitsuSays(el('p', { class: 'iy-voice', text: '「権現様、おわかりにならぬことがあれば、こちらをご覧くだされ。項目を押すと開きまする。」' })),
        ...sections,
        playing ? el('button', {
          type: 'button', class: 'iy-secondary', text: 'チュートリアルをもう一度見る',
          onclick: () => { closeGuide(); startTutorial(); },
        }) : null,
      ]),
    );
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeGuide() {
    const dialog = $('guide-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  // ───── チュートリアル（初回だけ。霊体の家光が画面の各部分を順に案内する）

  function startTutorial() {
    if (state.phase === 'prologue') return;
    ui.coach = 0;
    ui.coachLine = 0;
    ui.tab = 'seimu';
    render();
    showCoach();
  }

  function clearSpot() {
    document.querySelectorAll('.iy-spot, .iy-raise').forEach((n) => n.classList.remove('iy-spot', 'iy-raise'));
  }

  // 案内している場所を光らせる。固定表示の帯の中なら、帯ごと手前に出す
  function applySpot() {
    clearSpot();
    const step = DATA.tutorial[ui.coach];
    const target = step && step.target ? document.querySelector(step.target) : null;
    if (!target) return null;
    target.classList.add('iy-spot');
    const bar = target.closest('#topbar, #tabbar');
    if (bar && bar !== target) bar.classList.add('iy-raise');
    return target;
  }

  function showCoach() {
    const steps = DATA.tutorial;
    const step = steps[ui.coach];
    if (step.tab && ui.tab !== step.tab) {
      ui.tab = step.tab;
      render();
    }
    const target = applySpot();
    if (target && !target.closest('#tabbar')) target.scrollIntoView({ block: 'center' });
    if (target && target.id === 'topbar') scrollToGame();

    // 光らせた場所と重ならないように、説明の札を上か下に置く
    const rect = target ? target.getBoundingClientRect() : null;
    const atTop = rect && rect.top + rect.height / 2 > window.innerHeight / 2;
    const lines = [].concat(step.text);
    const lineIndex = Math.min(ui.coachLine || 0, lines.length - 1);
    const isLast = ui.coach === steps.length - 1 && lineIndex === lines.length - 1;
    const forward = () => {
      if (lineIndex < lines.length - 1) ui.coachLine = lineIndex + 1;
      else if (isLast) { endTutorial(); return; }
      else { ui.coach += 1; ui.coachLine = 0; }
      showCoach();
    };
    const back = () => {
      if (lineIndex > 0) ui.coachLine = lineIndex - 1;
      else { ui.coach -= 1; ui.coachLine = [].concat(steps[ui.coach].text).length - 1; }
      showCoach();
    };
    const coach = $('coach');
    coach.hidden = false;
    document.body.classList.add('iy-coaching');
    coach.replaceChildren(
      el('div', { class: 'iy-coach__dim' }),
      el('div', { class: `iy-coach__card${atTop ? ' iy-coach__card--top' : ''}`, role: 'dialog', 'aria-label': 'チュートリアル' }, [
        iemitsuSays(el('p', { class: 'iy-voice', text: lines[lineIndex] })),
        el('div', { class: 'iy-coach__nav' }, [
          el('span', { class: 'iy-muted', text: `${ui.coach + 1} / ${steps.length}` }),
          el('button', { type: 'button', class: 'iy-coach__skip', text: 'とばす', onclick: endTutorial }),
          ui.coach > 0 || lineIndex > 0 ? el('button', { type: 'button', text: '戻る', onclick: back }) : null,
          el('button', { type: 'button', class: 'iy-coach__next', text: isLast ? '始める' : '次へ', onclick: forward }),
        ]),
      ]),
    );
    coach.querySelector('.iy-coach__next').focus();
  }

  function endTutorial() {
    ui.coach = null;
    clearSpot();
    $('coach').hidden = true;
    $('coach').replaceChildren();
    document.body.classList.remove('iy-coaching');
    markTutorialDone();
    ui.tab = 'seimu';
    render();
    scrollToGame();
  }

  function restart() {
    newGame();
    ui.tab = 'seimu';
    ui.person = null;
    ui.bookYear = 'now';
    commit();
  }

  $('title-art').innerHTML = ART.scene('heaven');
  $('intro-guide').addEventListener('click', openGuide);
  state = load() || newGame();
  lastPhase = state.phase;
  render();
  if (!tutorialDone() && ['event', 'result', 'manage'].includes(state.phase)) startTutorial();
})();
