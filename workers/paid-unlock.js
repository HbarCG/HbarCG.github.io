// 有料記事の「鍵渡し」を中継する Cloudflare Worker。
// Cloudflareの管理画面でWorkerを作り、このファイルの中身をそのまま貼り付けて使う（ビルド不要）。
//
// 流れ:
//   1. 読者がStripeの決済リンクで支払う
//   2. Stripeが読者をこのWorkerに戻す（…/?article=005-ai-and-labor&session_id=cs_xxx）
//   3. WorkerがStripeに「その支払いが完了しているか」を問い合わせる
//   4. 完了していれば、記事の鍵を作って https://hbarcg.github.io/essays/<記事>/#key=… に転送する
//
// どの記事の鍵を渡すかは、URLの article ではなく「支払いに使われた決済リンクの戻り先URL」から読む。
// こうしておけば、安い記事の支払いで別の記事の鍵を受け取ることはできない。
//
// 鍵は記事ごとに、マスター鍵から HMAC-SHA256 で作る（scripts/encrypt-paid.mjs と同じ計算）。
// 記事を増やしても、Worker側の設定を変える必要はない。
//
// Workerの「設定 → 変数とシークレット」に、次の2つをシークレットとして登録する:
//   STRIPE_API_KEY   Stripeの制限付きキー（Checkout Sessions と Payment Links の「読み取り」だけ）
//   PAID_MASTER_KEY  paid-src/master.key の中身
// 手順の全体は docs/paid-articles.md を参照。

const SITE_URL = "https://hbarcg.github.io";
const CONTACT = "hbarcg.contact@gmail.com";

export default {
  async fetch(request, env) {
    if (!env.STRIPE_API_KEY || !env.PAID_MASTER_KEY) {
      return errorPage(500, "設定に問題があります（シークレットが未登録）。");
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id") || "";
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return errorPage(400, "購入の情報が見つかりませんでした。");
    }

    // サンドボックスの支払いには rk_test_、本番の支払いには rk_live_ のキーが要る
    const keyIsLive = /^(rk|sk)_live_/.test(env.STRIPE_API_KEY.trim());
    if (sessionId.startsWith("cs_live_") !== keyIsLive) {
      return errorPage(500, "設定に問題があります（Stripeのキーのモードが支払いと合っていない）。");
    }

    const session = await stripeGet(env, `checkout/sessions/${sessionId}`);
    if (session === AUTH_ERROR) {
      return errorPage(500, "設定に問題があります（Stripeのキーまたはその権限）。");
    }
    if (!session) {
      return errorPage(404, "購入の情報が見つかりませんでした。");
    }
    if (session.status !== "complete" || session.payment_status !== "paid") {
      return errorPage(402, "お支払いがまだ完了していません。完了してからもう一度お試しください。");
    }
    if (!session.payment_link) {
      return errorPage(400, "この購入は記事の決済リンクによるものではありません。");
    }

    const paymentLink = await stripeGet(env, `payment_links/${session.payment_link}`);
    if (paymentLink === AUTH_ERROR) {
      return errorPage(500, "設定に問題があります（Stripeのキーの Payment Links 権限）。");
    }
    const redirectUrl = paymentLink && paymentLink.after_completion && paymentLink.after_completion.redirect
      ? paymentLink.after_completion.redirect.url
      : "";
    const article = articleFromRedirectUrl(redirectUrl);
    if (!article) {
      return errorPage(500, "記事の設定に問題があります。");
    }

    const key = await articleKey(env.PAID_MASTER_KEY, article);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${SITE_URL}/essays/${article}/#key=${key}`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};

// キーが違う・権限が足りないときの目印（読者の購入情報がない場合と区別するため）
const AUTH_ERROR = "auth_error";

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_API_KEY.trim()}` },
  });
  if (!res.ok) {
    console.log(`Stripe API エラー: ${res.status} ${await res.text()}`);
    return res.status === 401 || res.status === 403 ? AUTH_ERROR : null;
  }
  return res.json();
}

// 決済リンクの戻り先URL（…/?article=005-ai-and-labor&session_id={CHECKOUT_SESSION_ID}）から記事名を取り出す
function articleFromRedirectUrl(redirectUrl) {
  try {
    const article = new URL(redirectUrl).searchParams.get("article") || "";
    return /^[0-9a-z-]+$/.test(article) ? article : "";
  } catch {
    return "";
  }
}

// 記事の鍵 = HMAC-SHA256(マスター鍵, "hbarcg-paid:" + 記事名) を base64url にしたもの
async function articleKey(masterKeyText, article) {
  const master = Uint8Array.from(atob(masterKeyText.trim().replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const hmacKey = await crypto.subtle.importKey("raw", master, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`hbarcg-paid:${article}`));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function errorPage(status, message) {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HbarCG</title>
<style>body{font-family:sans-serif;line-height:1.8;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#1f1f1f;background:#fdfdfb}</style>
</head>
<body>
<p>${message}</p>
<p>お支払い済みなのに続きが読めない場合は、<a href="mailto:${CONTACT}">${CONTACT}</a> までご連絡ください。</p>
<p><a href="${SITE_URL}/">HbarCG に戻る</a></p>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
