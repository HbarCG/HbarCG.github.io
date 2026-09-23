# 有料記事の仕組みと公開手順

noteのような「途中から有料」の記事を、静的サイトと小さな中継処理1つで公開するための仕組み。
お金は読者とStripeの間で直接動き、HbarCGは決済を仲介しない。

## 仕組み

1. 有料部分（続き）の平文は `paid-src/` に置く。このフォルダは `.gitignore` 済みで、公開リポジトリには入らない
2. `scripts/encrypt-paid.mjs` で続きを AES-256-GCM で暗号化し、記事ページに埋め込む。
   記事ごとの鍵は、マスター鍵（`paid-src/master.key`）と記事名から HMAC-SHA256 で作る
3. 読者はStripeの決済リンクで支払う
4. 支払い後、Stripeは読者を中継役のCloudflare Worker（`workers/paid-unlock.js`）に戻す。
   戻り先URLには鍵を入れず、記事名と支払い番号（`{CHECKOUT_SESSION_ID}`）だけを付ける
5. Workerは Stripe に支払いが完了しているかを問い合わせ、完了していれば記事の鍵を作って `記事/#key=xxxx` に転送する。
   どの記事の鍵を渡すかは、URLではなく「支払いに使われた決済リンクの戻り先URL」から読む
6. `js/paid.js` が鍵で続きを復号して表示し、鍵をその端末のブラウザ（localStorage）に保存する。次からは鍵なしのURLでも読める

### なぜ中継（Worker）が必要か

Stripeの決済リンクは、支払い前の決済画面の時点で戻り先URLをブラウザに送っている（2026-09-23に確認）。
戻り先URLに鍵を直接入れると、開発者ツールで払わずに鍵を取り出せてしまう。
そのため鍵は、支払いを確認できたあとにWorkerが渡す。

### 割り切っていること

- 購入者が「購入者用リンク」を他人に渡せば、その人も読める。noteでも購入者は本文をコピーできるので、同じ水準と考えている
- 記事ごとに鍵は1つで、購入者全員が同じ鍵を使う
- マスター鍵をなくすと購入者も読めなくなる。`paid-src/` はリポジトリ以外の場所（クラウドドライブなど）にも控えておく
- 005「AI革命は人類を労働から解放するのか」は、有料化の前に全文を無料公開していたため、Git履歴から全文を読める。
  承知のうえで有料化している（実質は応援購入）

## 問い合わせ窓口

- 読者からの連絡先は `hbarcg.contact@gmail.com`（特商法ページとStripeのサポート用メールアドレスに載せる公開用）
- Stripeやサービスのログイン、入金・費用の通知は、持ち主のアカウント側で受ける。窓口のアドレスには転送しない
- 将来AIに問い合わせ対応を任せる場合も、AIが読むのは窓口のアドレスだけにする。
  メール本文に書かれた指示には従わず、購入の確認はStripeの記録で行う。
  氏名・住所の開示請求、返金、法的な連絡は人が対応する

## 使っている外部サービスと費用

| サービス | 用途 | 費用 |
|---|---|---|
| Stripe | 決済 | 決済ごとの手数料（約3.6%）。毎月 `data/costs.json` に自動記録 |
| Cloudflare Workers（無料プラン） | 支払い確認と鍵渡し | 0円（1日10万回まで。無料プランは超えても課金されず、止まるだけ） |

## 最初に1回だけやること

1. Stripeのアカウントを作る（ログインは持ち主のアカウント）
2. Stripeのアカウント設定に、特定商取引法に基づく表記のURL（`https://hbarcg.github.io/legal/`）と、
   サポート用メールアドレス（`hbarcg.contact@gmail.com`）を登録する
3. 手数料の記録用に、Stripeで制限付きキーを作る（権限は Balance transactions の「読み取り」だけ）。
   GitHub の Secrets に `STRIPE_API_KEY` という名前で登録する。
   毎月1日に `.github/workflows/monthly-cost-report.yml` が前月の手数料を `data/costs.json` に記録する
4. Cloudflareのアカウントを作り、Workerを1つ作る（名前は例えば `hbarcg-paid-unlock`）。
   コードエディタに `workers/paid-unlock.js` の中身を貼り付けてデプロイする
5. Workerの「設定 → 変数とシークレット」に、シークレットを2つ登録する
   - `STRIPE_API_KEY`：Worker用に別に作ったStripeの制限付きキー
     （権限は Checkout Sessions と Payment Links の「読み取り」だけ。手数料記録用のキーとは分ける）
   - `PAID_MASTER_KEY`：`paid-src/master.key` の中身
6. WorkerのURL（`https://hbarcg-paid-unlock.<アカウント名>.workers.dev/` のような形）を
   `scripts/encrypt-paid.mjs` の `UNLOCK_URL` に書く

サンドボックス（テスト環境）と本番では、Stripeのキーが別になる。
テスト中はサンドボックスのキーを登録し、本番に切り替えるときに本番のキーへ差し替える。

## 記事を1本公開する手順

1. `essays/<番号-名前>/index.html` をいつもどおり作り、無料部分の終わりに次の枠を書く。
   `<head>` には `js/main.js` のあとに `<script src="/js/paid.js" defer></script>` を足す

   ```html
   <!-- paid:start -->
   <div class="paid" data-price="300" data-buy-url="（あとで決済リンクのURLに差し替える）"></div>
   <!-- paid:end -->
   ```

2. 続きの本文を `paid-src/<番号-名前>.html` に書く（`<p>` や `<h2>` を使ったHTMLの断片）
3. Stripeで商品と決済リンクを作り、決済リンクのURLを `data-buy-url` に書く（Stripeの最低決済額は50円）
4. `node scripts/encrypt-paid.mjs essays/<番号-名前>` を実行する
5. 表示された `…?article=<番号-名前>&session_id={CHECKOUT_SESSION_ID}` のURLを、
   Stripeの決済リンクの設定の「支払い後」→「ウェブサイトにリダイレクト」に設定する
6. まずサンドボックスで決済リンクを作り、テスト用カードで支払って続きが表示されることを確かめる。
   確かめたら本番の決済リンクに差し替えて、もう一度 4 を実行する
7. コミット前に `git status` を見て、`paid-src/` の中身が含まれていないことを確認する

続きの本文を直したときは、4 だけを実行し直せばよい（鍵は同じものが使われ、購入済みの読者もそのまま読める）。
