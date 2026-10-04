// 家康の憂鬱（試作版）の本体。
// 物語・出来事カード・制度のデータは cards.js にある。ここは「1年の流れ」と画面の描画だけを受け持つ。
(() => {
  'use strict';

  const DATA = window.IEYASU_DATA;

  const CONFIG = {
    START_YEAR: 1637,       // 本編が始まる年（東照宮完成の翌年）
    BAKUFU_FOUNDED: 1603,   // 幕府を開いた年（何年続いたかの起点）
    ORACLE_COST: 2,         // 夢枕に立つ（将軍の判断を変える）のに使う神力
    TEACH_COST: 1,          // 若君を1回教育するのに使う神力
    RETIRE_COST: 3,         // 将軍に隠居を勧めるのに使う神力
    SHINRYOKU_MAX: 12,
    ABILITY_MAX: 20,
    ADULT_AGE: 15,          // これ未満で将軍になると「幼い将軍」
    TEACH_AGE_LIMIT: 20,    // この歳までは教育できる
    MAX_HEIRS: 3,
    HEIR_BIRTH_CHANCE: 0.2,
    CARD_COOLDOWN: 10,      // 同じ出来事は、この年数のあいだ出ない
    CRISIS_YEARS: 3,        // 状態が0になってから立て直すまでの猶予
    CRISIS_SAFE: 10,        // 全部の状態がこれを超えたら危機を脱する
  };

  const STATE_LABELS = { zaisei: '財政', ikou: '威光', minshin: '民心', chotei: '朝廷' };
  const ABILITY_LABELS = { seimu: '政務', bui: '武威', jintoku: '人徳', kenko: '健康' };
  const OTHER_LABELS = { shinko: '信仰', jisseki: '実績', health: '将軍の健康' };
  const TEACH_LABELS = { seimu: '学問', bui: '武芸', jintoku: '人の道', kenko: '養生' };
  const TRAITS = ['慎重', '豪胆', '寛大', '倹約', '華美'];
  const CHILD_NAMES = ['竹千代', '長松', '徳松', '亀松', '鶴松', '国松', '万寿丸', '虎松', '福松', '松千代'];
  // 本編はオリジナルの歴史なので、実在の将軍とは違う名前にする
  const NAME_KANJI = ['信', '昌', '貞', '盛', '隆', '寛', '泰', '弘', '保', '和', '成', '明', '敬', '直', '房',
    '輝', '長', '孝', '正', '清', '時', '邦', '周', '範', '教', '良', '景', '義', '道', '元'];
  const GOSANKE_HOUSES = ['尾張家', '紀伊家', '水戸家'];
  const ORACLE_LINES = [
    '「{name}よ、そうではない……」その夜、将軍の夢枕に権現様が立った。',
    '「{name}、よう聞け」夢の中の老人の声に、将軍は飛び起きた。',
    '将軍は夢を見た。日光の山の上から、誰かがじっとこちらを見ている夢を。',
  ];

  const SAVE_KEY = 'ieyasu-save';
  const BEST_KEY = 'ieyasu-best';
  const SAVE_VERSION = 1;

  let state = null;

  // ─────────────────────────────── 小さな道具

  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const signed = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else if (key === 'disabled') node.disabled = Boolean(value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function institution(id) {
    return DATA.institutions.find((i) => i.id === id);
  }

  function hasInstitution(id) {
    return state.institutions.includes(id);
  }

  function addLog(text) {
    state.log.unshift({ year: state.year, text });
    state.log = state.log.slice(0, 40);
  }

  function bakufuYears() {
    return state.year - CONFIG.BAKUFU_FOUNDED;
  }

  // 年が進むほど、悪い出来事の痛手が大きくなる
  function difficulty() {
    return 1 + Math.max(0, state.year - CONFIG.START_YEAR) / 120;
  }

  // ─────────────────────────────── 保存

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      // 保存できない環境（プライベートモードなど）でも遊べるようにする
    }
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && saved.version === SAVE_VERSION) return saved;
    } catch (e) {
      // 壊れた保存データは捨てて、はじめからにする
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

  // ─────────────────────────────── はじまり

  function newGame() {
    return {
      version: SAVE_VERSION,
      phase: 'prologue',
      prologueStep: 0,
      year: 1616,
      shogunate: { zaisei: 55, ikou: 60, minshin: 55, chotei: 50 },
      shinko: 70,
      shinryoku: 3,
      jisseki: 0,
      shogun: {
        name: '家光', gen: 3, age: 33, health: 35, startYear: 1623, trait: '華美',
        stats: { seimu: 9, bui: 8, jintoku: 7 },
      },
      heirs: [],
      institutions: [],
      usedNames: ['家康', '秀忠', '家光'],
      seen: {},
      card: null,
      result: null,
      succession: null,
      crisis: null,
      log: [],
      history: [
        { gen: 1, name: '家康', from: 1603, to: 1605, note: '将軍職を秀忠に譲る' },
        { gen: 2, name: '秀忠', from: 1605, to: 1623, note: '将軍職を家光に譲る' },
      ],
    };
  }

  function startMain() {
    state.year = CONFIG.START_YEAR;
    state.phase = 'event';
    addLog('家光が倒れた。権現様は、夢枕に立つ力を得た。');
    const heir = makeHeir('竹千代');
    state.heirs.push(heir);
    addLog(`若君・${heir.name}が生まれた。家光は床の中で涙を流して喜んだ。`);
    drawCard();
  }

  // ─────────────────────────────── 若君と将軍

  function makeHeir(name) {
    const parent = state.shogun.stats;
    const inherit = (v) => clamp(Math.round(v * 0.3) + rand(2, 6), 1, CONFIG.ABILITY_MAX);
    const used = state.heirs.map((h) => h.name);
    return {
      name: name || pick(CHILD_NAMES.filter((n) => !used.includes(n))),
      age: 0,
      trait: Math.random() < 0.5 ? state.shogun.trait : pick(TRAITS),
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

  // ─────────────────────────────── 出来事

  function cardById(id) {
    return DATA.cards.find((c) => c.id === id);
  }

  function cardWeight(card) {
    if (card.trial) return 0.5 + (state.year - card.minYear) / 50;
    return card.weight || 1;
  }

  function drawCard() {
    const usable = (card, useCooldown) => {
      if (card.minYear && state.year < card.minYear) return false;
      if (card.when && !card.when(state)) return false;
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
    state.card = { id: chosen.id, shogunPick: shogunPick(chosen) };
  }

  // 将軍は自分の性格に合う選択肢を選ぶ。合うものがなければ、見た目の損得がいちばん良いものを選ぶ
  function shogunPick(card) {
    const byTrait = card.options.findIndex((o) => o.tag === state.shogun.trait);
    if (byTrait >= 0) return byTrait;
    const score = (o) => Object.keys(STATE_LABELS).reduce((sum, k) => sum + (o.effects[k] || 0), 0);
    let best = 0;
    card.options.forEach((o, i) => { if (score(o) > score(card.options[best])) best = i; });
    return best;
  }

  function successChance(check) {
    const ability = state.shogun.stats[check.stat];
    return clamp(0.5 + (ability - check.dc) * 0.07, 0.15, 0.92);
  }

  function isGuarded(kind) {
    return Boolean(kind) && state.institutions.some((id) => institution(id)?.guards === kind);
  }

  // 効果を反映し、画面に出す「何がどれだけ変わったか」の一覧を返す
  function applyEffects(effects, kind) {
    const changes = [];
    if (!effects) return changes;
    const guarded = isGuarded(kind);
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
      if (STATE_LABELS[key]) {
        if (v < 0) v = Math.round(v * difficulty());
        if (v < 0 && guarded) v = Math.ceil(v / 2);
        state.shogunate[key] = clamp(state.shogunate[key] + v, 0, 100);
      } else if (key === 'shinko') {
        state.shinko = clamp(state.shinko + v, 0, 100);
      } else if (key === 'jisseki') {
        state.jisseki = Math.max(0, state.jisseki + v);
      } else if (key === 'health') {
        state.shogun.health = clamp(state.shogun.health + v, 0, 100);
      } else {
        continue;
      }
      if (v !== 0) changes.push({ label: STATE_LABELS[key] || OTHER_LABELS[key], delta: v });
    }
    return changes;
  }

  function choose(index, overridden) {
    const card = cardById(state.card.id);
    const option = card.options[index];
    if (overridden) {
      if (state.shinryoku < CONFIG.ORACLE_COST) return;
      state.shinryoku -= CONFIG.ORACLE_COST;
    }

    let success = true;
    if (option.check) success = Math.random() < successChance(option.check);
    const changes = applyEffects(success ? option.effects : option.fail, card.kind);

    // 任せた場合だけ、将軍は経験を積んで育つ
    let growth = null;
    if (!overridden && option.grow && state.shogun.stats[option.grow] < CONFIG.ABILITY_MAX) {
      state.shogun.stats[option.grow] += 1;
      growth = `将軍の${ABILITY_LABELS[option.grow]}が1上がった（任された経験）`;
    }

    state.seen[card.id] = state.year;
    state.result = {
      title: card.title,
      choice: option.label,
      text: success ? option.text : option.failText,
      failed: !success,
      oracle: overridden ? pick(ORACLE_LINES).replace('{name}', state.shogun.name) : null,
      changes,
      growth,
    };
    addLog(`${card.title}：「${option.label}」${overridden ? '（夢枕に立った）' : ''}${success ? '' : '……しくじった'}`);
    state.phase = 'result';
    commit();
  }

  // ─────────────────────────────── 政務の間（教育・制度・隠居）

  function teach(heirIndex, stat) {
    const heir = state.heirs[heirIndex];
    if (!heir || heir.taughtYear === state.year || state.shinryoku < CONFIG.TEACH_COST) return;
    state.shinryoku -= CONFIG.TEACH_COST;
    const gain = 2 + (hasInstitution('gakumon') ? 1 : 0);
    heir.stats[stat] = clamp(heir.stats[stat] + gain, 1, CONFIG.ABILITY_MAX);
    heir.taughtYear = state.year;
    addLog(`若君・${heir.name}の夢に立ち、${TEACH_LABELS[stat]}を授けた（${ABILITY_LABELS[stat]}+${gain}）。`);
    commit();
  }

  function institutionStatus(inst) {
    if (hasInstitution(inst.id)) return { ok: false, reason: '整備済み' };
    if (state.jisseki < inst.cost) return { ok: false, reason: `実績が${inst.cost}必要` };
    for (const [key, min] of Object.entries(inst.requires || {})) {
      if (state.shogunate[key] < min) return { ok: false, reason: `${STATE_LABELS[key]}が${min}必要` };
    }
    return { ok: true };
  }

  function establish(id) {
    const inst = institution(id);
    if (!institutionStatus(inst).ok) return;
    state.jisseki -= inst.cost;
    state.institutions.push(id);
    addLog(`制度「${inst.name}」を整えた。この制度は代をまたいで残る。`);
    commit();
  }

  function canRetire() {
    return state.heirs.some((h) => h.age >= CONFIG.ADULT_AGE) && state.shinryoku >= CONFIG.RETIRE_COST;
  }

  function retire() {
    if (!canRetire()) return;
    if (!window.confirm(`神力を${CONFIG.RETIRE_COST}使って、${state.shogun.name}に隠居を勧めますか？`)) return;
    state.shinryoku -= CONFIG.RETIRE_COST;
    addLog(`権現様の勧めにより、${state.shogun.name}は将軍職を退き、大御所となった。`);
    startSuccession('retire');
    commit();
  }

  // ─────────────────────────────── 年を越す

  function endYear() {
    const s = state.shogun;
    const notes = [];

    // 制度の効果（毎年）
    for (const id of state.institutions) {
      const yearly = institution(id)?.yearly;
      if (yearly) applyEffects(yearly);
    }

    // 将軍の能力による自然な増減。能力が低いと少しずつ悪くなる。
    // 時代が下るほど幕府の費えは膨らみ、長い平和で大名は幕府を恐れなくなっていく
    const age = Math.floor((state.year - CONFIG.START_YEAR) / 50);
    const drift = {
      zaisei: Math.floor(s.stats.seimu / 4) - 3 - age,
      ikou: Math.floor(s.stats.bui / 5) - 2 - Math.floor(age / 2),
      minshin: Math.floor(s.stats.jintoku / 5) - 2,
      chotei: 0,
    };
    // 満ち足りた状態は長続きしない（慢心）
    for (const key of Object.keys(drift)) {
      if (state.shogunate[key] > 80) drift[key] -= 2;
      else if (key === 'chotei' && state.shogunate.chotei > 60) drift[key] -= 1;
    }
    applyEffects(drift);
    state.shinko = clamp(state.shinko - 2, 0, 100);

    // 神力と実績
    state.shinryoku = Math.min(CONFIG.SHINRYOKU_MAX, state.shinryoku + 1 + Math.floor(state.shinko / 25));
    state.jisseki += 1 + (s.stats.seimu >= 12 ? 1 : 0);

    // 若君が育つ
    for (const heir of state.heirs) {
      heir.age += 1;
      if (heir.age < CONFIG.ADULT_AGE && Math.random() < 0.5) {
        const stat = pick(['seimu', 'bui', 'jintoku']);
        heir.stats[stat] = clamp(heir.stats[stat] + 1, 1, CONFIG.ABILITY_MAX);
      }
    }

    // 将軍が歳をとる
    s.age += 1;
    if (s.age >= 60) s.health -= 4;
    else if (s.age >= 40) s.health -= 2;
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
    const values = Object.values(state.shogunate);
    if (state.crisis) {
      if (values.every((v) => v > CONFIG.CRISIS_SAFE)) {
        state.crisis = null;
        notes.push('幕府は危機を脱した。');
      } else {
        state.crisis.years -= 1;
        if (state.crisis.years <= 0) {
          state.year += 1;
          gameOver();
          return;
        }
      }
    } else if (values.some((v) => v <= 0)) {
      const fallen = Object.keys(state.shogunate).filter((k) => state.shogunate[k] <= 0).map((k) => STATE_LABELS[k]);
      state.crisis = { years: CONFIG.CRISIS_YEARS };
      notes.push(`${fallen.join('・')}が尽きた。倒幕の危機！${CONFIG.CRISIS_YEARS}年のうちに立て直さねばならぬ。`);
    }

    state.year += 1;
    notes.forEach(addLog);

    if (died) {
      addLog(`将軍・${s.name}が${s.age}歳で世を去った。`);
      startSuccession('death');
    } else {
      state.phase = 'event';
      drawCard();
    }
    commit();
  }

  // ─────────────────────────────── 世代交代

  function startSuccession(reason) {
    const s = state.shogun;
    state.history.push({
      gen: s.gen, name: s.name, from: s.startYear, to: state.year,
      note: reason === 'retire' ? '隠居して大御所となる' : `${s.age}歳で没する`,
    });

    let mode = 'heirs';
    let candidates = state.heirs.map((h) => ({ ...h, house: null }));
    if (candidates.length === 0) {
      if (hasInstitution('gosanke')) {
        mode = 'gosanke';
        candidates = GOSANKE_HOUSES.map((house) => ({
          name: `${house}の若殿`, house, age: rand(18, 34), trait: pick(TRAITS),
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
    state.shogun = {
      name, gen: prev.gen + 1, age: c.age, startYear: state.year, trait: c.trait,
      health: clamp(c.stats.kenko * 5, 20, 100),
      stats: { seimu: c.stats.seimu, bui: c.stats.bui, jintoku: c.stats.jintoku },
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

    // 兄弟は一門として家を出る。若君は新しい将軍の子から生まれる
    state.heirs = [];
    state.succession = null;
    state.phase = 'event';
    drawCard();
    commit();
  }

  function gameOver() {
    state.phase = 'over';
    const s = state.shogun;
    state.history.push({ gen: s.gen, name: s.name, from: s.startYear, to: state.year, note: '倒幕により幕府滅ぶ' });
    addLog(`倒幕。徳川幕府は${bakufuYears()}年で幕を閉じた。`);
    saveBest(bakufuYears());
    commit();
  }

  // ─────────────────────────────── 描画

  const $ = (id) => document.getElementById(id);

  let lastPhase = null;

  function commit() {
    save();
    render();
    // 場面が変わったら、状態が見える位置まで戻す（スマホで下までスクロールしたままにならないように）
    if (state.phase !== lastPhase) {
      const target = state.phase === 'prologue' ? $('stage') : $('status');
      if (target.getBoundingClientRect().top < 0) target.scrollIntoView({ block: 'start' });
    }
    lastPhase = state.phase;
  }

  function render() {
    renderStatus();
    renderStage();
    renderLog();
    renderHistory();
  }

  function renderStatus() {
    const panel = $('status');
    panel.hidden = state.phase === 'prologue';
    if (panel.hidden) return;
    const s = state.shogun;

    $('stat-year').textContent = `${state.year}年`;
    $('stat-age').textContent = `開府から${bakufuYears()}年`;
    $('stat-shogun').textContent = `第${s.gen}代 ${s.name}（${s.age}歳・${s.trait}）`;
    $('stat-abilities').textContent =
      `政務${s.stats.seimu}　武威${s.stats.bui}　人徳${s.stats.jintoku}　健康${s.health}`;

    const bars = $('stat-bars');
    bars.replaceChildren();
    for (const [key, label] of Object.entries(STATE_LABELS)) {
      const value = state.shogunate[key];
      const fill = el('div', { class: 'iy-bar__fill' });
      fill.style.width = `${value}%`;
      bars.append(el('div', { class: `iy-bar${value <= 20 ? ' iy-bar--low' : ''}` }, [
        el('span', { class: 'iy-bar__label', text: label }),
        el('div', { class: 'iy-bar__track' }, fill),
        el('span', { class: 'iy-bar__value', text: String(value) }),
      ]));
    }

    $('stat-shinryoku').textContent = `${state.shinryoku} / ${CONFIG.SHINRYOKU_MAX}`;
    $('stat-shinko').textContent = String(state.shinko);
    $('stat-jisseki').textContent = String(state.jisseki);

    const crisis = $('crisis');
    crisis.hidden = !state.crisis;
    if (state.crisis) crisis.textContent = `倒幕の危機：あと${state.crisis.years}年のうちに、すべての状態を${CONFIG.CRISIS_SAFE}より上に戻せ`;
  }

  function renderStage() {
    const stage = $('stage');
    stage.replaceChildren();
    const views = {
      prologue: viewPrologue,
      event: viewEvent,
      result: viewResult,
      manage: viewManage,
      succession: viewSuccession,
      over: viewOver,
    };
    stage.append(...[].concat(views[state.phase]()));
  }

  function paragraphs(lines) {
    return [].concat(lines).map((line) => el('p', { text: line }));
  }

  function viewPrologue() {
    const step = DATA.prologue[state.prologueStep];
    const isLast = state.prologueStep === DATA.prologue.length - 1;
    const nodes = [
      el('p', { class: 'iy-year', text: `${step.year}年` }),
      el('h2', { text: step.title }),
      el('div', { class: 'iy-voice' }, paragraphs(step.text)),
    ];
    const next = () => {
      state.prologueNote = null;
      if (isLast) startMain();
      else state.prologueStep += 1;
      commit();
    };
    if (step.choices) {
      const list = el('div', { class: 'iy-options' });
      step.choices.forEach((choice) => {
        list.append(el('button', {
          type: 'button', class: 'iy-option',
          onclick: () => {
            state.institutions.push(choice.institution);
            addLog(`家康、最後の布石として「${institution(choice.institution).name}」を残す。`);
            state.prologueStep += 1;
            state.prologueNote = choice.text;
            commit();
          },
        }, [el('strong', { text: choice.label }), el('span', { text: institution(choice.institution).desc })]));
      });
      nodes.push(list);
    } else {
      if (state.prologueNote) {
        nodes.splice(2, 0, el('p', { class: 'iy-note', text: state.prologueNote }));
      }
      nodes.push(el('button', { type: 'button', class: 'iy-primary', onclick: next, text: isLast ? '幕府を見守る' : '次へ' }));
    }
    return nodes;
  }

  function viewEvent() {
    const card = cardById(state.card.id);
    const pickIndex = state.card.shogunPick;
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年${card.trial ? '　大きな試練' : ''}` }),
      el('h2', { text: card.title }),
      el('p', { text: card.text }),
      el('p', { class: 'iy-voice iy-voice--aside', text: `権現様「${card.ieyasu}」` }),
      el('p', { class: 'iy-intent' }, [
        `将軍・${state.shogun.name}（${state.shogun.trait}）は「`,
        el('strong', { text: card.options[pickIndex].label }),
        '」を選ぼうとしている。',
      ]),
    ];

    const list = el('div', { class: 'iy-options' });
    card.options.forEach((option, i) => {
      const isPick = i === pickIndex;
      const hint = option.check
        ? `成否は将軍の${ABILITY_LABELS[option.check.stat]}しだい（見込み${Math.round(successChance(option.check) * 100)}%）`
        : '';
      list.append(el('button', {
        type: 'button',
        class: `iy-option${isPick ? ' iy-option--pick' : ''}`,
        disabled: !isPick && state.shinryoku < CONFIG.ORACLE_COST,
        onclick: () => choose(i, !isPick),
      }, [
        el('span', { class: 'iy-option__how', text: isPick ? '見守る（将軍に任せる）' : `夢枕に立つ（神力${CONFIG.ORACLE_COST}）` }),
        el('strong', { text: option.label }),
        hint ? el('span', { class: 'iy-option__hint', text: hint }) : null,
      ]));
    });
    nodes.push(list);
    return nodes;
  }

  function changeList(changes) {
    if (changes.length === 0) return null;
    return el('ul', { class: 'iy-changes' }, changes.map((c) =>
      el('li', { class: c.delta > 0 ? 'iy-up' : 'iy-down', text: `${c.label} ${signed(c.delta)}` })));
  }

  function viewResult() {
    const r = state.result;
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: `${r.title}：${r.choice}` }),
      r.oracle ? el('p', { class: 'iy-voice iy-voice--aside', text: r.oracle }) : null,
      el('p', { class: r.failed ? 'iy-failed' : '', text: r.text }),
      changeList(r.changes),
      r.growth ? el('p', { class: 'iy-note', text: r.growth }) : null,
      el('button', {
        type: 'button', class: 'iy-primary', text: '政務の間へ',
        onclick: () => { state.phase = 'manage'; state.result = null; commit(); },
      }),
    ].filter(Boolean);
  }

  function heirCard(heir, index) {
    const canTeach = heir.age < CONFIG.TEACH_AGE_LIMIT;
    const taught = heir.taughtYear === state.year;
    const buttons = el('div', { class: 'iy-teach' });
    if (canTeach) {
      for (const stat of Object.keys(TEACH_LABELS)) {
        buttons.append(el('button', {
          type: 'button', text: TEACH_LABELS[stat],
          disabled: taught || state.shinryoku < CONFIG.TEACH_COST,
          onclick: () => teach(index, stat),
        }));
      }
    }
    return el('div', { class: 'iy-heir' }, [
      el('p', { class: 'iy-heir__name' }, [
        el('strong', { text: heir.name }),
        `（${heir.age}歳・${heir.trait}）`,
      ]),
      el('p', { class: 'iy-heir__stats', text: Object.keys(ABILITY_LABELS).map((k) => `${ABILITY_LABELS[k]}${heir.stats[k]}`).join('　') }),
      canTeach
        ? el('p', { class: 'iy-hint', text: taught ? '今年はもう教えた。' : `夢で教える（神力${CONFIG.TEACH_COST}・1年に1回）` })
        : el('p', { class: 'iy-hint', text: '成人したので、もう教えられない。' }),
      canTeach ? buttons : null,
    ].filter(Boolean));
  }

  function viewManage() {
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '政務の間' }),
      el('p', { class: 'iy-hint', text: '神力と実績を使って、次の代への備えをする。終わったら年を越す。' }),
      el('h3', { text: '若君' }),
    ];

    if (state.heirs.length === 0) {
      nodes.push(el('p', { class: 'iy-hint', text: 'まだ若君がいない。将軍が若いうちは、いずれ生まれるだろう。' }));
    } else {
      state.heirs.forEach((h, i) => nodes.push(heirCard(h, i)));
    }

    if (state.heirs.some((h) => h.age >= CONFIG.ADULT_AGE)) {
      nodes.push(el('button', {
        type: 'button', class: 'iy-secondary', disabled: !canRetire(), onclick: retire,
        text: `将軍に隠居を勧める（神力${CONFIG.RETIRE_COST}）`,
      }));
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
      list.append(el('div', { class: 'iy-inst' }, [
        el('p', { class: 'iy-inst__name' }, [el('strong', { text: inst.name }), `（実績${inst.cost}）`]),
        el('p', { class: 'iy-hint', text: inst.desc }),
        el('button', {
          type: 'button', text: status.ok ? '整える' : status.reason,
          disabled: !status.ok, onclick: () => establish(inst.id),
        }),
      ]));
    }
    nodes.push(list);

    nodes.push(el('button', { type: 'button', class: 'iy-primary', text: '年を越す', onclick: endYear }));
    return nodes;
  }

  function viewSuccession() {
    const { reason, mode, candidates } = state.succession;
    const intro = {
      heirs: '次の将軍を選ぶ。権現様の声は、夢を通して家臣たちにも届く。',
      gosanke: '本家に跡継ぎがいない。御三家から次の将軍を迎える。',
      dispute: '跡継ぎがいない。一門の中から、争いの末に一人が担ぎ出された。',
    }[mode];
    const nodes = [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: reason === 'retire' ? '将軍職を譲る' : '将軍、世を去る' }),
      el('p', { text: intro }),
    ];
    const list = el('div', { class: 'iy-options' });
    candidates.forEach((c, i) => {
      const warn = c.age < CONFIG.ADULT_AGE ? '　幼い将軍になる（威光が下がる）' : '';
      list.append(el('button', { type: 'button', class: 'iy-option', onclick: () => crown(i) }, [
        el('strong', { text: `${c.name}（${c.age}歳・${c.trait}）` }),
        el('span', { text: Object.keys(ABILITY_LABELS).map((k) => `${ABILITY_LABELS[k]}${c.stats[k]}`).join('　') + warn }),
      ]));
    });
    nodes.push(list);
    return nodes;
  }

  function viewOver() {
    const years = bakufuYears();
    return [
      el('p', { class: 'iy-year', text: `${state.year}年` }),
      el('h2', { text: '倒幕' }),
      el('div', { class: 'iy-voice' }, paragraphs([
        `徳川の幕府は、開府から${years}年で幕を閉じた。最後の将軍は、第${state.shogun.gen}代・${state.shogun.name}。`,
        '日光の山の上で、権現様は長いため息をついた。……次こそは。',
      ])),
      el('p', { class: 'iy-note', text: `これまでの最長記録：${Math.max(years, loadBest())}年（史実の幕府は約265年）` }),
      el('button', { type: 'button', class: 'iy-primary', text: 'もう一度、最初から', onclick: restart }),
    ];
  }

  function renderLog() {
    const list = $('log');
    list.replaceChildren(...state.log.map((entry) =>
      el('li', {}, [el('span', { class: 'iy-log__year', text: `${entry.year}` }), entry.text])));
    $('log-panel').hidden = state.log.length === 0;
  }

  function renderHistory() {
    const list = $('history');
    list.replaceChildren(...state.history.map((h) =>
      el('li', { text: `第${h.gen}代 ${h.name}（${h.from}〜${h.to}年）${h.note}` })));
  }

  function restart() {
    state = newGame();
    commit();
  }

  $('btn-reset').addEventListener('click', () => {
    if (window.confirm('保存されている進行状況を消して、はじめからやり直しますか？')) restart();
  });

  state = load() || newGame();
  lastPhase = state.phase;
  render();
})();
