// 家康の憂鬱（試作版）の画面。
// ルール（1年の流れ・お金の帳簿・組織・家系図）は engine.js、物語・出来事カード・制度のデータは cards.js、
// イラストは art.js、音は audio.js にある。ここは画面の描画と、ボタンを押したときの受け渡しを受け持つ。
(() => {
  'use strict';

  const E = window.IEYASU_ENGINE;
  const ART = window.IEYASU_ART;
  // 音（audio.js）。読み込まれていない環境では、何もしない代わりを使う
  const AUDIO = window.IEYASU_AUDIO || { cue() {}, phrase() {}, setOn: () => false, isOn: () => false };

  // ルールの側から借りるもの（状態と、状態を読むだけの道具）。state は engine.js と同じ入れ物
  const {
    state, DATA, CONFIG, STATE_LABELS, OBOE_LABELS, ABILITY_LABELS, RETAINER_LABELS, TEACH_LABELS, POSTS,
    institution, hasInstitution, bakufuYears, scaledCost, loadHonors, loadBest, formatRyo,
    kakuOf, shogunKaku, constitution, constitutionWear, abilityDrift, abilityJisseki, skillById, starInfo, starText, person,
    brideKind, ookuBase, birthChance, branchById, bloodKaku, branchDef, projectedBlood, strongBranch, branchesBalanced,
    shipDue, roundParts, roundChance, boostCost,
    salaryOf, wants, holder, postValue, vacancies, debtLimit, assets, netAssets, runway,
    cardById, fillNames, checkAbility, successChance, teachCost, institutionCost, institutionStatus, canRetire, overCause,
    wishStatus, wishDef, kakun, kakunDef, heirCap, expectedChildKaku,
    projectDef, projectCost, projectOptions, bestBugyo, projectLeft,
    banzukeTable, townView, loadZukan,
    oboe, oboeLabel,
  } = E;

  // ルールの側の操作。状態を変えたあと、保存して描き直す（commit）
  const act = (fn) => (...args) => {
    fn(...args);
    commit();
  };
  const choose = act(E.choose);
  const closeTalk = act(E.closeTalk);
  const closeReport = act(E.closeReport);
  const marry = act(E.marry);
  const declineMarriage = act(E.declineMarriage);
  const addConcubine = act(E.addConcubine);
  const removeConcubine = act(E.removeConcubine);
  const marryDaughter = act(E.marryDaughter);
  const closeBattle = act(E.closeBattle);
  const continueAfterEnding = act(E.continueAfterEnding);
  const assign = act(E.assign);
  const autoAssign = act(E.autoAssign);
  const hire = act(E.hire);
  const raise = act(E.raise);
  const repay = act(E.repay);
  const borrowMore = act(E.borrowMore);
  const sellRice = act(E.sellRice);
  const teach = act(E.teach);
  const establish = act(E.establish);
  const chooseTestament = act(E.chooseTestament);
  const chooseWish = act(E.chooseWish);
  const startProject = act(E.startProject);

  // 宿願の進み具合を短い文にする（上の帯と政務の間）
  function wishLine(w) {
    if (w.done) return `宿願「${w.label}」を果たした（${w.year}年）`;
    return `宿願「${w.label}」：${w.goal}（いま${w.now}）`;
  }

  // 家訓の一覧（段のあるものだけ）。なければ空
  function kakunList() {
    return DATA.kakun.filter((k) => kakun(k.id) > 0).map((k) => `${k.name}${kakun(k.id)}段（${k.desc}）`);
  }

  // 諸家の覚えを短い文にする（「大名 恩+3・商人 平ら・朝廷 恨み−2」）
  function oboeLine() {
    return Object.keys(OBOE_LABELS).map((k) => {
      const v = Math.round(oboe(k));
      return `${OBOE_LABELS[k]} ${oboeLabel(v)}${v ? signed(v) : ''}`;
    }).join('・');
  }

  // 覚えが動いたわけの一覧（新しいものから。limit 件まで）
  function oboeLogNodes(limit = Infinity) {
    const list = state.oboeLog.slice(0, limit);
    if (list.length === 0) return [el('p', { class: 'iy-hint', text: 'まだ、どの家とも貸し借りはない。' })];
    return [el('ul', { class: 'iy-log' }, list.map((e) => el('li', {}, [
      el('span', { class: 'iy-log__year', text: `${e.year}` }),
      el('span', { class: e.delta > 0 ? 'iy-up' : 'iy-down', text: `${OBOE_LABELS[e.party]}${e.delta > 0 ? 'の恩' : 'の恨み'}${signed1(Math.abs(e.delta))}　` }),
      e.why,
    ])))];
  }

  // 遺言の決まり（cards.js の testaments）。id がなければ null
  function testamentDef(id) {
    return DATA.testaments.find((t) => t.id === id) || null;
  }

  // 年を越す。決算の年を、財務の画面で開く年にしておく（倒幕で終わった年は、そのまま）
  function endYear() {
    E.endYear();
    if (state.phase !== 'over') ui.bookYear = String(state.year - 1);
    commit();
  }

  // 跡継ぎを決める。家系図では、新しい将軍を選んでおく
  function crown(index) {
    E.crown(index);
    ui.person = state.shogun.personId;
    commit();
  }

  // 異国船との勝負をひとつ行う。勝負ごとの音を鳴らし、決着がついたら勝ち負けの節にする
  function fight(boost) {
    const before = state.battle ? state.battle.results.length : 0;
    E.fight(boost);
    const b = state.battle;
    if (b && b.results.length > before) {
      AUDIO.cue(b.done ? (b.victory ? 'good' : 'bad') : b.results[b.results.length - 1].win ? 'select' : 'fail');
    }
    commit();
  }

  // 取り返しのつかない操作は、確かめてから行う
  function adoptOut(index, target = 'daimyo') {
    const heir = state.heirs[index];
    const branch = branchById(target);
    const where = branch ? branch.house : '他家';
    if (!heir || !window.confirm(`${heir.name}を${where}へ養子に出しますか？（若君ではなくなる）`)) {
      render();
      return;
    }
    E.adoptOut(index, target);
    commit();
  }

  function dismiss(id) {
    const r = state.retainers.find((x) => x.id === id);
    if (!r || !window.confirm(`${r.name}に暇を出しますか？`)) return;
    E.dismiss(id);
    commit();
  }

  function retire() {
    if (!canRetire()) return;
    if (!window.confirm(`${state.shogun.name}を隠居させ、将軍職を譲りますか？`)) return;
    E.retire();
    commit();
  }

  const TABS = [
    { id: 'seimu', icon: '政', label: '政務' },
    { id: 'family', icon: '系', label: '家系図' },
    { id: 'finance', icon: '財', label: '財務' },
    { id: 'org', icon: '組', label: '組織' },
    { id: 'log', icon: '記', label: '記録' },
  ];

  const TUTORIAL_KEY = 'ieyasu-tutorial-done';

  // 画面だけの状態（保存しない）。coach はチュートリアルの何番目を見せているか
  // reportShown は、演出を見せ終えた決算の年（描き直しても、演出をくり返さない）。
  // side は、PCの広い画面で政務の右に並べる画面（家系図・財務・組織・記録のどれか）
  const ui = { tab: 'seimu', person: null, bookYear: 'now', coach: null, coachLine: 0, reportShown: null, side: 'org' };

  // PCの広い画面（2列）。政務を左に、ほかの画面を右に並べる
  const WIDE = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : { matches: false };
  const isWide = () => WIDE.matches && state.phase !== 'prologue';

  // メニューの画面を開く。広い画面では、政務はいつも左にあるので、右の列を切り替える
  function openTab(id) {
    ui.tab = id;
    if (id !== 'seimu') ui.side = id;
    render();
    if (isWide()) {
      if (id === 'seimu') scrollToGame();
      else $('side').scrollTop = 0;
    } else {
      scrollToGame();
    }
  }

  // ─────────────────────────────── 小さな道具

  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
  // 表の中の金額（単位は万両）。千両の位まで、小数1けたで出す
  const money = (n) => `${Math.round(n * 10) < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}`;
  // 文の中の金額（「12万5千両」の形）
  const ryo = formatRyo;
  // 毎年の増減など、端数のある数（小数1けた。例：+0.4、−1.2）
  const signed1 = (n) => {
    const v = Math.round(n * 10) / 10;
    return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '±0';
  };

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

  // 節目の掛け合い（決算報告の talk）のせりふ。cards.js の talks[kind] の i 番目
  function talkLines(t) {
    const pair = t && (DATA.talks[t.kind] || [])[t.i];
    return pair ? pair.map((l) => lineOf(l)) : [];
  }

  // ─────────────────────────────── 描画の共通部品

  let lastPhase = null;

  function commit() {
    E.save();
    render();
    // 場面が変わったら、画面の上に戻す（スマホで下までスクロールしたままにならないように）
    if (state.phase !== lastPhase) {
      if (state.phase === 'prologue') $('stage').scrollIntoView({ block: 'start' });
      else if (ui.tab === 'seimu' || isWide()) scrollToGame();
      soundFor(state.phase);
    }
    lastPhase = state.phase;
  }

  // 場面が変わったときの音（音を切っていれば何も鳴らない）
  function soundFor(phase) {
    if (phase === 'event') {
      const card = cardById(state.card.id);
      // 静かな年は決算の画面を飛ばすので、年越しの拍子木をここで鳴らす
      if (state.brief) AUDIO.cue('year');
      if (card.trial) AUDIO.cue('drum');
      AUDIO.phrase(card.trial || ieyasuMood() === 'worry' ? 'worry' : 'calm');
    } else if (phase === 'manage') {
      if (state.result) AUDIO.cue(state.result.failed ? 'fail' : 'select');
    } else if (phase === 'talk') {
      AUDIO.cue('year');
      AUDIO.phrase('calm');
    } else if (phase === 'report') {
      const r = state.report;
      AUDIO.cue('year');
      AUDIO.cue('soroban');
      if ((r.births || []).some((b) => (b.stars || 0) >= 4)) AUDIO.cue('star');
      else if (r.honors.length || (r.banzuke && r.banzuke.place <= 2)) AUDIO.cue('honor');
      else if (r.omen || state.crisis) AUDIO.cue('drum');
    } else if (phase === 'ship') {
      AUDIO.cue('drum');
    } else if (phase === 'marriage') {
      AUDIO.phrase('calm');
    } else if (phase === 'enthrone') {
      AUDIO.cue('honor');
      AUDIO.phrase('calm');
    } else if (phase === 'reignEnd') {
      AUDIO.phrase('worry');
    } else if (phase === 'succession') {
      AUDIO.phrase('worry');
    } else if (phase === 'over') {
      AUDIO.cue('over');
    } else if (phase === 'ending') {
      AUDIO.cue('ending');
    }
  }

  // ゲームの頭（上の帯）を画面の上にそろえる。遊んでいるあいだはサイトの見出しを見せる必要がないので、
  // 下にずれていても上にずれていても合わせる（スマホで、選択肢を最初の画面に入れるため）
  function scrollToGame() {
    const top = $('game').getBoundingClientRect().top + window.scrollY - 8;
    if (Math.abs(window.scrollY - top) > 4) window.scrollTo(0, top);
  }

  // イラスト（art.js が作る固定のSVG文字列）を入れる箱
  function art(svg, cls) {
    const box = el('div', { class: cls, 'aria-hidden': 'true' });
    box.innerHTML = svg;
    return box;
  }

  // compact … 出来事の画面では、スマホで絵を少し小さくして、選択肢を最初の画面に近づける
  // outcome … 'good' なら金の光、'bad' なら曇り空と雨を重ねる（結果の絵）
  function sceneArt(name, compact = false, outcome = null) {
    return art(ART.scene(name, outcome), compact ? 'iy-scene iy-scene--compact' : 'iy-scene');
  }

  // 江戸の町の絵と、その下の一行（町の育ちと、絵に加わった普請）
  function edoNodes() {
    const v = townView();
    const works = v.works.map((id) => projectDef(id).name);
    return [
      art(ART.edo(v), 'iy-scene'),
      el('p', { class: 'iy-hint iy-edo-caption', text: `江戸の町（${v.level}段 / 6）${works.length ? `　普請：${works.join('・')}` : '　まだ大きな普請はない'}` }),
    ];
  }

  // 家臣の名前に、二つ名を添える
  function retainerName(r) {
    return r.epithet ? `${r.name}「${r.epithet}」` : r.name;
  }

  // 見立番付の表（東と西に並べる）。limit を渡すと、上からその数まで。highlight の十年（from の年）に印をつける
  function banzukeNodes(limit = Infinity, highlight = null) {
    const table = banzukeTable().slice(0, limit);
    if (table.length === 0) return [el('p', { class: 'iy-hint', text: '1640年代から、十年ごとに番付が出る。' })];
    const rows = [];
    for (let i = 0; i < table.length; i += 2) {
      const cell = (d) => (d ? el('td', { class: d.from === highlight ? 'iy-banzuke__mine' : '' }, [
        el('strong', { text: d.label }), el('br'), d.name, el('span', { class: 'iy-muted', text: `（${d.score}点）` }),
      ]) : el('td', { text: '' }));
      rows.push(el('tr', {}, [cell(table[i]), el('th', { text: table[i].rank }), cell(table[i + 1])]));
    }
    return [el('div', { class: 'iy-scroll' }, el('table', { class: 'iy-table iy-banzuke' }, [
      el('thead', {}, el('tr', {}, ['東', '', '西'].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows),
    ]))];
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
  // 顔の描き分けには、人ごとの番号（seed）と歳を使う。世を去った人は、亡くなったときの歳で描く
  function faceOf(p, small) {
    const cls = `iy-face${small ? ' iy-face--small' : ''}`;
    if (p.gen === 1) return art(ART.ieyasu('calm'), cls);
    if (p.house && !p.gen) return art(ART.retainer(p.id || 0), cls);
    const age = p.age !== undefined ? p.age : p.to && p.endAge ? p.endAge : state.year - p.born;
    const seed = p.personId || p.id || 0;
    if (p.sex === 'f') return art(ART.lady(seed, age < CONFIG.DAUGHTER_MARRY_AGE), cls);
    if (!p.gen && age < CONFIG.ADULT_AGE) return art(ART.child(p.trait, seed), cls);
    return art(ART.shogun(p.trait || '慎重', seed, age), cls);
  }

  function shogunFace(cls) {
    const s = state.shogun;
    return art(ART.shogun(s.trait, s.personId, s.age), cls);
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

  // 将軍の能力が、いま何にどれだけ効いているか（将軍の札と組織の画面に出す）
  function abilityEffects() {
    const s = state.shogun;
    const d = abilityDrift();
    const j = abilityJisseki();
    // 出来事の成否で、担当の役職がどれだけ助けているか
    const help = (stat, postName) => {
      const v = checkAbility({ stat }) - s.stats[stat];
      return v > 0 ? `（${postName}が+${Math.round(v * 10) / 10}助ける）` : `（${postName}の腕が9を超えると助ける）`;
    };
    const pct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n))}%`;
    const rows = [
      ['seimu', `年貢${pct(s.stats.seimu - 10)}（1につき1%）・実績 毎年${signed1(j.shogun)}・出来事の成否${help('seimu', '老中')}`],
      ['bui', `威光 毎年${signed1(d.ikou.shogun)}（10を超えた1につき+0.2）・出来事の成否${help('bui', '大目付')}`],
      ['jintoku', `民心 毎年${signed1(d.minshin.shogun)}（10を超えた1につき+0.2）・出来事の成否${help('jintoku', '町奉行')}`],
      ['kenko', `歳による健康の衰え ×${constitutionWear().toFixed(2)}（体質10で1倍。高いほど衰えにくい）`],
    ];
    return el('details', { class: 'iy-rules' }, [
      el('summary', { text: '能力の働き（いまの効き目）' }),
      el('ul', { class: 'iy-hint' }, rows.map(([k, text]) => el('li', {}, [el('strong', { text: `${ABILITY_LABELS[k]}${k === 'kenko' ? constitution() : s.stats[k]}` }), `　${text}`]))),
      el('p', { class: 'iy-hint', text: '毎年の増減の端数は年をまたいでたまり、1になった年に効く。三つの能力の合計が「格」で、家臣の集まり方と去就を決める。異国船との勝負では、能力の4分の1が力に足される。' }),
    ]);
  }

  // 役職の家臣が、いま何にどれだけ効いているか（組織の画面に出す）
  function postEffect(postId) {
    const v = postValue(postId);
    const j = abilityJisseki();
    const helpCheck = Math.round(Math.max(0, (v - 9) / 3) * 10) / 10;
    const pct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n * 10) / 10)}%`;
    const text = {
      roju: `政務の成否 +${helpCheck}・実績 毎年${signed1(j.post)}`,
      kanjo: `年貢${pct((v - 10) * 1.5)}・経費${pct(-(v - 10))}`,
      machi: `民心 毎年${signed1((v - 10) / 4)}・人徳の成否 +${helpCheck}`,
      ometsuke: `威光 毎年${signed1((v - 10) / 4)}・武威の成否 +${helpCheck}`,
      shoshidai: `朝廷 毎年${signed1((v - 10) / 4)}`,
      jisha: `威光・民心 毎年 各${signed1((v - 10) / 8)}`,
    }[postId];
    return el('p', { class: 'iy-hint', text: `いまの効き目：${text}` });
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
      el('li', { class: (c.good !== undefined ? c.good : c.delta > 0) ? 'iy-up' : 'iy-down', text: c.unit === '万両' ? `${c.label} ${c.delta > 0 ? '+' : ''}${ryo(c.delta)}` : `${c.label} ${signed(c.delta)}${c.unit || ''}` })));
  }

  function panel(title, children, cls = '') {
    return el('section', { class: `iy-panel ${cls}` }, [title ? el('h2', { text: title }) : null].concat(children));
  }

  // ─────────────────────────────── 描画

  function render() {
    const playing = state.phase !== 'prologue';
    $('intro').hidden = playing;
    // 紹介文の下のボタン。途中まで読んでいれば「続きから」にする
    if (!playing) $('intro-start').textContent = state.prologueStep > 0 || state.prologueLine > 0 ? '物語の続きから' : '物語を始める';
    $('topbar').hidden = !playing;
    $('tabbar').hidden = !playing;
    document.body.classList.toggle('iy-has-tabbar', playing);
    if (!playing) ui.tab = 'seimu';

    // 広い画面では、政務（左）と、右の列の画面（ui.side）の2つを出す
    const wide = isWide();
    document.body.classList.toggle('iy-wide', wide);
    const shown = wide ? ['seimu', ui.side] : [ui.tab];
    renderTopbar();
    renderTabbar();
    for (const tab of TABS) $(`tab-${tab.id}`).hidden = !shown.includes(tab.id);
    const views = { seimu: renderSeimu, family: renderFamily, finance: renderFinance, org: renderOrg, log: renderLog };
    for (const id of shown) views[id]();
    // 右の列は、上の帯の下から画面の下までに収め、列の中だけで動かせるようにする
    if (wide) document.body.style.setProperty('--iy-top', `${$('topbar').offsetHeight + 8}px`);
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
        shogunFace('iy-face iy-face--tiny'),
        el('p', { class: 'iy-topbar__title' }, [
          // 決算報告を見ているあいだは、まだその年の暮れとして出す（年はもう進んでいるが、報告と食い違わないように）
          el('strong', { text: state.phase === 'report' && state.report ? `${state.report.year}年の暮れ` : `${state.year}年` }),
          ` 第${s.gen}代 ${s.name}（${s.age}歳）`,
          s.ailing && state.phase !== 'over' ? el('span', { class: 'iy-warn', text: ' 御不例' }) : null,
        ]),
        // 音を入れる・切る（はじめは切ってある）
        el('button', {
          type: 'button', class: 'iy-guide-btn iy-sound-btn', 'aria-pressed': AUDIO.isOn() ? 'true' : 'false',
          'aria-label': AUDIO.isOn() ? '音を切る（いまは音が入っている）' : '音を入れる（いまは音を切っている）',
          onclick: () => { AUDIO.setOn(!AUDIO.isOn()); renderTopbar(); },
        }, [
          el('span', { class: 'iy-guide-btn__mark', 'aria-hidden': 'true', text: '♪' }),
          el('span', { class: 'iy-sound-btn__text', 'aria-hidden': 'true', text: AUDIO.isOn() ? '音 入' : '音 切' }),
        ]),
        el('button', { type: 'button', class: 'iy-guide-btn', id: 'guide-button', onclick: openGuide }, [
          el('span', { class: 'iy-guide-btn__mark', text: '?' }), 'ガイド',
        ]),
      ]),
      el('div', { class: 'iy-topbar__gauges' }, gauges),
      el('p', { class: 'iy-topbar__money' }, [
        el('span', { text: `現金 ${ryo(f.cash)}` }),
        el('span', { class: overLimit ? 'iy-warn' : '', text: `借入 ${money(f.debt)}/${money(debtLimit())}` }),
        el('span', { text: `実績 ${state.jisseki}` }),
        el('span', { class: 'iy-kaku', id: 'kaku', title: '将軍の格（政務・武威・人徳の合計）', text: `格${shogunKaku()}` }),
      ]),
      wishStatus() && !['over', 'enthrone'].includes(state.phase)
        ? el('p', { class: `iy-topbar__wish${wishStatus().done ? ' iy-topbar__wish--done' : ''}`, text: wishLine(wishStatus()) })
        : null,
      state.crisis
        ? el('p', { class: 'iy-crisis', role: 'alert', text: `倒幕の危機：あと${state.crisis.years}年で立て直せ（威光・民心・朝廷をすべて${CONFIG.CRISIS_SAFE}より上に）` })
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
      seimu: ['event', 'succession', 'marriage', 'ship', 'ending', 'enthrone', 'reignEnd'].includes(state.phase),
    };
    // 広い画面では、政務はいつも左に出ているので、右の列で開いている画面を「いま」とする
    const current = isWide() ? ui.side : ui.tab;
    $('tabbar').replaceChildren(...TABS.map((t) => el('button', {
      type: 'button',
      class: `iy-tab${current === t.id ? ' iy-tab--active' : ''}`,
      'data-tab': t.id,
      'aria-current': current === t.id ? 'page' : 'false',
      onclick: () => openTab(t.id),
    }, [
      el('span', { class: 'iy-tab__icon', text: t.icon }),
      el('span', { class: 'iy-tab__label', text: t.label }),
      alerts[t.id] && current !== t.id ? el('span', { class: 'iy-tab__dot', 'aria-label': '要対応' }) : null,
    ])));
  }

  // ───── 政務

  function renderSeimu() {
    const views = {
      prologue: viewPrologue, event: viewEvent, marriage: viewMarriage, talk: viewTalk,
      manage: viewManage, succession: viewSuccession, over: viewOver, report: viewReport,
      ship: viewShip, ending: viewEnding, enthrone: viewEnthrone, reignEnd: viewReignEnd,
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
      E.nextPrologueStep();
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
        onclick: () => { E.prologueLineTo(index + 1); AUDIO.cue('next'); commit(); },
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
            E.choosePrologue(choice);
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
        onclick: () => { E.prologueLineTo(index - 1); commit(); },
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

  // 選ぶ前に「何が動くか」だけを見せる（Reigns の点と同じ考え方）。
  // 点の数で動く量の大きさを示し、上がるか下がるかは伏せる。成否が分かれる選択肢は、大きいほうで数える
  const MARK_GROUPS = [
    { label: '威光', size: (e) => Math.abs(e.ikou || 0), steps: [4, 8] },
    { label: '民心', size: (e) => Math.abs(e.minshin || 0), steps: [4, 8] },
    { label: '朝廷', size: (e) => Math.abs(e.chotei || 0), steps: [4, 8] },
    {
      label: 'お金',
      size: (e) => Math.abs(e.ryo || 0) + Math.abs(e.borrow || 0) * 0.5 + Math.abs(e.trade || 0) * 10 + Math.abs(e.kokudaka || 0) * 2.5
        + Math.abs(e.mine || 0) * 8 + Math.abs(e.rice || 0) + Math.abs(e.ooku || 0) * 10 + Math.abs(e.debtCut || 0) * 0.5,
      steps: [20, 45],
    },
    { label: '将軍', size: (e) => Math.abs(e.health || 0) + Math.abs(e.stress || 0) / 2, steps: [5, 10] },
    { label: '若君', size: (e) => Object.values(e.heir || {}).reduce((a, b) => a + Math.abs(b), 0), steps: [1, 2] },
    // 諸家の覚え（大名・商人・朝廷の恩と恨み）
    ...Object.entries(OBOE_LABELS).map(([k, label]) => ({ label: `${label}の覚え`, size: (e) => Math.abs((e.oboe || {})[k] || 0), steps: [1, 2] })),
  ];
  const MARK_WORDS = ['少し', 'かなり', '大きく'];

  function optionMarks(option) {
    const marks = [];
    for (const g of MARK_GROUPS) {
      const size = Math.max(g.size(option.effects), option.fail ? g.size(option.fail) : 0);
      if (size <= 0) continue;
      const n = size <= g.steps[0] ? 1 : size <= g.steps[1] ? 2 : 3;
      marks.push(el('span', { class: 'iy-mark' }, [
        g.label,
        el('span', { class: 'iy-mark__dots', 'aria-hidden': 'true', text: '●'.repeat(n) }),
        el('span', { class: 'iy-sr', text: `（${MARK_WORDS[n - 1]}動く）` }),
      ]));
    }
    return marks.length ? el('span', { class: 'iy-marks' }, marks) : null;
  }

  // 時代の章・史実の節目の掛け合い。せりふは一度に並べ、1回押せば先へ進む
  function viewTalk() {
    const t = state.talk;
    const era = t.era ? DATA.eras.find((e) => e.id === t.era) : null;
    const history = t.history ? DATA.history.find((h) => h.year === t.history) : null;
    const speech = (lines) => lines.map((l) => lineOf(l)).map((l) => says(l.who, el('p', { class: 'iy-voice', text: l.text }), l.mood));
    const nodes = [
      el('p', { class: 'iy-year', text: era ? `${state.year}年　時代の移り変わり` : `${state.year}年　史実では` }),
      el('h2', { text: era ? era.title : history.title }),
      sceneArt(era ? era.scene : history.scene),
    ];
    if (era) nodes.push(el('p', { text: era.lead }), ...speech(era.lines));
    // 章の始めと史実の節目が同じ年なら、続けて見せる
    if (history && era) nodes.push(el('h3', { class: 'iy-talk-sub', text: `史実では：${history.title}` }));
    if (history) nodes.push(...speech(history.lines));
    nodes.push(el('button', { type: 'button', class: 'iy-primary', text: era ? 'この時代へ' : '次へ', onclick: closeTalk }));
    return nodes;
  }

  // 静かな年の決算（決算の画面を飛ばした年）を、出来事の上に1行で出す
  function briefNode() {
    const b = state.brief;
    if (!b || b.year !== state.year - 1) return null;
    const gauges = b.gauges.map((g) => `${STATE_LABELS[g.key]}${g.after}（${signed(g.after - g.before)}）`).join(' ');
    return el('p', { class: 'iy-brief' }, [
      el('strong', { text: `${b.year}年の決算　` }),
      `営業の収支${b.op > 0 ? "+" : ""}${ryo(b.op)}・現金${ryo(b.cash)}・${gauges}　`,
      el('button', {
        type: 'button', class: 'iy-link-button', text: '帳簿を見る',
        onclick: () => { ui.bookYear = String(b.year); openTab('finance'); },
      }),
    ]);
  }

  function viewEvent() {
    const card = cardById(state.card.id);
    const s = state.shogun;
    // 2回目以降は、書き出しを差し替える（{last} は前回選んだ選択肢）
    const last = state.seen[card.id] !== undefined ? state.lastChoice[card.id] : null;
    const text = card.again && state.seen[card.id] !== undefined && (last || !card.again.includes('{last}'))
      ? card.again.replace('{last}', last) : card.text;
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
        optionMarks(option),
      ]));
    });
    return [
      briefNode(),
      el('p', { class: 'iy-year', text: `${state.year}年${card.trial ? '　大きな試練' : ''}` }),
      el('h2', { text: card.title }),
      sceneArt(card.scene, true),
      el('p', { text: fillNames(text) }),
      ieyasuSays(el('p', { class: 'iy-voice', text: `「${fillNames(card.ieyasu)}」` }), card.trial ? 'worry' : ieyasuMood()),
      // 将軍の好みの説明は1行に縮め、選択肢をなるべく最初の画面に入れる（詳しくはガイド）
      el('p', { class: 'iy-intent' }, [
        `将軍・${s.name}は${s.trait}。好みの裁きなら育ち、合わねば気苦労がたまる`,
        el('span', { class: (s.stress || 0) >= 60 ? 'iy-warn' : 'iy-muted', text: `（気苦労 ${s.stress || 0}）` }),
      ]),
      list,
      el('p', { class: 'iy-hint iy-marks-note', text: '●の数は、動く大きさ（上がるか下がるかは伏せてある）。' }),
    ];
  }

  // 出来事の結果。政務の間の頭に出す。しくじったか、悪い変化ばかりなら曇り空、良い変化ばかりなら金の光を絵に重ねる
  function resultNodes() {
    const r = state.result;
    const card = cardById(state.card.id);
    const good = r.changes.filter((c) => (c.good !== undefined ? c.good : c.delta > 0)).length;
    const bad = r.changes.length - good;
    const outcome = r.failed || (bad > 0 && good === 0) ? 'bad' : good > 0 && bad === 0 ? 'good' : null;
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: `${r.title}：${r.choice}` }),
      sceneArt(card.scene, true, outcome),
      el('p', { class: r.failed ? 'iy-failed' : '', text: r.text }),
      changeList(r.changes),
      r.growth ? el('p', { class: 'iy-note', text: r.growth }) : null,
      r.failed ? ieyasuSays(el('p', { class: 'iy-voice', text: '「……むう。」' }), 'worry') : null,
    ];
  }

  // 政務の間で手を打てること（結果のすぐ下に、年を越すボタンと並べて知らせる）
  function pendingWork() {
    const items = [];
    const teachable = state.heirs.filter((h) => h.age < CONFIG.TEACH_AGE_LIMIT).length;
    if (teachable) items.push(`教育できる若君${teachable}人`);
    const ready = DATA.institutions.filter((inst) => !inst.prologueOnly && !hasInstitution(inst.id) && institutionStatus(inst).ok).length;
    if (ready) items.push(`整えられる制度${ready}件`);
    if (vacancies().length) items.push('空いている役職');
    if (state.retainers.some((r) => r.unhappy)) items.push('不満を漏らす家臣');
    if (shipDue() || state.ships.arriving) items.push('異国船への備え');
    if (!state.project && projectOptions().some((def) => state.fin.cash >= projectCost(def))) items.push('始められる普請');
    return items;
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
        el('p', { class: 'iy-hint', text: `${p.post.name}・${p.holder ? p.holder.name : '空席'}の${RETAINER_LABELS[p.post.stat]}${p.value}　＋　将軍の${ABILITY_LABELS[r.stat]}÷4（${p.shogun}）${p.nagasaki ? `　＋　長崎奉行（${p.nagasaki}）` : ''}${p.kakun ? `　＋　海防の家訓（${p.kakun}）` : ''}${p.works ? `　＋　普請（${p.works}）` : ''}${p.oboe ? `　${p.oboe > 0 ? '＋' : '−'}　${OBOE_LABELS[p.oboeParty]}の${p.oboe > 0 ? '恩' : '恨み'}（${Math.abs(p.oboe)}）` : ''}　＝　力${p.power}（難しさ${ship.difficulty}）` }),
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
        ...(b.epithets || []).map((t) => el('p', { class: 'iy-honor-line', text: t })),
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
      ...chronicleNodes(),
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
      el('p', { class: 'iy-hint', text: `力は、役職の腕と、将軍の能力÷4で決まる。海防は大名、軍資金は商人、朝廷は朝廷の覚え（恩と恨み）も響く。当日は、勝負ごとに軍資金（約${boostCost(ship)}万両）を投じて、力を${CONFIG.SHIP_BOOST}上げられる。` }),
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
          el('span', { class: 'iy-option__hint', text: `生まれる若君の見込み：格${expectedChildKaku(b.stats)}前後（素質が並のとき）` }),
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
      el('p', { text: `将軍・${s.name}（${s.age}歳）に、正室を迎える縁談が三つ来ている。正室の能力と特技は、生まれてくる子に受け継がれる。将軍の格が高いほど、良い縁談が来る。` }),
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
      el('p', { class: 'iy-hint', text: `天井：${['seimu', 'bui', 'jintoku'].map((k) => `${ABILITY_LABELS[k]}${heirCap(heir, k)}`).join('・')}（格${['seimu', 'bui', 'jintoku'].reduce((a, k) => a + heirCap(heir, k), 0)}）。生まれと素質で決まり、教育でもここまでしか伸びない。` }),
      skillTag(heir.skill, '（将軍になると働く）'),
      canTeach
        ? el('p', { class: 'iy-hint', text: taught ? '今年はもう師をつけた。' : `師をつける（教育費 ${teachCost()}万両・1年に1回）` })
        : el('p', { class: 'iy-hint', text: '成人したので、教育は終わった。' }),
      canTeach ? el('div', { class: 'iy-teach' }, Object.keys(TEACH_LABELS).map((stat) => el('button', {
        type: 'button', text: stat !== 'kenko' && heir.stats[stat] >= heirCap(heir, stat) ? `${TEACH_LABELS[stat]}（天井）` : TEACH_LABELS[stat],
        disabled: taught || (stat !== 'kenko' && heir.stats[stat] >= heirCap(heir, stat)), onclick: () => teach(index, stat),
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
      if (key === 'oboe') return Object.entries(v).map(([k, d]) => `${OBOE_LABELS[k]}の覚え${signed(d)}`).join('・');
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
    const nodes = [];
    if (state.result) {
      // 出来事の結果のすぐ下に「年を越す」を置く。手を打つことがあれば、その下の政務の間で
      const work = pendingWork();
      nodes.push(...resultNodes(), el('div', { class: 'iy-quick' }, [
        el('button', { type: 'button', class: 'iy-primary', text: '年を越す（決算）', onclick: endYear }),
        el('p', { class: 'iy-hint', text: work.length ? `政務の間（この下）で手を打てること：${work.join('・')}` : '政務の間（この下）で、教育・大奥・制度を見直せる。' }),
      ]));
    }
    nodes.push(
      state.result ? null : el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { class: state.result ? 'iy-manage-title' : '', text: '政務の間' }),
      el('p', { class: 'iy-hint', text: '若君の教育、大奥、制度の整備、代替わりを決める。財務と組織はメニューから（PCの広い画面では右の列）。終わったら年を越す。' }),
      state.shogun.ailing ? el('p', { class: 'iy-warn-box', text: `将軍・${state.shogun.name}は病に伏している（御不例・${state.year - state.shogun.ailing.since + 1}年目）。残された時は長くないかもしれぬ。${canRetire() ? '成人した若君に、いまのうちに職を譲ることもできる。' : '跡継ぎの支度を急げ。'}健康が${CONFIG.AILING_RECOVER}まで戻れば、病は癒える。` }) : null,
      testamentDef(state.shogun.testament) ? el('p', { class: 'iy-hint', text: `先代の遺言「${testamentDef(state.shogun.testament).label}」：${testamentDef(state.shogun.testament).desc}` }) : null,
      wishStatus() ? el('p', { class: 'iy-hint', text: wishLine(wishStatus()) }) : null,
      kakunList().length ? el('p', { class: 'iy-hint', text: `家訓：${kakunList().join('、')}` }) : null,
      el('details', { class: 'iy-oboe' }, [
        el('summary', { text: `諸家の覚え：${oboeLine()}` }),
        el('p', { class: 'iy-hint', text: '大名・商人・朝廷は、幕府の裁きや縁組を覚えている。恩も恨みも、ゆっくりとしか薄れない。'
          + `覚えが深まるとその家ならではの出来事が起き、倒幕の危機には、恩のある家は助けに来て、恨みのある家は敵に回る。異国船との勝負の力にも響く。` }),
        ...oboeLogNodes(8),
      ]),
      ...shipPrepNodes(),
      el('h3', { text: '若君' }),
    );

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

    nodes.push(...projectNodes());

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
      nodes.push(el('button', { type: 'button', class: 'iy-secondary', text: '組織を開く', onclick: () => openTab('org') }));
    }
    nodes.push(el('button', { type: 'button', class: 'iy-primary', text: '年を越す（決算）', onclick: endYear }));
    return nodes;
  }

  // 宣下の表紙。将軍1代が、物語の1章になる
  function viewEnthrone() {
    const s = state.shogun;
    const will = testamentDef(s.testament);
    return [
      el('p', { class: 'iy-year', text: `${state.year}年　第${s.gen - 3}章` }),
      el('h2', { text: `第${s.gen}代 ${s.name}の御治世` }),
      ...edoNodes(),
      el('div', { class: 'iy-heir__head' }, [
        shogunFace('iy-face'),
        el('p', { class: 'iy-heir__name' }, [
          el('strong', { text: s.name }), `（${s.age}歳・${s.trait}）`,
          el('span', { class: 'iy-kaku', text: `格${shogunKaku()}` }),
        ]),
      ]),
      s.nameOrigin ? el('p', { class: 'iy-hint' }, [el('strong', { text: '名の由来　' }), s.nameOrigin]) : null,
      statBars({ ...s.stats, kenko: constitution() }, { seimu: '政務', bui: '武威', jintoku: '人徳', kenko: '体質' }),
      abilityEffects(),
      skillTag(s.skill),
      kafuLine(s.house),
      will ? el('p', { class: 'iy-skill' }, [el('span', { class: 'iy-skill__name', text: `先代の遺言「${will.label}」` }), ` ${will.desc}`]) : null,
      ieyasuSays(el('p', { class: 'iy-voice', text: `「${DATA.enthroneLines[s.trait] || 'さて、この代はどうなるかのう。'}」` })),
      el('p', { class: 'iy-hint', text: 'この将軍の代が、物語の一章になる。将軍が世を去るか職を譲ると、大名・旗本・町人・朝廷が御治世に点をつける。' }),
      ...wishChoiceNodes(),
    ];
  }

  // 宿願を3つから1つ選ぶ。果たすと家訓が1段上がり、代をまたいで残る
  function wishChoiceNodes() {
    const offers = (state.reign && state.reign.wishOffers) || [];
    if (offers.length === 0) {
      return [el('button', { type: 'button', class: 'iy-primary', text: '御治世を始める', onclick: () => chooseWish(null) })];
    }
    const owned = kakunList();
    return [
      el('h3', { text: '宿願を選ぶ' }),
      el('p', { class: 'iy-hint', text: 'この代のうちに果たすと、家訓が1段上がる（2段まで）。家訓は代をまたいで残り、黒船に挑む地力になる。果たした代は、評定も少し甘くなる。' }),
      owned.length ? el('p', { class: 'iy-hint', text: `いまの家訓：${owned.join('、')}` }) : null,
      el('div', { class: 'iy-options' }, offers.map((o, i) => {
        const def = wishDef(o.id);
        const k = kakunDef(def.kakun);
        const lv = kakun(k.id);
        return el('button', { type: 'button', class: 'iy-option', onclick: () => chooseWish(i) }, [
          el('strong', { text: def.label }),
          el('span', { text: def.goal.replace('{target}', o.target) }),
          el('span', { class: 'iy-option__hint', text: `果たすと：${k.name} ${lv}段→${lv + 1}段（1段ごとに、${k.desc}）` }),
        ]);
      })),
      el('button', { type: 'button', class: 'iy-secondary', text: '宿願を掲げずに始める', onclick: () => chooseWish(null) }),
    ];
  }

  // 御治世の評定と、遺言（職を譲るときは申し送り）。state.shogun は、まだ世を去った（職を譲った）将軍
  function viewReignEnd() {
    const sc = state.succession;
    const s = state.shogun;
    const p = person(s.personId);
    const r = sc.rating;
    const retire = sc.reason === 'retire';
    const how = retire ? '職を譲り、大御所となった。' : sc.reason === 'sudden' ? 'にわかに世を去った。' : '病に伏したのち、世を去った。';
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年　第${s.gen - 3}章の終わり` }),
      el('h2', { text: '御治世の評定' }),
      sceneArt(retire ? 'hall' : 'sickbed'),
      el('p', { text: `第${s.gen}代 ${s.name}（在位 ${p.from}〜${p.to}年・${p.to - p.from}年）。${how}` }),
    ];
    if (r) {
      nodes.push(
        el('p', { class: 'iy-nickname' }, ['後の世は、この将軍を', el('strong', { text: `「${r.nickname}」` }), 'と呼んだ。']),
        el('p', { class: 'iy-hint', text: r.nickDesc }),
        r.saying ? el('p', { class: 'iy-saying' }, [el('span', { class: 'iy-saying__label', text: '言行録' }), r.saying]) : null,
        el('dl', { class: 'iy-kpis iy-judges' }, r.scores.map((x) => el('div', {}, [
          el('dt', { text: x.label }),
          el('dd', { text: `${x.value}点` }),
        ]))),
        el('p', { class: 'iy-rating' }, ['合わせて ', el('strong', { text: `${r.total}点` }), ` / 40　`, el('strong', { text: r.title })]),
        r.wish ? el('p', { class: r.wish.done ? 'iy-honor-line' : 'iy-hint', text: r.wish.done
          ? `宿願「${r.wish.label}」を果たした（どの者も1点ずつ甘くつけた）。` : `宿願「${r.wish.label}」は、果たせなかった。` }) : null,
        el('p', { class: 'iy-hint', text: DATA.reignJudges.map((j) => `${j.label}は${j.desc}`).join('、') + 'を見て点をつける。' }),
      );
    }
    nodes.push(
      el('h3', { text: retire ? '次の将軍への申し送り' : '遺言' }),
      el('p', { class: 'iy-hint', text: '一つ選ぶ。次の将軍の代のあいだ効く（得るものと、失うものがある）。' }),
      el('div', { class: 'iy-options' }, sc.offers.map((id, i) => {
        const t = testamentDef(id);
        return el('button', { type: 'button', class: 'iy-option', onclick: () => chooseTestament(i) }, [
          el('strong', { text: t.label }),
          el('span', { class: 'iy-option__hint', text: `「${t.text}」` }),
          el('span', { text: t.desc }),
        ]);
      })),
    );
    return nodes;
  }

  // 普請の欄。進めている普請があればそのようす、なければ始められる普請の一覧（奉行を選んで始める）
  function projectNodes() {
    const nodes = [el('h3', { text: '普請' })];
    const p = state.project;
    if (p) {
      const def = projectDef(p.id);
      const bugyo = state.retainers.find((r) => r.id === p.bugyo);
      nodes.push(el('p', { class: 'iy-hint', text: `「${def.name}」を進めている（奉行：${bugyo ? `${bugyo.name}・${RETAINER_LABELS[def.stat]}${bugyo.stats[def.stat]}` : '不在（完成のときは、いちばん向いた者が引き継ぐ）'}）。${projectLeft() <= 1 ? 'この暮れに完成する。' : `あと${projectLeft()}年で完成する。`}完成すると、大名・町人・朝廷・寺社が評定をつける。` }));
      return nodes;
    }
    const options = projectOptions();
    if (options.length === 0) {
      nodes.push(el('p', { class: 'iy-hint', text: 'いま始められる普請はない。時代が進むと、新しい普請ができるようになる。' }));
      return nodes;
    }
    const affordable = options.filter((def) => state.fin.cash >= projectCost(def)).length;
    nodes.push(el('p', { class: 'iy-hint', text: '数年かけて進める大きな事業。1つずつしか進められない。奉行の腕が良いほど、完成のときの評定が高く、効き目も大きい（0.6〜1.5倍）。' }));
    const list = el('details', { class: 'iy-institutions' });
    if (affordable > 0) list.open = true;
    list.append(el('summary', { text: `普請を始める（始められるもの${options.length}件）` }));
    const likeText = (likes) => DATA.projectJudges.filter((j) => (likes[j.key] || 0) >= 2).map((j) => j.label).join('・');
    for (const def of options) {
      const cost = projectCost(def);
      const best = bestBugyo(def);
      const select = el('select', { class: 'iy-heir__adopt', 'aria-label': `${def.name}の奉行` },
        [...state.retainers].sort((a, b) => b.stats[def.stat] - a.stats[def.stat]).map((r) => el('option', {
          value: String(r.id), text: `奉行：${r.name}（${RETAINER_LABELS[def.stat]}${r.stats[def.stat]}）`, selected: best && r.id === best.id,
        })));
      const effect = Object.entries(def.on).map(([k, v]) => k === 'shipPower' ? `異国船の力+${v}` : `${STATE_LABELS[k] || (E.FIN_LABELS[k] && E.FIN_LABELS[k][0]) || E.OTHER_LABELS[k] || k}+${v}`).join('・');
      list.append(el('div', { class: 'iy-inst' }, [
        el('p', { class: 'iy-inst__name' }, [el('strong', { text: def.name }), `（${cost}万両・${def.years}年）`]),
        el('p', { class: 'iy-hint', text: `${def.desc} 完成すると：${effect}。${likeText(def.likes) ? `${likeText(def.likes)}に喜ばれる。` : ''}` }),
        state.retainers.length ? select : null,
        el('button', {
          type: 'button', text: state.fin.cash < cost ? `現金が${cost}万両必要` : '始める', disabled: state.fin.cash < cost || !best,
          onclick: () => startProject(def.id, Number(select.value)),
        }),
      ]));
    }
    nodes.push(list);
    return nodes;
  }

  // 普請の評定（決算報告に出す）
  function projectReviewNodes(pr) {
    return [
      el('div', { class: 'iy-review' }, [
        sceneArt(pr.scene, true, pr.total >= 26 ? 'good' : pr.total < 20 ? 'bad' : null),
        el('p', { class: 'iy-review__title', text: `普請「${pr.name}」が成った${pr.bugyo ? `（奉行：${pr.bugyo}）` : ''}` }),
        el('dl', { class: 'iy-kpis iy-judges' }, pr.scores.map((x) => el('div', {}, [el('dt', { text: x.label }), el('dd', { text: `${x.value}点` })]))),
        el('p', { class: 'iy-rating' }, ['評定 ', el('strong', { text: `${pr.total}点` }), ' / 40　', el('strong', { text: pr.title })]),
        changeList(pr.changes),
        pr.epithet ? el('p', { class: 'iy-honor-line', text: pr.epithet }) : null,
      ]),
    ];
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
    // 代替わりの掛け合い（年で選ぶので、描き直しても変わらない）
    const kind = reason === 'retire' ? 'retire' : 'death';
    const talks = DATA.talks[kind] || [];
    const talk = talks.length ? talkLines({ kind, i: state.year % talks.length }) : [];
    const will = testamentDef(state.succession.testament);
    // 跡継ぎが決まるまで、state.shogun は世を去った（職を譲った）将軍のまま
    const fill = (text) => text.replace('{shogun}', state.shogun.name);
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: reason === 'retire' ? '将軍職を譲る' : '将軍、世を去る' }),
      sceneArt(reason === 'retire' ? 'hall' : 'sickbed'),
      ...talk.map((l) => says(l.who, el('p', { class: 'iy-voice', text: fill(l.text) }), l.mood)),
      el('p', { text: intro }),
      will ? el('p', { class: 'iy-hint', text: `${reason === 'retire' ? '申し送り' : '遺言'}「${will.label}」は、次の将軍の代のあいだ効く。${will.desc}` }) : null,
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
      b.sex === 'f' ? art(ART.lady(b.seed || 0, true), 'iy-face') : art(ART.child(b.trait, b.seed), 'iy-face'),
      el('div', {}, [
        el('p', { class: 'iy-birth__title', text: b.sex === 'f' ? `姫・${b.name}が生まれた` : `若君・${b.name}が生まれた` }),
        b.stars ? el('p', {}, [el('span', { class: 'iy-stars', text: starText(b.stars) }), ` 素質：${b.label}`]) : null,
        sk ? el('p', { class: 'iy-skill__name', text: `特技「${sk.name}」` }) : null,
        el('p', { class: 'iy-muted', text: `母：${b.mother}` }),
      ]),
    ]);
  }

  // 見立番付（十年の締めの決算報告に出す）。江戸の町の絵と、この十年の位、番付の上のほう
  function banzukeReportNodes(bz) {
    return [
      el('div', { class: 'iy-review' }, [
        el('p', { class: 'iy-review__title', text: `見立番付：${bz.label}（${bz.era}）` }),
        ...edoNodes(),
        el('p', { class: 'iy-rating' }, ['この十年の見立 ', el('strong', { text: `「${bz.name}」` }), `　${bz.score}点`]),
        el('p', {}, [`これまでの十年${bz.count}のうち、`, el('strong', { text: bz.rank }), '。']),
        ...banzukeNodes(6, bz.from),
        ieyasuSays(el('p', { class: 'iy-voice', text: bz.line })),
        el('p', { class: 'iy-hint', text: '番付の全部は、記録のメニューで見られる。' }),
      ]),
    ];
  }

  // 決算の判子（その年の見立て）。赤字・危機・上々・並
  function reportStamp(r, total) {
    if (state.crisis) return { text: '危急', bad: true };
    if (r.op < 0) return { text: '赤字', bad: true };
    if (r.netChange >= 0 && total >= 0) return { text: '上々', bad: false };
    return { text: '並', bad: false };
  }

  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 決算の数字を、0から繰り上げて見せる（動きを減らす設定なら、すぐに最後の数字を出す）
  function countUp(root) {
    const nodes = [...root.querySelectorAll('[data-count]')];
    if (REDUCED_MOTION || nodes.length === 0) return;
    const started = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - started) / 700);
      const ease = 1 - (1 - p) ** 3;
      for (const n of nodes) n.textContent = ryo(Math.round(Number(n.dataset.count) * ease * 10) / 10);
      if (p < 1) requestAnimationFrame(step);
    };
    for (const n of nodes) n.textContent = ryo(0);
    requestAnimationFrame(step);
  }

  // 一年の決算報告。数字の増減と、この一年の出来事をまとめて見せる。
  // はじめて開いたときだけ、算盤の音・数字の繰り上がり・判子・千両箱が落ちてくる演出をする
  function viewReport() {
    const r = state.report;
    const total = r.op + r.inv + r.fin;
    const play = ui.reportShown !== r.year;
    ui.reportShown = r.year;
    const kpi = (label, value, good) => el('div', {}, [
      el('dt', { text: label }),
      el('dd', { class: good === undefined ? '' : good ? 'iy-up' : 'iy-down', 'data-count': String(value), text: ryo(value) }),
    ]);
    const mood = r.omen || r.op < 0 || r.gauges.some((g) => g.after <= 20) ? 'worry' : 'calm';
    const bestBirth = (r.births || []).reduce((best, b) => Math.max(best, b.stars || 0), 0);
    // 家康のひと言（いちばん大事なことを1つだけ）
    const comment = (() => {
      if (r.omen) return '……海の向こうが騒がしい。役目の者どもを鍛え、金を蓄えて備えよ。';
      if (r.wish) return '宿願を果たしたか。よくやった。この家訓は、子や孫の代まで残るぞ。';
      if (r.project) return r.project.total >= 26 ? '見事な普請じゃ。後の世まで語り継がれよう。' : r.project.total < 20 ? '……出来は今ひとつか。奉行の腕も、考えものじゃな。' : 'うむ、普請が成った。次は何を手がけるかのう。';
      if (r.honors.length) return `栄誉「${r.honors.join('」「')}」とは、めでたい。この調子じゃ。`;
      if (bestBirth >= 4) return 'おお、これは良い器の子じゃ。しっかり育てよ。';
      if (r.op < 0) return '年貢と経費だけで赤字じゃ。このままでは金蔵がもたぬぞ。';
      if (r.gauges.some((g) => g.after <= 20)) return '数字は持っておるが、足元が危うい。手を打たねば。';
      return 'まずまずの一年じゃった。気を抜くでないぞ。';
    })();
    const isReignEnd = state.nextPhase === 'reignEnd';
    const stamp = reportStamp(r, total);
    // 金蔵の絵：千両箱ひとつで100万両（20まで）、証文ひとつで借入100万両（10まで）
    const boxes = Math.max(0, Math.min(20, Math.round(r.cash / 100)));
    const bills = Math.max(0, Math.min(10, Math.ceil(r.debt / 100)));
    const nodes = [
      el('div', { class: 'iy-report-head' }, [
        el('p', { class: 'iy-year', text: `${r.year}年の暮れ` }),
        el('h2', { text: `${r.year}年の決算` }),
        el('p', { class: `iy-stamp${stamp.bad ? ' iy-stamp--bad' : ''}`, 'aria-label': `この年の見立て：${stamp.text}`, text: stamp.text }),
      ]),
      el('dl', { class: 'iy-kpis' }, [
        kpi('営業の収支', r.op, r.op >= 0),
        kpi('現金の増減', total, total >= 0),
        kpi('純資産の増減', r.netChange, r.netChange >= 0),
        kpi('年末の現金', r.cash),
        kpi('年末の借入', r.debt),
      ]),
      el('div', { class: 'iy-purse' }, [
        art(ART.purse(boxes, bills), 'iy-purse__art'),
        el('p', { class: 'iy-hint', text: `金蔵：千両箱ひとつで100万両${bills ? '・証文ひとつで借入100万両' : ''}${r.cash >= 2050 ? '（20箱より先は省いた）' : ''}` }),
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
      ...(r.project ? projectReviewNodes(r.project) : []),
      ...(r.banzuke ? banzukeReportNodes(r.banzuke) : []),
      r.births && r.births.length ? el('div', { class: 'iy-births' }, r.births.map(birthCard)) : null,
      ...(r.epithets || []).map((t) => el('p', { class: 'iy-honor-line', text: t })),
      r.honors.length ? el('p', { class: 'iy-honor-line', text: `栄誉を得た：${r.honors.join('、')}` }) : null,
      r.wish ? el('p', { class: 'iy-honor-line', text: `宿願「${r.wish.label}」を果たした。家訓「${r.wish.kakun}」が${r.wish.level}段になった（${r.wish.desc}）。` }) : null,
      r.notes.filter((n) => !r.wish || n !== r.wish.text).length
        ? el('ul', { class: 'iy-report-notes' }, r.notes.filter((n) => !r.wish || n !== r.wish.text).map((n) => el('li', { text: n }))) : null,
      // お金が尽きそうなら、早めに知らせる（財務の画面に、グラフと内訳がある）
      (runway() || { years: 99 }).years <= 15 ? runwayLine() : null,
      // 危機の始まりや、★の高い若君の誕生では、家康のひと言のかわりに家光との掛け合いを出す
      ...(r.talk ? talkLines(r.talk).map((l) => says(l.who, el('p', { class: 'iy-voice', text: l.text }), l.mood))
        : [ieyasuSays(el('p', { class: 'iy-voice', text: comment }), mood)]),
      el('button', { type: 'button', class: 'iy-primary', text: isReignEnd ? '御治世の評定へ' : '次の年へ', onclick: closeReport }),
    ].filter(Boolean);
    // 演出：上から順に、少しずつ遅れて現れる（2回目からは動かさない）
    nodes.forEach((n, i) => { n.classList.add('iy-reveal'); n.style.setProperty('--i', String(i)); });
    const box = el('div', { class: `iy-report${play ? ' iy-report--play' : ''}` }, nodes);
    if (play) requestAnimationFrame(() => countUp(box));
    return [box];
  }

  // 倒幕の結末。何が尽きたかで場面と言葉が変わり、最後に幕府の年表を出す
  function viewOver() {
    const years = bakufuYears();
    const end = DATA.endings[state.overReason] || DATA.endings[overCause()];
    const fill = (text) => text.replace('{years}', years).replace('{shogun}', `第${state.shogun.gen}代・${state.shogun.name}`);
    const byYears = DATA.endingYears.find((e) => years < e.below);
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: `倒幕：${end.title}` }),
      sceneArt(end.scene),
      el('p', { text: fill(end.text) }),
      ieyasuSays(el('p', { class: 'iy-voice', text: `「${end.ieyasu}」` }), 'worry'),
      byYears ? iemitsuSays(el('p', { class: 'iy-voice', text: `「${byYears.text.replace('{rest}', CONFIG.HISTORY_YEARS - years)}」` })) : null,
      el('p', { class: 'iy-note', text: '霊体の権現様は長いため息をつき、家光とともに日光の山へ帰っていった。……次こそは。' }),
      ...chronicleNodes(),
      el('p', { class: 'iy-note', text: `これまでの最長記録：${Math.max(years, loadBest())}年（史実の幕府は約${CONFIG.HISTORY_YEARS}年）。家系図と財務の記録は、このまま見られる。` }),
      el('button', { type: 'button', class: 'iy-primary', text: 'もう一度、最初から', onclick: restart }),
    ];
  }

  // 幕府の年表：歴代将軍の在位と格、整えた制度、栄誉、異国船。結末の画面に出す（スクリーンショットで人に見せやすいように1か所にまとめる）
  function chronicleNodes() {
    const shoguns = state.family.filter((p) => p.gen).sort((a, b) => a.gen - b.gen);
    const rows = shoguns.map((p) => {
      const isCurrent = p.id === state.shogun.personId && !p.to;
      const endKaku = p.end ? kakuOf(p.end) : isCurrent ? shogunKaku() : null;
      return el('tr', {}, [
        el('td', { text: `${p.gen}` }),
        el('td', { text: `${p.name}${p.house ? `（${p.house}）` : ''}` }),
        el('td', { text: `${p.from}〜${p.to || ''}（${(p.to || state.year) - p.from}年）` }),
        el('td', { text: p.start ? `${kakuOf(p.start)}${endKaku !== null ? `→${endKaku}` : ''}` : '' }),
        el('td', { text: p.rating ? `${p.rating.nickname} ${p.rating.total}点${p.rating.wish && p.rating.wish.done ? '・宿願' : ''}` : isCurrent ? '在位中' : '' }),
      ]);
    });
    const insts = DATA.institutions.filter((i) => hasInstitution(i.id)).map((i) => i.name);
    const syns = DATA.synergies.filter((x) => state.synergies.includes(x.id)).map((x) => x.name);
    const honors = DATA.honors.filter((h) => state.honors.includes(h.id)).map((h) => h.name);
    const ships = DATA.ships.filter((s) => state.ships.won.includes(s.id) || state.ships.lost.includes(s.id))
      .map((s) => (state.ships.won.includes(s.id) ? `${s.name}を退けた` : `${s.name}に屈した`));
    const top = banzukeTable().slice(0, 2);
    return [
      ...edoNodes(),
      el('h3', { text: '幕府の年表' }),
      el('p', { class: 'iy-hint', text: `開府から${bakufuYears()}年・将軍${shoguns.length}代・制度${insts.length}・組み合わせの妙${syns.length}・栄誉${honors.length}` }),
      el('div', { class: 'iy-scroll' }, el('table', { class: 'iy-table iy-table--chronicle' }, [
        el('thead', {}, el('tr', {}, ['代', '将軍', '在位', '格', '評定'].map((h) => el('th', { text: h })))),
        el('tbody', {}, rows),
      ])),
      sayingNodes(shoguns),
      insts.length ? el('p', { class: 'iy-hint', text: `整えた制度：${insts.join('、')}${syns.length ? `（組み合わせの妙：${syns.join('、')}）` : ''}` }) : null,
      ships.length ? el('p', { class: 'iy-hint', text: `異国船：${ships.join('、')}` }) : null,
      kakunList().length ? el('p', { class: 'iy-hint', text: `家訓：${kakunList().join('、')}` }) : null,
      el('p', { class: 'iy-hint', text: `諸家の覚え：${oboeLine()}` }),
      state.projectsDone.length ? el('p', { class: 'iy-hint', text: `普請：${state.projectsDone.map((p) => `${projectDef(p.id).name}（${p.year}年・${p.total}点）`).join('、')}` }) : null,
      top.length ? el('p', { class: 'iy-hint', text: `見立番付の大関：${top.map((d) => `${d.side} ${d.label}「${d.name}」`).join('、')}` }) : null,
      state.meishin.length ? el('p', { class: 'iy-hint', text: `名臣録：${state.meishin.slice(0, 12).map((m) => `${m.epithet}（${m.name}）`).join('、')}${state.meishin.length > 12 ? `、ほか${state.meishin.length - 12}人` : ''}` }) : null,
      honors.length ? el('p', { class: 'iy-honor-line', text: `この幕府で得た栄誉：${honors.join('、')}` }) : null,
    ];
  }

  // 歴代将軍の言行録（評定のついた代だけ）。幕府の年表の下に出す
  function sayingNodes(shoguns) {
    const list = shoguns.filter((p) => p.rating && p.rating.saying);
    if (list.length === 0) return null;
    return el('details', { class: 'iy-rules' }, [
      el('summary', { text: `言行録（${list.length}代）` }),
      el('ul', { class: 'iy-log' }, list.map((p) => el('li', {}, [
        el('span', { class: 'iy-log__year', text: `${p.gen}代` }),
        el('strong', { text: `${p.name}「${p.rating.nickname}」` }), `　${p.rating.saying}`,
      ]))),
    ]);
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
          onclick: () => { ui.person = p.id; renderFamily(); if (isWide()) $('side').scrollTop = 0; else scrollToGame(); },
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
    if (p.nameOrigin) nodes.push(el('p', { class: 'iy-hint', text: `名の由来：${p.nameOrigin}` }));
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
      if (p.rating) {
        nodes.push(el('p', { class: 'iy-hint' }, [
          el('strong', { text: `「${p.rating.nickname}」` }),
          `　御治世の評定 ${p.rating.total}点 / 40（${p.rating.title}）　${p.rating.scores.map((x) => `${x.label}${x.value}`).join('・')}`,
        ]));
        if (p.rating.saying) nodes.push(el('p', { class: 'iy-saying' }, [el('span', { class: 'iy-saying__label', text: '言行録' }), p.rating.saying]));
      }
      if (p.rating && p.rating.wish) nodes.push(el('p', { class: 'iy-hint', text: `宿願「${p.rating.wish.label}」：${p.rating.wish.done ? '果たした' : '果たせなかった'}` }));
      const will = testamentDef(isCurrent ? state.shogun.testament : p.testament);
      if (will) nodes.push(el('p', { class: 'iy-hint', text: `受けた遺言：「${will.label}」` }));
      if (p.insts.length) nodes.push(el('p', { class: 'iy-hint', text: `整えた制度：${p.insts.join('、')}` }));
      if (p.endGauges) {
        nodes.push(el('p', { class: 'iy-hint', text: `退任時の幕府：${Object.entries(STATE_LABELS).map(([k, l]) => `${l}${p.endGauges[k]}`).join('　')}　純資産 ${ryo(p.endNet)}` }));
      }
    } else if (heir) {
      nodes.push(el('h3', { text: `若君の能力（格${kakuOf(heir.stats)}）` }));
      nodes.push(statBars(heir.stats, ABILITY_LABELS));
    }
    if (p.note) nodes.push(el('p', { class: 'iy-note', text: p.note }));
    return el('div', { class: 'iy-detail' }, nodes);
  }

  // ───── 財務

  function runwayLine() {
    const r = runway();
    if (!r || r.years > 40) return null;
    return el('p', { class: r.years <= 10 ? 'iy-warn' : 'iy-hint',
      text: `このままのペースだと、あと約${r.years}年で借入が上限に届く（ここ数年、現金と借入の差し引きが年に約${r.perYear}万両ずつ減っている）。` });
  }

  // 過去30年の営業の収支（棒）と、借入と上限（線）の小さなグラフ。数字は下の表にある
  function financeChart() {
    const books = state.books.slice(0, CONFIG.BOOKS_KEPT).reverse();
    if (books.length < 2) return null;
    const W = 320, n = books.length, step = W / n;
    const opMax = Math.max(10, ...books.map((b) => Math.abs(b.op)));
    const debtMax = Math.max(10, ...books.map((b) => Math.max(b.debt, b.limit || 0)));
    // 上の段：営業の収支（0の線から上下に伸びる棒）
    const mid = 34, half = 26;
    const bars = books.map((b, i) => {
      const h = Math.max(1, (Math.abs(b.op) / opMax) * half);
      const y = b.op >= 0 ? mid - h : mid;
      return `<rect class="${b.op >= 0 ? 'iy-chart__up' : 'iy-chart__down'}" x="${(i * step + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, step - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${b.year}年 営業の収支 ${ryo(b.op)}</title></rect>`;
    }).join('');
    // 下の段：借入（実線）と上限（点線）
    const base = 132, tall = 52;
    const yOf = (v) => (base - (v / debtMax) * tall).toFixed(1);
    const xOf = (i) => (i * step + step / 2).toFixed(1);
    const debtPath = books.map((b, i) => `${i ? 'L' : 'M'}${xOf(i)},${yOf(b.debt)}`).join(' ');
    const withLimit = books.map((b, i) => ({ b, i })).filter(({ b }) => b.limit);
    const limitPath = withLimit.map(({ b, i }, k) => `${k ? 'L' : 'M'}${xOf(i)},${yOf(b.limit)}`).join(' ');
    const svg = `<svg viewBox="0 0 ${W} 156" role="img" aria-label="過去${n}年の営業の収支と、借入と上限の移り変わり" xmlns="http://www.w3.org/2000/svg">
      <text class="iy-chart__label" x="0" y="10">営業の収支（青は黒字、赤は赤字）</text>
      <line class="iy-chart__axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}
      <text class="iy-chart__label" x="0" y="${base - tall - 8}">借入（実線）と上限（点線）</text>
      <line class="iy-chart__axis" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
      ${limitPath ? `<path class="iy-chart__limit" d="${limitPath}"/>` : ''}
      <path class="iy-chart__debt" d="${debtPath}"/>
      <text class="iy-chart__label" x="0" y="154">${books[0].year}年</text>
      <text class="iy-chart__label" x="${W}" y="154" text-anchor="end">${books[n - 1].year}年</text>
    </svg>`;
    const box = el('div', { class: 'iy-chart' });
    box.innerHTML = svg;
    return box;
  }

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
        el('p', { class: 'iy-hint', text: '表の金額の単位は万両（0.1万両＝千両）。年を越すときに決算をする。' }),
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
        runwayLine(),
        financeChart(),
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
    const next = Math.max(1, Math.round(salaryOf(r.stats) * (1 + CONFIG.RAISE_RATE * ((r.raises || 0) + 1)) * 10) / 10);
    const text = !canRaise ? `求める格${w}：将軍の格${k}では足りない（召し抱えると、暮れに不満を漏らす）`
      : r.unhappy ? `不満：求める格${w}・将軍の格${k}。この暮れに去る`
        : `求める格${w}：将軍の格${k}では足りない。暮れに不満を漏らす`;
    return el('div', { class: 'iy-loyalty' }, [
      el('p', { class: 'iy-warn', text }),
      canRaise ? el('button', {
        type: 'button', text: `加増する（俸禄${ryo(r.salary)}→${ryo(next)}・求める格−${CONFIG.RAISE_WANTS}）`, onclick: () => raise(r.id),
      }) : null,
    ]);
  }

  function retainerRow(r, button, canRaise) {
    return el('div', { class: 'iy-retainer iy-retainer--row' }, [
      retainerFace(r, true),
      el('div', {}, [
        r.renowned ? el('p', { class: 'iy-renowned' }, [el('strong', { text: '名のある人物' }), ` ${r.renowned}`]) : null,
        el('p', { class: 'iy-retainer__name', text: `${retainerName(r)}（${r.age}歳・俸禄${ryo(r.salary)}）` }),
        retainerStats(r),
        loyaltyLine(r, canRaise),
      ]),
      button,
    ]);
  }

  function renderOrg() {
    const s = state.shogun;
    const over = state.phase === 'over';
    const salaries = state.retainers.reduce((sum, r) => sum + (r.post ? r.salary : r.salary / 2), 0);
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
        h
          ? el('div', { class: 'iy-retainer' }, [retainerFace(h, true), el('div', {}, [
            el('p', { class: 'iy-retainer__name', text: `${retainerName(h)}（${h.age}歳・俸禄${ryo(h.salary)}）` }),
            retainerStats(h, post.stat),
            loyaltyLine(h, !over),
          ])])
          : el('p', { class: 'iy-warn', text: '空席' }),
        postEffect(post.id),
        select,
      ]);
    });

    const reserve = state.retainers.filter((r) => !r.post);
    $('tab-org').replaceChildren(
      panel('将軍', [
        el('div', { class: 'iy-heir__head' }, [
          shogunFace('iy-face'),
          el('p', {}, [el('strong', { text: `第${s.gen}代 ${s.name}` }), `（${s.age}歳・${s.trait}・健康${s.health}）`]),
        ]),
        statBars({ ...s.stats, kenko: constitution() }, { seimu: '政務', bui: '武威', jintoku: '人徳', kenko: '体質' }),
        abilityEffects(),
        el('p', { class: 'iy-kaku-line' }, [el('strong', { text: `将軍の格 ${k}` }), '（政務・武威・人徳の合計）']),
        el('p', { class: 'iy-hint', text: `格が高いほど、登用の候補が多く、腕の立つ者が集まる（候補は格${steps}）。格${CONFIG.RENOWN_KAKU}以上なら、名のある人物がまれに仕官を願い出る。` }),
        skillTag(s.skill),
        kafuLine(s.house),
        el('p', { class: (s.stress || 0) >= 60 ? 'iy-warn' : 'iy-hint', text: `気苦労 ${s.stress || 0} / 100（60を超えると体を壊しはじめる。好みに合う裁きや、鷹狩り・湯治で晴れる）` }),
      ]),
      panel('役職', [
        el('p', { class: 'iy-hint', text: `家臣 ${state.retainers.length}人・俸禄の合計 年${ryo(salaries)}（控えの家臣は半額）` }),
        // 決まりごとと役職の説明は長いので、たたんでおく（スマホで組織の画面が長くなりすぎないように）
        el('details', { class: 'iy-rules' }, [
          el('summary', { text: '役職と家臣の決まり' }),
          el('p', { class: 'iy-hint', text: `家臣は、自分の腕（いちばん高い能力）の${CONFIG.WANTS_RATE}倍の格を将軍に求める。足りないと暮れに不満を漏らし、次の暮れにも足りなければ去る。加増すれば、俸禄が上がるかわりに求める格が下がる。` }),
          el('ul', { class: 'iy-hint' }, POSTS.map((p) => el('li', {}, [el('strong', { text: p.name }), `（${RETAINER_LABELS[p.stat]}）　${p.desc}`]))),
        ]),
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
      panel('江戸の町', [
        ...edoNodes(),
        el('p', { class: 'iy-hint', text: '普請を成し、制度を整え、民がにぎわうほど、町は育つ。終わった普請は絵に加わる。' }),
      ]),
      panel('見立番付', [
        el('p', { class: 'iy-hint', text: '十年ごとの暮れに、その十年の治世に点をつけて番付にする（威光・民心・朝廷、金蔵、普請、異国船、栄誉などを見る）。' }),
        ...banzukeNodes(),
      ]),
      panel('諸家の覚え', [
        el('p', { class: 'iy-hint', text: `いまの覚え：${oboeLine()}。幕府の裁きや縁組で、大名・商人・朝廷の恩と恨みがたまる（毎年少しずつ薄れる）。` }),
        ...oboeLogNodes(),
      ]),
      panel('名臣録', state.meishin.length
        ? [el('ul', { class: 'iy-log' }, state.meishin.map((m) => el('li', {}, [
          el('span', { class: 'iy-log__year', text: `${m.year}` }), el('strong', { text: `「${m.epithet}」` }), `${m.name}　${m.desc}`,
        ])))]
        : [el('p', { class: 'iy-hint', text: '目立つ働きをした家臣には、二つ名がつく（同じ役職を長く腕よく務める、普請を見事にやり遂げる、異国船を退ける決め手の勝負に勝つ、長く仕える）。' })]),
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
      zukanPanel(),
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

  // 図鑑。これまでの周回で出会ったもの（出来事・名のある人物・普請・組み合わせ・あだ名・宿願・異国船・二つ名）
  function zukanPanel() {
    const z = loadZukan();
    const got = (kind, id) => (z[kind] || []).includes(id);
    const ep = DATA.epithets;
    const sections = [
      { title: '出来事', items: DATA.cards.map((c) => ({ known: got('cards', c.id), name: c.title })) },
      { title: '名のある人物', items: DATA.renowned.map((p) => ({ known: got('renowned', p.name), name: p.name, desc: p.desc })) },
      { title: '普請', items: DATA.projects.map((p) => ({ known: got('projects', p.id), name: p.name, desc: p.desc })) },
      { title: '組み合わせの妙', items: DATA.synergies.map((x) => ({ known: got('synergies', x.id), name: x.name, desc: x.desc, hint: x.hint })) },
      { title: 'あだ名', items: Object.entries(DATA.nicknames).map(([tag, n]) => ({ known: got('nicknames', tag), name: n.name, desc: n.desc, hint: `${tag}な裁きを重ねた将軍` })) },
      { title: '宿願', items: DATA.wishes.map((w) => ({ known: got('wishes', w.id), name: w.label })) },
      { title: '異国船', items: DATA.ships.map((x) => ({ known: got('ships', x.id), name: `${x.name}を退けた` })) },
      { title: '二つ名', items: [
        ...POSTS.map((p) => ({ known: got('epithets', p.id), name: ep.post[p.id].replace('{sei}', '◯◯'), hint: `${p.name}を長く腕よく務めた家臣` })),
        { known: got('epithets', 'work'), name: ep.work.replace('{sei}', '◯◯'), hint: '普請を見事にやり遂げた奉行' },
        { known: got('epithets', 'ship'), name: ep.ship.replace('{ship}', '◯船').replace('{sei}', '◯◯'), hint: '異国船を退ける決め手の勝負に勝った家臣' },
        { known: got('epithets', 'elder'), name: ep.elder.replace('{sei}', '◯◯'), hint: '長く仕えた家臣' },
        ...Object.entries(ep.special).map(([who, name]) => ({ known: got('epithets', who), name: `${name}（${who}）`, hint: '名のある人物の二つ名' })),
      ] },
    ];
    const total = sections.reduce((n, sec) => n + sec.items.length, 0);
    const known = sections.reduce((n, sec) => n + sec.items.filter((i) => i.known).length, 0);
    return panel('図鑑', [
      el('p', { class: 'iy-hint', text: `これまでの周回で出会ったもの ${known} / ${total}。倒幕になっても消えない。項目を押すと開く。` }),
      ...sections.map((sec) => el('details', { class: 'iy-zukan' }, [
        el('summary', { text: `${sec.title}　${sec.items.filter((i) => i.known).length} / ${sec.items.length}` }),
        el('ul', {}, sec.items.map((i) => el('li', { class: i.known ? '' : 'iy-muted' }, i.known
          ? [el('strong', { text: i.name }), i.desc || i.hint ? `　${i.desc || i.hint}` : '']
          : ['？？？', i.hint ? `　${i.hint}` : '']))),
      ])),
    ]);
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
      if (step.tab !== 'seimu') ui.side = step.tab;
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
    E.newGame();
    ui.tab = 'seimu';
    ui.person = null;
    ui.bookYear = 'now';
    commit();
  }

  $('title-art').innerHTML = ART.scene('heaven');
  // 画面の幅が変わって、1列と2列が入れ替わったら描き直す
  if (WIDE.addEventListener) WIDE.addEventListener('change', () => render());
  $('intro-guide').addEventListener('click', openGuide);
  // 物語の場面（紹介文のすぐ下）まで送る
  $('intro-start').addEventListener('click', () => $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  E.loadOrNew();
  lastPhase = state.phase;
  render();
  if (!tutorialDone() && ['event', 'result', 'manage'].includes(state.phase)) startTutorial();
})();
