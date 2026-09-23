// エッセイのページを、1つのテンプレートで揃えるためのスクリプト（依存パッケージなし）。
//
//   node scripts/essays.mjs new 下書き.txt
//       下書きのテキストから新しいエッセイのページを作り、一覧と sitemap.xml にも追加する
//   node scripts/essays.mjs
//       すべてのエッセイを点検する。<head>・ヘッダー・フッターなど本文以外の部分はテンプレートどおりに書き直し、
//       一覧（essays/index.html）と sitemap.xml も揃える。本文の書き方の問題は、直さずに指摘だけする
//
// 見た目（フォントや文字の大きさ）は css/style.css の「エッセイ本文ページ」でまとめて決めている。
// ページごとに style="..." などで見た目を変えると揃わなくなるので、本文では下の ALLOWED_TAGS だけを使う。
//
// 下書きの書き方（UTF-8のテキストファイル）:
//
//   タイトル: 効率を楽しむ、非効率を楽しむ
//   フォルダ: two-kinds-of-fun        ← URLになる英語の名前。番号（008- など）は自動で付く
//   日付: 2026-08-31                  ← 省略すると今日
//   説明: 検索結果やSNSに出る1〜2文の要約  ← 省略すると本文の書き出しを使う
//   副題: （あれば）
//
//   ここから本文。1行が1段落になる（空行はあってもなくてもよい）。
//   ## 見出し
//   > 目立たせたい一文（> の行が続くと、1つの枠の中で改行される）
//   - 箇条書き
//   ---                               ← 区切り線
//   **太字** は <strong> になる

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path/posix"; // Windowsでも区切りを / にそろえる

const SITE_URL = "https://hbarcg.github.io";
const ESSAYS_DIR = "essays";
const LIST_PATH = join(ESSAYS_DIR, "index.html");
const SITEMAP_PATH = "sitemap.xml";

// 本文に使ってよいタグ。これ以外（span, font, div の独自クラスなど）は見た目が揃わない原因になる
const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "blockquote", "ul", "ol", "li", "strong", "em", "a", "br", "hr", "code",
  "figure", "figcaption", "img",
  "div", // 対談形式の .turn と、有料記事の .paid だけ（下でクラスを確認する）
]);
const ALLOWED_DIV_CLASSES = ["turn turn-human", "turn turn-ai", "paid"];

// ---------------------------------------------------------------- テンプレート

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// body は、日付の行（essay-meta）の直後から </article> の手前までの本文HTMLをそのまま入れる
function renderEssayPage({ slug, title, date, subtitle, description, body }) {
  const url = `${SITE_URL}/${ESSAYS_DIR}/${slug}/`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const meta = escapeHtml(date) + (subtitle ? " ――" + escapeHtml(subtitle) : "");
  const paidScript = body.includes("<!-- paid:start -->")
    ? `\n  <script src="/js/paid.js" defer></script>`
    : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t} | HbarCG</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="HbarCG">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}/brand/icon-light.png">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="/js/main.js" defer></script>${paidScript}
</head>
<body>
  <div class="page">
    <header class="site-header">
      <p class="site-title"><a href="/"><span class="mark-hb">Hbar</span>CG</a></p>
      <nav class="site-nav">
        <a href="/essays/">Essays</a>
        <a href="/apps/">Apps</a>
        <a href="/about/">About</a>
      </nav>
    </header>

    <main>
      <p class="back-link"><a href="/essays/">← Essays</a></p>

      <article class="essay-body">
        <h1>${t}</h1>
        <p class="essay-meta">${meta}</p>${body}
      </article>
    </main>

    <footer class="site-footer">
      <p>&copy; 2026 HbarCG</p>
    </footer>
  </div>
</body>
</html>
`;
}

// 既存のページから、テンプレートに入れる値を読み取る。見出し（h1）・日付・説明・本文だけが「中身」で、残りは捨てる
function parseEssayPage(html, slug) {
  const h1 = html.match(/<article class="essay-body">\s*<h1>([\s\S]*?)<\/h1>/);
  const meta = html.match(/<p class="essay-meta">([\s\S]*?)<\/p>/);
  const desc = html.match(/<meta name="description" content="([^"]*)">/);
  const body = html.match(/<p class="essay-meta">[\s\S]*?<\/p>([\s\S]*?)\n[ \t]*<\/article>/);
  if (!h1 || !meta || !desc || !body) {
    throw new Error(`${slug}: ページの形が崩れていて、見出し・日付・説明・本文を読み取れません`);
  }
  const [date, ...rest] = unescapeHtml(meta[1].trim()).split(" ――");
  return {
    slug,
    title: unescapeHtml(h1[1].trim()),
    date: date.trim(),
    subtitle: rest.join(" ――").trim(),
    description: unescapeHtml(desc[1]),
    body: body[1].replace(/\s+$/, ""),
  };
}

// ---------------------------------------------------------------- 本文の点検

function lintBody(essay) {
  const problems = [];
  const { body } = essay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(essay.date)) problems.push(`日付が YYYY-MM-DD の形ではありません: ${essay.date}`);
  if (/\sstyle\s*=/.test(body)) problems.push("本文に style=\"...\" があります。見た目は css/style.css で決めるので消してください");
  if (/&nbsp;/.test(body)) problems.push("本文に &nbsp; があります。普通の空白か、段落分けにしてください");

  for (const m of body.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      problems.push(`本文に <${tag}> があります。見た目が揃わなくなるので使わないでください`);
    } else if (tag === "div") {
      const cls = (m[2].match(/class="([^"]*)"/) || [])[1];
      if (!ALLOWED_DIV_CLASSES.includes(cls)) problems.push(`本文に <div class="${cls || ""}"> があります（使えるのは対談の turn と有料記事の paid だけ）`);
    } else if (tag === "p" && /class=/.test(m[2]) && !/class="speaker"/.test(m[2])) {
      problems.push(`本文の <p> に独自のクラスがあります: <p${m[2]}>`);
    }
  }

  // 1つの <p> の中で改行している段落。画面では改行されず、改行の位置に余計な空白が入って1段落につながる
  for (const m of body.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
    const lines = m[1].split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      problems.push(`1つの段落の中で改行しています（画面では1段落につながります）: 「${lines[0].slice(0, 20)}…」`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- 一覧と sitemap

function listEssaySlugs() {
  return readdirSync(ESSAYS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name) && existsSync(join(ESSAYS_DIR, e.name, "index.html")))
    .map((e) => e.name);
}

// 新しい順（日付が同じならフォルダの番号が大きい順）
function sortNewestFirst(essays) {
  return [...essays].sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
}

function renderList(essays) {
  return sortNewestFirst(essays).map((e) => [
    "        <li>",
    `          <a href="/${ESSAYS_DIR}/${e.slug}/">${escapeHtml(e.title)}</a>`,
    `          <time datetime="${e.date}">${e.date}</time>`,
    "        </li>",
  ].join("\n")).join("\n") + "\n";
}

function updateList(essays) {
  const html = readFileSync(LIST_PATH, "utf8");
  const pattern = /(<ul class="essay-list">\n)[\s\S]*?(\n?[ \t]*<\/ul>)/;
  if (!pattern.test(html)) throw new Error(`${LIST_PATH} に <ul class="essay-list"> が見つかりません`);
  const next = html.replace(pattern, (m, open, close) => open + renderList(essays) + close.replace(/^\n/, ""));
  return writeIfChanged(LIST_PATH, html, next);
}

// sitemap は他のページも載っているので、足りないエッセイの行を足すだけにする（消したり並べ替えたりはしない）
function updateSitemap(essays) {
  const xml = readFileSync(SITEMAP_PATH, "utf8");
  const lines = xml.split("\n");
  for (const e of [...essays].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const loc = `${SITE_URL}/${ESSAYS_DIR}/${e.slug}/`;
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    // 一番最後のエッセイの行（なければ一覧ページの行）のすぐ下に足す
    let at = -1;
    lines.forEach((l, i) => { if (l.includes(`${SITE_URL}/${ESSAYS_DIR}/`)) at = i; });
    if (at < 0) throw new Error(`${SITEMAP_PATH} にエッセイ一覧の行が見つかりません`);
    lines.splice(at + 1, 0, `  <url><loc>${loc}</loc></url>`);
  }
  return writeIfChanged(SITEMAP_PATH, xml, lines.join("\n"));
}

function writeIfChanged(path, before, after) {
  if (before === after) return false;
  writeFileSync(path, after);
  return true;
}

// ---------------------------------------------------------------- 点検して揃える

function tidyAll() {
  const essays = [];
  let problemCount = 0;

  for (const slug of listEssaySlugs()) {
    const path = join(ESSAYS_DIR, slug, "index.html");
    const html = readFileSync(path, "utf8");
    let essay;
    try {
      essay = parseEssayPage(html, slug);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      problemCount++;
      continue;
    }
    essays.push(essay);
    if (writeIfChanged(path, html, renderEssayPage(essay))) console.log(`✎ テンプレートに合わせて直しました: ${path}`);
    const problems = lintBody(essay);
    for (const p of problems) console.log(`✗ ${slug}: ${p}`);
    problemCount += problems.length;
  }

  if (updateList(essays)) console.log(`✎ 一覧を更新しました: ${LIST_PATH}`);
  if (updateSitemap(essays)) console.log(`✎ エッセイのURLを追加しました: ${SITEMAP_PATH}`);

  console.log(`エッセイ ${essays.length} 本を点検しました。` +
    (problemCount ? `直してほしいところが ${problemCount} 件あります。` : "問題はありません。"));
  return problemCount === 0;
}

// ---------------------------------------------------------------- 下書きから新しいエッセイを作る

function inline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// 下書きの本文（1行1段落）を、既存のエッセイと同じ書き方のHTMLにする
function draftToBody(lines) {
  const blocks = [];
  let list = null;
  let quote = null;
  const flush = () => {
    if (list) blocks.push(`        <ul>\n${list.map((l) => `          <li>${inline(l)}</li>`).join("\n")}\n        </ul>`);
    if (quote) blocks.push(`        <blockquote><p>${quote.map(inline).join("<br>")}</p></blockquote>`);
    list = quote = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^- /.test(line)) { if (quote) flush(); (list ||= []).push(line.slice(2).trim()); continue; }
    if (/^> ?/.test(line)) { if (list) flush(); (quote ||= []).push(line.replace(/^> ?/, "")); continue; }
    flush();
    if (/^---+$/.test(line)) blocks.push("        <hr>");
    else if (/^## /.test(line)) blocks.push(`        <h2>${inline(line.slice(3).trim())}</h2>`);
    else blocks.push(`        <p>\n          ${inline(line)}\n        </p>`);
  }
  flush();
  return "\n\n" + blocks.join("\n\n");
}

function todayInJapan() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createFromDraft(draftPath) {
  const lines = readFileSync(draftPath, "utf8").replace(/^﻿/, "").split(/\r?\n/);

  // 冒頭の「項目: 値」の行を読む（最初の空行まで）
  const fields = {};
  while (lines.length && lines[0].trim()) {
    const m = lines[0].match(/^\s*(タイトル|フォルダ|日付|説明|副題)\s*[:：]\s*(.*)$/);
    if (!m) break;
    fields[m[1]] = m[2].trim();
    lines.shift();
  }
  if (!fields["タイトル"]) throw new Error("下書きの1行目に「タイトル: …」を書いてください");
  if (!fields["フォルダ"]) throw new Error("下書きに「フォルダ: two-kinds-of-fun」のような英語の名前を書いてください（URLになります）");

  const name = fields["フォルダ"].replace(/^\d{3}-/, "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`フォルダの名前は半角英小文字・数字・ハイフンにしてください: ${name}`);
  const numbers = listEssaySlugs().map((s) => Number(s.slice(0, 3)));
  const slug = String(Math.max(0, ...numbers) + 1).padStart(3, "0") + "-" + name;
  const dir = join(ESSAYS_DIR, slug);
  if (existsSync(dir)) throw new Error(`${dir} はすでにあります`);

  const body = draftToBody(lines);
  const firstParagraph = lines.map((l) => l.trim()).find((l) => l && !/^(##|>|-|---)/.test(l)) || "";
  const plainFirst = firstParagraph.replace(/\*\*/g, "");
  const essay = {
    slug,
    title: fields["タイトル"],
    date: fields["日付"] || todayInJapan(),
    subtitle: fields["副題"] || "",
    description: fields["説明"] || (plainFirst.length > 100 ? plainFirst.slice(0, 100) + "…" : plainFirst),
    body,
  };
  const problems = lintBody(essay);
  if (problems.some((p) => p.startsWith("日付"))) throw new Error(problems[0]);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), renderEssayPage(essay));
  console.log(`＋ 新しいエッセイを作りました: ${dir}/index.html`);
  console.log(`  公開後のURL: ${SITE_URL}/${ESSAYS_DIR}/${slug}/`);
}

// ---------------------------------------------------------------- 実行

try {
  const [command, arg] = process.argv.slice(2);
  if (command === "new") {
    if (!arg) throw new Error("使い方: node scripts/essays.mjs new 下書き.txt");
    createFromDraft(arg);
  } else if (command) {
    throw new Error(`知らないコマンドです: ${command}`);
  }
  process.exitCode = tidyAll() ? 0 : 1;
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
