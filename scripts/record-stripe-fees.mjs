// Stripe の決済手数料を、1か月分まとめて data/costs.json に記録する。
// GitHub Actions (.github/workflows/monthly-cost-report.yml) から、費用レポートを送る前に実行される。
//
// STRIPE_API_KEY には、Stripeの管理画面で作った「制限付きキー」を使う。
// 権限は Balance transactions（残高の取引）の「読み取り」だけで足りる。キーは GitHub Secrets に置くこと。
// Stripe の手数料は円建てなので、台帳には amount_jpy で記録する。

import { readLedger, appendCostEntry, previousMonthKey } from "./costs-ledger.mjs";

const CATEGORY = "Stripe";

const apiKey = process.env.STRIPE_API_KEY;
if (!apiKey) {
  console.log("[record-stripe-fees] STRIPE_API_KEY が未設定のため、スキップします。");
  process.exit(0);
}

const monthKey = process.env.TARGET_MONTH || previousMonthKey();
const [year, month] = monthKey.split("-").map(Number);
const start = Date.UTC(year, month - 1, 1) / 1000;
const end = Date.UTC(year, month, 1) / 1000;
// レポートは日付で月を振り分けるので、その月の末日の日付で記録する
const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

if (readLedger().some((entry) => entry.category === CATEGORY && entry.date === lastDay)) {
  console.log(`[record-stripe-fees] ${monthKey} 分はすでに記録済みです。`);
  process.exit(0);
}

let fee = 0;
let payments = 0;
let startingAfter = "";
let hasMore = true;

while (hasMore) {
  const params = new URLSearchParams({
    "created[gte]": String(start),
    "created[lt]": String(end),
    limit: "100",
  });
  if (startingAfter) params.set("starting_after", startingAfter);

  const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Stripe API エラー: ${res.status} ${await res.text()}`);
  }
  const page = await res.json();

  for (const tx of page.data) {
    if (tx.currency !== "jpy") {
      console.warn(`[record-stripe-fees] 円以外の取引を飛ばしました: ${tx.id} (${tx.currency})`);
      continue;
    }
    fee += tx.fee; // 円は補助単位のない通貨なので、fee はそのまま円の金額
    if (tx.type === "charge" || tx.type === "payment") payments++;
  }

  hasMore = page.has_more;
  if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
}

if (fee === 0) {
  console.log(`[record-stripe-fees] ${monthKey} は手数料がありませんでした。`);
  process.exit(0);
}

appendCostEntry({
  category: CATEGORY,
  amountJpy: fee,
  note: `決済手数料（${monthKey}、決済${payments}件）`,
  date: lastDay,
});
console.log(`[record-stripe-fees] ${monthKey} の手数料 ¥${fee} を記録しました。`);
