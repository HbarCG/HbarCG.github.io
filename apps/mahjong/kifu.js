'use strict';

/*
 * 天鳳のmjlogタグ形式に「寄せた」棋譜テキストを生成する。
 * 完全互換・天鳳ビューアでの読み込みは目指さない。差分は KIFU_HEADER_COMMENT に明記する。
 *
 * 差分（意図的な簡略化）:
 *   - プレイヤー名はパーセントエンコードしない
 *   - ツモ切りは天鳳の「+100オフセット」ではなく t="1" 属性で表現する
 *   - 鳴き(N)は天鳳の不透明なビット圧縮整数ではなく type/tiles/from 属性で表現する
 *   - 和了(AGARI)のyaku IDは本実装独自のYAKU_IDテーブルを使用する
 *   - 通常の流局のみ出力し、途中流局系(四槓散了等)は扱わない
 */

const KIFU_HEADER_COMMENT =
  '<!-- 天鳳mjlog形式に寄せた棋譜（完全互換ではありません。差分は apps/mahjong/kifu.js 参照） -->';

const DRAW_TAGS = ['T', 'U', 'V', 'W'];
const DISCARD_TAGS = ['D', 'E', 'F', 'G'];

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function kifuHeader(names) {
  const un = names.map((n, i) => `n${i}="${escapeAttr(n)}"`).join(' ');
  return [
    KIFU_HEADER_COMMENT,
    '<mjloggm ver="2.3">',
    '<GO type="0" lobby="0"/>',
    `<UN ${un}/>`,
    '<TAIKYOKU oya="0"/>',
  ].join('\n');
}

function kifuFooter() {
  return '</mjloggm>';
}

function kifuInit({ kyoku, honba, kyotaku, doraIndicators, scores, oya, hands }) {
  const seed = [kyoku, honba, kyotaku, doraIndicators[0], 0, 0].join(',');
  const ten = scores.join(',');
  const haiAttrs = hands.map((h, i) => `hai${i}="${h.join(',')}"`).join(' ');
  return `<INIT seed="${seed}" ten="${ten}" oya="${oya}" ${haiAttrs}/>`;
}

function kifuDraw(seat, tileId) {
  return `<${DRAW_TAGS[seat]}${tileId}/>`;
}

function kifuDiscard(seat, tileId, tsumogiri) {
  const t = tsumogiri ? ' t="1"' : '';
  return `<${DISCARD_TAGS[seat]}${tileId}${t}/>`;
}

function kifuCall(who, kind, tiles, from) {
  return `<N who="${who}" type="${kind}" tiles="${tiles.join(',')}" from="${from}"/>`;
}

function kifuReachStep1(who) {
  return `<REACH who="${who}" step="1"/>`;
}

function kifuReachStep2(who, scores) {
  return `<REACH who="${who}" step="2" ten="${scores.join(',')}"/>`;
}

function kifuDora(tileId) {
  return `<DORA hai="${tileId}"/>`;
}

function kifuAgari({ who, fromWho, handTiles, melds, machi, fu, points, limitName, yakuList, doraHan, akaHan, uraDoraHan, scoreDeltas }) {
  const yakuAttr = yakuList.map(([name]) => YAKU_ID[nameToKey(name)] || 0).join(',');
  const meldTiles = melds.flatMap((m) => m.tiles);
  const haiAll = handTiles.concat(meldTiles).join(',');
  const limitFlag = limitName ? escapeAttr(limitName) : '';
  return `<AGARI who="${who}" fromWho="${fromWho}" hai="${haiAll}" machi="${machi}" ten="${fu},${points},${limitFlag}" yaku="${yakuAttr}" dora="${doraHan}" doraAka="${akaHan}" doraUra="${uraDoraHan}" sc="${scoreDeltas.join(',')}"/>`;
}

function nameToKey(jpName) {
  const map = {
    '門前清自摸和': 'menzenTsumo', 'リーチ': 'riichi', '一発': 'ippatsu',
    'タンヤオ': 'tanyao', '平和': 'pinfu', '役牌': 'yakuhai',
    '混一色': 'honitsu', '清一色': 'chinitsu', '対々和': 'toitoi',
    '混全帯幺九': 'chanta', '純全帯幺九': 'junchan', '一盃口': 'iipeikou',
    '三色同順': 'sanshokuDoujun', '三色同刻': 'sanshokuDoukou', '一気通貫': 'ittsu',
    '七対子': 'chiitoitsu', '国士無双': 'kokushi', '国士無双十三面': 'kokushi',
    '四暗刻': 'suuankou', '四暗刻単騎': 'suuankou', '大三元': 'daisangen',
  };
  return map[jpName] || jpName;
}

function kifuRyuukyoku({ kyoku, honba, scoreDeltas, tenpaiSeats }) {
  const ba = `${kyoku},${honba}`;
  return `<RYUUKYOKU ba="${ba}" sc="${scoreDeltas.join(',')}" tenpai="${tenpaiSeats.join(',')}"/>`;
}

function buildKifuText(lines) {
  return lines.join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // フォールバックへ
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    return false;
  }
}
