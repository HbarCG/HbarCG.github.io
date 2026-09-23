'use strict';

/*
 * 今の局面を文字で書き出す（途中経過をAIや人に相談するため）。
 * 牌の表記は一般的な「mpsz表記」に寄せる:
 *   萬子=m 筒子=p 索子=s。同じ色の数牌は数字を続けて書く（例: 123m4056p）。赤5は 0。
 *   字牌は読みやすさを優先して漢字（東南西北白發中）で書く。
 * このファイルは状態を持たない純粋関数のみで構成し、盤面の情報は game.js から受け取る。
 * 見えていない情報（他家の手牌・山・裏ドラ）は、game.js が局の終わりまで渡さない。
 *
 * 書き出す内容（上から順に）:
 *   盤面（全員の点数・河・副露、自分の手牌） / この局の経過 / あなたのこの局の記録（配牌とツモ・打牌の流れ） /
 *   アプリの計算（向聴数・受け入れ・待ち・危険度。AIチャットは数え間違えやすいので、計算した値を渡す） /
 *   直前の打牌とお手本AIの比較 / いま判断すること / 質問（状況に合わせて1つ選ぶ）
 */

function tileText(id) {
  const type = tileType(id);
  if (isHonorType(type)) return tileTypeLabel(type);
  const digit = isRedFive(id) ? 0 : rankOfType(type);
  return `${digit}${suitOfType(type)}`;
}

// 牌の並びを牌種順に並べ替えて「123m4056p78s東東白」の形にまとめる
function tilesText(ids) {
  let out = '';
  let digits = '';
  let suit = null;
  const flush = () => {
    if (digits) out += digits + suit;
    digits = '';
  };
  for (const id of sortTilesByType(ids)) {
    const type = tileType(id);
    if (isHonorType(type)) {
      flush();
      suit = null;
      out += tileTypeLabel(type);
      continue;
    }
    const s = suitOfType(type);
    if (s !== suit) {
      flush();
      suit = s;
    }
    digits += isRedFive(id) ? '0' : String(rankOfType(type));
  }
  flush();
  return out;
}

// 河の1枚。ツモ切りは ' を付け、リーチ宣言牌・鳴かれた牌は [] で書き添える
function discardText(d) {
  let text = tileText(d.tile);
  if (d.tsumogiri) text += "'";
  if (d.sideways) text += '[リーチ]';
  if (d.calledByName) text += `[${d.calledByName}が鳴き]`;
  return text;
}

function meldText(m) {
  const from = m.fromName ? `（${m.fromName}から）` : '';
  return `${m.label} ${tilesText(m.tiles)}${from}`;
}

// view: game.js の buildPositionView() が作る、見えている情報だけをまとめたもの
function buildPositionText(view) {
  const lines = [];
  lines.push('麻雀の練習中です。次の局面について、先生として教えてください（最後の「質問」に答えてください）。');
  lines.push('');
  lines.push('麻雀の局面（4人打ち・東風戦・赤5あり）');
  lines.push(`${view.roundLabel} ${view.honba}本場 供託${view.kyotaku} ／ 山の残り${view.wallRemaining}枚`);
  const dora = view.doraIndicators.map((id) => tileTypeLabel(doraTypeFromIndicator(id)));
  lines.push(`ドラ表示牌: ${view.doraIndicators.map(tileText).join(' ')}（ドラ: ${dora.join(' ')}）`);
  lines.push("表記: m=萬子 p=筒子 s=索子、0=赤5。河の ' はツモ切り、[リーチ] はリーチ宣言牌、[〇〇が鳴き] は鳴かれた牌");
  if (view.revealed) lines.push('※この局は終了しています。全員の手牌を公開しています。');

  for (const p of view.players) {
    lines.push('');
    const turn = p.turn === 0 ? 'まだ手番なし' : `${p.turn}巡目`;
    const tags = [`${p.wind}家${p.isDealer ? '・親' : ''}`, `${p.score}点`, turn];
    if (p.riichi) tags.push('リーチ中');
    lines.push(`■ ${p.name}（${tags.join('・')}）`);
    if (p.hand) {
      const drawn = p.drawnTile === null ? '' : ` ＋ツモ ${tileText(p.drawnTile)}`;
      const rest = p.drawnTile === null ? p.hand : removeOne(p.hand, p.drawnTile);
      lines.push(`手牌: ${tilesText(rest)}${drawn}`);
    }
    if (p.status) lines.push(`状況: ${p.status}`);
    lines.push(`副露: ${p.melds.length === 0 ? 'なし' : p.melds.map(meldText).join(' ／ ')}`);
    lines.push(`河: ${p.discards.length === 0 ? 'なし' : p.discards.map(discardText).join(' ')}`);
  }

  if (view.log.length > 0) {
    lines.push('');
    lines.push('この局の経過:');
    for (const line of view.log) lines.push(`- ${line}`);
  }

  lines.push('');
  lines.push(...recordLines(view.record));
  if (view.analysis) {
    lines.push('');
    lines.push(...analysisLines(view.analysis));
  }
  if (view.lastReview) {
    lines.push('');
    lines.push(...lastReviewLines(view.lastReview));
  }
  lines.push('');
  if (view.pending) {
    const choices = view.pending.choices ? `（選択肢: ${view.pending.choices.join('／')}）` : '';
    lines.push(`■ いま判断すること: ${view.pending.text}${choices}`);
  }
  lines.push(`■ 質問: ${adviceQuestion(view)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// あなたのこの局の記録（振り返り用）
// ---------------------------------------------------------------------------

function actionText(a) {
  switch (a.kind) {
    case 'draw': return `ツモ${tileText(a.tile)}`;
    case 'rinshan': return `嶺上ツモ${tileText(a.tile)}`;
    case 'call': return `${a.label}${tilesText(a.tiles)}（${a.fromName}から）`;
    case 'kan': return `${a.label}${tilesText(a.tiles)}`;
    case 'riichi': return 'リーチ宣言';
    case 'discard': return `打${tileText(a.tile)}${a.tsumogiri ? "'" : ''}`;
    default: return '';
  }
}

function recordLines(record) {
  const lines = ['■ あなたのこの局の記録（1巡＝ツモか鳴きから打牌まで。（）はお手本AIの打牌）'];
  lines.push(`配牌: ${tilesText(record.haipai)}`);
  record.turns.forEach((turn, i) => {
    let text = `${i + 1}巡目: ${turn.actions.map(actionText).join(' → ')}`;
    if (turn.review) text += turn.review.same ? '（お手本AIと同じ）' : `（お手本AIは打${tileText(turn.review.aiTile)}）`;
    lines.push(text);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// アプリの計算（向聴数・受け入れ・待ち・危険度）
// ---------------------------------------------------------------------------

function shantenText(shanten) {
  return shanten === 0 ? '聴牌' : `${shanten}向聴`;
}

// 受け入れ（引くと向聴数が進む牌）: 「5種15枚（14p6s西）」
function ukeireText(ukeire) {
  const tiles = tilesText(ukeire.types.map((t) => t * 4 + 1));
  return `受け入れ${ukeire.types.length}種${ukeire.total}枚（${tiles}）`;
}

// 待ち: 「待ち3s（残り2枚）6s（残り3枚）」と、待ちごとの和了したときの役（字下げした行）。
// どの待ちで和了しても役と翻が同じなら、1行にまとめる
function waitLines(waits, furiten, indent) {
  const head = `待ち${waits.map((w) => `${tileText(w.type * 4 + 1)}（残り${w.left}枚）`).join('')}`
    + (furiten ? '・フリテン（ロン不可）' : '');
  const winText = (w) => `ロン ${w.ron}／ツモ ${w.tsumo}`;
  const allSame = waits.every((w) => winText(w) === winText(waits[0]));
  const details = allSame && waits.length > 1
    ? [`${indent}どの待ちで和了しても: ${winText(waits[0])}`]
    : waits.map((w) => `${indent}${tileText(w.type * 4 + 1)}で和了: ${winText(w)}`);
  return { head, details };
}

function analysisLines(a) {
  const lines = ['■ アプリの計算（見えている情報だけから機械的に計算した値です。向聴数・受け入れ枚数・残り枚数はこの値を正としてください）'];
  lines.push('※残り枚数＝あなたから見えていない枚数（他家の手の中にある分も含む）。お手本AI＝このアプリの一番強い設定のCPU');
  if (a.phase === 'wait') {
    if (a.shanten > 0) {
      lines.push(`あなたの手: ${shantenText(a.shanten)}・${ukeireText(a.ukeire)}`);
    } else {
      const w = waitLines(a.waits, a.furiten, '  ');
      lines.push(`あなたの手: 聴牌・${w.head}`, ...w.details);
    }
    return lines;
  }

  if (a.complete) lines.push('あなたの手: 和了形です');
  lines.push('打牌の候補（打牌後の向聴数と受け入れ。先頭がお手本AIの選択、残りは向聴数→受け入れ枚数の順）:');
  for (const c of a.candidates) {
    const parts = [shantenText(c.shanten)];
    const details = [];
    if (c.waits) {
      const w = waitLines(c.waits, c.furiten, '    ');
      parts.push(w.head);
      details.push(...w.details);
    } else {
      parts.push(ukeireText(c.ukeire));
    }
    if (c.danger !== null) parts.push(`危険度: ${c.danger}`);
    lines.push(`- 打${tileText(c.tile)}${c.isAi ? '【お手本AIの選択】' : ''}: ${parts.join('・')}`, ...details);
  }
  if (a.threats.length > 0) lines.push(`お手本AIが警戒している相手: ${a.threats.join('・')}`);
  return lines;
}

function lastReviewLines(r) {
  const side = (d) => `打${tileText(d.tile)}（打牌後${shantenText(d.shanten)}・${ukeireText(d.ukeire)}）`;
  return [
    '■ 直前のあなたの打牌とお手本AIの比較',
    `あなた: ${side(r.mine)}`,
    `お手本AI: ${side(r.ai)}`,
    `アプリの説明: ${r.reason}`,
  ];
}

// ---------------------------------------------------------------------------
// 質問（今の状況から、AIに聞くことを1つ選ぶ）
// ---------------------------------------------------------------------------

function adviceQuestion(view) {
  if (view.revealed) {
    return 'この局のあなたの打ち方（記録とお手本AIとの違い）を振り返って、良かった点と改善できる点を教えてください。';
  }
  const p = view.pending;
  if (p && p.discard) {
    return p.riichi
      ? 'リーチを宣言しました。どの牌を切ってリーチするのがよいか、理由とあわせて教えてください。'
      : 'この局面で何を切るべきか、理由とあわせて教えてください。';
  }
  if (p) {
    const then = p.thenDiscard ? 'あわせて、切る牌も教えてください。' : '';
    return `「${p.choices.join('」「')}」のどれを選ぶべきか、理由とあわせて教えてください。${then}`;
  }
  if (view.lastReview) {
    return '直前のあなたの打牌とお手本AIの打牌は、どちらがよかったか、なぜかを解説してください。';
  }
  return '今の局面をどう見ればよいか（攻めるか守るか、何に気をつけるか）を教えてください。';
}

function removeOne(ids, id) {
  const rest = ids.slice();
  const idx = rest.indexOf(id);
  if (idx !== -1) rest.splice(idx, 1);
  return rest;
}
