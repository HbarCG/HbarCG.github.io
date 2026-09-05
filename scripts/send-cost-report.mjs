// data/costs.json を集計し、前月分の費用レポートをメールで送る。
// GitHub Actions (.github/workflows/monthly-cost-report.yml) から毎月1日に実行される。

import { readLedger } from "./costs-ledger.mjs";
import { sendEmail } from "./send-email.mjs";

function previousMonthKey() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11、前月を指す
  const prev = new Date(Date.UTC(year, month - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildReport(monthKey) {
  const ledger = readLedger();
  const entries = ledger.filter((entry) => entry.date.startsWith(monthKey));

  const byCategory = {};
  let total = 0;
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount_usd;
    total += entry.amount_usd;
  }

  const lines = [`HbarCG 月次費用レポート（${monthKey}）`, ""];

  if (entries.length === 0) {
    lines.push("この月は記録された費用はありませんでした。");
  } else {
    lines.push("カテゴリ別内訳:");
    for (const [category, amount] of Object.entries(byCategory)) {
      lines.push(`  - ${category}: $${amount.toFixed(2)}`);
    }
    lines.push("");
    lines.push(`合計: $${total.toFixed(2)}`);
    lines.push("");
    lines.push("明細:");
    for (const entry of entries) {
      lines.push(`  ${entry.date}  $${entry.amount_usd.toFixed(2)}  [${entry.category}] ${entry.note}`);
    }
  }

  return lines.join("\n");
}

const monthKey = process.env.TARGET_MONTH || previousMonthKey();
const reportText = buildReport(monthKey);

const user = process.env.GMAIL_USER;
const appPassword = process.env.GMAIL_APP_PASSWORD;
const to = process.env.REPORT_TO_EMAIL;

if (!user || !appPassword || !to) {
  console.log("[send-cost-report] メール送信用のSecretsが未設定のため、内容だけ出力してスキップします。");
  console.log(reportText);
  process.exit(0);
}

await sendEmail({
  user,
  appPassword,
  to,
  subject: `HbarCG 月次費用レポート（${monthKey}）`,
  text: reportText,
});

console.log(`[send-cost-report] ${monthKey} 分のレポートを送信しました。`);
