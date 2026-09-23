// data/costs.json を集計し、前月分の費用レポートをメールで送る。
// GitHub Actions (.github/workflows/monthly-cost-report.yml) から毎月1日に実行される。

import { readLedger, previousMonthKey, formatAmount, formatTotal } from "./costs-ledger.mjs";
import { sendEmail } from "./send-email.mjs";

function buildReport(monthKey) {
  const ledger = readLedger();
  const entries = ledger.filter((entry) => entry.date.startsWith(monthKey));

  const byCategory = {};
  for (const entry of entries) {
    if (!byCategory[entry.category]) byCategory[entry.category] = [];
    byCategory[entry.category].push(entry);
  }

  const lines = [`HbarCG 月次費用レポート（${monthKey}）`, ""];

  if (entries.length === 0) {
    lines.push("この月は記録された費用はありませんでした。");
  } else {
    lines.push("カテゴリ別内訳:");
    for (const [category, categoryEntries] of Object.entries(byCategory)) {
      lines.push(`  - ${category}: ${formatTotal(categoryEntries)}`);
    }
    lines.push("");
    lines.push(`合計: ${formatTotal(entries)}`);
    lines.push("");
    lines.push("明細:");
    for (const entry of entries) {
      lines.push(`  ${entry.date}  ${formatAmount(entry)}  [${entry.category}] ${entry.note}`);
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
