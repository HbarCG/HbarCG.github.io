(() => {
  'use strict';

  const CONFIG = {
    START_POPULATION: 10,
    RESET_POPULATION: 8,
    BASE_STATS: { combat: 5, gather: 5, fertility: 5, lifespan: 5 },
    VITALITY_PER_LIFESPAN: 10,
    PASSIVE_AGE_PER_TURN: 2,
    EGG_BASE_COST: 0.18,
    EGG_MAX_PER_TURN: 30,
    CANDIDATE_SLOTS: 3,
    GROWTH_RATE: 0.6,
    RISK: {
      low: { label: '低リスク', yieldMul: 1.0, lossBase: 0.05 },
      mid: { label: '中リスク', yieldMul: 1.8, lossBase: 0.16 },
      high: { label: '高リスク', yieldMul: 3.0, lossBase: 0.34 },
    },
  };

  const FLAVOR = {
    low: {
      safe: [
        '静かな下草を巡回し、{sent}匹全員が無事に資源を持ち帰った。',
        '目立った危険もなく、いつも通りの収穫だった。',
      ],
      loss: [
        '小さな諍いに巻き込まれ、{lost}匹を失った。',
        '思わぬ雨に降られ、{lost}匹が帰ってこなかった。',
      ],
    },
    mid: {
      safe: [
        '少し足を伸ばした遠征だったが、{sent}匹全員が戻ってきた。',
        '手強い相手もいたが、うまく切り抜けた。',
      ],
      loss: [
        '途中で捕食者に見つかり、{lost}匹が戻らなかった。',
        '縄張り争いに巻き込まれ、{lost}匹を失った。',
      ],
    },
    high: {
      safe: [
        '危険な縄張りに踏み込んだが、驚くほど無傷で戻ってきた。',
        '大きな賭けだったが、{sent}匹全員が生きて帰った。',
      ],
      loss: [
        '大型の甲虫に襲われ、{lost}匹を失う大きな代償を払った。',
        '深追いしすぎた。{lost}匹が二度と巣に戻らなかった。',
      ],
    },
  };

  const SAVE_KEY = 'ant-colony-save';
  const SAVE_VERSION = 2;

  let state = null;
  let candidateDrafts = [];

  function freshQueen(stats) {
    const lifespan = stats.lifespan;
    const maxVitality = lifespan * CONFIG.VITALITY_PER_LIFESPAN;
    return { stats, vitality: maxVitality, maxVitality };
  }

  function freshCandidates() {
    return Array.from({ length: CONFIG.CANDIDATE_SLOTS }, () => ({ invested: 0, base: null }));
  }

  function resetDrafts() {
    candidateDrafts = new Array(CONFIG.CANDIDATE_SLOTS).fill(0);
  }

  function newGameState() {
    return {
      generation: 1,
      queen: freshQueen({ ...CONFIG.BASE_STATS }),
      population: CONFIG.START_POPULATION,
      resource: 0,
      candidates: freshCandidates(),
      turnActions: { expeditionUsed: false, eggUsed: false },
      turnsThisReign: 0,
      resourceThisReign: 0,
      history: [],
      log: [`第1代の女王が即位した。`],
      gameOver: false,
      awaitingSuccession: false,
    };
  }

  function saveState() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
    } catch (e) {
      /* private browsing / quota などで失敗しても致命的ではないので無視する */
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.version !== SAVE_VERSION || !parsed.state) return null;
      return parsed.state;
    } catch (e) {
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      /* 無視する */
    }
  }

  function mutateStat(v) {
    return Math.max(1, v * (0.85 + Math.random() * 0.3));
  }

  function growthBonus(invested) {
    return Math.sqrt(invested) * CONFIG.GROWTH_RATE;
  }

  function candidateFinalStats(candidate) {
    const bonus = growthBonus(candidate.invested);
    const base = candidate.base;
    return {
      combat: base.combat + bonus,
      gather: base.gather + bonus,
      fertility: base.fertility + bonus,
      lifespan: base.lifespan + bonus,
    };
  }

  function fmt(n) {
    return Math.round(n * 10) / 10;
  }

  function addLog(msg) {
    state.log.unshift(msg);
    state.log = state.log.slice(0, 40);
  }

  function pickFlavor(riskKey, sent, lost) {
    const bucket = FLAVOR[riskKey][lost > 0 ? 'loss' : 'safe'];
    const template = bucket[Math.floor(Math.random() * bucket.length)];
    return template.replace('{sent}', sent).replace('{lost}', lost);
  }

  function eggCostPerUnit() {
    const fertility = state.queen.stats.fertility;
    return CONFIG.EGG_BASE_COST * (10 / (10 + fertility));
  }

  function applyVitalityChange(delta) {
    state.queen.vitality = Math.max(0, state.queen.vitality + delta);
    if (state.queen.vitality <= 0) {
      checkSuccession();
    }
  }

  function doExpedition(sentCount, riskKey) {
    if (state.turnActions.expeditionUsed || sentCount <= 0) return;
    const risk = CONFIG.RISK[riskKey];
    const combat = state.queen.stats.combat;
    const gather = state.queen.stats.gather;

    const yieldRand = 0.85 + Math.random() * 0.3;
    const gained = Math.round(sentCount * risk.yieldMul * (gather / 10) * yieldRand);

    const effectiveLossRate = risk.lossBase * (10 / (10 + combat));
    const lossRand = 0.7 + Math.random() * 0.6;
    const lost = Math.min(sentCount, Math.round(sentCount * effectiveLossRate * lossRand));

    state.population -= lost;
    state.resource += gained;
    state.resourceThisReign += gained;
    state.turnActions.expeditionUsed = true;

    const flavor = pickFlavor(riskKey, sentCount, lost);
    const tail = lost > 0 ? `（資源+${gained}、損耗${lost}匹）` : `（資源+${gained}）`;
    addLog(`${risk.label}の遠征：${flavor}${tail}`);
    animateExpedition(sentCount, lost, () => renderAll());
    renderAll();
  }

  function doLayEggs(requested) {
    if (state.turnActions.eggUsed || requested <= 0) return;
    const costPerUnit = eggCostPerUnit();
    let count = requested;
    const affordable = Math.floor(state.queen.vitality / costPerUnit);
    if (count > affordable) count = affordable;
    if (count <= 0) {
      addLog('活力が足りず、産卵できなかった。');
      state.turnActions.eggUsed = true;
      renderAll();
      return;
    }
    const cost = count * costPerUnit;
    state.population += count;
    state.turnActions.eggUsed = true;
    addLog(`産卵：${count}匹誕生。活力-${fmt(cost)}。`);
    applyVitalityChange(-cost);
    renderAll();
  }

  function doInvest(index, amount) {
    if (amount <= 0 || amount > state.resource) return;
    const c = state.candidates[index];
    if (!c.base) {
      c.base = {
        combat: mutateStat(state.queen.stats.combat),
        gather: mutateStat(state.queen.stats.gather),
        fertility: mutateStat(state.queen.stats.fertility),
        lifespan: mutateStat(state.queen.stats.lifespan),
      };
    }
    c.invested += amount;
    state.resource -= amount;
    candidateDrafts[index] = 0;
    addLog(`候補${index + 1}に資源${amount}を投資した。`);
    renderAll();
  }

  function endTurn() {
    if (state.gameOver || state.awaitingSuccession) return;
    state.turnsThisReign += 1;
    state.turnActions = { expeditionUsed: false, eggUsed: false };
    addLog('--- ターンを終えた ---');
    applyVitalityChange(-CONFIG.PASSIVE_AGE_PER_TURN);
    renderAll();
  }

  function checkSuccession() {
    if (state.gameOver || state.awaitingSuccession) return;
    const viable = state.candidates
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.base && x.c.invested > 0);

    state.history.push({
      generation: state.generation,
      stats: { ...state.queen.stats },
      turnsReigned: state.turnsThisReign,
      resourceGathered: state.resourceThisReign,
      outcome: viable.length > 0 ? 'succeeded' : 'wiped',
    });

    if (viable.length === 0) {
      state.gameOver = true;
    } else {
      state.awaitingSuccession = true;
    }
  }

  function chooseSuccessor(stats) {
    state.generation += 1;
    state.queen = freshQueen({
      combat: stats.combat,
      gather: stats.gather,
      fertility: stats.fertility,
      lifespan: stats.lifespan,
    });
    state.population = CONFIG.RESET_POPULATION;
    state.resource = 0;
    state.candidates = freshCandidates();
    state.turnActions = { expeditionUsed: false, eggUsed: false };
    state.turnsThisReign = 0;
    state.resourceThisReign = 0;
    state.awaitingSuccession = false;
    resetDrafts();
    addLog(`第${state.generation}代の女王が即位した。`);
    renderAll();
  }

  function restartGame() {
    clearSave();
    state = newGameState();
    resetDrafts();
    renderAll();
  }

  function requestReset() {
    const ok = window.confirm('保存されている進行状況を削除して、最初からやり直します。よろしいですか？');
    if (!ok) return;
    restartGame();
  }

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      text: cs.getPropertyValue('--color-text').trim() || '#1f1f1f',
      muted: cs.getPropertyValue('--color-text-muted').trim() || '#6b6b6b',
      link: cs.getPropertyValue('--color-link').trim() || '#1a5fb4',
      border: cs.getPropertyValue('--color-border').trim() || '#e3e2de',
    };
  }

  function seeded(i) {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawScene(homeCount, travelers) {
    const canvas = document.getElementById('nest-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const colors = themeColors();
    ctx.clearRect(0, 0, w, h);

    const nestX = w * 0.32;
    const nestY = h * 0.5;
    const nestR = 70;

    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(nestX, nestY, nestR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colors.link;
    const shown = Math.min(homeCount, 60);
    for (let i = 0; i < shown; i++) {
      const angle = seeded(i) * Math.PI * 2;
      const r = seeded(i + 100) * (nestR - 10);
      const x = nestX + Math.cos(angle) * r;
      const y = nestY + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (travelers) {
      ctx.fillStyle = colors.text;
      travelers.forEach((t) => {
        if (t.alpha <= 0) return;
        ctx.globalAlpha = t.alpha;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = colors.muted;
    ctx.font = '13px sans-serif';
    ctx.fillText('巣', nestX - 8, nestY + nestR + 20);
  }

  function animateExpedition(sentCount, lostCount, onDone) {
    const canvas = document.getElementById('nest-canvas');
    const homeCount = Math.max(0, state.population - (sentCount - lostCount));
    const w = canvas.width;
    const h = canvas.height;
    const nestX = w * 0.32;
    const nestY = h * 0.5;
    const outX = w * 0.82;
    const outY = h * 0.5;
    const travelCount = Math.min(sentCount, 40);
    const duration = 1300;
    const start = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const travelers = [];
      for (let i = 0; i < travelCount; i++) {
        const isLost = i < lostCount;
        const jitterX = (seeded(i + 200) - 0.5) * 30;
        const jitterY = (seeded(i + 300) - 0.5) * 80;
        let x, y, alpha = 1;
        if (t < 0.4) {
          const p = t / 0.4;
          x = nestX + (outX - nestX) * p + jitterX * p;
          y = nestY + (outY - nestY) * p + jitterY * p;
        } else if (t < 0.6) {
          x = outX + jitterX;
          y = outY + jitterY;
          if (isLost) alpha = 1 - (t - 0.4) / 0.2;
        } else {
          if (isLost) {
            alpha = 0;
          } else {
            const p = (t - 0.6) / 0.4;
            x = outX + jitterX * (1 - p) + (nestX - outX) * p;
            y = outY + jitterY * (1 - p) + (nestY - outY) * p;
          }
        }
        travelers.push({ x, y, alpha });
      }
      drawScene(homeCount, travelers);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  function renderStatus() {
    document.getElementById('stat-generation').textContent = state.generation;
    document.getElementById('stat-population').textContent = state.population;
    document.getElementById('stat-resource').textContent = state.resource;
    document.getElementById('stat-combat').textContent = fmt(state.queen.stats.combat);
    document.getElementById('stat-gather').textContent = fmt(state.queen.stats.gather);
    document.getElementById('stat-fertility').textContent = fmt(state.queen.stats.fertility);
    document.getElementById('stat-lifespan').textContent = fmt(state.queen.stats.lifespan);

    const pct = Math.max(0, Math.min(100, (state.queen.vitality / state.queen.maxVitality) * 100));
    document.getElementById('vitality-fill').style.width = `${pct}%`;
    document.getElementById('vitality-text').textContent =
      `${fmt(state.queen.vitality)} / ${fmt(state.queen.maxVitality)}`;
  }

  function locked() {
    return state.gameOver || state.awaitingSuccession;
  }

  function renderExpeditionControls() {
    const slider = document.getElementById('expedition-count');
    const out = document.getElementById('expedition-count-out');
    const max = document.getElementById('expedition-max');
    slider.max = state.population;
    if (Number(slider.value) > state.population) slider.value = state.population;
    max.textContent = state.population;
    out.textContent = slider.value;
    document.getElementById('btn-expedition').disabled =
      state.turnActions.expeditionUsed || state.population <= 0 || locked() || Number(slider.value) <= 0;
  }

  function renderEggControls() {
    const slider = document.getElementById('egg-count');
    const out = document.getElementById('egg-count-out');
    out.textContent = slider.value;
    const cost = Number(slider.value) * eggCostPerUnit();
    const preview = document.getElementById('egg-cost-preview');
    preview.textContent = `消費する活力：${fmt(cost)}${cost > state.queen.vitality ? '(活力不足のため一部のみ実行される)' : ''}`;
    document.getElementById('btn-egg').disabled =
      state.turnActions.eggUsed || locked() || Number(slider.value) <= 0;
  }

  function renderCandidates() {
    const container = document.getElementById('candidates');
    container.innerHTML = '';
    state.candidates.forEach((c, i) => {
      if (candidateDrafts[i] > state.resource) candidateDrafts[i] = state.resource;

      const el = document.createElement('div');
      el.className = 'ant-candidate';

      const h3 = document.createElement('h3');
      h3.textContent = `候補${i + 1}`;
      el.appendChild(h3);

      const statsP = document.createElement('p');
      statsP.className = 'ant-candidate__stats';
      if (c.base) {
        const fs = candidateFinalStats(c);
        statsP.textContent = `戦${fmt(fs.combat)} 収${fmt(fs.gather)} 繁${fmt(fs.fertility)} 寿${fmt(fs.lifespan)}（投資済み${c.invested}）`;
      } else {
        statsP.textContent = '未投資（素質は投資すると判明する）';
      }
      el.appendChild(statsP);

      const field = document.createElement('div');
      field.className = 'ant-field';
      const label = document.createElement('label');
      label.textContent = '投資量';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = String(state.resource);
      range.value = String(candidateDrafts[i]);
      range.disabled = state.resource <= 0 || locked();
      const out = document.createElement('output');
      out.textContent = String(candidateDrafts[i]);
      const btn = document.createElement('button');
      btn.textContent = '投資する';
      btn.disabled = state.resource <= 0 || locked() || candidateDrafts[i] <= 0;
      range.addEventListener('input', () => {
        candidateDrafts[i] = Number(range.value);
        out.textContent = range.value;
        btn.disabled = state.resource <= 0 || locked() || candidateDrafts[i] <= 0;
      });
      field.appendChild(label);
      field.appendChild(range);
      field.appendChild(out);
      el.appendChild(field);

      btn.addEventListener('click', () => doInvest(i, Number(range.value)));
      el.appendChild(btn);

      container.appendChild(el);
    });
  }

  function renderLog() {
    const el = document.getElementById('ant-log');
    el.innerHTML = state.log.map((m) => `<p>${m}</p>`).join('');
  }

  function renderHistory() {
    const panel = document.getElementById('history-panel');
    const list = document.getElementById('ant-history');
    if (state.history.length === 0) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    list.innerHTML = state.history
      .map((h) => {
        const outcome = h.outcome === 'succeeded' ? '継承' : 'コロニー全滅';
        return `<li>第${h.generation}代（${h.turnsReigned}ターン在位、資源${h.resourceGathered}獲得）— ${outcome}</li>`;
      })
      .join('');
  }

  function renderEndTurnButton() {
    document.getElementById('btn-end-turn').disabled = locked();
  }

  function renderSuccessionModal() {
    const modal = document.getElementById('succession-modal');
    const title = document.getElementById('succession-title');
    const body = document.getElementById('succession-body');
    const restartBtn = document.getElementById('btn-restart');

    if (state.gameOver) {
      const lastGen = state.history.length ? state.history[state.history.length - 1].generation : state.generation;
      title.textContent = 'コロニー全滅';
      body.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = `第${lastGen}代の女王が寿命を迎えたが、後継者は誰も育っていなかった。コロニーはここで途絶えた。`;
      body.appendChild(p);
      restartBtn.hidden = false;
      modal.hidden = false;
      return;
    }

    if (!state.awaitingSuccession) {
      modal.hidden = true;
      return;
    }

    title.textContent = '世代交代';
    body.innerHTML = '';
    const intro = document.createElement('p');
    intro.textContent = `第${state.generation}代の女王が寿命を迎えた。次代を選んでほしい。`;
    body.appendChild(intro);

    const viable = state.candidates
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.base && x.c.invested > 0);
    viable.forEach(({ c, i }) => {
      const fs = candidateFinalStats(c);
      const row = document.createElement('div');
      row.className = 'succession-option';
      const info = document.createElement('span');
      info.textContent = `候補${i + 1}｜戦${fmt(fs.combat)} 収${fmt(fs.gather)} 繁${fmt(fs.fertility)} 寿${fmt(fs.lifespan)}`;
      const btn = document.createElement('button');
      btn.textContent = 'この子を女王にする';
      btn.addEventListener('click', () => chooseSuccessor(fs));
      row.appendChild(info);
      row.appendChild(btn);
      body.appendChild(row);
    });
    restartBtn.hidden = true;
    modal.hidden = false;
  }

  function renderAll() {
    renderStatus();
    renderExpeditionControls();
    renderEggControls();
    renderCandidates();
    renderLog();
    renderHistory();
    renderEndTurnButton();
    renderSuccessionModal();
    drawScene(state.population, null);
    saveState();
  }

  function init() {
    const loaded = loadState();
    state = loaded || newGameState();
    resetDrafts();

    document.getElementById('expedition-count').addEventListener('input', () => {
      renderExpeditionControls();
    });
    document.getElementById('egg-count').addEventListener('input', () => {
      renderEggControls();
    });

    document.getElementById('btn-expedition').addEventListener('click', () => {
      const count = Number(document.getElementById('expedition-count').value);
      const risk = document.getElementById('expedition-risk').value;
      doExpedition(count, risk);
    });

    document.getElementById('btn-egg').addEventListener('click', () => {
      const count = Number(document.getElementById('egg-count').value);
      doLayEggs(count);
    });

    document.getElementById('btn-end-turn').addEventListener('click', endTurn);
    document.getElementById('btn-restart').addEventListener('click', restartGame);
    document.getElementById('btn-reset-save').addEventListener('click', requestReset);

    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
