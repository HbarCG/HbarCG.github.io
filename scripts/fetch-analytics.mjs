// サイトの集客の数字を月ごとに取得し、data/analytics/YYYY-MM.json に保存して、要約をメールで送る。
// GitHub Actions (.github/workflows/monthly-analytics.yml) から毎月4日に実行される。
// 依存パッケージなし（Node組み込みモジュールのみ）。
//
// 取得するもの:
//   - Google Search Console: 検索での表示回数・クリック数・検索された言葉・ページ別の数字
//   - Cloudflare Web Analytics: ページ別の閲覧数・訪問数・どこから来たか（リファラー）
//
// どちらも、必要なSecretsが未設定ならその部分だけスキップする。
// 使い方: node scripts/fetch-analytics.mjs          … 前月分
//         TARGET_MONTH=2026-09 node scripts/fetch-analytics.mjs

import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { previousMonthKey } from "./costs-ledger.mjs";
import { sendEmail } from "./send-email.mjs";

const SITE_URL = "https://hbarcg.github.io/"; // Search Console に登録したプロパティのURL（URLプレフィックス）
const OUTPUT_DIR = "data/analytics";
const TOP_N = 50; // 言葉・ページ・リファラーは上位何件まで保存するか

const monthKey = process.env.TARGET_MONTH || previousMonthKey();
if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error(`TARGET_MONTH の形式が不正です: ${monthKey}`);
const [year, month] = monthKey.split("-").map(Number);
const startDate = `${monthKey}-01`;
const endDate = `${monthKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------- Google Search Console

// サービスアカウントの鍵で署名したJWTを、Googleのアクセストークンに交換する
async function getGoogleAccessToken(serviceAccount) {
  const base64url = (value) => Buffer.from(value).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(serviceAccount.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Googleの認証に失敗しました: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function querySearchConsole(accessToken, dimensions) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: TOP_N }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Search Console の取得に失敗しました: ${JSON.stringify(data)}`);
  return (data.rows || []).map((row) => ({
    ...(row.keys ? { key: row.keys[0] } : {}),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 1000) / 10, // %（小数1桁）
    position: Math.round(row.position * 10) / 10, // 平均掲載順位
  }));
}

async function fetchSearchConsole() {
  const json = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!json) {
    console.log("[analytics] GSC_SERVICE_ACCOUNT_JSON が未設定のため、Search Console はスキップします。");
    return null;
  }
  const token = await getGoogleAccessToken(JSON.parse(json));
  const [totals] = await querySearchConsole(token, []);
  return {
    totals: totals || { clicks: 0, impressions: 0, ctr: 0, position: null },
    queries: await querySearchConsole(token, ["query"]),
    pages: await querySearchConsole(token, ["page"]),
  };
}

// ---------------------------------------------------------------- Cloudflare Web Analytics

async function fetchWebAnalytics() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const siteTag = process.env.CLOUDFLARE_SITE_TAG;
  if (!apiToken || !accountId || !siteTag) {
    console.log("[analytics] Cloudflare のSecretsが未設定のため、Web Analytics はスキップします。");
    return null;
  }
  // GraphQLに直接埋め込むので、想定外の文字が入っていないか確かめておく
  if (!/^[0-9a-f]+$/i.test(accountId) || !/^[0-9a-f]+$/i.test(siteTag)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID または CLOUDFLARE_SITE_TAG の形式が不正です");
  }

  const filter = `{ AND: [{ datetime_geq: "${startDate}T00:00:00Z", datetime_leq: "${endDate}T23:59:59Z" }, { siteTag: "${siteTag}" }] }`;
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        totals: rumPageloadEventsAdaptiveGroups(limit: 1, filter: ${filter}) {
          count
          sum { visits }
        }
        pages: rumPageloadEventsAdaptiveGroups(limit: ${TOP_N}, filter: ${filter}, orderBy: [count_DESC]) {
          count
          sum { visits }
          dimensions { requestPath }
        }
        referrers: rumPageloadEventsAdaptiveGroups(limit: ${TOP_N}, filter: ${filter}, orderBy: [count_DESC]) {
          count
          sum { visits }
          dimensions { refererHost }
        }
      }
    }
  }`;

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok || data.errors?.length) {
    throw new Error(`Cloudflare Web Analytics の取得に失敗しました: ${JSON.stringify(data.errors || data)}`);
  }
  const account = data.data.viewer.accounts[0];
  const toRow = (key) => (group) => ({
    key: group.dimensions[key] || "(直接・不明)",
    pageViews: group.count,
    visits: group.sum.visits,
  });
  const [totals] = account.totals;
  return {
    totals: { pageViews: totals?.count || 0, visits: totals?.sum.visits || 0 },
    pages: account.pages.map(toRow("requestPath")),
    referrers: account.referrers.map(toRow("refererHost")),
  };
}

// ---------------------------------------------------------------- 保存とメール

function buildSummary(result) {
  const lines = [`HbarCG 月次アクセスレポート（${monthKey}）`, ""];
  const top = (rows, format) => rows.slice(0, 10).map((row) => `  ${format(row)}`);

  const web = result.webAnalytics;
  lines.push("■ 閲覧（Cloudflare Web Analytics）");
  if (web) {
    lines.push(`  閲覧数 ${web.totals.pageViews} ／ 訪問数 ${web.totals.visits}`, "", " よく読まれたページ:");
    lines.push(...top(web.pages, (r) => `${r.pageViews}  ${r.key}`), "", " どこから来たか:");
    lines.push(...top(web.referrers, (r) => `${r.visits}  ${r.key}`));
  } else {
    lines.push("  未設定のため取得していません。");
  }
  lines.push("");

  const gsc = result.searchConsole;
  lines.push("■ Google検索（Search Console）");
  if (gsc) {
    const t = gsc.totals;
    lines.push(`  表示回数 ${t.impressions} ／ クリック数 ${t.clicks} ／ クリック率 ${t.ctr}% ／ 平均順位 ${t.position ?? "-"}`);
    lines.push("", " 検索された言葉（表示回数・クリック数）:");
    lines.push(...top(gsc.queries, (r) => `${r.impressions}回表示・${r.clicks}クリック  ${r.key}`));
  } else {
    lines.push("  未設定のため取得していません。");
  }
  lines.push("", `詳細: ${OUTPUT_DIR}/${monthKey}.json`);
  return lines.join("\n");
}

const result = {
  month: monthKey,
  period: { start: startDate, end: endDate },
  fetchedAt: new Date().toISOString(),
  searchConsole: await fetchSearchConsole(),
  webAnalytics: await fetchWebAnalytics(),
};

if (!result.searchConsole && !result.webAnalytics) {
  console.log("[analytics] どちらも未設定のため、何も保存せずに終了します。");
  process.exit(0);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(`${OUTPUT_DIR}/${monthKey}.json`, JSON.stringify(result, null, 2) + "\n");
console.log(`[analytics] ${OUTPUT_DIR}/${monthKey}.json を保存しました。`);

const summary = buildSummary(result);
const { GMAIL_USER, GMAIL_APP_PASSWORD, REPORT_TO_EMAIL } = process.env;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !REPORT_TO_EMAIL) {
  console.log("[analytics] メール送信用のSecretsが未設定のため、内容だけ出力します。");
  console.log(summary);
} else {
  await sendEmail({
    user: GMAIL_USER,
    appPassword: GMAIL_APP_PASSWORD,
    to: REPORT_TO_EMAIL,
    subject: `HbarCG 月次アクセスレポート（${monthKey}）`,
    text: summary,
  });
  console.log(`[analytics] ${monthKey} 分の要約をメールで送信しました。`);
}
