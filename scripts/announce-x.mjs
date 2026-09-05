// 新しいエッセイが essays/ 配下に追加されたとき、Xに自動投稿するスクリプト。
// GitHub Actions (.github/workflows/announce-x.yml) から実行される。
// 依存パッケージなし（Node組み込みモジュールのみ）。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildOAuthHeader, getCredentialsFromEnv } from "./x-oauth.mjs";
import { appendCostEntry } from "./costs-ledger.mjs";

// URLを含む投稿の単価。X側の料金が変わったら更新すること。
// 参考: https://docs.x.com/x-api/getting-started/pricing
const COST_PER_POST_WITH_URL_USD = 0.2;

const SITE_URL = "https://HbarCG.github.io";

const beforeSha = process.env.BEFORE_SHA || "";
const afterSha = process.env.AFTER_SHA || "";

if (!afterSha || !beforeSha || /^0+$/.test(beforeSha)) {
  console.log("[announce-x] 初回push、または比較元コミットがないため、投稿をスキップします。");
  process.exit(0);
}

const { credentials, missing } = getCredentialsFromEnv();
if (!credentials) {
  console.log(`[announce-x] 未設定のSecretsがあるため、投稿をスキップします: ${missing.join(", ")}`);
  process.exit(0);
}

function newlyAddedEssayIndexFiles() {
  const diffOutput = execFileSync(
    "git",
    ["diff", "--name-status", beforeSha, afterSha, "--", "essays/"],
    { encoding: "utf8" }
  );

  return diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("A\t") && line.endsWith("/index.html"))
    .map((line) => line.slice(2))
    .filter((path) => path !== "essays/index.html");
}

function unescapeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractEssayInfo(path) {
  const html = readFileSync(path, "utf8");
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);

  const title = titleMatch ? unescapeHtml(titleMatch[1].trim()) : "";
  const description = descMatch ? unescapeHtml(descMatch[1].trim()) : "";
  const slug = path.replace(/^essays\//, "").replace(/\/index\.html$/, "");
  const url = `${SITE_URL}/essays/${slug}/`;

  return { title, description, url };
}

// Xの文字数カウント方式(CJKは重み2)を簡易的に近似し、安全側に切り詰める。
function weightedLength(str) {
  let length = 0;
  for (const ch of str) {
    length += ch.codePointAt(0) > 0x2e00 ? 2 : 1;
  }
  return length;
}

function truncateToWeight(str, maxWeight) {
  let result = "";
  let length = 0;
  for (const ch of str) {
    const w = ch.codePointAt(0) > 0x2e00 ? 2 : 1;
    if (length + w > maxWeight) {
      return result + "…";
    }
    result += ch;
    length += w;
  }
  return result;
}

function buildTweetText({ title, description }) {
  // URLはt.coで23文字換算される前提で、本文側は200を上限に抑える。
  const header = "新しいエッセイを公開しました。";
  const titleLine = `「${title}」`;
  const budgetForDescription = 200 - weightedLength(header) - weightedLength(titleLine) - 4;
  const desc = truncateToWeight(description, Math.max(budgetForDescription, 0));
  return [header, titleLine, desc].filter(Boolean).join("\n\n");
}

async function postTweet(text) {
  const url = "https://api.x.com/2/tweets";
  const authHeader = buildOAuthHeader({ url, method: "POST", credentials });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API error ${response.status}: ${body}`);
  }

  console.log(`[announce-x] 投稿完了: ${text}`);
}

const newEssays = newlyAddedEssayIndexFiles();

if (newEssays.length === 0) {
  console.log("[announce-x] 新しいエッセイはありません。");
  process.exit(0);
}

for (const path of newEssays) {
  const info = extractEssayInfo(path);
  const text = `${buildTweetText(info)}\n\n${info.url}`;
  await postTweet(text);
  appendCostEntry({
    category: "X API",
    amountUsd: COST_PER_POST_WITH_URL_USD,
    note: `告知投稿: ${info.title}`,
  });
}
