// 家康の憂鬱（試作版）のルール。
// 物語・出来事カード・制度のデータは cards.js、画面の描画は game.js にある。
// ここは「1年の流れ」「お金の帳簿」「組織」「家系図」を受け持ち、画面（document）には触れない。
// そのため、画面のない自動プレイ（scripts/ieyasu-selfplay.mjs）でも、そのまま動かせる。
//
// 決まりごと：
// - ゲームの状態は state ひとつにまとめる。state は作り直さず、中身を入れ替える（replaceState）。
//   画面の側は同じ state を見続けられる
// - 「選ぶ」「雇う」などの操作は、状態を変えるだけ。保存と描き直しは画面の側（game.js の commit）がする
// - 確かめの問い（「養子に出しますか？」など）や音も、画面の側で出す
(() => {
  'use strict';

  const DATA = window.IEYASU_DATA;

  const CONFIG = {
    START_YEAR: 1637,       // 本編が始まる年（東照宮完成の翌年）
    BAKUFU_FOUNDED: 1603,   // 幕府を開いた年（何年続いたかの起点）
    HISTORY_YEARS: 265,     // 史実の幕府が続いた年数（目安として画面に出す）
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
    INHERIT_RATE: 0.75,     // 生まれた子の能力は、父と母の能力の平均のこの割合（＋少しの運と素質）
    INHERIT_LUCK: [-1, 2],  // 生まれた子の能力に足される運
    HEIR_ROOM: 3,           // 若君の伸びしろ。天井 ＝ 生まれたときの能力 ＋ これ ＋ 素質の★の数（教育でも天井は越えない）
    BRIDE_LIFT: [30, 8],    // 将軍の格が [0] を [1] 上回るごとに、縁談の姫の能力が1上がる（-1〜+3）
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
    // 異国船（白船・赤船・黒船の順）。来航の年は、SHIP_YEARS の前後 SHIP_JITTER 年のどこか（周回のはじめに決める）。
    // 黒船は史実どおり1853年ごろ。これが1周の大きなゴール
    SHIP_YEARS: [1700, 1777, 1853],
    SHIP_JITTER: 2,
    SHIP_NOTICE: [3, 5],    // 予兆から来航までの年数
    SHIP_BOOST: 3,          // 軍資金を投じたときに上がる力
    CARD_COOLDOWN: 10,      // 同じ出来事は、この年数のあいだ出ない
    // 威光・民心・朝廷とお金のつながり。ゲージを損ねると、数年かけてお金で返ってくる
    TRADE_START: 5,         // はじめの運上金・交易（万両/年）。これと制度で得たぶんは細らない
    TRADE_DECAY: 0.06,      // 出来事で増えた運上金・交易が、毎年細る割合（流行り廃り。11年ほどで半分）
    DRIFT_SHIFT: -1,        // 威光と民心の毎年の自然な増減に足す値（マイナスなら、放っておくと下がる）
    GAUGE_PULL: 0.2,        // 50を超えたぶんのこの割合が、毎年自然に戻る（慢心）
    MINSHIN_NENGU: 0.005,
    NENGU_PRICE: 0.2,       // 物価の上がりのうち、この割合だけ年貢の換金額（米価）も上がる。残りが、時代とともに重くなる財政の苦しさ   // 民心が50から1離れるごとに、年貢の取れ高がこれだけ増減する
    IKOU_CENTER: 50,        // 威光がこれより高ければ大名の献上が入り、低ければ見張りの費えがかかる
    IKOU_DAIMYO: 0.4,       // 威光が IKOU_CENTER から1離れるごとに、大名の献上（または見張りの費え）がこれだけ増減する（万両/年、物価を反映）
    CHOTEI_COURT: 0.05,     // 朝廷が50を1下回るごとに、朝廷・寺社への費えがこの割合で増える
    CRISIS_YEARS: 3,        // 危機になってから立て直すまでの猶予
    CRISIS_SAFE: 10,        // 威光・民心・朝廷がすべてこれを超えれば危機を脱する
    // 借入が上限を超えても、幕府は倒れない。商人に借金の棒引きを命じ（棄捐令）、借入を上限の KIEN_KEEP まで減らす。
    // そのかわり、威光と民心が下がり、出来事で増やした交易の上がりが KIEN_TRADE の割合だけ残る（商人が離れる）
    KIEN_KEEP: 0.6,
    KIEN_EFFECTS: { ikou: -4, minshin: -3 },
    KIEN_TRADE: 0.5,
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
    // 将軍の寿命。病に伏す（御不例）と、数年のうちに世を去る。予告なしの急死は、ごくまれ。
    // 病に伏す見込み（1年あたり）は、健康が40を下回るほど、60歳を超えるほど上がる
    SUDDEN_DEATH: 0.003,    // 予告なしに世を去る見込み（1年あたり）
    AILING_DEATH: 0.4,      // 御不例のあいだ、1年に世を去る見込み
    AILING_MAX: 4,          // 御不例は、長くともこの年数で終わる
    AILING_RECOVER: 50,     // 御不例のあいだに健康がここまで戻れば、病は癒える
    WISH_OFFERS: 3,         // 宣下のときに出る宿願の数
    KAKUN_MAX: 2,           // 家訓は、この段まで上がる
    WISH_JUDGE: 1,          // 宿願を果たした代は、御治世の評定で、どの者も1点ずつ甘くつける
    PROJECT_AGAIN: 10,      // くり返せる普請は、終わってからこの年数がたつと、また始められる
    PROJECT_MULT: [0.6, 1.5], // 普請の評定の点（4〜40点）しだいで、効き目がこの幅で変わる
  };

  const STATE_LABELS = { ikou: '威光', minshin: '民心', chotei: '朝廷' };
  const ABILITY_LABELS = { seimu: '政務', bui: '武威', jintoku: '人徳', kenko: '健康' };
  const RETAINER_LABELS = { seimu: '政務', sanyo: '算用', bui: '武威', jinbo: '人望' };
  const TEACH_LABELS = { seimu: '学問', bui: '武芸', jintoku: '人の道', kenko: '養生' };
  const FIN_LABELS = {
    ryo: ['現金', '万両'], borrow: ['借入', '万両'], rice: ['蔵米', '万両'], kokudaka: ['天領の石高', '万石'],
    mine: ['金銀山の産出', '万両/年'], trade: ['運上金・交易', '万両/年'], ooku: ['大奥の費え', '万両/年'],
  };
  // 減るほうが良い項目（結果の一覧で、減ったときに青で出す）
  const LOWER_IS_BETTER = ['stress', 'ooku', 'borrow', 'debtCut'];
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

  const SAVE_KEY = 'ieyasu-save';
  const BEST_KEY = 'ieyasu-best';
  const HONORS_KEY = 'ieyasu-honors';   // これまでの周回で得た栄誉（周回をまたいで残る）
  const SAVE_VERSION = 2;

  // ゲームの状態。作り直さずに中身を入れ替えるので、画面の側は同じ入れ物を見続けられる
  const state = {};

  function replaceState(next) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    return state;
  }

  // ─────────────────────────────── 小さな道具

  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
    if (!saved.ships.plan) {
      // 来る年を決めていなかったころの保存データ。過ぎてしまった船は、いまから数年後に来ることにする
      saved.ships.plan = planShips().map((p, i) => (i < saved.ships.next || p.omen > saved.year ? p
        : { omen: saved.year, arrive: saved.year + 1 + CONFIG.SHIP_NOTICE[0] }));
    }
    if (!saved.branches) {
      // 御三家を代々続く家にする前の保存データ。布石で御三家を固めていたら、血筋の強い状態で始める
      const strong = (saved.institutions || []).includes('gosanke');
      saved.branches = DATA.branches.map((def) => makeBranch(def, 'sanke', strong ? CONFIG.BLOOD_STRONG : CONFIG.BLOOD_START, saved.year));
    }
    if (saved.shogun && saved.shogun.stress === undefined) saved.shogun.stress = 0;
    if (saved.shogun && saved.shogun.skill === undefined) saved.shogun.skill = null;
    saved.lastChoice = saved.lastChoice || {};
    saved.kakun = saved.kakun || {};
    if (saved.project === undefined) saved.project = null;
    saved.projectsDone = saved.projectsDone || [];
    saved.shipPower = saved.shipPower || 0;
    // 御治世の評定を入れる前の保存データ。いまの年から始まったことにする
    if (saved.reign === undefined && saved.shogun) {
      saved.reign = { from: saved.year, tags: {}, gauges: { ...saved.gauges }, net: null, kaku: kakuOf(saved.shogun.stats),
        insts: 0, won: (saved.ships.won || []).length, lost: (saved.ships.lost || []).length, crisis: false };
    }
    // 結果の画面は政務の間にまとめた
    if (saved.phase === 'result') saved.phase = 'manage';
    if (saved.era === undefined) saved.era = saved.phase === 'prologue' ? null : eraAt(saved.year).id;
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

  // 保存データがあれば続きから、なければはじめから
  function loadOrNew() {
    const saved = load();
    if (saved) replaceState(saved);
    else newGame();
    return state;
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

  // ─────────────────────────────── はじまり

  function newGame() {
    replaceState({
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
      // plan: 船ごとの { omen: 予兆が出る年, arrive: 来航の年 }
      ships: { next: 0, arriving: null, last: null, won: [], lost: [], plan: planShips() },
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
      lastChoice: {},   // 出来事ごとの、前回選んだ選択肢（2回目の書き出しに使う）
      brief: null,      // 静かな年の決算を、翌年の出来事の上に1行で出すときの中身
      talk: null,       // 時代の章・史実の節目の掛け合い（{ era, history }）
      era: null,        // いまの時代（cards.js の eras の id）
      succession: null,
      crisis: null,
      kien: 0,          // 借入が上限を超えて、借金の棒引き（棄捐令）を命じた回数
      reign: null,      // いまの将軍の御治世（1章）の始まりの記録。評定に使う（beginReign）
      kakun: {},        // 家訓の段（{ kenyaku: 1, ... }）。宿願を果たすと上がり、代をまたいで残る
      ledger: { year: CONFIG.START_YEAR, items: [] },
      books: [],
      family: [],
      log: [],
      flags: {},        // 過去の選択の印（数年後の出来事につながる）。値は印をつけた年
      tension: 0,       // 厳しい出来事が続いた度合い。高いほど良い出来事が来やすい
      synergies: [],    // そろった制度の組み合わせ
      honors: [],       // この周回で得た栄誉
      renownSeen: [],   // 登用の候補に現れた、名のある人物の名前
      project: null,    // 進めている普請（{ id, bugyo: 奉行の家臣の id, from: 始めた年 }）
      projectsDone: [], // 終わった普請（{ id, year, total, title, trade }）
      shipPower: 0,     // 普請（台場・大船など）で上がった、異国船との勝負の力
      legacy: null,     // 最後の布石で選んだ遺訓（制度でないもの）
      report: null,     // 一年の決算報告
      nextPhase: null,  // 決算報告のあとに進む場面
      yearStart: null,  // 年のはじめの状態（決算報告で増減を出すため）
    });

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
    state.era = eraAt(state.year).id;
    state.yearStart = snapshot();
    drawCard();
    beginReign();
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
      for (const k of Object.keys(heir.cap)) heir.cap[k] = clamp(heir.cap[k] + 3, 1, CONFIG.ABILITY_MAX);
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

  // 家訓の段（0〜KAKUN_MAX）
  function kakun(id) {
    return (state.kakun && state.kakun[id]) || 0;
  }

  // いまの将軍に効いている、先代の遺言の id（なければ null）
  function testament() {
    return (state.shogun && state.shogun.testament) || null;
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
    const inherit = (k) => clamp(Math.round((s.stats[k] + mother.stats[k]) / 2 * CONFIG.INHERIT_RATE)
      + rand(CONFIG.INHERIT_LUCK[0], CONFIG.INHERIT_LUCK[1]) + star.bonus, 1, CONFIG.ABILITY_MAX);
    const stats = { seimu: inherit('seimu'), bui: inherit('bui'), jintoku: inherit('jintoku') };
    // 伸びしろの天井。生まれ（血筋）と素質で決まり、教育でも越えない
    const cap = {};
    for (const k of Object.keys(stats)) cap[k] = clamp(stats[k] + CONFIG.HEIR_ROOM + star.stars, 1, CONFIG.ABILITY_MAX);
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
      stats: { ...stats, kenko: clamp(Math.round(mother.stats.kenko * 0.5) + rand(3, 8), 1, CONFIG.ABILITY_MAX) },
      cap,
      taughtYear: null,
    };
  }

  // 若君の能力の天井（政務・武威・人徳。健康には天井はない）。天井を入れる前の保存データの若君は、上限まで
  function heirCap(heir, k) {
    return heir.cap && heir.cap[k] !== undefined ? heir.cap[k] : CONFIG.ABILITY_MAX;
  }

  // 若君の能力を v だけ動かす。上げるときは天井で止まる（もとから天井を超えていれば、そのまま）
  function moveHeirStat(heir, k, v) {
    const cur = heir.stats[k];
    const next = v > 0 ? Math.min(cur + v, Math.max(cur, heirCap(heir, k))) : cur + v;
    heir.stats[k] = clamp(next, 1, CONFIG.ABILITY_MAX);
    return heir.stats[k] - cur;
  }

  // 正室の能力と父（いまの将軍）から見た、生まれる若君の格の見込み（素質が並で、運がならしのとき）
  function expectedChildKaku(motherStats) {
    const s = state.shogun;
    const luck = (CONFIG.INHERIT_LUCK[0] + CONFIG.INHERIT_LUCK[1]) / 2;
    return ['seimu', 'bui', 'jintoku'].reduce((sum, k) => sum
      + clamp(Math.round((s.stats[k] + motherStats[k]) / 2 * CONFIG.INHERIT_RATE + luck), 1, CONFIG.ABILITY_MAX), 0);
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
    const p = (state.oku.wife ? CONFIG.WIFE_BIRTH : 0) + state.oku.concubines * CONFIG.CONCUBINE_BIRTH
      + (testament() === 'ie' && (state.oku.wife || state.oku.concubines) ? 0.1 : 0);
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
    const lift = clamp(Math.floor((shogunKaku() - CONFIG.BRIDE_LIFT[0]) / CONFIG.BRIDE_LIFT[1]), -1, 3);
    const lifted = ([min, max]) => clamp(rand(min, max) + lift, 1, CONFIG.ABILITY_MAX);
    return DATA.brides.kinds.map((kind) => {
      const name = kind.id === 'kashin' ? pick(DATA.brides.musume) : pick(DATA.brides.hime);
      return {
        kind: kind.id, name, house: pick(kind.houses), upkeep: kind.upkeep, seed: rand(0, 99),
        skill: Math.random() < 0.15 ? pick(DATA.skills).id : null,
        stats: { seimu: lifted(kind.stats.seimu), bui: lifted(kind.stats.bui), jintoku: lifted(kind.stats.jintoku), kenko: rand(...kind.stats.kenko) },
      };
    });
  }

  // 年のはじめの場面を決める。正室のいない将軍には、まず縁談が来る
  // 年のはじめ。時代が変わった年や、史実の節目の年は、まず家康と家光の掛け合いを見せる
  function beginYear() {
    const era = eraAt(state.year);
    const history = DATA.history.find((h) => h.year === state.year);
    const newEra = era.id !== state.era;
    state.era = era.id;
    if (newEra || history) {
      state.talk = { era: newEra ? era.id : null, history: history ? history.year : null };
      state.phase = 'talk';
      return;
    }
    continueYear();
  }

  function eraAt(year) {
    return DATA.eras.filter((e) => e.from <= year).pop() || DATA.eras[0];
  }

  function closeTalk() {
    state.talk = null;
    continueYear();
  }

  function continueYear() {
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
  }

  function declineMarriage() {
    state.oku.offers = null;
    state.oku.nextOffer = state.year + CONFIG.OFFER_WAIT;
    addLog(`将軍・${state.shogun.name}の縁談を見送った。`);
    startEventOrShip();
  }

  function addConcubine() {
    if (state.oku.concubines >= CONFIG.MAX_CONCUBINES) return;
    state.oku.concubines += 1;
    addLog(`側室を迎えた（いま${state.oku.concubines}人。大奥の費え 年+${CONFIG.CONCUBINE_UPKEEP}万両）。`);
  }

  function removeConcubine() {
    if (state.oku.concubines <= 0) return;
    state.oku.concubines -= 1;
    addLog(`側室に暇を出した（いま${state.oku.concubines}人）。`);
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
  }

  // 若君を養子に出す（若君の枠が空く）。target は御三家・御三卿の id か 'daimyo'。
  // 御三家・御三卿へ出すと、その家の血筋が若君の見込みまで強くなる。大名家へ出すと、縁が広がって威光が少し上がる
  function adoptOut(index, target = 'daimyo') {
    const heir = state.heirs[index];
    const branch = branchById(target);
    if (!heir) return;
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
    for (const k of ['seimu', 'bui', 'jintoku']) out[k] = clamp(Math.min(heir.stats[k] + extra, Math.max(heir.stats[k], heirCap(heir, k))), 1, CONFIG.ABILITY_MAX);
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
        const decay = CONFIG.BLOOD_DECAY * Math.max(0, 1 - kakun('ichimon') * 0.5);
        b.blood[k] = Math.round((b.blood[k] + (CONFIG.BLOOD_BASE - b.blood[k]) * decay) * 100) / 100;
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

  // 周回のはじめに、船ごとの来航の年と、予兆が出る年を決める（来航の数年前に予兆が出る）
  function planShips() {
    return CONFIG.SHIP_YEARS.map((year) => {
      const arrive = year + rand(-CONFIG.SHIP_JITTER, CONFIG.SHIP_JITTER);
      return { omen: arrive - 1 - rand(CONFIG.SHIP_NOTICE[0], CONFIG.SHIP_NOTICE[1]), arrive };
    });
  }

  // 年の暮れに、次の船の予兆が出る年なら、予兆を出す。出たら、決算報告に出す中身を返す
  function rollShip() {
    const sh = state.ships;
    if (sh.next >= DATA.ships.length || sh.arriving) return null;
    const plan = sh.plan[sh.next];
    if (state.year < plan.omen) return null;
    const ship = DATA.ships[sh.next];
    sh.arriving = { year: plan.arrive };
    // 決算のあとで年が1つ進むので、その年から数える
    return { name: ship.name, years: plan.arrive - (state.year + 1), text: ship.omen };
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
      kakun: kakun('kaibo'),
      works: state.shipPower || 0,
    };
    parts.power = parts.value + parts.shogun + parts.nagasaki + parts.kakun + parts.works;
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
  }

  // 結末のあとも、幕府を続ける（もう異国船は来ない）
  function continueAfterEnding() {
    state.endless = true;
    state.phase = 'manage';
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
    return best * CONFIG.WANTS_RATE - eased * CONFIG.RAISE_WANTS - kakun('toyo') * 3;
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
    return base + (hasSkill('mekiki') ? 1 : 0) + (testament() === 'hito' ? 1 : 0);
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
  }

  function hire(index) {
    if (state.retainers.length >= CONFIG.MAX_RETAINERS) return;
    const c = state.candidates.splice(index, 1)[0];
    state.retainers.push(c);
    addLog(`${c.name}を召し抱えた（俸禄 年${c.salary}万両）。`);
  }

  function dismiss(id) {
    const r = state.retainers.find((x) => x.id === id);
    if (!r) return;
    state.retainers = state.retainers.filter((x) => x.id !== id);
    addLog(`${r.name}に暇を出した。`);
  }

  // 加増。俸禄が上がるかわりに、家臣が求める格が下がる（格の足りない将軍でも、金でつなぎとめられる）
  function raise(id) {
    const r = state.retainers.find((x) => x.id === id);
    if (!r) return;
    r.raises = (r.raises || 0) + 1;
    r.salary = payOf(r);
    if (wants(r) <= shogunKaku()) r.unhappy = null;
    addLog(`${r.name}を加増した（俸禄 年${r.salary}万両・求める格${wants(r)}）。`);
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

  // 細らない商いの上がり（万両/年）：もとの5万両と、制度や組み合わせの妙で得たぶん
  function tradeBase() {
    const inst = state.institutions.reduce((sum, id) => sum + ((institution(id)?.on || {}).trade || 0), 0);
    const syn = state.synergies.reduce((sum, id) => sum + ((DATA.synergies.find((x) => x.id === id)?.on || {}).trade || 0), 0);
    const works = (state.projectsDone || []).reduce((sum, p) => sum + (p.trade || 0), 0);
    return CONFIG.TRADE_START + inst + syn + works;
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
  }

  function borrowMore() {
    if (state.fin.debt + CONFIG.LOAN_STEP > debtLimit()) return;
    borrow(CONFIG.LOAN_STEP);
    addLog(`商人から${CONFIG.LOAN_STEP}万両借りた。`);
  }

  function sellRice() {
    const amount = Math.min(CONFIG.RICE_STEP, Math.floor(state.fin.rice));
    if (amount <= 0) return;
    state.fin.rice -= amount;
    state.fin.cash += amount;
    book('op', '蔵米の売却', amount);
    addLog(`蔵米を${amount}万両ぶん売った。`);
  }

  // 1年の決算。収入と経常の支出を帳簿につけ、帳簿を締める
  function closeBooks() {
    const f = state.fin;
    const s = state.shogun;
    const inflation = price();
    const kanjo = postValue('kanjo');

    const g = state.gauges;
    // 民心しだいで年貢の取れ高が変わる（民心50でもとの取れ高。0で7割、100で13割ほど）。
    // 米価は物価につれて上がるが、物価ほどには上がらない（NENGU_PRICE）
    const ricePrice = 1 + (inflation - 1) * CONFIG.NENGU_PRICE;
    const nengu = Math.round(f.kokudaka * 0.25 * (0.825 + (g.minshin - 50) * CONFIG.MINSHIN_NENGU) * (0.9 + s.stats.seimu / 100)
      * (1 + (kanjo - 10) * 0.015) * (hasInstitution('kanjo') ? 1.08 : 1) * ricePrice * (testament() === 'tami' ? 0.97 : 1) * (1 + kakun('kanjo') * 0.03));
    const mine = Math.round(f.mine);
    // 商いは時代とともに大きくなる（交易の上がりは年々増える）。尾張家の華美な家風なら、さらに15%
    const trade = Math.round(f.trade * (1 + (state.year - CONFIG.START_YEAR) / 250) * (s.house === 'owari' ? 1.15 : 1));
    // 紀伊家の倹約の家風なら、経費が5%減る
    // 遺言「倹約を守れ」でも5%減る
    const costRate = 1 - (kanjo - 10) * 0.01 - (hasInstitution('kanjo') ? 0.05 : 0) - (s.house === 'kii' ? 0.05 : 0)
      - (testament() === 'ken' ? 0.05 : 0) - kakun('kenyaku') * 0.03;
    const hatamoto = Math.round(60 * inflation * costRate * (testament() === 'bu' ? 1.05 : 1));
    const salaries = Math.round(state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : Math.ceil(r.salary / 2)), 0)
      * (testament() === 'hito' ? 1.1 : 1));
    const ooku = Math.round(ookuBase() * inflation * costRate * (s.house === 'owari' ? 1.3 : 1) * (testament() === 'ie' ? 1.2 : 1));
    // 朝廷との仲が冷えるほど、官位の礼金や公家への付け届けがかさむ（朝廷50以上でもとの額）
    const court = Math.round(5 * inflation * costRate * (1 + Math.max(0, 50 - g.chotei) * CONFIG.CHOTEI_COURT) * (testament() === 'kyo' ? 2 : 1));
    const upkeep = state.institutions.reduce((sum, id) => sum + (institution(id)?.upkeep || 0), 0);
    const interest = Math.round(f.debt * CONFIG.INTEREST);
    // 威光が高ければ大名の献上や手伝い普請が入り、低ければ大名を見張る費えがかさむ（威光50で差し引きなし）
    const daimyo = Math.round((g.ikou - CONFIG.IKOU_CENTER) * CONFIG.IKOU_DAIMYO * inflation);

    const regular = [
      ['op', '年貢', nengu], ['op', '金銀山', mine], ['op', '運上金・交易', trade],
      ['op', daimyo >= 0 ? '大名の献上・手伝い普請' : '大名を見張る費え', daimyo],
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

    // 資産の目減り（金山は掘るほど細り、蔵米は傷み、普請は古びる）。
    // 出来事で増えた商いの上がりも、流行り廃りで少しずつ細る（制度で得たぶんと、もとの上がりは残る）
    const tradeFloor = Math.min(f.trade, tradeBase());
    f.trade = tradeFloor + (f.trade - tradeFloor) * (1 - CONFIG.TRADE_DECAY);
    f.mine = Math.max(0, f.mine * 0.985);
    f.rice = Math.max(0, f.rice * 0.95);
    f.infra = Math.max(0, f.infra * 0.99);

    const total = (cf) => state.ledger.items.filter((i) => i.cf === cf).reduce((a, b) => a + b.amount, 0);
    state.books.unshift({
      year: state.year, items: state.ledger.items,
      op: total('op'), inv: total('inv'), fin: total('fin'),
      cash: Math.round(f.cash), debt: Math.round(f.debt), net: Math.round(netAssets()), limit: debtLimit(),
    });
    state.books = state.books.slice(0, CONFIG.BOOKS_KEPT);
  }

  // 棄捐令。借入を上限の KIEN_KEEP まで棒引きにさせる。決算報告に出す一文を返す
  function kienrei() {
    const f = state.fin;
    const before = Math.round(f.debt);
    f.debt = Math.round(debtLimit() * CONFIG.KIEN_KEEP);
    const floor = Math.min(f.trade, tradeBase());
    f.trade = floor + (f.trade - floor) * CONFIG.KIEN_TRADE;
    applyEffects(CONFIG.KIEN_EFFECTS);
    state.kien = (state.kien || 0) + 1;
    addLog(`借入が上限を超え、商人に借金の棒引き（棄捐令）を命じた（借入 ${before}→${f.debt}万両）。`);
    return `借入が上限を超えた。商人に借金の棒引き（棄捐令）を命じ、借入を${before}万両から${f.debt}万両に減らした。`
      + '幕府の信用は落ち（威光・民心が下がる）、商人たちは離れていった（交易の上がりが細る）。';
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
      if (card.maxYear && state.year > card.maxYear) return false;
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
          const d = moveHeirStat(heir, stat, v);
          if (d !== 0) changes.push({ label: `${heir.name}の${ABILITY_LABELS[stat]}`, delta: d });
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
        // 返す（マイナス）ときは、いまある借入より多くは返さない（借入がマイナスになり、利息が入ってこないように）
        if (v < 0) v = -Math.min(-v, Math.max(0, Math.round(f.debt)));
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
      // good … 画面で青（良い変化）にするか赤（悪い変化）にするか。気苦労や借入は、減るほうが良い
      if (v !== 0) changes.push({ label, delta: v, unit, good: LOWER_IS_BETTER.includes(key) ? v < 0 : v > 0 });
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
      // 遺言「倹約を守れ」に背く華美な裁きは、気苦労がさらにたまる
      const extra = option.tag === '華美' && testament() === 'ken' ? 3 : 0;
      sh.stress = clamp((sh.stress || 0) + CONFIG.STRESS_RELUCTANT + extra, 0, 100);
      growth = `${sh.trait}な将軍は渋々従った（気苦労+${CONFIG.STRESS_RELUCTANT + extra}、いま${sh.stress}）。`;
    }
    // 御治世の裁きの好みを数える（あだ名に使う）
    if (option.tag && state.reign) state.reign.tags[option.tag] = (state.reign.tags[option.tag] || 0) + 1;

    // 選択の印（数年後の出来事につながる）
    if (option.flag) state.flags[option.flag] = state.year;
    if (card.clears) delete state.flags[card.clears];
    // 緊張と緩和
    if (card.tone === 'bad' || card.trial) state.tension = Math.min(4, state.tension + 1);
    else if (card.tone === 'good') state.tension = 0;
    else state.tension = Math.max(0, state.tension - 1);

    state.seen[card.id] = state.year;
    state.lastChoice[card.id] = option.label;
    state.brief = null;
    state.result = {
      title: card.title,
      choice: option.label,
      text: fillNames(success ? option.text : option.failText),
      failed: !success,
      changes,
      growth,
    };
    addLog(`${card.title}：「${option.label}」${success ? '' : '……しくじった'}`);
    // 結果は政務の間の頭に出す（結果の画面と政務の間を1つにして、1年の操作を減らす）
    state.phase = 'manage';
  }

  // ─────────────────────────────── 政務の間（教育・制度・隠居）

  function teachCost() {
    return Math.round(CONFIG.TEACH_COST * price() * (testament() === 'gaku' ? 2 : 1));
  }

  function teach(heirIndex, stat) {
    const heir = state.heirs[heirIndex];
    if (!heir || heir.taughtYear === state.year) return;
    if (heir.stats[stat] >= heirCap(heir, stat)) return;   // 天井に届いていれば、師をつけても伸びない
    const cost = teachCost();
    state.fin.cash -= cost;
    book('op', '若君の教育費', -cost);
    const gain = 2 + (hasInstitution('gakumon') ? 1 : 0) + (hasSkill('gakumonzuki') ? 1 : 0) + (testament() === 'gaku' ? 1 : 0) + kakun('yoiku');
    const d = moveHeirStat(heir, stat, gain);
    heir.taughtYear = state.year;
    addLog(`若君・${heir.name}に${TEACH_LABELS[stat]}の師をつけた（${ABILITY_LABELS[stat]}+${d}、${cost}万両）。`);
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
    if (state.reign) state.reign.insts += 1;
    applyInstitutionOn(id);
    if (id === 'gosankyo') foundKyo();
    addLog(`制度「${inst.name}」を整えた。この制度は代をまたいで残る。`);
    checkSynergies();
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
    addLog(`${state.shogun.name}は将軍職を退き、大御所となった。`);
    startSuccession('retire');
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
    // 放っておくと、威光と民心は少しずつ下がる（手当てをしないと保てない）。
    // 朝廷はもともと将軍の能力では伸びないので、ここでは下げない
    // 先代の遺言
    if (testament() === 'tami') drift.minshin += 1;
    if (testament() === 'bu') drift.ikou += 1;
    if (testament() === 'kyo') drift.chotei += 1;
    // 家訓
    drift.ikou += kakun('buke');
    drift.minshin += kakun('jinsei');
    drift.chotei += kakun('kuge');
    drift.ikou += CONFIG.DRIFT_SHIFT;
    drift.minshin += CONFIG.DRIFT_SHIFT;
    // 満ち足りた状態は長続きしない（慢心）。50を超えたぶんの一部が、毎年自然に戻る。
    // 高いほど強く戻るので、よい将軍と役職がそろっても100には張りつかず、悪い出来事が効き続ける
    for (const key of Object.keys(drift)) {
      if (state.gauges[key] > 50) drift[key] -= Math.round((state.gauges[key] - 50) * CONFIG.GAUGE_PULL);
    }
    applyEffects(drift);
    state.jisseki += 1 + (s.stats.seimu >= 12 ? 1 : 0) + (postValue('roju') >= 14 ? 1 : 0) + (s.house === 'mito' ? 1 : 0) + kakun('hosei');
    ageBranches();

    closeBooks();

    // 家臣が歳をとる。腕は役目の中で磨かれ（将軍が「名伯楽」なら2倍伸びやすい）、老いれば職を辞す
    const growChance = (hasSkill('hakuraku') ? 0.6 : 0.3) + (testament() === 'hito' ? 0.1 : 0);
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
      const grow = (heir.stars ? starInfo(heir.stars).grow : 0.5) + kakun('teio') * 0.1;
      if (heir.age < CONFIG.ADULT_AGE && Math.random() < grow) {
        const stat = pick(['seimu', 'bui', 'jintoku']);
        moveHeirStat(heir, stat, 1);
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
    // 寿命。病に伏す（御不例）と、数年のうちに世を去る。健康が戻れば病は癒える。予告なしの急死は、ごくまれ
    let died = false;
    let fellIll = false;
    if (s.ailing) {
      if (s.health >= CONFIG.AILING_RECOVER) {
        s.ailing = null;
        notes.push(`将軍・${s.name}は、病から持ち直した。`);
      } else {
        died = Math.random() < CONFIG.AILING_DEATH || state.year - s.ailing.since >= CONFIG.AILING_MAX - 1;
      }
    } else if (Math.random() < CONFIG.SUDDEN_DEATH) {
      died = true;
    } else if (Math.random() < Math.max(0, 40 - s.health) * 0.008 + Math.max(0, s.age - 60) * 0.02) {
      s.ailing = { since: state.year };
      fellIll = true;
      notes.push(`将軍・${s.name}が病に伏した（御不例）。残された時は、長くないかもしれぬ。跡継ぎの支度を急げ。`);
    }
    const sudden = died && !s.ailing;

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
        births.push({ sex: 'm', name: child.name, mother: child.mother, trait: child.trait, stars: child.stars, label: star.label, seed: child.personId,
          skill: child.skill,
          text: `若君・${child.name}が生まれた（素質${starText(child.stars)} ${star.label}${sk ? `・特技「${sk.name}」` : ''}・母：${child.mother}）。` });
      }
    }

    // 異国船の予兆（来航の数年前）。決算報告では、別の枠で見せる
    const omen = rollShip();

    // 借入が上限を超えたら、商人に借金の棒引きを命じる（幕府は倒れないが、威光と民心と商いが痛む）
    if (state.fin.debt > debtLimit()) notes.push(kienrei());

    // 倒幕の危機（威光・民心・朝廷のどれかが尽きたとき）
    let crisisBegan = false;
    const low = Object.keys(state.gauges).filter((k) => state.gauges[k] <= 0).map((k) => STATE_LABELS[k]);
    if (state.crisis) {
      const safe = Object.values(state.gauges).every((v) => v > CONFIG.CRISIS_SAFE);
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
      crisisBegan = true;
      if (state.reign) state.reign.crisis = true;
    }

    notes.forEach(addLog);
    births.forEach((b) => addLog(b.text));
    if (omen) addLog(`予兆：${omen.text}（${omen.name}の来航まで、あと${omen.years}年）`);
    const honors = checkHonors();
    const project = advanceProject();
    const wish = checkWish();
    if (wish) notes.push(wish.text);

    // 一年の決算報告をつくる
    const closed = state.books[0];
    const start = state.yearStart || snapshot();
    state.report = {
      year: state.year,
      op: closed.op, inv: closed.inv, fin: closed.fin, cash: closed.cash, debt: closed.debt,
      netChange: closed.net - start.net,
      gauges: Object.keys(STATE_LABELS).map((k) => ({ key: k, before: start.gauges[k], after: state.gauges[k] })),
      notes: notes.concat(died ? [`将軍・${s.name}が${s.age}歳で${sudden ? '、にわかに' : ''}世を去った。`] : []),
      births,
      omen,
      honors: honors.map((h) => h.name),
      wish,
      project,
      // 節目の掛け合い（cards.js の talks）。何番目のせりふかを決めておき、描き直しても変わらないようにする
      talk: crisisBegan ? talkPick('crisis') : fellIll ? talkPick('ailing') : births.some((b) => (b.stars || 0) >= 4) ? talkPick('star') : null,
    };
    state.result = null;

    // 何も起きなかった年は、決算の画面を出さずに次の年へ進み、翌年の出来事の上に1行で知らせる
    const run = runway();
    const quiet = !died && !wish && !project && notes.length === 0 && births.length === 0 && !omen && honors.length === 0
      && !state.crisis && closed.op >= 0 && !(run && run.years <= 15);
    const report = state.report;

    state.year += 1;
    state.ledger = { year: state.year, items: [] };

    if (quiet) {
      state.report = null;
      state.brief = { year: report.year, op: report.op, cash: report.cash, debt: report.debt, gauges: report.gauges };
      state.phase = 'event';
      drawCard();
      state.yearStart = snapshot();
      beginYear();
      return;
    }
    state.brief = null;
    if (died) {
      addLog(`将軍・${s.name}が${s.age}歳で世を去った。`);
      startSuccession(sudden ? 'sudden' : 'death');
    } else {
      state.phase = 'event';
      drawCard();
    }
    state.yearStart = snapshot();
    state.nextPhase = state.phase;
    state.phase = 'report';
  }

  // 節目の掛け合いを1つ選ぶ（{ kind, i }）。cards.js の talks[kind] の何番目か
  function talkPick(kind) {
    const list = DATA.talks[kind] || [];
    return list.length ? { kind, i: Math.floor(Math.random() * list.length) } : null;
  }

  function closeReport() {
    if ((state.nextPhase || 'event') === 'event') beginYear();
    else state.phase = state.nextPhase;
    state.nextPhase = null;
    state.report = null;
  }

  // ─────────────────────────────── 世代交代

  // ─────────────────────────────── 普請と評定

  function projectDef(id) {
    return DATA.projects.find((p) => p.id === id) || null;
  }

  function projectCost(def) {
    return Math.round(def.ryo * price());
  }

  // いま始められる普請（年代・一度きりか・くり返しの間をみる）。進めている普請があれば空
  function projectOptions() {
    if (state.project) return [];
    return DATA.projects.filter((def) => {
      if (state.year < def.minYear) return false;
      const last = state.projectsDone.filter((p) => p.id === def.id).pop();
      if (!last) return true;
      return def.once === false && state.year - last.year >= CONFIG.PROJECT_AGAIN;
    });
  }

  // その普請の奉行にいちばん向いている家臣（なければ null）
  function bestBugyo(def) {
    return state.retainers.reduce((best, r) => (!best || r.stats[def.stat] > best.stats[def.stat] ? r : best), null);
  }

  // 普請を始める。費用は始めるときに払う（普請として資産に積む）
  function startProject(id, bugyoId) {
    const def = projectDef(id);
    if (!def || !projectOptions().includes(def)) return;
    const cost = projectCost(def);
    if (state.fin.cash < cost) return;
    const bugyo = state.retainers.find((r) => r.id === bugyoId) || bestBugyo(def);
    if (!bugyo) return;
    state.fin.cash -= cost;
    state.fin.infra += cost;
    book('inv', `普請：${def.name}`, -cost);
    state.project = { id, bugyo: bugyo.id, from: state.year };
    addLog(`普請「${def.name}」を始めた（奉行：${bugyo.name}・${cost}万両・${def.years}年がかり）。`);
  }

  // 普請があと何年で終わるか（その年の暮れに終わるなら1）
  function projectLeft() {
    const p = state.project;
    return p ? projectDef(p.id).years - (state.year - p.from) : 0;
  }

  // 年の暮れに普請を進め、終わったら評定をつけて効き目を出す。決算報告に出す中身を返す
  function advanceProject() {
    const p = state.project;
    if (!p || projectLeft() > 1) return null;
    const def = projectDef(p.id);
    // 奉行が去っていたら、いま居るいちばん向いた者が引き継いだことにする
    const bugyo = state.retainers.find((r) => r.id === p.bugyo) || bestBugyo(def);
    const skill = bugyo ? bugyo.stats[def.stat] : 6;
    const tilt = {
      daimyo: (state.gauges.ikou - 50) / 20, chonin: (state.gauges.minshin - 50) / 20,
      kuge: (state.gauges.chotei - 50) / 20, jisha: 0,
    };
    const scores = DATA.projectJudges.map((j) => ({ key: j.key, label: j.label,
      value: clamp(Math.round(3 + (def.likes[j.key] || 0) + (skill - 12) / 2 + tilt[j.key] + rand(-1, 1)), 1, 10) }));
    const total = scores.reduce((sum, x) => sum + x.value, 0);
    const [lo, hi] = CONFIG.PROJECT_MULT;
    const mult = lo + (hi - lo) * clamp((total - 4) / 36, 0, 1);
    const scaled = {};
    for (const [k, v] of Object.entries(def.on)) if (k !== 'shipPower') scaled[k] = Math.round(v * mult);
    const changes = applyEffects(scaled, { label: def.name });
    if (def.on.shipPower) {
      state.shipPower = (state.shipPower || 0) + def.on.shipPower;
      changes.push({ label: '異国船との勝負の力', delta: def.on.shipPower, good: true });
    }
    // 奉行は、大きな普請をやり遂げて腕を上げる
    if (bugyo) {
      bugyo.stats[def.stat] = clamp(bugyo.stats[def.stat] + 1, 1, CONFIG.ABILITY_MAX);
      bugyo.salary = payOf(bugyo);
    }
    const title = DATA.projectRatings.find((x) => total >= x.min).label;
    state.projectsDone.push({ id: def.id, year: state.year, total, title, trade: scaled.trade || 0 });
    state.project = null;
    addLog(`普請「${def.name}」が成った。評定は${total}点（${title}）。`);
    return { id: def.id, name: def.name, scene: def.scene, bugyo: bugyo ? bugyo.name : null, scores, total, title, changes };
  }

  // ─────────────────────────────── 宿願と家訓

  // 宿願ごとの決まり。ok: 宣下のときに候補に出るか / target: 目標の数（宣下のときに決める） / now: いまの数 /
  // lower: 数が target 以下になれば果たしたことにする（借入）
  const gaugeWish = (key) => ({
    ok: () => state.gauges[key] < 85,
    // いまより10上。ただし60より下の目標は出さない（朝廷は自然には伸びないので、70を超す目標は重すぎた）
    target: () => clamp(state.gauges[key] + 10, 60, 85),
    now: () => state.gauges[key],
  });
  const WISH_RULES = {
    kura: {
      ok: () => true,
      target: () => Math.round((Math.max(0, state.fin.cash) + 150 * price()) / 10) * 10,
      now: () => Math.round(state.fin.cash),
    },
    debt: { ok: () => state.fin.debt >= 20, target: () => 0, now: () => Math.round(state.fin.debt), lower: true },
    ikou: gaugeWish('ikou'),
    minshin: gaugeWish('minshin'),
    chotei: gaugeWish('chotei'),
    heir: {
      ok: () => state.shogun.age <= 45 && !state.heirs.some((h) => kakuOf(h.stats) >= 44),
      target: () => 44,
      now: () => Math.max(0, ...state.heirs.map((h) => kakuOf(h.stats))),
    },
    inst: {
      ok: () => DATA.institutions.filter((i) => !i.prologueOnly && !hasInstitution(i.id)).length >= 3,
      target: () => 3,
      now: () => (state.reign ? state.reign.insts : 0),
    },
    posts: {
      ok: () => POSTS.some((p) => holderValue(p.id) < 14),
      target: () => 14,
      now: () => Math.min(...POSTS.map((p) => holderValue(p.id))),
    },
    sanke: {
      ok: () => Math.min(...sanke().map(bloodKaku)) < 32,
      target: () => 32,
      now: () => Math.min(...sanke().map(bloodKaku)),
    },
    ship: {
      // 次の船が、この代のうちに来そうなとき（20年以内）だけ
      ok: () => state.ships.next < DATA.ships.length && !state.endless
        && state.ships.plan[state.ships.next].arrive <= state.year + 20,
      target: () => state.ships.won.length + 1,
      now: () => state.ships.won.length,
    },
    kaku: {
      ok: () => shogunKaku() <= 52,
      target: () => shogunKaku() + 8,
      now: () => shogunKaku(),
    },
  };

  function wishDef(id) {
    return DATA.wishes.find((w) => w.id === id) || null;
  }

  function kakunDef(id) {
    return DATA.kakun.find((k) => k.id === id) || null;
  }

  // 宣下のときの宿願の候補（3つ）。家訓がもう上がりきっているものと、すでに果たしているものは出さない
  function wishOffers() {
    const pool = DATA.wishes.filter((w) => {
      const rule = WISH_RULES[w.id];
      if (!rule || !rule.ok() || kakun(w.kakun) >= CONFIG.KAKUN_MAX) return false;
      const t = rule.target();
      return rule.lower ? rule.now() > t : rule.now() < t;
    });
    const offers = [];
    while (offers.length < CONFIG.WISH_OFFERS && pool.length) offers.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return offers.map((w) => ({ id: w.id, target: WISH_RULES[w.id].target() }));
  }

  // いまの宿願の進み具合（なければ null）。{ id, label, goal, now, target, done }
  function wishStatus() {
    const w = state.reign && state.reign.wish;
    if (!w) return null;
    const def = wishDef(w.id);
    return { ...w, label: def.label, goal: def.goal.replace('{target}', w.target), now: WISH_RULES[w.id].now() };
  }

  // 宿願を選ぶ（宣下の表紙で）。index が null なら、宿願を掲げずに始める
  function chooseWish(index) {
    const r = state.reign;
    const offer = index === null ? null : r.wishOffers[index];
    r.wish = offer ? { id: offer.id, target: offer.target, done: false } : null;
    if (offer) addLog(`将軍・${state.shogun.name}は、宿願「${wishDef(offer.id).label}」（${wishDef(offer.id).goal.replace('{target}', offer.target)}）を掲げた。`);
    closeEnthrone();
  }

  // 年の暮れに、宿願を果たしたかを確かめる。果たしたら家訓を1段上げ、決算報告に出す中身を返す
  function checkWish() {
    const w = state.reign && state.reign.wish;
    if (!w || w.done) return null;
    const rule = WISH_RULES[w.id];
    const now = rule.now();
    if (rule.lower ? now > w.target : now < w.target) return null;
    w.done = true;
    w.year = state.year;
    const def = wishDef(w.id);
    const k = kakunDef(def.kakun);
    state.kakun[k.id] = Math.min(CONFIG.KAKUN_MAX, kakun(k.id) + 1);
    const text = `宿願「${def.label}」を果たした。家訓「${k.name}」が${kakun(k.id)}段になった（${k.desc}）。`;
    addLog(text);
    return { label: def.label, kakun: k.name, level: kakun(k.id), desc: k.desc, text };
  }

  // 御治世（1章）の始まりを記録し、宣下の表紙を出す。評定は、ここからの伸びで決まる
  function beginReign() {
    state.reign = {
      from: state.year, tags: {}, gauges: { ...state.gauges }, net: netAssets() / price(), kaku: shogunKaku(),
      insts: 0, won: state.ships.won.length, lost: state.ships.lost.length, crisis: false, wish: null,
    };
    state.reign.wishOffers = wishOffers();
    state.phase = 'enthrone';
  }

  // 宣下の表紙を閉じて、その年を始める
  function closeEnthrone() {
    beginYear();
  }

  // 御治世の評定。大名・旗本・町人・朝廷が10点ずつ点をつけ、在位中の裁きの癖からあだ名をつける
  function rateReign() {
    const r = state.reign;
    if (!r) return null;
    const g = state.gauges;
    // 在位中にどれだけ良くしたか（4で割る）と、いまの高さ（50から10で割る）
    const gauge = (k) => 5 + (g[k] - r.gauges[k]) / 4 + (g[k] - 50) / 10;
    const won = state.ships.won.length - r.won;
    const lost = state.ships.lost.length - r.lost;
    // 純資産の増減は、物価を割り引いて比べる
    const netChange = r.net === null ? 0 : netAssets() / price() - r.net;
    const raw = {
      daimyo: gauge('ikou') + (won - lost) * 2,
      hatamoto: 5 + clamp(netChange / 150, -3, 3) + Math.min(3, r.insts) + (shogunKaku() - r.kaku) / 4,
      chonin: gauge('minshin'),
      kuge: gauge('chotei'),
    };
    // 倒幕の危機を招いた代は、どの者も1点ずつ辛くつける
    const scores = DATA.reignJudges.map((j) => ({ key: j.key, label: j.label,
      value: clamp(Math.round(raw[j.key] - (r.crisis ? 1 : 0) + (r.wish && r.wish.done ? CONFIG.WISH_JUDGE : 0)), 1, 10) }));
    const total = scores.reduce((sum, x) => sum + x.value, 0);
    // あだ名：いちばん多く選んだ裁きの好み（同じ数なら将軍の性格を優先）。2回に満たなければ性格で決める
    const tags = Object.entries(r.tags)
      .sort((a, b) => b[1] - a[1] || (b[0] === state.shogun.trait) - (a[0] === state.shogun.trait));
    const tag = tags.length && tags[0][1] >= 2 ? tags[0][0] : state.shogun.trait;
    const nick = DATA.nicknames[tag] || DATA.nicknames['慎重'];
    return {
      scores, total, title: DATA.reignRatings.find((x) => total >= x.min).label,
      nickname: nick.name, nickDesc: nick.desc, years: state.year - r.from,
      wish: r.wish ? { id: r.wish.id, label: wishDef(r.wish.id).label, done: r.wish.done } : null,
    };
  }

  // 御治世を閉じる。家系図に退任時のようすと評定を記し、評定を返す
  function closeReign(note) {
    const s = state.shogun;
    const p = person(s.personId);
    const rating = rateReign();
    p.to = state.year;
    p.end = { ...s.stats };
    p.endAge = s.age;
    p.endGauges = { ...state.gauges };
    p.endNet = Math.round(netAssets());
    p.note = note;
    if (rating) p.rating = rating;
    if (s.testament) p.testament = s.testament;
    state.reign = null;
    return rating;
  }

  // 遺言の候補を3つ。世を去る将軍の性格に合うものを1つ、ほかからくじで2つ
  function testamentOffers() {
    const own = DATA.testaments.filter((t) => t.trait === state.shogun.trait);
    const rest = DATA.testaments.filter((t) => !own.includes(t));
    const offers = own.slice(0, 1);
    while (offers.length < 3 && rest.length) offers.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    return offers.map((t) => t.id);
  }

  // reason: 'death'（病に伏したのち世を去った）/ 'sudden'（にわかに世を去った）/ 'retire'（職を譲った）
  function startSuccession(reason) {
    const s = state.shogun;
    const rating = closeReign(reason === 'retire' ? '隠居して大御所となる。' : `${s.age}歳で没する。`);

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
    // まず御治世の評定と遺言の場面（reignEnd）。遺言を選んだら、跡継ぎを選ぶ（succession）
    state.succession = { reason, mode, candidates, rating, offers: testamentOffers(), testament: null };
    state.phase = 'reignEnd';
  }

  // 遺言を選ぶ（次の将軍の代のあいだ効く）
  function chooseTestament(index) {
    const sc = state.succession;
    const id = sc.offers[index];
    if (!id) return;
    sc.testament = id;
    const t = DATA.testaments.find((x) => x.id === id);
    addLog(`${state.shogun.name}は、${sc.reason === 'retire' ? '次の将軍に' : '遺言として'}「${t.label}」と言い残した。`);
    state.phase = 'succession';
  }

  function crown(index) {
    const { mode, candidates, testament: will } = state.succession;
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
      testament: will || null,            // 先代の遺言（この代のあいだ効く）
      ailing: null,                       // 病に伏しているか（御不例）。{ since: 伏した年 }
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
    drawCard();
    beginReign();
  }

  // 何が尽きて倒れたか（cards.js の endings の名前）。いちばん低いゲージ
  function overCause() {
    return Object.keys(state.gauges).sort((a, b) => state.gauges[a] - state.gauges[b])[0];
  }

  // reason: 'black' なら黒船に屈した倒幕。省くと、尽きたものから決める
  function gameOver(reason = null) {
    state.phase = 'over';
    state.overReason = reason || overCause();
    closeReign(reason === 'black' ? '黒船に屈し、幕府とともに倒れる。' : '倒幕により、幕府とともに倒れる。');
    addLog(`倒幕。徳川幕府は${bakufuYears()}年で幕を閉じた。`);
    saveBest(bakufuYears());
    checkHonors();
  }

  // ─────────────────────────────── プロローグ（せりふを1つずつ送り、最後に布石を選ぶ）

  function prologueLineTo(index) {
    state.prologueLine = index;
  }

  // 最後の布石を選ぶ（制度か遺訓）。選んだあとの家康の一言を prologueNote に入れる
  function choosePrologue(choice) {
    if (choice.institution) state.institutions.push(choice.institution);
    if (choice.bonus) state.legacy = choice.bonus;
    addLog(`家康、最後の布石として「${choice.label}」を残す。`);
    state.prologueNote = choice.text;
  }

  // 次の場面へ。最後の場面のあとは本編が始まる
  function nextPrologueStep() {
    state.prologueNote = null;
    state.prologueLine = 0;
    if (state.prologueStep === DATA.prologue.length - 1) startMain();
    else state.prologueStep += 1;
  }

  // ─────────────────────────────── 財政の見通し

  // このままのペースで、あと何年で借入が上限に届くか（ここ数年の「現金−借入」の減り方から見積もる）。
  // 減っていなければ null。books は新しい年から並んでいる
  function runway() {
    const list = state.books.slice(0, 6);
    if (list.length < 3) return null;
    const pos = (b) => b.cash - b.debt;
    const perYear = (pos(list[0]) - pos(list[list.length - 1])) / (list.length - 1);
    if (perYear >= -1) return null;
    const room = Math.max(0, state.fin.cash) + Math.max(0, debtLimit() - state.fin.debt);
    return { years: Math.floor(room / -perYear), perYear: Math.round(-perYear) };
  }

  // ─────────────────────────────── 外から使う入口
  // 画面（game.js）と自動プレイ（scripts/ieyasu-selfplay.mjs）は、ここに並べたものだけを使う

  window.IEYASU_ENGINE = {
    state, DATA, CONFIG,
    // 名前と決まりごと
    STATE_LABELS, ABILITY_LABELS, RETAINER_LABELS, TEACH_LABELS, FIN_LABELS, OTHER_LABELS, LOWER_IS_BETTER, TRAITS, POSTS,
    // 小さな道具
    clamp, institution, hasInstitution, bakufuYears, price, scaledCost,
    // 保存
    save, loadOrNew, newGame, loadHonors, loadBest,
    // プロローグ
    prologueLineTo, choosePrologue, nextPrologueStep, startMain,
    // 将軍・若君・人物
    kakuOf, shogunKaku, skillById, hasSkill, starInfo, starText, person, eldestHeir, expectedAdult,
    // 大奥
    brideKind, ookuBase, birthChance, marry, declineMarriage, addConcubine, removeConcubine, marryDaughter, adoptOut,
    // 御三家と御三卿
    branchById, bloodKaku, branchDef, sanke, projectedBlood, strongBranch, branchesBalanced,
    // 異国船
    shipDue, roundParts, roundChance, boostCost, fight, closeBattle, continueAfterEnding,
    // 家臣と組織
    salaryOf, wants, holder, holderValue, postValue, postOf, vacancies, assign, autoAssign, hire, dismiss, raise,
    // 帳簿
    debtLimit, assets, netAssets, repay, borrowMore, sellRice, runway,
    // 出来事
    cardById, fillNames, successChance, choose,
    // 政務の間
    teachCost, teach, institutionCost, institutionStatus, establish, canRetire, retire,
    // 年を越す・場面を進める
    endYear, closeReport, closeTalk, eraAt, crown, overCause,
    // 将軍1代（章）
    closeEnthrone, chooseTestament, testament,
    // 宿願と家訓
    chooseWish, wishStatus, wishDef, kakun, kakunDef,
    // 血筋
    heirCap, expectedChildKaku,
    // 普請
    projectDef, projectCost, projectOptions, bestBugyo, startProject, projectLeft,
  };
})();
