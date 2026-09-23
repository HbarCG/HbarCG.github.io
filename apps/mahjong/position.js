'use strict';

/*
 * 今の局面を文字で書き出す（途中経過をAIや人に相談するため）。
 * 牌の表記は一般的な「mpsz表記」に寄せる:
 *   萬子=m 筒子=p 索子=s。同じ色の数牌は数字を続けて書く（例: 123m4056p）。赤5は 0。
 *   字牌は読みやすさを優先して漢字（東南西北白發中）で書く。
 * このファイルは状態を持たない純粋関数のみで構成し、盤面の情報は game.js から受け取る。
 * 見えていない情報（他家の手牌・山・裏ドラ）は、game.js が局の終わりまで渡さない。
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
  return lines.join('\n');
}

function removeOne(ids, id) {
  const rest = ids.slice();
  const idx = rest.indexOf(id);
  if (idx !== -1) rest.splice(idx, 1);
  return rest;
}
