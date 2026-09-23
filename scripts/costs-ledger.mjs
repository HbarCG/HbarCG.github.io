// HbarCGの取り組みでかかった費用の台帳。data/costs.json に追記していく。
// Xの料金は console.x.com の実際の請求ではなく、この台帳の記録が正とする。
// 料金体系が変わった場合は、呼び出し側の amountUsd を更新すること。
// 参考: https://docs.x.com/x-api/getting-started/pricing
//
// 金額はドル建て（amount_usd）か円建て（amount_jpy）のどちらか一方で記録する。
// 為替換算はせず、集計もそれぞれの通貨ごとに行う。

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LEDGER_PATH = "data/costs.json";

export function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return [];
  }
  return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
}

// date を省略すると今日の日付（UTC）で記録する
export function appendCostEntry({ category, amountUsd, amountJpy, note, date }) {
  const ledger = readLedger();
  const entry = {
    date: date || new Date().toISOString().slice(0, 10),
    category,
  };
  if (amountJpy !== undefined) {
    entry.amount_jpy = amountJpy;
  } else {
    entry.amount_usd = amountUsd;
  }
  entry.note = note;
  ledger.push(entry);
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

// 前月を "YYYY-MM" で返す（UTC基準）
export function previousMonthKey() {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 台帳の1件の金額を "$1.23" や "¥123" の形で返す
export function formatAmount(entry) {
  if (entry.amount_jpy !== undefined) {
    return `¥${entry.amount_jpy.toLocaleString("ja-JP")}`;
  }
  return `$${entry.amount_usd.toFixed(2)}`;
}

// 複数件の合計を通貨ごとに出して "$1.23 + ¥456" の形で返す
export function formatTotal(entries) {
  let usd = 0;
  let jpy = 0;
  for (const entry of entries) {
    if (entry.amount_jpy !== undefined) {
      jpy += entry.amount_jpy;
    } else {
      usd += entry.amount_usd;
    }
  }
  const parts = [];
  if (usd || !jpy) parts.push(`$${usd.toFixed(2)}`);
  if (jpy) parts.push(`¥${jpy.toLocaleString("ja-JP")}`);
  return parts.join(" + ");
}
