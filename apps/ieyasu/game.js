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
    MAX_DAUGHTERS: 3,
    WIFE_BIRTH: 0.25,       // 正室がいるとき、1年に子が生まれる見込み
    CONCUBINE_BIRTH: 0.15,  // 側室1人ごとに増える、子が生まれる見込み
    SON_CHANCE: 0.55,       // 生まれた子が男子（若君）である見込み
    BIRTH_AGE: [16, 55],    // 将軍に子が生まれる歳
    MARRY_AGE: [16, 50],    // 将軍に縁談が来る歳
    OFFER_WAIT: 3,          // 縁談を断ると、次に来るまでの年数
    MAX_CONCUBINES: 3,
    CONCUBINE_UPKEEP: 2,    // 側室1人ごとの大奥の費え（万両/年）
    INHERIT_RATE: 0.45,     // 生まれた子の能力は、父と母の能力の平均のこの割合（＋少しの運と素質）
    DAUGHTER_MARRY_AGE: 13, // 姫を嫁がせられる歳
    ADOPT_OUT_COST: 10,     // 若君を大名家へ養子に出すときの支度金（万両）
    // 御三家・御三卿の血筋（跡継ぎの候補の能力の目安。政務・武威・人徳それぞれの値）
    BLOOD_BASE: 8,          // 放っておくと、血筋はこの値に近づいていく（平凡）
    BLOOD_START: 9,         // 御三家の始まりの血筋（格27）
    BLOOD_STRONG: 12,       // 最後の布石で「御三家を固める」を選んだときの血筋（格36）
    BLOOD_DECAY: 0.01,      // 毎年、血筋が BLOOD_BASE に近づく割合（70年ほどで差が半分になる）
    BRANCH_ADOPT_COST: 15,  // 若君を御三家・御三卿へ養子に出すときの支度金（万両）
    BYPASS_IKOU: 5,         // 本家の若君をさしおいて分家から迎えると、威光がこれだけ下がる
    MEDDLE_GAP: 8,          // 御三家の一家の格が、ほかの二家の平均よりこれだけ高いと、口を出してくる
    BALANCE_MIN: 30,        // 三家がそろってこの格以上で、
    BALANCE_SPREAD: 6,      // 格の差がこれ以内なら、互いに牽制して威光が毎年+1
    HEAD_CHANGE: 0.05,      // 分家の当主が、1年に代替わりする見込み（当主になって12年たってから）
    // 異国船（白船・赤船・黒船の順）。予兆が出る見込みは、開府からの年数が SHIP_START を
    // 超えた年数 × SHIP_RAMP（上限 SHIP_MAX）。幕府が長く続くほど来やすい
    SHIP_START: [40, 100, 160],
    SHIP_RAMP: 0.001,
    SHIP_MAX: 0.3,
    SHIP_GAP: 15,           // 前の船が去ってから、次の船の予兆が出るまでの最短の年数
    SHIP_NOTICE: [3, 5],    // 予兆から来航までの年数
    SHIP_BOOST: 3,          // 軍資金を投じたときに上がる力
    CARD_COOLDOWN: 10,      // 同じ出来事は、この年数のあいだ出ない
    CRISIS_YEARS: 3,        // 危機になってから立て直すまでの猶予
    CRISIS_SAFE: 10,        // 威光・民心・朝廷がすべてこれを超え、借入が上限以下なら危機を脱する
    INTEREST: 0.08,         // 借入の利息（年）
    DEBT_LIMIT: 2,          // 借りられる上限は、その年の歳入のこの倍まで
    LOAN_STEP: 20,          // 財務画面で1回に借りる・返す額（万両）
    RICE_STEP: 20,          // 財務画面で1回に売る蔵米（万両ぶん）
    MAX_RETAINERS: 12,
    // 将軍の格（政務・武威・人徳の合計）しだいで、毎年あらわれる登用の候補の数が決まる。[この格から, 人数]
    CANDIDATE_STEPS: [[0, 1], [24, 2], [40, 3], [52, 4]],
    WANTS_RATE: 2,          // 家臣は、自分の腕（いちばん高い能力）のこの倍の格を将軍に求める
    RAISE_RATE: 0.5,        // 加増1回で、俸禄がもとの額のこの割合ぶん増える
    RAISE_WANTS: 6,         // 加増1回で、家臣の求める格がこれだけ下がる
    RENOWN_KAKU: 40,        // 将軍の格がこれ以上なら、名のある人物がまれに登用の候補に現れる
    RENOWN_CHANCE: 0.005,   // 格が RENOWN_KAKU−2 を1上回るごとに、名のある人物が現れる見込みが増える（格50で年6%）
    SKILL_CHANCE: 0.08,     // 若君や御三家の若殿に、特技がたまたまつく見込み
    SKILL_INHERIT: 0.3,     // 親の特技を受け継ぐ見込み
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
    saved.renownSeen = saved.renownSeen || [];
    if (!saved.oku) {
      // 縁組を入れる前の保存データ。正室と側室のぶんを別に足すようになったので、もとの大奥の費えを下げておく
      saved.oku = { wife: null, concubines: 0, offers: null, nextOffer: 0 };
      saved.fin.ooku = Math.max(0, saved.fin.ooku - 4);
    }
    saved.daughters = saved.daughters || [];
    saved.ships = saved.ships || { next: 0, arriving: null, last: null, won: [], lost: [] };
    if (!saved.branches) {
      // 御三家を代々続く家にする前の保存データ。布石で御三家を固めていたら、血筋の強い状態で始める
      const strong = (saved.institutions || []).includes('gosanke');
      saved.branches = DATA.branches.map((def) => makeBranch(def, 'sanke', strong ? CONFIG.BLOOD_STRONG : CONFIG.BLOOD_START, saved.year));
    }
    if (saved.shogun && saved.shogun.stress === undefined) saved.shogun.stress = 0;
    if (saved.shogun && saved.shogun.skill === undefined) saved.shogun.skill = null;
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
      // ooku は大奥のもとの費え。正室と側室のぶんは別に足す（ookuBase）
      fin: { cash: 250, rice: 60, debt: 0, kokudaka: 400, mine: 30, trade: 5, ooku: 6, infra: 200, lastRevenue: 120 },
      jisseki: 0,
      shogun: null,
      heirs: [],
      daughters: [],    // 将軍の娘（姫）
      // 御三家（と、のちに立つ御三卿）。血筋・当主・家風を持って代々続く
      branches: DATA.branches.map((def) => makeBranch(def, 'sanke', CONFIG.BLOOD_START, 1616)),
      // 異国船。next: 次に来る船（DATA.ships の何番目か） / arriving: 予兆が出た船の来航の年 / last: 前の船が去った年
      ships: { next: 0, arriving: null, last: null, won: [], lost: [] },
      battle: null,     // 異国船との勝負のようす
      endless: false,   // 黒船を退けたあとも続けているか
      overReason: null, // 倒幕のわけ（黒船に屈したなら 'black'）
      // 大奥。wife: 正室 / concubines: 側室の数 / offers: 来ている縁談 / nextOffer: 次に縁談が来る年
      oku: { wife: null, concubines: 0, offers: null, nextOffer: 0 },
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
      renownSeen: [],   // 登用の候補に現れた、名のある人物の名前
      legacy: null,     // 最後の布石で選んだ遺訓（制度でないもの）
      report: null,     // 一年の決算報告
      nextPhase: null,  // 決算報告のあとに進む場面
      yearStart: null,  // 年のはじめの状態（決算報告で増減を出すため）
    };

    // 家系図（史実の部分）
    const ieyasu = addPerson({ name: '家康', born: 1543, parentId: null, trait: '慎重', gen: 1, from: 1603, to: 1605,
      start: { seimu: 18, bui: 18, jintoku: 16 }, note: '幕府を開く。将軍職を秀忠に譲り、大御所として政を見る。' });
    DATA.branches.forEach((g, i) => {
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
      stats: { seimu: 9, bui: 8, jintoku: 7 }, stress: 0, skill: null, house: null,
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
      r.salary = payOf(r);
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

    // 家光の忘れ形見（家光と側室・お楽の子として家系図に記す）
    const heir = makeChild({ label: '側室・お楽', stats: { seimu: 7, bui: 5, jintoku: 8, kenko: 10 }, skill: null }, '竹千代');
    closeReign('33歳で病に倒れ、天に昇る。霊体となって権現様に付き従う。');
    addLog('家光が天に昇った。権現様は東照宮の力で霊体となり、江戸城に降りた。');

    // 将軍は家光の異母弟・保科正之が継ぐ。人を育てるのがうまい（特技「名伯楽」）
    const hidetada = state.family.find((p) => p.name === '秀忠');
    const masayuki = addPerson({ name: '正之', born: 1611, parentId: hidetada.id, house: '保科家', trait: '慎重',
      gen: 4, from: state.year, start: { seimu: 14, bui: 9, jintoku: 13 }, skill: 'hakuraku' });
    state.usedNames.push('正之');
    state.shogun = {
      personId: masayuki.id, name: '正之', gen: 4, age: 26, health: 70, startYear: state.year, trait: '慎重',
      stats: { ...masayuki.start }, stress: 0, skill: 'hakuraku',
    };
    addLog('家光の異母弟・保科正之が、第4代将軍となった。');
    state.heirs.push(heir);
    addLog(`家光の忘れ形見、若君・${heir.name}が生まれた（素質${starText(heir.stars)} ${starInfo(heir.stars).label}）。`);
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
        r.salary = payOf(r);
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
    } else if (bonus === 'gosanke') {
      for (const b of state.branches) b.blood = { seimu: CONFIG.BLOOD_STRONG, bui: CONFIG.BLOOD_STRONG, jintoku: CONFIG.BLOOD_STRONG };
      addLog('最後の布石により、御三家にはよい血が入っていた。');
    }
  }

  // 年のはじめの状態を覚えておく
  function snapshot() {
    return { gauges: { ...state.gauges }, cash: Math.round(state.fin.cash), debt: Math.round(state.fin.debt), net: Math.round(netAssets()) };
  }

  // ─────────────────────────────── 将軍の格と特技

  // 格は、政務・武威・人徳の合計（将軍・若君・跡継ぎの候補で同じ数え方）
  function kakuOf(stats) {
    return stats.seimu + stats.bui + stats.jintoku;
  }

  function shogunKaku() {
    return kakuOf(state.shogun.stats);
  }

  function skillById(id) {
    return DATA.skills.find((s) => s.id === id) || null;
  }

  // 働くのは、いまの将軍の特技だけ
  function hasSkill(id) {
    return state.shogun.skill === id;
  }

  // 生まれた子や御三家の若殿の特技。親の特技を受け継ぐか、たまたま新しくつく
  function rollSkill(parentSkill) {
    if (parentSkill && Math.random() < CONFIG.SKILL_INHERIT) return parentSkill;
    return Math.random() < CONFIG.SKILL_CHANCE ? pick(DATA.skills).id : null;
  }

  // ─────────────────────────────── 若君と姫の誕生

  function starInfo(stars) {
    return DATA.stars.find((s) => s.stars === stars) || DATA.stars[1];
  }

  function starText(stars) {
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  }

  // 素質のくじ（cards.js の stars の見込みで引く）
  function rollStars() {
    let roll = Math.random();
    for (const s of DATA.stars) {
      roll -= s.chance;
      if (roll < 0) return s;
    }
    return DATA.stars[DATA.stars.length - 1];
  }

  // 子の特技。父か母の特技を受け継ぐか、★5なら必ず、そうでなくてもたまに新しい特技がつく
  function childSkill(fatherSkill, motherSkill, star) {
    if (fatherSkill && Math.random() < CONFIG.SKILL_INHERIT) return fatherSkill;
    if (motherSkill && Math.random() < CONFIG.SKILL_INHERIT) return motherSkill;
    if (star.skill) return pick(DATA.skills).id;
    return Math.random() < CONFIG.SKILL_CHANCE * (star.stars >= 4 ? 2 : 1) ? pick(DATA.skills).id : null;
  }

  // 若君。能力は父（将軍）と母の平均から決まり、素質（★）の分だけ上下する
  // mother: { label: '正室・照姫' など, stats: { seimu, bui, jintoku, kenko }, skill }
  function makeChild(mother, name) {
    const s = state.shogun;
    const star = rollStars();
    const inherit = (k) => clamp(Math.round((s.stats[k] + mother.stats[k]) / 2 * CONFIG.INHERIT_RATE) + rand(1, 4) + star.bonus,
      1, CONFIG.ABILITY_MAX);
    const used = state.heirs.map((h) => h.name);
    const heirName = name || pick(CHILD_NAMES.filter((n) => !used.includes(n)));
    const trait = Math.random() < 0.5 ? s.trait : pick(TRAITS);
    const skill = childSkill(s.skill, mother.skill, star);
    const p = addPerson({ name: heirName, childName: heirName, born: state.year, parentId: s.personId, trait, skill,
      mother: mother.label, stars: star.stars });
    return {
      personId: p.id,
      name: heirName,
      age: 0,
      trait,
      skill,
      stars: star.stars,
      mother: mother.label,
      stats: {
        seimu: inherit('seimu'),
        bui: inherit('bui'),
        jintoku: inherit('jintoku'),
        kenko: clamp(Math.round(mother.stats.kenko * 0.5) + rand(3, 8), 1, CONFIG.ABILITY_MAX),
      },
      taughtYear: null,
    };
  }

  function makeDaughter(mother) {
    const used = state.daughters.map((d) => d.name);
    const name = pick(DATA.brides.daughters.filter((n) => !used.includes(n)));
    const p = addPerson({ name, born: state.year, parentId: state.shogun.personId, sex: 'f', mother: mother.label });
    return { personId: p.id, name, age: 0, mother: mother.label, sex: 'f' };
  }

  // 1年に子が生まれる見込み（正室と側室の数しだい。将軍の特技「子宝」なら1.5倍）
  function birthChance() {
    const s = state.shogun;
    if (s.age < CONFIG.BIRTH_AGE[0] || s.age > CONFIG.BIRTH_AGE[1]) return 0;
    const p = (state.oku.wife ? CONFIG.WIFE_BIRTH : 0) + state.oku.concubines * CONFIG.CONCUBINE_BIRTH;
    return Math.min(0.9, p * (hasSkill('kodakara') ? 1.5 : 1));
  }

  // 子が生まれたら、その子（若君か姫）を返す。母は、正室と側室の見込みの重みで決まる
  function rollBirth() {
    if (Math.random() >= birthChance()) return null;
    const son = Math.random() < CONFIG.SON_CHANCE;
    if (son ? state.heirs.length >= CONFIG.MAX_HEIRS : state.daughters.length >= CONFIG.MAX_DAUGHTERS) return null;
    const wifeWeight = state.oku.wife ? CONFIG.WIFE_BIRTH : 0;
    const total = wifeWeight + state.oku.concubines * CONFIG.CONCUBINE_BIRTH;
    const w = state.oku.wife;
    const mother = Math.random() * total < wifeWeight
      ? { label: `正室・${w.name}`, stats: w.stats, skill: w.skill }
      // 側室は名前だけ。能力はそのつど違う（だれの子になるかも運のうち）
      : { label: `側室・${pick(DATA.brides.musume)}`, stats: { seimu: rand(3, 10), bui: rand(3, 10), jintoku: rand(3, 10), kenko: rand(6, 12) }, skill: null };
    return son ? makeChild(mother) : makeDaughter(mother);
  }

  // ─────────────────────────────── 大奥（縁組・側室・姫の縁組・養子）

  function brideKind(id) {
    return DATA.brides.kinds.find((k) => k.id === id);
  }

  // 大奥の費え（万両/年、物価を反映する前）。もとの費えに、正室と側室のぶんを足す
  function ookuBase() {
    const o = state.oku;
    return state.fin.ooku + (o.wife ? o.wife.upkeep : 0) + o.concubines * CONFIG.CONCUBINE_UPKEEP;
  }

  function needsMarriage() {
    const s = state.shogun;
    return !state.oku.wife && s.age >= CONFIG.MARRY_AGE[0] && s.age <= CONFIG.MARRY_AGE[1]
      && state.year >= state.oku.nextOffer && state.year > CONFIG.START_YEAR;
  }

  // 三家から1人ずつ、縁談の相手をつくる
  function makeBrides() {
    const range = ([min, max]) => rand(min, max);
    return DATA.brides.kinds.map((kind) => {
      const name = kind.id === 'kashin' ? pick(DATA.brides.musume) : pick(DATA.brides.hime);
      return {
        kind: kind.id, name, house: pick(kind.houses), upkeep: kind.upkeep, seed: rand(0, 99),
        skill: Math.random() < 0.15 ? pick(DATA.skills).id : null,
        stats: { seimu: range(kind.stats.seimu), bui: range(kind.stats.bui), jintoku: range(kind.stats.jintoku), kenko: range(kind.stats.kenko) },
      };
    });
  }

  // 年のはじめの場面を決める。正室のいない将軍には、まず縁談が来る
  function beginYear() {
    if (needsMarriage()) {
      state.oku.offers = makeBrides();
      state.phase = 'marriage';
    } else {
      startEventOrShip();
    }
  }

  // 異国船が来る年は、その年の出来事のかわりに勝負になる
  function startEventOrShip() {
    if (shipDue()) startBattle();
    else state.phase = 'event';
  }

  function marry(index) {
    const b = state.oku.offers[index];
    const kind = brideKind(b.kind);
    state.oku.wife = b;
    state.oku.offers = null;
    applyEffects(kind.on, { label: '将軍の婚礼' });
    if (kind.flag) state.flags[kind.flag] = state.year;
    person(state.shogun.personId).wife = `${b.name}（${b.house}・${kind.label}）`;
    addLog(`将軍・${state.shogun.name}は、${b.house}の${b.name}を正室に迎えた。`);
    startEventOrShip();
    commit();
  }

  function declineMarriage() {
    state.oku.offers = null;
    state.oku.nextOffer = state.year + CONFIG.OFFER_WAIT;
    addLog(`将軍・${state.shogun.name}の縁談を見送った。`);
    startEventOrShip();
    commit();
  }

  function addConcubine() {
    if (state.oku.concubines >= CONFIG.MAX_CONCUBINES) return;
    state.oku.concubines += 1;
    addLog(`側室を迎えた（いま${state.oku.concubines}人。大奥の費え 年+${CONFIG.CONCUBINE_UPKEEP}万両）。`);
    commit();
  }

  function removeConcubine() {
    if (state.oku.concubines <= 0) return;
    state.oku.concubines -= 1;
    addLog(`側室に暇を出した（いま${state.oku.concubines}人）。`);
    commit();
  }

  // 姫を嫁がせる（大名家なら威光、公家なら朝廷との縁が深まる）
  function marryDaughter(index, matchId) {
    const d = state.daughters[index];
    const match = DATA.brides.matches.find((m) => m.id === matchId);
    if (!d || !match || d.age < CONFIG.DAUGHTER_MARRY_AGE) return;
    const house = pick(match.houses);
    state.daughters.splice(index, 1);
    person(d.personId).note = `${house}へ嫁ぐ。`;
    applyEffects(match.on, { label: '姫の婚礼' });
    addLog(`姫・${d.name}が${house}へ嫁いだ。`);
    commit();
  }

  // 若君を養子に出す（若君の枠が空く）。target は御三家・御三卿の id か 'daimyo'。
  // 御三家・御三卿へ出すと、その家の血筋が若君の見込みまで強くなる。大名家へ出すと、縁が広がって威光が少し上がる
  function adoptOut(index, target = 'daimyo') {
    const heir = state.heirs[index];
    const branch = branchById(target);
    const where = branch ? branch.house : '他家';
    if (!heir || !window.confirm(`${heir.name}を${where}へ養子に出しますか？（若君ではなくなる）`)) {
      render();
      return;
    }
    state.heirs.splice(index, 1);
    if (branch) {
      const before = bloodKaku(branch);
      branch.blood = projectedBlood(branch, heir);
      if (heir.skill) branch.skill = heir.skill;
      branch.adopted = { name: heir.name, year: state.year };
      person(heir.personId).note = `${branch.house}の養子となる。`;
      applyEffects({ ryo: -CONFIG.BRANCH_ADOPT_COST }, { label: '養子の支度' });
      addLog(`若君・${heir.name}を${branch.house}へ養子に出した（血筋 格${before}→${bloodKaku(branch)}）。`);
    } else {
      const house = pick(brideKind('daimyo').houses);
      person(heir.personId).note = `${house}の養子となる。`;
      applyEffects({ ikou: 2, ryo: -CONFIG.ADOPT_OUT_COST }, { label: '養子の支度' });
      addLog(`若君・${heir.name}を${house}へ養子に出した。`);
    }
    commit();
  }

  // ─────────────────────────────── 御三家と御三卿

  // 分家をつくる。kind: 'sanke'（御三家）/ 'kyo'（御三卿）。blood は数（三つの能力とも同じ値）か { seimu, bui, jintoku }
  function makeBranch(def, kind, blood, year) {
    const b = typeof blood === 'number' ? { seimu: blood, bui: blood, jintoku: blood } : { ...blood };
    return { id: def.id, house: def.house, kind, blood: b, skill: null, head: def.founder, gen: 1, since: year, adopted: null };
  }

  function branchById(id) {
    return state.branches.find((b) => b.id === id) || null;
  }

  // 血筋の格（政務・武威・人徳の血筋の合計を、四捨五入したもの）
  function bloodKaku(b) {
    return Math.round(kakuOf(b.blood));
  }

  // 家風などの決まり（cards.js の branches）。御三卿には家風がない
  function branchDef(id) {
    return DATA.branches.find((d) => d.id === id) || null;
  }

  function sanke() {
    return state.branches.filter((b) => b.kind === 'sanke');
  }

  // 若君が大人になったときの能力の見込み（15歳まで、素質に応じて自然に伸びるぶんを足す）
  function expectedAdult(heir) {
    const grow = heir.stars ? starInfo(heir.stars).grow : 0.5;
    const extra = heir.age < CONFIG.ADULT_AGE ? Math.round(((CONFIG.ADULT_AGE - heir.age) * grow) / 3) : 0;
    const out = {};
    for (const k of ['seimu', 'bui', 'jintoku']) out[k] = clamp(heir.stats[k] + extra, 1, CONFIG.ABILITY_MAX);
    return out;
  }

  // 若君を養子に入れたあとの血筋（能力ごとに、高いほうが残る）
  function projectedBlood(branch, heir) {
    const e = expectedAdult(heir);
    const out = {};
    for (const k of ['seimu', 'bui', 'jintoku']) out[k] = Math.max(branch.blood[k], e[k]);
    return out;
  }

  // 突出している御三家（ほかの二家の平均より MEDDLE_GAP 以上、格が高い家）。なければ null
  function strongBranch() {
    const list = sanke();
    if (list.length < 3) return null;
    for (const b of list) {
      const others = list.filter((x) => x !== b);
      const avg = others.reduce((sum, x) => sum + kakuOf(x.blood), 0) / others.length;
      if (kakuOf(b.blood) - avg >= CONFIG.MEDDLE_GAP) return b;
    }
    return null;
  }

  // 三家がそろって強く、釣り合っているか（互いに牽制して、威光が毎年+1）
  function branchesBalanced() {
    const k = sanke().map((b) => kakuOf(b.blood));
    return k.length === 3 && Math.min(...k) >= CONFIG.BALANCE_MIN && Math.max(...k) - Math.min(...k) <= CONFIG.BALANCE_SPREAD;
  }

  // 毎年：血筋は平凡に近づき、当主はときどき代替わりする
  function ageBranches() {
    for (const b of state.branches) {
      for (const k of ['seimu', 'bui', 'jintoku']) {
        b.blood[k] = Math.round((b.blood[k] + (CONFIG.BLOOD_BASE - b.blood[k]) * CONFIG.BLOOD_DECAY) * 100) / 100;
      }
      if (state.year - b.since >= 12 && Math.random() < CONFIG.HEAD_CHANGE) changeHead(b);
    }
  }

  function changeHead(b) {
    const def = branchDef(b.id);
    b.gen += 1;
    b.since = state.year;
    b.head = (def && def.heads[b.gen - 1]) || `${pick(GIVEN)}${pick(GIVEN)}`;
  }

  // 分家から迎える跡継ぎの候補。能力は血筋のまわりに少しばらつき、家風に合う性格と得意を持ちやすい
  function branchCandidate(b) {
    const def = branchDef(b.id);
    const bias = (def && def.bias) || {};
    const stat = (k) => clamp(Math.round(b.blood[k]) + rand(-2, 2) + (bias[k] || 0), 1, CONFIG.ABILITY_MAX);
    return {
      name: `${b.house}の若殿`, house: b.house, branchId: b.id, age: rand(18, 34),
      trait: def && Math.random() < 0.6 ? def.trait : pick(TRAITS),
      skill: b.skill && Math.random() < 0.5 ? b.skill : rollSkill(null),
      stats: { seimu: stat('seimu'), bui: stat('bui'), jintoku: stat('jintoku'), kenko: rand(7, 14) },
    };
  }

  // 制度「御三卿」：将軍の子らに三家を立てさせる。血筋は本家（いまの将軍）に近い
  function foundKyo() {
    const s = state.shogun;
    for (const def of DATA.kyo) {
      if (branchById(def.id)) continue;
      state.branches.push(makeBranch(def, 'kyo', { ...s.stats }, state.year));
      addPerson({ name: def.founder, born: state.year - clamp(s.age - 18, 3, 15), parentId: s.personId, house: def.house, note: `${def.house}の祖。` });
    }
    addLog('田安・一橋・清水の御三卿が立った。本家に近い血筋の分家が、跡継ぎの備えとなる。');
  }

  // ─────────────────────────────── 異国船（白船・赤船・黒船）

  // 次の船の予兆が出る見込み（1年あたり）。幕府が長く続くほど上がる
  function shipChance() {
    const sh = state.ships;
    if (sh.next >= DATA.ships.length || sh.arriving) return 0;
    if (sh.last !== null && state.year - sh.last < CONFIG.SHIP_GAP) return 0;
    const over = bakufuYears() - CONFIG.SHIP_START[sh.next];
    return over > 0 ? Math.min(CONFIG.SHIP_MAX, over * CONFIG.SHIP_RAMP) : 0;
  }

  // 年の暮れに、次の船の予兆が出るかを決める。出たら、決算報告に出す中身を返す
  function rollShip() {
    if (Math.random() >= shipChance()) return null;
    const ship = DATA.ships[state.ships.next];
    const years = rand(CONFIG.SHIP_NOTICE[0], CONFIG.SHIP_NOTICE[1]);
    state.ships.arriving = { year: state.year + 1 + years };   // 決算のあとで年が1つ進むので、その年から数える
    return { name: ship.name, years, text: ship.omen };
  }

  function shipDue() {
    const a = state.ships.arriving;
    return Boolean(a) && state.year >= a.year;
  }

  // 勝負の力：役職の腕（特技の上乗せこみ）＋将軍の能力÷4（＋長崎奉行があれば、海防と交渉に2）
  function roundParts(roundId) {
    const r = DATA.shipRounds[roundId];
    const post = POSTS.find((p) => p.id === r.post);
    const h = holder(r.post);
    const parts = {
      post, holder: h, value: postValue(r.post),
      shogun: Math.floor(state.shogun.stats[r.stat] / 4),
      nagasaki: hasInstitution('nagasaki') && (roundId === 'kaibo' || roundId === 'kosho') ? 2 : 0,
    };
    parts.power = parts.value + parts.shogun + parts.nagasaki;
    return parts;
  }

  function roundChance(power, ship) {
    return clamp(0.5 + (power - ship.difficulty) * 0.08, 0.1, 0.95);
  }

  function boostCost(ship) {
    return Math.round(ship.boost * price());
  }

  function startBattle() {
    state.battle = { ship: state.ships.next, round: 0, results: [], done: false, victory: null, changes: [], honors: [] };
    state.phase = 'ship';
  }

  // 勝負をひとつ行う。boost なら軍資金を投じて力を上げる
  function fight(boost) {
    const b = state.battle;
    if (!b || b.done) return;
    const ship = DATA.ships[b.ship];
    const roundId = ship.rounds[b.round];
    if (boost) {
      const cost = boostCost(ship);
      if (state.fin.cash < cost) return;
      state.fin.cash -= cost;
      book('op', `異国船への備え（${ship.name}）`, -cost);
    }
    const power = roundParts(roundId).power + (boost ? CONFIG.SHIP_BOOST : 0);
    const chance = roundChance(power, ship);
    b.results.push({ id: roundId, win: Math.random() < chance, power, chance, boost });
    b.round += 1;
    const wins = b.results.filter((r) => r.win).length;
    const losses = b.results.length - wins;
    if (wins >= ship.need) finishBattle(true);
    else if (losses > ship.rounds.length - ship.need) finishBattle(false);
    commit();
  }

  function finishBattle(victory) {
    const b = state.battle;
    const ship = DATA.ships[b.ship];
    const sh = state.ships;
    b.done = true;
    b.victory = victory;
    b.changes = applyEffects(victory ? ship.win : ship.lose, { kind: 'foreign', label: ship.name });
    sh.next += 1;
    sh.arriving = null;
    sh.last = state.year;
    (victory ? sh.won : sh.lost).push(ship.id);
    if (victory && ship.final) state.flags.opened = state.year;
    const wins = b.results.filter((r) => r.win).length;
    addLog(`${ship.name}の来航：${victory ? '退けた' : '屈した'}（${wins}勝${b.results.length - wins}敗）。`);
    b.honors = checkHonors().map((h) => h.name);
  }

  // 勝負のあと。黒船に勝てば結末、負ければ倒幕。白船・赤船なら政務の間へ
  function closeBattle() {
    const b = state.battle;
    const ship = DATA.ships[b.ship];
    state.battle = null;
    if (ship.final && !b.victory) {
      gameOver('black');
      return;
    }
    if (ship.final) saveBest(bakufuYears());
    state.phase = ship.final ? 'ending' : 'manage';
    commit();
  }

  // 結末のあとも、幕府を続ける（もう異国船は来ない）
  function continueAfterEnding() {
    state.endless = true;
    state.phase = 'manage';
    commit();
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

  // 実際に払う俸禄。加増するたびに、もとの額の RAISE_RATE ぶん増える
  function payOf(r) {
    return Math.max(1, Math.round(salaryOf(r.stats) * (1 + CONFIG.RAISE_RATE * (r.raises || 0))));
  }

  // 家臣が将軍に求める格（腕の WANTS_RATE 倍）。加増や将軍の特技「人たらし」で下がる
  function wants(r) {
    const best = Math.max(...Object.values(r.stats));
    const eased = (r.raises || 0) + (hasSkill('hitotarashi') ? 1 : 0);
    return best * CONFIG.WANTS_RATE - eased * CONFIG.RAISE_WANTS;
  }

  // seed.lift … 得意な能力の上乗せ / seed.cap … 能力の上限（将軍の格に見合わない腕の者は来ない）
  function makeRetainer(seed = {}) {
    let name = seed.name;
    if (!name) {
      const used = new Set(state.retainers.map((r) => r.name).concat(state.candidates.map((c) => c.name), DATA.renowned.map((p) => p.name)));
      do {
        name = `${pick(SURNAMES)}${pick(GIVEN)}${pick(GIVEN)}`;
      } while (used.has(name) || name[name.length - 1] === name[name.length - 2]);
    }
    const stats = seed.stats || { seimu: rand(3, 10), sanyo: rand(3, 10), bui: rand(3, 10), jinbo: rand(3, 10) };
    if (!seed.stats) {
      const strong = pick(Object.keys(stats));
      stats[strong] = clamp(stats[strong] + Math.max(1, rand(3, 8) + (seed.lift || 0)), 1, CONFIG.ABILITY_MAX);
      if (seed.cap) for (const k of Object.keys(stats)) stats[k] = Math.min(stats[k], seed.cap);
    }
    const id = nextId();
    return { id, name, age: seed.age || rand(22, 40), stats, salary: salaryOf(stats), post: seed.post || null, seed: id * 7 + name.length };
  }

  // 将軍の格に応じた、毎年の登用の候補の数
  function candidateCount() {
    const k = shogunKaku();
    const base = CONFIG.CANDIDATE_STEPS.filter(([min]) => k >= min).pop()[1];
    return base + (hasSkill('mekiki') ? 1 : 0);
  }

  // 格が高いほど、腕の立つ者が集まる。格に見合わないほどの腕の者は、はじめから来ない
  function makeCandidates() {
    const k = shogunKaku();
    const lift = clamp(Math.floor((k - 30) / 6), -2, 4);
    const eased = hasSkill('hitotarashi') ? CONFIG.RAISE_WANTS : 0;
    const cap = clamp(Math.floor((k + eased) / CONFIG.WANTS_RATE), 6, CONFIG.ABILITY_MAX);
    const list = Array.from({ length: candidateCount() }, () => makeRetainer({ age: rand(20, 34), lift, cap }));
    const renowned = renownedCandidate();
    if (renowned) list.unshift(renowned);
    return list;
  }

  // 名のある人物（その年だけ現れる。1回の幕府で1人1度まで）
  function renownedCandidate() {
    const k = shogunKaku();
    if (k < CONFIG.RENOWN_KAKU) return null;
    if (Math.random() >= (k - CONFIG.RENOWN_KAKU + 2) * CONFIG.RENOWN_CHANCE) return null;
    const pool = DATA.renowned.filter((p) => state.year >= p.minYear && !state.renownSeen.includes(p.name));
    if (pool.length === 0) return null;
    const p = pick(pool);
    state.renownSeen.push(p.name);
    const r = makeRetainer({ name: p.name, age: p.age, stats: { ...p.stats } });
    r.renowned = p.desc;
    return r;
  }

  function holder(postId) {
    return state.retainers.find((r) => r.post === postId) || null;
  }

  // 役職に就いている家臣の腕。空席なら 4 として扱う（空席は損）
  function holderValue(postId) {
    const h = holder(postId);
    const post = POSTS.find((p) => p.id === postId);
    return h ? h.stats[post.stat] : 4;
  }

  // 役職の働きぶり。将軍の特技が効く役職は、そのぶん上乗せする
  function postValue(postId) {
    const sk = skillById(state.shogun.skill);
    return holderValue(postId) + (sk && sk.post === postId ? sk.bonus : 0);
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

  // 加増。俸禄が上がるかわりに、家臣が求める格が下がる（格の足りない将軍でも、金でつなぎとめられる）
  function raise(id) {
    const r = state.retainers.find((x) => x.id === id);
    if (!r) return;
    r.raises = (r.raises || 0) + 1;
    r.salary = payOf(r);
    if (wants(r) <= shogunKaku()) r.unhappy = null;
    addLog(`${r.name}を加増した（俸禄 年${r.salary}万両・求める格${wants(r)}）。`);
    commit();
  }

  // 「老中の」のように、役職名を前につける（控えの家臣なら空）
  function postOf(r) {
    return r.post ? `${POSTS.find((p) => p.id === r.post).name}の` : '';
  }

  // 年の暮れの去就。求める格に将軍が届かなければ不満を漏らし、次の暮れにも届かなければ去る
  function checkLoyalty(notes) {
    const k = shogunKaku();
    for (const r of [...state.retainers]) {
      const w = wants(r);
      if (w <= k) {
        r.unhappy = null;
      } else if (r.unhappy) {
        state.retainers = state.retainers.filter((x) => x !== r);
        notes.push(`${postOf(r)}${r.name}は、将軍の格に見切りをつけて去った（求める格${w}・将軍の格${k}）。`);
      } else {
        r.unhappy = state.year;
        notes.push(`${postOf(r)}${r.name}が不満を漏らしている（求める格${w}・将軍の格${k}）。次の暮れまでに格が届かなければ去る。組織の画面で加増すれば引き留められる。`);
      }
    }
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
    // 商いは時代とともに大きくなる（交易の上がりは年々増える）。尾張家の華美な家風なら、さらに15%
    const trade = Math.round(f.trade * (1 + (state.year - CONFIG.START_YEAR) / 250) * (s.house === 'owari' ? 1.15 : 1));
    // 紀伊家の倹約の家風なら、経費が5%減る
    const costRate = 1 - (kanjo - 10) * 0.01 - (hasInstitution('kanjo') ? 0.05 : 0) - (s.house === 'kii' ? 0.05 : 0);
    const hatamoto = Math.round(60 * inflation * costRate);
    const salaries = state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : Math.ceil(r.salary / 2)), 0);
    const ooku = Math.round(ookuBase() * inflation * costRate * (s.house === 'owari' ? 1.3 : 1));
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
      if (key === 'branch') return (strongBranch() || { house: '御三家のひとつ' }).house;
      const post = POSTS.find((p) => p.id === key);
      if (!post) return all;
      const h = holder(key);
      return h ? `${post.name}・${h.name}` : `${post.name}（空席）`;
    });
  }

  function drawCard() {
    // cards.js の when(s) は s.shogunate や s.heirs、s.strongBranch などを見る
    const view = { ...state, shogunate: state.gauges, strongBranch: strongBranch() };
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
          r.salary = payOf(r);
          state.candidates.push(r);
        }
        unit = '人';
      } else if (key === 'debtCut') {
        v = Math.min(v, Math.round(f.debt));
        f.debt -= v;
        v = -v;
        unit = '万両';
      } else if (key === 'branchCurb' || key === 'branchLift') {
        // 突出した御三家の血筋を下げる／ほかの二家の血筋を上げる（能力ごとに v ずつ）
        const strong = strongBranch();
        if (!strong) continue;
        const targets = key === 'branchCurb' ? [strong] : sanke().filter((b) => b !== strong);
        const d = key === 'branchCurb' ? -v : v;
        for (const b of targets) {
          for (const k of ['seimu', 'bui', 'jintoku']) b.blood[k] = clamp(b.blood[k] + d, 1, CONFIG.ABILITY_MAX);
        }
        changes.push({ label: key === 'branchCurb' ? `${strong.house}の血筋の格` : 'ほかの二家の血筋の格', delta: d * 3 });
        continue;
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
    const gain = 2 + (hasInstitution('gakumon') ? 1 : 0) + (hasSkill('gakumonzuki') ? 1 : 0);
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
    if (id === 'gosankyo') foundKyo();
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
      postsAll: (min) => POSTS.every((p) => holderValue(p.id) >= min),
      heirs: state.heirs, retainers: state.retainers,
      sankeMinKaku: Math.min(...sanke().map(bloodKaku)),
      shipsWon: (state.ships && state.ships.won) || [],
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
    // 分家から迎えた将軍の家風。尾張は民心、水戸は朝廷と実績（朝廷が強すぎると威光がかすむ）
    if (s.house === 'owari') drift.minshin += 1;
    if (s.house === 'mito') {
      drift.chotei += 1;
      if (state.gauges.chotei > 70) drift.ikou -= 1;
    }
    // 御三家がそろって強く釣り合っていれば、互いに牽制して幕府の重しになる
    if (branchesBalanced()) drift.ikou += 1;
    // 満ち足りた状態は長続きしない（慢心）
    for (const key of Object.keys(drift)) {
      if (state.gauges[key] > 80) drift[key] -= 2;
    }
    applyEffects(drift);
    state.jisseki += 1 + (s.stats.seimu >= 12 ? 1 : 0) + (postValue('roju') >= 14 ? 1 : 0) + (s.house === 'mito' ? 1 : 0);
    ageBranches();

    closeBooks();

    // 家臣が歳をとる。腕は役目の中で磨かれ（将軍が「名伯楽」なら2倍伸びやすい）、老いれば職を辞す
    const growChance = hasSkill('hakuraku') ? 0.6 : 0.3;
    for (const r of [...state.retainers]) {
      r.age += 1;
      if (r.post && r.age < 45 && Math.random() < growChance) {
        const stat = POSTS.find((p) => p.id === r.post).stat;
        r.stats[stat] = clamp(r.stats[stat] + 1, 1, CONFIG.ABILITY_MAX);
        r.salary = payOf(r);
      }
      if (r.age > 58 && Math.random() < (r.age - 58) * 0.05) {
        state.retainers = state.retainers.filter((x) => x !== r);
        notes.push(`${postOf(r)}${r.name}が老いて職を辞した（${r.age}歳）。`);
      }
    }

    // 若君が育つ（素質が高いほど伸びやすい）。姫も歳をとる
    for (const heir of state.heirs) {
      heir.age += 1;
      const grow = heir.stars ? starInfo(heir.stars).grow : 0.5;
      if (heir.age < CONFIG.ADULT_AGE && Math.random() < grow) {
        const stat = pick(['seimu', 'bui', 'jintoku']);
        heir.stats[stat] = clamp(heir.stats[stat] + 1, 1, CONFIG.ABILITY_MAX);
      }
    }
    for (const d of state.daughters) d.age += 1;

    // 将軍が歳をとる（「頑健」なら衰えは半分）。気苦労がたまっていると体を壊し、城中にも苛立ちが広がる
    s.age += 1;
    const wear = hasSkill('ganken') ? 0.5 : 1;
    if (s.age >= 60) s.health -= 4 * wear;
    else if (s.age >= 40) s.health -= 2 * wear;
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

    // 家臣の去就と、来年の登用の候補（将軍が亡くなった年は、次の将軍が決まってから）
    if (!died) {
      checkLoyalty(notes);
      state.candidates = makeCandidates();
    }

    // 子の誕生（決算報告では、別の枠で素質とともに見せる）
    const births = [];
    const child = died ? null : rollBirth();
    if (child) {
      if (child.sex === 'f') {
        state.daughters.push(child);
        births.push({ sex: 'f', name: child.name, mother: child.mother, seed: child.personId,
          text: `姫・${child.name}が生まれた（母：${child.mother}）。` });
      } else {
        state.heirs.push(child);
        const star = starInfo(child.stars);
        const sk = skillById(child.skill);
        births.push({ sex: 'm', name: child.name, mother: child.mother, trait: child.trait, stars: child.stars, label: star.label,
          skill: child.skill,
          text: `若君・${child.name}が生まれた（素質${starText(child.stars)} ${star.label}${sk ? `・特技「${sk.name}」` : ''}・母：${child.mother}）。` });
      }
    }

    // 異国船の予兆（幕府が長く続くほど出やすい）。決算報告では、別の枠で見せる
    const omen = rollShip();

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
          births.forEach((b) => addLog(b.text));
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
    births.forEach((b) => addLog(b.text));
    if (omen) addLog(`予兆：${omen.text}（${omen.name}の来航まで、あと${omen.years}年）`);
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
      births,
      omen,
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
    if ((state.nextPhase || 'event') === 'event') beginYear();
    else state.phase = state.nextPhase;
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

    // 本家の若君に加えて、御三家・御三卿からも候補が出る（若君がいれば、さしおいて迎えると威光が下がる）
    const heirs = state.heirs.map((h) => ({ ...h }));
    let candidates = heirs.concat(state.branches.map(branchCandidate));
    let mode = heirs.length > 0 ? 'heirs' : 'gosanke';
    if (candidates.length === 0) {
      // 分家もない（ふつうは起きない）
      mode = 'dispute';
      candidates = [{
        name: '一門の若者', house: '一門', age: rand(16, 30), trait: pick(TRAITS),
        stats: { seimu: rand(3, 8), bui: rand(3, 8), jintoku: rand(3, 8), kenko: rand(5, 12) },
      }];
    }
    state.succession = { reason, mode, candidates };
    state.phase = 'succession';
  }

  function crown(index) {
    const { mode, candidates } = state.succession;
    const c = candidates[index];
    const prev = state.shogun;
    const name = makeShogunName();
    const branch = branchById(c.branchId);

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
    p.skill = c.skill || null;
    for (const h of state.heirs) {
      if (h.personId !== c.personId) person(h.personId).note = '一門として家を出る。';
    }

    state.shogun = {
      personId: p.id, name, gen: prev.gen + 1, age: c.age, startYear: state.year, trait: c.trait,
      health: clamp(c.stats.kenko * 5, 20, 100),
      stats: { ...p.start }, stress: 0, skill: c.skill || null,
      house: branch ? branch.id : null,   // 分家から迎えた将軍は、その家の家風を持ち込む
    };
    // 新しい将軍の格に応じて、登用の候補が集まり直す
    state.candidates = makeCandidates();

    const from = c.house ? `${c.house}から迎えられた` : `若君・${c.name}が`;
    addLog(`${from}${name}が、第${state.shogun.gen}代将軍となった。`);
    if (branch) {
      // よい若者を出した分家は、そのぶん血筋が薄まり、当主も代わる
      for (const k of ['seimu', 'bui', 'jintoku']) branch.blood[k] = Math.round((branch.blood[k] + CONFIG.BLOOD_BASE) / 2);
      changeHead(branch);
    }
    if (branch && mode === 'heirs') {
      applyEffects({ ikou: -CONFIG.BYPASS_IKOU });
      addLog(`本家の若君をさしおいて、${branch.house}から将軍を迎えた。大名たちは本家の行く末をささやき合っている。`);
    } else if (mode === 'gosanke') {
      applyEffects({ ikou: -3 });
      addLog(`本家の血は絶えたが、${branch ? branch.house : '分家'}が幕府をつないだ。`);
    } else if (mode === 'dispute') {
      applyEffects({ ikou: -15, minshin: -5 });
      addLog('跡継ぎをめぐって争いが起き、幕府の威光は大きく揺らいだ。');
    }
    if (c.age < CONFIG.ADULT_AGE) {
      applyEffects({ ikou: -8 });
      addLog('幼い将軍に、大名たちは侮りの目を向けている。');
    }

    state.heirs = [];
    // 先代の正室と側室は大奥を退く。新しい将軍の大奥は、縁組から始まる
    state.oku = { wife: null, concubines: 0, offers: null, nextOffer: 0 };
    state.succession = null;
    ui.person = p.id;
    drawCard();
    beginYear();
    commit();
  }

  // reason: 'black' なら黒船に屈した倒幕
  function gameOver(reason = null) {
    state.phase = 'over';
    state.overReason = reason;
    closeReign(reason === 'black' ? '黒船に屈し、幕府とともに倒れる。' : '倒幕により、幕府とともに倒れる。');
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

  // 人物の顔。家康・将軍・若君・姫・御三家の人などで描き分ける
  function faceOf(p, small) {
    const cls = `iy-face${small ? ' iy-face--small' : ''}`;
    if (p.gen === 1) return art(ART.ieyasu('calm'), cls);
    if (p.house && !p.gen) return art(ART.retainer(p.id || 0), cls);
    const age = p.age !== undefined ? p.age : state.year - p.born;
    if (p.sex === 'f') return art(ART.lady(p.id || 0, age < CONFIG.DAUGHTER_MARRY_AGE), cls);
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

  // 特技の札。note は、いまは働いていない特技に添える一言（「将軍になると働く」など）
  function skillTag(id, note = '') {
    const sk = skillById(id);
    if (!sk) return null;
    return el('p', { class: 'iy-skill' }, [
      el('span', { class: 'iy-skill__name', text: `特技「${sk.name}」` }),
      ` ${sk.desc}${note}`,
    ]);
  }

  // 分家から迎えた将軍の家風の説明（本家の将軍なら何も出さない）
  function kafuLine(houseId) {
    const b = branchById(houseId);
    if (!b) return null;
    const def = branchDef(houseId);
    return el('p', { class: 'iy-skill' }, [
      el('span', { class: 'iy-skill__name', text: def ? `家風「${def.kafu}」` : '御三卿の出' }),
      ` ${b.house}から迎えた将軍。${def ? def.desc : '家風はない。'}`,
    ]);
  }

  // 素質（★）の札
  function starTag(stars, extra = '') {
    if (!stars) return null;
    return el('p', { class: 'iy-hint iy-star-line' }, [
      el('span', { class: 'iy-stars', text: starText(stars) }),
      ` 素質：${starInfo(stars).label}${extra}`,
    ]);
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
        el('span', { text: `現金 ${money(f.cash)}万両` }),
        el('span', { class: overLimit ? 'iy-warn' : '', text: `借入 ${money(f.debt)}/${money(debtLimit())}` }),
        el('span', { text: `実績 ${state.jisseki}` }),
        el('span', { class: 'iy-kaku', id: 'kaku', title: '将軍の格（政務・武威・人徳の合計）', text: `格${shogunKaku()}` }),
      ]),
      state.crisis
        ? el('p', { class: 'iy-crisis', role: 'alert', text: `倒幕の危機：あと${state.crisis.years}年で立て直せ（威光・民心・朝廷を${CONFIG.CRISIS_SAFE}より上、借入を上限以下に）` })
        : null,
      state.ships.arriving && state.phase !== 'over'
        ? el('p', { class: 'iy-ship-alert', text: shipDue() ? `${DATA.ships[state.ships.next].name}が来航した`
          : `${DATA.ships[state.ships.next].name}の来航まで、あと${state.ships.arriving.year - state.year}年` })
        : null,
    ].filter(Boolean));
  }

  function renderTabbar() {
    const alerts = {
      org: vacancies().length > 0 || state.retainers.some((r) => r.unhappy),
      seimu: ['event', 'succession', 'marriage', 'ship', 'ending'].includes(state.phase),
    };
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
      prologue: viewPrologue, event: viewEvent, result: viewResult, marriage: viewMarriage,
      manage: viewManage, succession: viewSuccession, over: viewOver, report: viewReport,
      ship: viewShip, ending: viewEnding,
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

  // 異国船との勝負。役職ごとの勝負を順に行い、決まった数だけ勝てば退けられる
  function viewShip() {
    const b = state.battle;
    const ship = DATA.ships[b.ship];
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年　異国船の来航` }),
      el('h2', { text: `${ship.name}の来航` }),
      sceneArt(ship.scene),
      el('p', { text: ship.text }),
      ieyasuSays(el('p', { class: 'iy-voice', text: `「${ship.ieyasu}」` }), 'worry'),
      el('p', { class: 'iy-hint', text: `${ship.rounds.length}回の勝負のうち、${ship.need}回勝てば退けられる。${ship.final ? '負ければ、幕府は倒れる。' : ''}` }),
      el('ol', { class: 'iy-rounds' }, ship.rounds.map((id, i) => {
        const r = DATA.shipRounds[id];
        const res = b.results[i];
        const status = res ? `${res.win ? '勝ち' : '負け'}（力${res.power}・見込み${Math.round(res.chance * 100)}%${res.boost ? '・軍資金' : ''}）`
          : !b.done && i === b.round ? 'いまの勝負' : b.done ? '—' : 'これから';
        return el('li', { class: res ? (res.win ? 'iy-round--win' : 'iy-round--lose') : !b.done && i === b.round ? 'iy-round--now' : '' }, [
          el('strong', { text: r.name }), `（${POSTS.find((p) => p.id === r.post).name}）　`, el('span', { text: status }),
        ]);
      })),
    ];
    if (!b.done) {
      const id = ship.rounds[b.round];
      const r = DATA.shipRounds[id];
      const p = roundParts(id);
      const cost = boostCost(ship);
      const short = state.fin.cash < cost;
      nodes.push(el('div', { class: 'iy-round' }, [
        el('p', { class: 'iy-round__title', text: `第${b.round + 1}の勝負：${r.name}（${r.desc}）` }),
        el('p', { class: 'iy-hint', text: `${p.post.name}・${p.holder ? p.holder.name : '空席'}の${RETAINER_LABELS[p.post.stat]}${p.value}　＋　将軍の${ABILITY_LABELS[r.stat]}÷4（${p.shogun}）${p.nagasaki ? `　＋　長崎奉行（${p.nagasaki}）` : ''}　＝　力${p.power}（難しさ${ship.difficulty}）` }),
      ]));
      nodes.push(el('div', { class: 'iy-options' }, [
        el('button', { type: 'button', class: 'iy-option', onclick: () => fight(false) }, [
          el('strong', { text: 'このまま臨む' }),
          el('span', { class: 'iy-option__hint', text: `見込み${Math.round(roundChance(p.power, ship) * 100)}%` }),
        ]),
        el('button', { type: 'button', class: 'iy-option', disabled: short, onclick: () => fight(true) }, [
          el('strong', { text: '軍資金を投じる' }),
          el('span', { class: 'iy-option__hint', text: `約${cost}万両で力+${CONFIG.SHIP_BOOST}・見込み${Math.round(roundChance(p.power + CONFIG.SHIP_BOOST, ship) * 100)}%${short ? '（現金が足りない）' : ''}` }),
        ]),
      ]));
    } else {
      const line = b.victory
        ? (ship.final ? '「……退けた。退けたぞ。」' : '「よし。じゃが、次はもっと手ごわいのが来るぞ。」')
        : (ship.final ? '「……ここまでか。」' : '「……むう。備えが足りなんだ。次の船までに立て直さねば。」');
      nodes.push(
        el('p', { class: b.victory ? 'iy-victory' : 'iy-failed', text: b.victory ? ship.winText : ship.loseText }),
        changeList(b.changes),
        b.honors.length ? el('p', { class: 'iy-honor-line', text: `栄誉を得た：${b.honors.join('、')}` }) : null,
        ieyasuSays(el('p', { class: 'iy-voice', text: line }), b.victory ? 'calm' : 'worry'),
        el('button', { type: 'button', class: 'iy-primary', text: ship.final ? (b.victory ? '結末へ' : '幕府の最期') : '政務の間へ', onclick: closeBattle }),
      );
    }
    return nodes;
  }

  // 黒船を退けた結末。このまま続けることもできる
  function viewEnding() {
    const years = bakufuYears();
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '史実を超えて' }),
      sceneArt('heaven'),
      el('p', { text: `黒船は去った。開府から${years}年、第${state.shogun.gen}代・${state.shogun.name}の代。徳川の幕府は、国を閉ざすことも、屈することもなく、新しい時代へ踏み出した。` }),
      ieyasuSays(el('p', { class: 'iy-voice', text: '「……やれやれ。これで、ようやく肩の荷が下りた。……肩はないが。」' })),
      iemitsuSays(el('p', { class: 'iy-voice', text: '「権現様、お見事にございました。この先の世は、子や孫たちに任せてもよいのではありませぬか。」' })),
      el('p', { class: 'iy-note', text: `記録：開府から${years}年（史実の幕府は約265年）。このまま幕府を続けることもできる（もう異国船は来ない）。` }),
      el('button', { type: 'button', class: 'iy-primary', text: 'このまま幕府を続ける', onclick: continueAfterEnding }),
      el('button', {
        type: 'button', class: 'iy-secondary', text: 'もう一度、最初から',
        onclick: () => { if (window.confirm('この幕府の進行状況を消して、はじめからやり直しますか？')) restart(); },
      }),
    ];
  }

  // 異国船の予兆が出ているときの備え（政務の間に出す）
  function shipPrepNodes() {
    const a = state.ships.arriving;
    if (!a) return [];
    const ship = DATA.ships[state.ships.next];
    return [
      el('h3', { text: '異国船への備え' }),
      el('p', { class: 'iy-warn-box', text: `${ship.name}の来航まで、あと${a.year - state.year}年。${ship.rounds.length}回の勝負のうち${ship.need}回勝てば退けられる。${ship.final ? '負ければ、幕府は倒れる。' : ''}` }),
      el('ul', { class: 'iy-prep' }, ship.rounds.map((id) => {
        const r = DATA.shipRounds[id];
        const p = roundParts(id);
        return el('li', {}, [
          el('strong', { text: r.name }),
          `　${p.post.name}・${p.holder ? p.holder.name : '空席'}　力${p.power}（難しさ${ship.difficulty}）　見込み${Math.round(roundChance(p.power, ship) * 100)}%`,
        ]);
      })),
      el('p', { class: 'iy-hint', text: `力は、役職の腕と、将軍の能力÷4で決まる。当日は、勝負ごとに軍資金（約${boostCost(ship)}万両）を投じて、力を${CONFIG.SHIP_BOOST}上げられる。` }),
    ];
  }

  // 縁組。正室のいない将軍に、三家から縁談が来る
  function viewMarriage() {
    const s = state.shogun;
    const list = el('div', { class: 'iy-options' });
    state.oku.offers.forEach((b, i) => {
      const kind = brideKind(b.kind);
      const sk = skillById(b.skill);
      const terms = [termsOf(kind.on, '婚礼の費え'), `大奥の費え 年+${kind.upkeep}万両`, kind.flag === 'gaiseki' ? 'のちに実家が口を出す' : '']
        .filter(Boolean).join('・');
      list.append(el('button', { type: 'button', class: 'iy-option iy-option--person', onclick: () => marry(i) }, [
        art(ART.lady(b.seed), 'iy-face'),
        el('span', { class: 'iy-option__text' }, [
          el('span', { class: 'iy-option__how', text: `${kind.label}・${b.house}` }),
          el('strong', { text: `${b.name}（格${kakuOf(b.stats)}）` }),
          el('span', { text: Object.keys(ABILITY_LABELS).map((k) => `${ABILITY_LABELS[k]}${b.stats[k]}`).join('　') }),
          sk ? el('span', { class: 'iy-skill__name', text: `特技「${sk.name}」${sk.desc}` }) : null,
          el('span', { text: terms }),
        ]),
      ]));
    });
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '縁組' }),
      sceneArt('palanquin'),
      el('p', { text: `将軍・${s.name}（${s.age}歳）に、正室を迎える縁談が三つ来ている。正室の能力と特技は、生まれてくる子に受け継がれる。` }),
      ieyasuSays(el('p', { class: 'iy-voice', text: '「嫁取りは、家と家を結ぶもの。じゃが、生まれてくる子の器も母しだいじゃ。……金のかかり方もな。」' })),
      list,
      el('button', { type: 'button', class: 'iy-secondary', text: `今は迎えない（${CONFIG.OFFER_WAIT}年後に、また縁談が来る）`, onclick: declineMarriage }),
    ];
  }

  function heirCard(heir, index) {
    const canTeach = heir.age < CONFIG.TEACH_AGE_LIMIT;
    const taught = heir.taughtYear === state.year;
    return el('div', { class: 'iy-heir' }, [
      el('div', { class: 'iy-heir__head' }, [
        faceOf(heir),
        el('p', { class: 'iy-heir__name' }, [
          el('strong', { text: heir.name }), `（${heir.age}歳・${heir.trait}）`,
          el('span', { class: 'iy-kaku', text: `格${kakuOf(heir.stats)}` }),
        ]),
      ]),
      starTag(heir.stars, heir.mother ? `　母：${heir.mother}` : ''),
      statBars(heir.stats, ABILITY_LABELS),
      skillTag(heir.skill, '（将軍になると働く）'),
      canTeach
        ? el('p', { class: 'iy-hint', text: taught ? '今年はもう師をつけた。' : `師をつける（教育費 ${teachCost()}万両・1年に1回）` })
        : el('p', { class: 'iy-hint', text: '成人したので、教育は終わった。' }),
      canTeach ? el('div', { class: 'iy-teach' }, Object.keys(TEACH_LABELS).map((stat) => el('button', {
        type: 'button', text: TEACH_LABELS[stat], disabled: taught, onclick: () => teach(index, stat),
      }))) : null,
      // 養子に出す先。御三家・御三卿へ出すと、その家の血筋が若君の見込みまで上がる
      el('select', {
        class: 'iy-heir__adopt', 'aria-label': `${heir.name}を養子に出す先`,
        onchange: (e) => adoptOut(index, e.target.value),
      }, [
        el('option', { value: '', text: '養子に出す…（若君の枠が空く）', selected: true, disabled: true }),
        ...state.branches.map((b) => el('option', {
          value: b.id,
          text: `${b.house}へ（血筋 格${bloodKaku(b)}→${Math.round(kakuOf(projectedBlood(b, heir)))}・支度金 約${Math.abs(scaledCost(-CONFIG.BRANCH_ADOPT_COST))}万両）`,
        })),
        el('option', { value: 'daimyo', text: `大名家へ（威光+2・支度金 約${Math.abs(scaledCost(-CONFIG.ADOPT_OUT_COST))}万両）` }),
      ]),
    ]);
  }

  // 効果の一覧を短い文にする（例：「朝廷+8・婚礼の費え 約30万両」）。ryoName は出費の呼び名
  function termsOf(on, ryoName) {
    return Object.entries(on).map(([key, v]) => {
      if (key === 'ryo') return v < 0 ? `${ryoName} 約${Math.abs(scaledCost(v))}万両` : `持参金 ${v}万両`;
      return STATE_LABELS[key] ? `${STATE_LABELS[key]}${signed(v)}` : '';
    }).filter(Boolean).join('・');
  }

  function daughterCard(d, index) {
    const ready = d.age >= CONFIG.DAUGHTER_MARRY_AGE;
    return el('div', { class: 'iy-heir' }, [
      el('div', { class: 'iy-heir__head' }, [
        faceOf({ ...d, id: d.personId }),
        el('p', { class: 'iy-heir__name' }, [el('strong', { text: `姫・${d.name}` }), `（${d.age}歳）`, el('br'), el('span', { class: 'iy-muted', text: `母：${d.mother}` })]),
      ]),
      ready
        ? el('div', { class: 'iy-matches' }, DATA.brides.matches.map((m) => el('button', {
          type: 'button', text: `${m.label}（${termsOf(m.on, '婚礼の費え')}）`, onclick: () => marryDaughter(index, m.id),
        })))
        : el('p', { class: 'iy-hint', text: `${CONFIG.DAUGHTER_MARRY_AGE}歳になると、大名家や公家へ嫁がせられる。` }),
    ]);
  }

  // 大奥：正室・側室と、子が生まれる見込み
  function okuNodes() {
    const o = state.oku;
    const s = state.shogun;
    const nodes = [];
    if (o.wife) {
      const kind = brideKind(o.wife.kind);
      nodes.push(el('div', { class: 'iy-heir' }, [
        el('div', { class: 'iy-heir__head' }, [
          art(ART.lady(o.wife.seed), 'iy-face'),
          el('p', { class: 'iy-heir__name' }, [
            el('strong', { text: `正室・${o.wife.name}` }), `（${o.wife.house}・${kind.label}）`,
            el('span', { class: 'iy-kaku', text: `格${kakuOf(o.wife.stats)}` }),
          ]),
        ]),
        el('p', { class: 'iy-retainer__stats' }, Object.keys(ABILITY_LABELS).map((k) => el('span', { text: `${ABILITY_LABELS[k]}${o.wife.stats[k]}` }))),
        skillTag(o.wife.skill, '（子に受け継がれることがある）'),
      ]));
    } else {
      const [min, max] = CONFIG.MARRY_AGE;
      nodes.push(el('p', { class: 'iy-hint', text: s.age < min ? `正室はまだいない。将軍が${min}歳になると、縁談が来る。`
        : s.age > max ? '正室はいない。将軍の歳から、もう縁談は来ない。'
          : `正室がいない。縁談は${Math.max(o.nextOffer, state.year + 1)}年のはじめに来る。` }));
    }
    nodes.push(el('p', { class: 'iy-hint', text: `側室 ${o.concubines}人（1人ごとに子が生まれやすくなり、大奥の費えが年${CONFIG.CONCUBINE_UPKEEP}万両増える）` }));
    nodes.push(el('div', { class: 'iy-actions' }, [
      el('button', { type: 'button', text: '側室を迎える', disabled: o.concubines >= CONFIG.MAX_CONCUBINES, onclick: addConcubine }),
      el('button', { type: 'button', text: '側室に暇を出す', disabled: o.concubines <= 0, onclick: removeConcubine }),
    ]));
    const p = birthChance();
    const [bmin, bmax] = CONFIG.BIRTH_AGE;
    nodes.push(el('p', { class: 'iy-hint', text: p > 0
      ? `子が生まれる見込み：年${Math.round(p * 100)}%（若君は${CONFIG.MAX_HEIRS}人、姫は${CONFIG.MAX_DAUGHTERS}人まで）。大奥の費え：年${Math.round(ookuBase())}万両（物価で上がる）`
      : s.age < bmin ? `将軍が${bmin}歳になるまで、子は生まれない。`
        : s.age > bmax ? '将軍の歳から、もう子は望めない。' : '正室か側室がいないと、子は生まれない。' }));
    return nodes;
  }

  function viewManage() {
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '政務の間' }),
      el('p', { class: 'iy-hint', text: '若君の教育、大奥、制度の整備、代替わりを決める。財務と組織は下のメニューから。終わったら年を越す。' }),
      ...shipPrepNodes(),
      el('h3', { text: '若君' }),
    ];

    if (state.heirs.length === 0) {
      nodes.push(el('p', { class: 'iy-hint', text: 'まだ若君がいない。正室や側室がいれば、いずれ生まれるだろう。' }));
    } else {
      state.heirs.forEach((h, i) => nodes.push(heirCard(h, i)));
    }
    if (canRetire()) {
      nodes.push(el('button', { type: 'button', class: 'iy-secondary', onclick: retire, text: `${state.shogun.name}を隠居させ、将軍職を譲る` }));
    }
    if (state.daughters.length > 0) {
      nodes.push(el('h3', { text: '姫' }));
      state.daughters.forEach((d, i) => nodes.push(daughterCard(d, i)));
    }
    nodes.push(el('h3', { text: '大奥' }));
    nodes.push(...okuNodes());

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

    const unhappy = state.retainers.filter((r) => r.unhappy);
    if (vacancies().length > 0) {
      nodes.push(el('p', { class: 'iy-warn-box', text: `空いている役職があります（${vacancies().map((p) => p.name).join('・')}）。空席のままだと、その役目の働きが落ちる。` }));
    }
    if (unhappy.length > 0) {
      nodes.push(el('p', { class: 'iy-warn-box', text: `不満を漏らしている家臣がいます（${unhappy.map((r) => r.name).join('・')}）。将軍の格が求める格に届かなければ、この暮れに去る。加増すれば引き留められる。` }));
    }
    if (vacancies().length > 0 || unhappy.length > 0) {
      nodes.push(el('button', { type: 'button', class: 'iy-secondary', text: '組織を開く', onclick: () => { ui.tab = 'org'; render(); scrollToGame(); } }));
    }
    nodes.push(el('button', { type: 'button', class: 'iy-primary', text: '年を越す（決算）', onclick: endYear }));
    return nodes;
  }

  function viewSuccession() {
    const { reason, mode, candidates } = state.succession;
    const intro = {
      heirs: `次の将軍を選ぶ。本家の若君のほか、御三家・御三卿からも迎えられる（若君をさしおくと、威光が${CONFIG.BYPASS_IKOU}下がる）。`,
      gosanke: '本家に跡継ぎがいない。御三家・御三卿から次の将軍を迎える。',
      dispute: '跡継ぎがいない。一門の中から、争いの末に一人が担ぎ出された。',
    }[mode];
    const option = (c) => {
      const i = candidates.indexOf(c);
      const warn = c.age < CONFIG.ADULT_AGE ? '　幼い将軍になる（威光が下がる）' : '';
      const sk = skillById(c.skill);
      const def = branchDef(c.branchId);
      const kafu = c.branchId ? (def ? `家風「${def.kafu}」：${def.desc}` : '御三卿（家風はない）') : '';
      return el('button', { type: 'button', class: 'iy-option iy-option--person', onclick: () => crown(i) }, [
        faceOf({ ...c, id: i + 3 }),
        el('span', { class: 'iy-option__text' }, [
          el('strong', { text: `${c.name}（${c.age}歳・${c.trait}）格${kakuOf(c.stats)}` }),
          c.stars ? el('span', { class: 'iy-stars', text: `${starText(c.stars)} ${starInfo(c.stars).label}` }) : null,
          el('span', { text: Object.keys(ABILITY_LABELS).map((k) => `${ABILITY_LABELS[k]}${c.stats[k]}`).join('　') + warn }),
          sk ? el('span', { class: 'iy-skill__name', text: `特技「${sk.name}」${sk.desc}` }) : null,
          kafu ? el('span', { text: kafu }) : null,
        ]),
      ]);
    };
    const heirs = candidates.filter((c) => !c.branchId && !c.house);
    const others = candidates.filter((c) => c.branchId || c.house);
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: reason === 'retire' ? '将軍職を譲る' : '将軍、世を去る' }),
      sceneArt(reason === 'retire' ? 'hall' : 'sickbed'),
      el('p', { text: intro }),
      heirs.length ? el('h3', { text: '本家の若君' }) : null,
      heirs.length ? el('div', { class: 'iy-options' }, heirs.map(option)) : null,
      others.length ? el('h3', { text: '御三家・御三卿から迎える' }) : null,
      others.length ? el('div', { class: 'iy-options' }, others.map(option)) : null,
    ];
  }

  // 決算報告の「誕生」の札。若君なら素質（★）と特技を見せる（ガチャの見せ場）
  function birthCard(b) {
    const sk = skillById(b.skill);
    return el('div', { class: `iy-birth${b.stars >= 4 ? ' iy-birth--rare' : ''}` }, [
      b.sex === 'f' ? art(ART.lady(b.seed || 0, true), 'iy-face') : art(ART.child(b.trait), 'iy-face'),
      el('div', {}, [
        el('p', { class: 'iy-birth__title', text: b.sex === 'f' ? `姫・${b.name}が生まれた` : `若君・${b.name}が生まれた` }),
        b.stars ? el('p', {}, [el('span', { class: 'iy-stars', text: starText(b.stars) }), ` 素質：${b.label}`]) : null,
        sk ? el('p', { class: 'iy-skill__name', text: `特技「${sk.name}」` }) : null,
        el('p', { class: 'iy-muted', text: `母：${b.mother}` }),
      ]),
    ]);
  }

  // 一年の決算報告。数字の増減と、この一年の出来事をまとめて見せる
  function viewReport() {
    const r = state.report;
    const total = r.op + r.inv + r.fin;
    const kpi = (label, value, good) => el('div', {}, [
      el('dt', { text: label }),
      el('dd', { class: good === undefined ? '' : good ? 'iy-up' : 'iy-down', text: value }),
    ]);
    const mood = r.omen || r.op < 0 || r.gauges.some((g) => g.after <= 20) ? 'worry' : 'calm';
    const bestBirth = (r.births || []).reduce((best, b) => Math.max(best, b.stars || 0), 0);
    // 家康のひと言（いちばん大事なことを1つだけ）
    const comment = (() => {
      if (r.omen) return '……海の向こうが騒がしい。役目の者どもを鍛え、金を蓄えて備えよ。';
      if (r.honors.length) return `栄誉「${r.honors.join('」「')}」とは、めでたい。この調子じゃ。`;
      if (bestBirth >= 4) return 'おお、これは良い器の子じゃ。しっかり育てよ。';
      if (r.op < 0) return '年貢と経費だけで赤字じゃ。このままでは金蔵がもたぬぞ。';
      if (r.gauges.some((g) => g.after <= 20)) return '数字は持っておるが、足元が危うい。手を打たねば。';
      return 'まずまずの一年じゃった。気を抜くでないぞ。';
    })();
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
      r.omen ? el('div', { class: 'iy-omen' }, [
        sceneArt('horizon'),
        el('p', { class: 'iy-omen__title', text: `予兆：${r.omen.name}` }),
        el('p', { text: r.omen.text }),
        el('p', { class: 'iy-muted', text: `あと${r.omen.years}年で来る。役職の腕を上げ、将軍を鍛え、金を蓄えて備えよ（政務の間に、備えのようすが出る）。` }),
      ]) : null,
      r.births && r.births.length ? el('div', { class: 'iy-births' }, r.births.map(birthCard)) : null,
      r.honors.length ? el('p', { class: 'iy-honor-line', text: `栄誉を得た：${r.honors.join('、')}` }) : null,
      r.notes.length ? el('ul', { class: 'iy-report-notes' }, r.notes.map((n) => el('li', { text: n }))) : null,
      ieyasuSays(el('p', { class: 'iy-voice', text: comment }), mood),
      el('button', { type: 'button', class: 'iy-primary', text: isSuccession ? '跡継ぎを決める' : '次の年へ', onclick: closeReport }),
    ];
  }

  function viewOver() {
    const years = bakufuYears();
    const black = state.overReason === 'black';
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: black ? '倒幕（黒船）' : '倒幕' }),
      sceneArt(black ? 'blackship' : 'fall'),
      el('p', { text: `${black ? '黒船に屈し、' : ''}徳川の幕府は、開府から${years}年で幕を閉じた。最後の将軍は、第${state.shogun.gen}代・${state.shogun.name}。` }),
      ieyasuSays(el('p', { class: 'iy-voice', text: black
        ? '海の向こうの力を、甘く見ておった。霊体の権現様は長いため息をつき、家光とともに日光の山へ帰っていった。……次こそは。'
        : '霊体の権現様は長いため息をつき、家光とともに日光の山へ帰っていった。……次こそは。' }), 'worry'),
      el('p', { class: 'iy-note', text: `これまでの最長記録：${Math.max(years, loadBest())}年（史実の幕府は約265年）。家系図と財務の記録は、このまま見られる。` }),
      el('button', { type: 'button', class: 'iy-primary', text: 'もう一度、最初から', onclick: restart }),
    ];
  }

  // ───── 家系図

  // 御三家・御三卿の一覧（当主・家風・血筋）
  function branchPanel() {
    const strong = strongBranch();
    const status = strong
      ? `${strong.house}が突出している（ほかの二家の平均より格が${CONFIG.MEDDLE_GAP}以上高い）。政に口を出してくることがある。`
      : branchesBalanced()
        ? `三家がそろって強く、釣り合っている。互いに牽制して、威光が毎年+1。`
        : `三家がそろって格${CONFIG.BALANCE_MIN}以上で、差が${CONFIG.BALANCE_SPREAD}以内なら、互いに牽制して威光が毎年+1。一家だけ強すぎると、政に口を出してくる。`;
    // 一覧は長いので、たたんでおく（見出しに各家の血筋の格だけ出す）
    const box = el('details', { class: 'iy-branches' });
    box.append(el('summary', { text: state.branches.map((b) => `${b.house} 格${bloodKaku(b)}`).join('・') }));
    box.append(
      el('p', { class: 'iy-hint', text: '本家に若君がいないときや、若君より良い者がいるとき、ここから将軍を迎えられる。血筋（候補の能力の目安）は代を重ねると平凡に近づくが、本家の若君を養子に出すと強くなる。' }),
      ...state.branches.map((b) => {
        const def = branchDef(b.id);
        return el('div', { class: 'iy-heir' }, [
          el('div', { class: 'iy-heir__head' }, [
            art(ART.retainer(b.house.charCodeAt(0) + b.gen * 3), 'iy-face iy-face--small'),
            el('p', { class: 'iy-heir__name' }, [
              el('strong', { text: b.house }), `（当主：${b.head}・${b.gen}代）`,
              el('span', { class: 'iy-kaku', text: `血筋 格${bloodKaku(b)}` }),
            ]),
          ]),
          el('p', { class: 'iy-retainer__stats' }, ['seimu', 'bui', 'jintoku'].map((k) => el('span', { text: `${ABILITY_LABELS[k]}${Math.round(b.blood[k])}` }))),
          el('p', { class: 'iy-hint', text: def ? `家風「${def.kafu}」：${def.desc}` : '御三卿。家風はなく、政に口を出さない。' }),
          skillTag(b.skill, '（この家の候補が受け継ぐことがある）'),
          b.adopted ? el('p', { class: 'iy-hint', text: `本家から迎えた養子：${b.adopted.name}（${b.adopted.year}年）` }) : null,
        ]);
      }),
    );
    return panel('御三家と御三卿', [el('p', { class: strong ? 'iy-warn' : 'iy-hint', text: status }), box]);
  }

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
      branchPanel(),
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
    const facts = [p.gen ? `第${p.gen}代将軍` : '', p.sex === 'f' ? '姫' : '', p.house || '', p.trait ? `性格：${p.trait}` : '', `${p.born}年生まれ`].filter(Boolean);
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
    nodes.push(starTag(p.stars));
    if (p.mother) nodes.push(el('p', { class: 'iy-hint', text: `母：${p.mother}` }));
    if (p.wife) nodes.push(el('p', { class: 'iy-hint', text: `正室：${p.wife}` }));
    nodes.push(skillTag(p.skill, heir ? '（将軍になると働く）' : ''));
    if (p.gen) {
      nodes.push(el('p', { class: 'iy-hint', text: `在位：${p.from}年〜${p.to ? `${p.to}年` : '在位中'}（${(p.to || state.year) - p.from}年）` }));
      if (isCurrent) {
        nodes.push(el('h3', { text: '今の能力（かっこ内は就任時からの伸び）' }));
        nodes.push(statBars(state.shogun.stats, { seimu: '政務', bui: '武威', jintoku: '人徳' }, p.start));
        nodes.push(el('p', { class: 'iy-hint', text: `格${shogunKaku()}（就任時${kakuOf(p.start)}）・${state.shogun.age}歳・健康${state.shogun.health}` }));
      } else if (p.end) {
        nodes.push(el('h3', { text: '退任時の能力（かっこ内は就任時からの伸び）' }));
        nodes.push(statBars(p.end, { seimu: '政務', bui: '武威', jintoku: '人徳' }, p.start));
        nodes.push(el('p', { class: 'iy-hint', text: `退任時の格${kakuOf(p.end)}（就任時${kakuOf(p.start)}）` }));
      }
      if (p.insts.length) nodes.push(el('p', { class: 'iy-hint', text: `整えた制度：${p.insts.join('、')}` }));
      if (p.endGauges) {
        nodes.push(el('p', { class: 'iy-hint', text: `退任時の幕府：${Object.entries(STATE_LABELS).map(([k, l]) => `${l}${p.endGauges[k]}`).join('　')}　純資産 ${money(p.endNet)}万両` }));
      }
    } else if (heir) {
      nodes.push(el('h3', { text: `若君の能力（格${kakuOf(heir.stats)}）` }));
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
          ['天領の石高', `${Math.round(f.kokudaka)}万石`], ['昨年の歳入', money(f.lastRevenue)], ['大奥の費え', `${Math.round(ookuBase())}/年`],
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

  // 家臣が将軍に求める格。足りなければ警告と、加増のボタンを出す（召し抱える前の候補には、ボタンは出さない）
  function loyaltyLine(r, canRaise) {
    const k = shogunKaku();
    const w = wants(r);
    if (w <= k) return el('p', { class: 'iy-loyalty iy-muted', text: `求める格${w}` });
    const next = Math.max(1, Math.round(salaryOf(r.stats) * (1 + CONFIG.RAISE_RATE * ((r.raises || 0) + 1))));
    const text = !canRaise ? `求める格${w}：将軍の格${k}では足りない（召し抱えると、暮れに不満を漏らす）`
      : r.unhappy ? `不満：求める格${w}・将軍の格${k}。この暮れに去る`
        : `求める格${w}：将軍の格${k}では足りない。暮れに不満を漏らす`;
    return el('div', { class: 'iy-loyalty' }, [
      el('p', { class: 'iy-warn', text }),
      canRaise ? el('button', {
        type: 'button', text: `加増する（俸禄${r.salary}→${next}万両・求める格−${CONFIG.RAISE_WANTS}）`, onclick: () => raise(r.id),
      }) : null,
    ]);
  }

  function retainerRow(r, button, canRaise) {
    return el('div', { class: 'iy-retainer iy-retainer--row' }, [
      retainerFace(r, true),
      el('div', {}, [
        r.renowned ? el('p', { class: 'iy-renowned' }, [el('strong', { text: '名のある人物' }), ` ${r.renowned}`]) : null,
        el('p', { class: 'iy-retainer__name', text: `${r.name}（${r.age}歳・俸禄${r.salary}万両）` }),
        retainerStats(r),
        loyaltyLine(r, canRaise),
      ]),
      button,
    ]);
  }

  function renderOrg() {
    const s = state.shogun;
    const over = state.phase === 'over';
    const salaries = state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : Math.ceil(r.salary / 2)), 0);
    const k = shogunKaku();
    const steps = CONFIG.CANDIDATE_STEPS.slice(1).map(([min, n]) => `${min}以上で${n}人`).join('、');

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
            loyaltyLine(h, !over),
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
        el('p', { class: 'iy-kaku-line' }, [el('strong', { text: `将軍の格 ${k}` }), '（政務・武威・人徳の合計）']),
        el('p', { class: 'iy-hint', text: `格が高いほど、登用の候補が多く、腕の立つ者が集まる（候補は格${steps}）。格${CONFIG.RENOWN_KAKU}以上なら、名のある人物がまれに仕官を願い出る。` }),
        skillTag(s.skill),
        kafuLine(s.house),
        el('p', { class: (s.stress || 0) >= 60 ? 'iy-warn' : 'iy-hint', text: `気苦労 ${s.stress || 0} / 100（60を超えると体を壊しはじめる。好みに合う裁きや、鷹狩り・湯治で晴れる）` }),
      ]),
      panel('役職', [
        el('p', { class: 'iy-hint', text: `家臣 ${state.retainers.length}人・俸禄の合計 年${salaries}万両（控えの家臣は半額）` }),
        el('p', { class: 'iy-hint', text: `家臣は、自分の腕（いちばん高い能力）の${CONFIG.WANTS_RATE}倍の格を将軍に求める。足りないと暮れに不満を漏らし、次の暮れにも足りなければ去る。加増すれば、俸禄が上がるかわりに求める格が下がる。` }),
        vacancies().length && reserve.length && !over
          ? el('button', { type: 'button', class: 'iy-secondary', text: '空席に、いちばん向いている控えの家臣を就ける', onclick: autoAssign })
          : null,
        ...posts,
      ]),
      panel('控えの家臣', reserve.length
        ? reserve.map((r) => retainerRow(r, el('button', { type: 'button', text: '暇を出す', disabled: over, onclick: () => dismiss(r.id) }), !over))
        : [el('p', { class: 'iy-hint', text: '控えの家臣はいない。' })]),
      panel(`登用の候補（今年・将軍の格${k}）`, state.candidates.length
        ? state.candidates.map((c, i) => retainerRow(c, el('button', {
          type: 'button', text: '召し抱える', disabled: state.retainers.length >= CONFIG.MAX_RETAINERS || over, onclick: () => hire(i),
        }), false))
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

  // 開発用の入り口。scripts/ieyasu-selfplay.mjs が、画面を使わずに自動で遊ばせるときに使う
  window.IEYASU_DEV = {
    get state() { return state; },
    CONFIG, POSTS,
    startMain, choose, endYear, closeReport, crown, hire, autoAssign,
    teach, teachCost, establish, institutionStatus, repay, retire, canRetire,
    shogunKaku, kakuOf, wants, raise,
    marry, declineMarriage, addConcubine, removeConcubine, marryDaughter, adoptOut, birthChance, ookuBase,
    projectedBlood, strongBranch, branchesBalanced, bloodKaku,
    fight, closeBattle, continueAfterEnding, boostCost,
  };

  $('title-art').innerHTML = ART.scene('heaven');
  $('intro-guide').addEventListener('click', openGuide);
  state = load() || newGame();
  lastPhase = state.phase;
  render();
  if (!tutorialDone() && ['event', 'result', 'manage'].includes(state.phase)) startTutorial();
})();
