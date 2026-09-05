// HbarCGの取り組みでかかった費用の台帳。data/costs.json に追記していく。
// Xの料金は console.x.com の実際の請求ではなく、この台帳の記録が正とする。
// 料金体系が変わった場合は、呼び出し側の amountUsd を更新すること。
// 参考: https://docs.x.com/x-api/getting-started/pricing

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LEDGER_PATH = "data/costs.json";

export function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return [];
  }
  return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
}

export function appendCostEntry({ category, amountUsd, note }) {
  const ledger = readLedger();
  ledger.push({
    date: new Date().toISOString().slice(0, 10),
    category,
    amount_usd: amountUsd,
    note,
  });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}
