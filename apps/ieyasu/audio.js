// 家康の憂鬱（試作版）の音。音のファイルは使わず、ブラウザの Web Audio API でその場で音を作る。
// 音ははじめは切ってあり、上の帯の「音」ボタンで入れる（設定はこの端末のブラウザに覚えさせる）。
// ブラウザは、人がボタンを押す前に音を鳴らすことを禁じているので、ボタンを押したときに初めて音の仕組みを起こす。
//
//   IEYASU_AUDIO.cue('select')    … 効果音や短い節を鳴らす（名前は下の CUES を参照）
//   IEYASU_AUDIO.phrase('calm')   … 場面の頭に流す、琴の短い調べ（'calm' 陽音階 / 'worry' 都節）
//   IEYASU_AUDIO.setOn(true)      … 音を入れる・切る
//   IEYASU_AUDIO.isOn()           … いま音が入っているか
window.IEYASU_AUDIO = (() => {
  'use strict';

  const KEY = 'ieyasu-sound';
  const VOLUME = 0.35;   // 全体の音量（読む邪魔をしないよう控えめに）

  // 音階（Hz）。陽音階はレミソラシ、都節はミファラシド
  const SCALES = {
    calm: [293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.26, 783.99],
    worry: [329.63, 349.23, 440.0, 493.88, 523.25, 659.26, 698.46, 880.0],
  };

  let ctx = null;
  let master = null;
  let on = false;
  const kotoCache = new Map();

  try {
    on = localStorage.getItem(KEY) === '1';
  } catch (e) {
    on = false;
  }

  // 音の仕組みを起こす（ボタンを押したときだけ呼ぶ）
  function wake() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function ready() {
    return on && ctx && ctx.state !== 'closed';
  }

  // ─────────────────────────────── 楽器

  // 琴の爪弾き。短いノイズを、少しずつ丸めながらくり返す計算（Karplus-Strong）で弦の音を作る。
  // 音を遅らせて戻す仕組み（DelayNode）で作ると高い音が出せないので、波を先に計算しておく。音程ごとに作って使い回す
  function kotoBuffer(freq) {
    const key = Math.round(freq * 10);
    if (kotoCache.has(key)) return kotoCache.get(key);
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 1.8);
    const buffer = ctx.createBuffer(1, length, rate);
    const out = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(rate / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let prev = 0;
    for (let i = 0; i < length; i++) {
      const j = i % period;
      const next = (ring[j] + ring[(j + 1) % period]) * 0.5 * 0.996;
      // 爪の当たる音を少し残すため、最初の一瞬は丸めを弱める
      ring[j] = i < period * 2 ? (ring[j] * 0.3 + next * 0.7) : next;
      prev = prev * 0.2 + ring[j] * 0.8;
      out[i] = prev;
    }
    // 低い音は鳴り終わる前に切れてプツッとしないよう、終わりの0.3秒で消していく
    const fade = Math.floor(rate * 0.3);
    for (let i = 0; i < fade; i++) out[length - fade + i] *= 1 - i / fade;
    kotoCache.set(key, buffer);
    return buffer;
  }

  function koto(freq, when = 0, gain = 0.5) {
    const src = ctx.createBufferSource();
    src.buffer = kotoBuffer(freq);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(ctx.currentTime + when);
  }

  // 短いノイズ（拍子木・太鼓・息の材料）
  function noise(seconds) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  // 拍子木：高く乾いた打音
  function clack(when = 0, gain = 0.6) {
    const t = ctx.currentTime + when;
    const src = noise(0.08);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(band).connect(g).connect(master);
    src.start(t);
    // 木の鳴り（短いサイン波）
    const osc = ctx.createOscillator();
    osc.frequency.value = 1150;
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(og).connect(master);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // 太鼓：低い音の高さを一気に下げ、皮を打つノイズを少し混ぜる
  function taiko(when = 0, gain = 0.45) {
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.85);
    const src = noise(0.12);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(low).connect(ng).connect(master);
    src.start(t);
  }

  // りん：鐘の倍音（整数倍でない倍音）を重ね、長く減らしていく
  function rin(freq = 880, when = 0, gain = 0.35) {
    const t = ctx.currentTime + when;
    [[1, 1, 3.2], [2.76, 0.5, 1.8], [5.4, 0.25, 0.9], [8.9, 0.12, 0.5]].forEach(([ratio, amp, decay]) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    });
  }

  // 尺八ふうの息：帯域を絞ったノイズと、ゆれるサイン波
  function breath(freq = 392, when = 0, seconds = 2.2, gain = 0.25) {
    const t = ctx.currentTime + when;
    const src = noise(seconds + 0.2);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq * 2;
    band.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(gain * 0.5, t + 0.35);
    ng.gain.linearRampToValueAtTime(0.0001, t + seconds);
    src.connect(band).connect(ng).connect(master);
    src.start(t);
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = freq * 0.012;
    lfo.connect(depth).connect(osc.frequency);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(gain * 0.6, t + 0.4);
    og.gain.linearRampToValueAtTime(0.0001, t + seconds);
    osc.connect(og).connect(master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + seconds + 0.1);
    lfo.stop(t + seconds + 0.1);
  }

  // ─────────────────────────────── 効果音と短い節

  const S = SCALES;
  const CUES = {
    select: () => koto(S.calm[5], 0, 0.45),                     // 選択肢を選んだ
    next: () => koto(S.calm[3], 0, 0.25),                       // せりふを送った
    fail: () => { koto(S.worry[2], 0, 0.45); koto(S.worry[1], 0.18, 0.4); },   // しくじった
    year: () => { clack(0); clack(0.16, 0.5); },                // 年を越した（拍子木）
    good: () => [0, 1, 2, 4].forEach((n, i) => koto(S.calm[n + 2], i * 0.12, 0.4)),   // 良い年・勝ち
    bad: () => [4, 3, 1, 0].forEach((n, i) => koto(S.worry[n], i * 0.16, 0.4)),      // 赤字・負け
    star: () => { rin(1046.5, 0, 0.3); [0, 2, 4, 5, 7].forEach((n, i) => koto(S.calm[n], 0.3 + i * 0.1, 0.35)); },   // ★の高い若君
    honor: () => rin(880, 0, 0.35),                             // 栄誉
    drum: () => { taiko(0); taiko(0.5, 0.35); taiko(0.75, 0.45); },   // 試練・異国船・危機
    over: () => { breath(329.63, 0, 2.6); [3, 2, 1, 0].forEach((n, i) => koto(S.worry[n], 1.2 + i * 0.4, 0.3)); },  // 倒幕
    ending: () => { rin(659.26, 0, 0.3); [0, 1, 2, 3, 4, 5, 6, 7].forEach((n, i) => koto(S.calm[n], 0.4 + i * 0.13, 0.35)); },  // 黒船を退けた
  };

  function cue(name) {
    if (!ready() || !CUES[name]) return;
    try {
      CUES[name]();
    } catch (e) {
      // 音が鳴らなくても遊べるようにする
    }
  }

  // 場面の調べ：音階の中を、となりの音へ歩くように8音ほど。毎回少しずつ違う
  function phrase(mood = 'calm') {
    if (!ready()) return;
    const scale = SCALES[mood] || SCALES.calm;
    const beat = mood === 'worry' ? 0.42 : 0.32;
    let i = Math.floor(Math.random() * 3) + 2;
    try {
      for (let n = 0; n < 8; n++) {
        koto(scale[i], n * beat, n === 0 ? 0.4 : 0.28);
        const step = Math.random() < 0.5 ? -1 : 1;
        i = Math.max(0, Math.min(scale.length - 1, i + step * (Math.random() < 0.25 ? 2 : 1)));
      }
      if (mood === 'worry') koto(scale[0] / 2, 8 * beat, 0.35);
    } catch (e) {
      // 音が鳴らなくても遊べるようにする
    }
  }

  function setOn(value) {
    on = Boolean(value) && wake();
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch (e) {
      // 覚えさせられなくても、この場では鳴らせる
    }
    if (on) cue('honor');
    return on;
  }

  // 前に音を入れていた人は、最初にどこかを押したときに音の仕組みを起こす（ブラウザの決まりで、押す前は鳴らせない）
  if (on) {
    const first = () => { wake(); window.removeEventListener('pointerdown', first); window.removeEventListener('keydown', first); };
    window.addEventListener('pointerdown', first);
    window.addEventListener('keydown', first);
  }

  return { cue, phrase, setOn, isOn: () => on, names: Object.keys(CUES) };
})();
