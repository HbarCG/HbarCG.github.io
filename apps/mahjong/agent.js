'use strict';

/*
 * AI操作パネル（?ai=1 で開いたときだけ表示する）。
 * Claude in Chrome・ChatGPTのクラウドブラウザ・Claude Code＋Playwright など、ブラウザを操作できるAIが
 * このアプリを実際に打ちながら解説できるように、次の3つを1か所にまとめて出す。
 *   - 状態: 今AIが操作してよいか（あなたの判断待ち／CPUの手番／局の結果／振り返り中／対局終了）
 *   - 操作: 今押せる操作をすべてボタンにしたもの（打牌は1回押せば切れる。手牌の2回タップは要らない）
 *   - 盤面: 見えている情報だけを文字にしたもの（書き方は position.js。「AIに相談用にコピー」と同じ）
 * AIによって画面の読み方（ページの文字・アクセシビリティ情報・スクリーンショット）が違うので、
 * どれでも読めるよう、画面に見える普通の文字とボタンだけで作る。
 * ボタンは画面の操作と同じ関数を呼ぶだけで、対局の進め方は変えない。
 * パネルの一番外側の data-status に状態の種類を入れる（Playwright などで待つ条件に使える）。
 * AIに渡す指示文と使い方は /apps/mahjong/ai/ に書いている。
 */

const AGENT_STATUS_NAMES = {
  turn: 'あなたの判断待ち',
  busy: 'CPUの手番',
  result: '局の結果',
  replay: '振り返り中',
  over: '対局終了',
};

// 盤面の文字の頭に付ける、表記と読み方の短い説明（詳しい前提は指示文で伝える）
const AGENT_NOTATION = [
  '表記: m=萬子 p=筒子 s=索子、0=赤5。同じ色の数牌は数字を続けて書く（例: 123m）。字牌は漢字（東南西北白發中）',
  "河: ' はツモ切り、[リーチ] はリーチ宣言牌、[〇〇が鳴き] は鳴かれた牌。他家の手牌は局が終わるまで伏せています",
  '「アプリの計算」の向聴数・受け入れ枚数・残り枚数は正しい値として使ってください。「お手本AI」はこのアプリで一番強い設定のCPUで、正解とは限りません',
];

function setupAgentPanel() {
  if (!CONFIG.agentMode) return;
  el('mj-agent').hidden = false;
  renderAgentPanel();
}

// 盤面が変わるたび（描画・選択肢の表示と消去・振り返りの移動）に game.js から呼ばれる
function renderAgentPanel() {
  if (!CONFIG.agentMode) return;
  const status = agentStatus();
  el('mj-agent').dataset.status = status.key;
  el('mj-agent-status-name').textContent = AGENT_STATUS_NAMES[status.key];
  el('mj-agent-status-text').textContent = status.text;

  const box = el('mj-agent-actions');
  box.innerHTML = '';
  const actions = agentActions(status);
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = a.label;
    btn.addEventListener('click', a.run);
    // ページの文字をそのまま読むAIでもボタンの区切りがわかるよう、間に空白を入れる（並びには影響しない）
    box.append(btn, ' ');
  }
  if (status.key === 'replay') box.appendChild(replayJumpForm());
  if (actions.length === 0) box.textContent = '今押せる操作はありません。';

  // 盤面の文字を作れなくても対局は止めない（このパネルは対局の進行に関わらない）
  let text;
  try {
    text = agentText(status);
  } catch (e) {
    console.error(e);
    text = '盤面の文字を作れませんでした。画面の卓を見て判断してください。';
  }
  el('mj-agent-text').textContent = text;
}

function agentStatus() {
  if (!state) return { key: 'busy', text: '準備中です。' };
  if (replayActive()) {
    return { key: 'replay', text: `この局を一手ずつ振り返っています（${replay.index} / ${state.steps.length - 1}手）。` };
  }
  if (replay && promptResolver) {
    return { key: 'result', text: '局が終わりました。「振り返る」でこの局を一手ずつ見返せます。「次へ」で次の局に進みます。' };
  }
  if (discardResolver) return { key: 'turn', text: '切る牌を選んでください。' };
  if (promptResolver) return { key: 'turn', text: '選択肢から選んでください。' };
  if (state.gameOver) return { key: 'over', text: '「新しい対局を始める」で、もう一度対局できます。' };
  return { key: 'busy', text: '数秒待ってから、このパネルを読み直してください。' };
}

// 今押せる操作 { label, run }
function agentActions(status) {
  if (status.key === 'replay') return replayActions();
  if (status.key === 'over') return [{ label: '新しい対局を始める', run: () => el('mj-new-game').click() }];
  if (discardResolver) return discardActions();
  if (promptResolver && promptChoices) {
    // チーのように同じ名前の選択肢が並ぶことがあるので、鳴いた後の形を名前に添えて区別する
    return promptChoices.map((c) => ({
      label: c.meld ? `${c.label} ${tilesText(c.meld.tiles)}` : c.label,
      run: () => (c.onClick ? c.onClick() : onPromptChoice(c.value)),
    }));
  }
  return [];
}

// 打牌ボタン。並びは画面の手牌と同じ（ツモった牌が最後）。
// 同じ牌が2枚あれば1つにまとめるが、ツモった牌は河での扱い（ツモ切り）が違うので分けて出す
function discardActions() {
  const discardable = state.pending.discardable;
  const { ordered, drawnId } = orderHand(state, 0);
  const seen = new Set();
  const actions = [];
  for (const id of ordered) {
    if (!discardable.includes(id)) continue;
    const label = id === drawnId ? `打 ${tileText(id)}（ツモ切り）` : `打 ${tileText(id)}`;
    if (seen.has(label)) continue;
    seen.add(label);
    actions.push({ label, run: () => commitDiscard(id) });
  }
  return actions;
}

function replayActions() {
  const i = replay.index;
  const last = state.steps.length - 1;
  const actions = [];
  if (i > 0) {
    actions.push({ label: '最初へ', run: () => showReplayStep(0) });
    actions.push({ label: '1手戻る', run: () => showReplayStep(i - 1) });
  }
  if (i < last) {
    actions.push({ label: '1手進む', run: () => showReplayStep(i + 1) });
    actions.push({ label: '最後へ', run: () => showReplayStep(last) });
  }
  actions.push({ label: '結果を見る', run: closeReplay });
  actions.push({ label: '次へ（次の局に進む）', run: () => onPromptChoice(true) });
  return actions;
}

// 手番号を入れて、その手に移る（手番号は盤面の文字の「この局の手順」に書いてある）
function replayJumpForm() {
  const form = document.createElement('form');
  form.className = 'mj-agent-jump';
  const label = document.createElement('label');
  label.appendChild(document.createTextNode('手番号へ移動 '));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(state.steps.length - 1);
  input.value = String(replay.index);
  label.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = '移動';
  form.append(label, btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = Number(input.value);
    if (Number.isInteger(n)) showReplayStep(n);
  });
  return form;
}

// ---------------------------------------------------------------------------
// 盤面の文字
// ---------------------------------------------------------------------------

function agentText(status) {
  if (status.key === 'busy') return '（CPUの手番が終わると、ここに盤面が出ます）';
  if (status.key === 'over') return finalLines().join('\n');
  if (status.key === 'replay') return replayLines().join('\n');
  // あなたの判断待ち・局の結果: 「AIに相談用にコピー」と同じ本文（局の結果では全員の手牌を公開している）
  return AGENT_NOTATION.concat([''], positionBodyLines(buildPositionView())).join('\n');
}

function stepLabel(step) {
  return step.tile === null ? stepText(step) : `${stepText(step)} ${tileText(step.tile)}`;
}

// 振り返り中: 見ている手の盤面（全員の手牌を表にする）と、この局の手順の一覧
function replayLines() {
  const i = replay.index;
  const lines = [`■ 見ている手: ${i}手目 ${stepLabel(state.steps[i])}`];
  const next = state.steps[i + 1];
  if (next) lines.push(`次の手: ${i + 1}手目 ${stepLabel(next)}`);
  lines.push('', ...AGENT_NOTATION.slice(0, 2), '');
  lines.push(...boardLines(boardView(state.steps[i], true)));
  lines.push('', '■ この局の手順（手番号: 動き。→ が見ている手）');
  state.steps.forEach((s, n) => lines.push(`${n === i ? '→' : '　'}${n}: ${stepLabel(s)}`));
  return lines;
}

// 対局終了: 順位・答え合わせの一致数・対局全体の経過
function finalLines() {
  const lines = ['■ 最終結果'];
  state.players
    .map((p, s) => ({ s, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .forEach((r, i) => lines.push(`${i + 1}位 ${seatLabel(r.s)} ${r.score}点`));
  const { reviewStats: d, callReviewStats: c } = state;
  if (d.total > 0 || c.total > 0) {
    lines.push('', `お手本AIとの一致: 打牌 ${d.match}/${d.total}・鳴きの判断 ${c.match}/${c.total}`);
  }
  lines.push('', '■ 対局の経過');
  for (const line of state.eventLog) lines.push(line.startsWith('--- ') ? line : `- ${line}`);
  return lines;
}
