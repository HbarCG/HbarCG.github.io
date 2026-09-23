// 有料記事の「続き」を暗号化して、記事ページに埋め込む。
//
// 使い方:
//   node scripts/encrypt-paid.mjs essays/008-example
//
// - 続きの原稿（平文のHTML）は paid-src/<記事フォルダ名>.html に置く。
//   paid-src/ は .gitignore 済みで、公開リポジトリには入らない。
//   平文を essays/ 以下に置いたり、コミットしたりしないこと（一度でも公開すると取り消せない）。
// - 記事ごとの鍵は、マスター鍵 paid-src/master.key から HMAC-SHA256 で作る（なければマスター鍵を新しく作る）。
//   同じ計算を workers/paid-unlock.js（Cloudflare Worker）も行い、支払いを確認できた読者にだけ鍵を渡す。
//   マスター鍵をなくすと、購入済みの読者も続きを読めなくなる。paid-src/ はリポジトリ以外の場所にも控えておくこと。
// - 記事ページには、先に次の枠を書いておく。data-price と data-buy-url 以外はこのスクリプトが書き換える。
//     <!-- paid:start -->
//     <div class="paid" data-price="300" data-buy-url="https://buy.stripe.com/xxxx"></div>
//     <!-- paid:end -->
// - 暗号方式は AES-256-GCM。ブラウザ側の復号は js/paid.js。
// - 手順の全体は docs/paid-articles.md を参照。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { randomBytes, createCipheriv, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const SRC_DIR = "paid-src";
const MASTER_KEY_PATH = join(SRC_DIR, "master.key");
// 支払い後にStripeが読者を戻す先（workers/paid-unlock.js を置いたCloudflare WorkerのURL）
const UNLOCK_URL = "https://hbarcg-paid-unlock.hbarcg.workers.dev/";

function fail(message) {
  console.error(`[encrypt-paid] ${message}`);
  process.exit(1);
}

function readAttr(html, name) {
  const match = html.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
}

// 平文が誤って公開されないよう、paid-src/ がGitの管理外になっていることを確かめる
function assertIgnored(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path]);
  } catch {
    fail(`${path} がGitの管理外になっていません。.gitignore に paid-src/ があるか確認してください。`);
  }
}

const articleDir = (process.argv[2] || "").replace(/[\\/]+$/, "");
if (!articleDir) {
  fail("使い方: node scripts/encrypt-paid.mjs essays/008-example");
}

const name = basename(articleDir);
const pagePath = join(articleDir, "index.html");
const plainPath = join(SRC_DIR, `${name}.html`);

// Worker は https://hbarcg.github.io/essays/<記事名>/ に転送するので、essays/ 直下の記事に限る
if (!/^essays[\\/][0-9a-z-]+$/.test(articleDir)) fail("記事は essays/<英小文字・数字・ハイフンの名前> で指定してください。");
if (!existsSync(pagePath)) fail(`${pagePath} が見つかりません。`);
if (!existsSync(plainPath)) fail(`続きの原稿 ${plainPath} が見つかりません。`);
assertIgnored(plainPath);
assertIgnored(MASTER_KEY_PATH);

const page = readFileSync(pagePath, "utf8");
const plain = readFileSync(plainPath, "utf8").trim();

const blockPattern = /([ \t]*)<!-- paid:start -->[\s\S]*?<!-- paid:end -->/;
const block = page.match(blockPattern);
if (!block) fail(`${pagePath} に <!-- paid:start --> 〜 <!-- paid:end --> の枠がありません。`);

const indent = block[1];
const price = readAttr(block[0], "data-price");
const buyUrl = readAttr(block[0], "data-buy-url");
if (!price || !buyUrl) fail("枠の data-price と data-buy-url を書いてください。");

let master;
if (existsSync(MASTER_KEY_PATH)) {
  master = Buffer.from(readFileSync(MASTER_KEY_PATH, "utf8").trim(), "base64url");
} else {
  master = randomBytes(32);
  writeFileSync(MASTER_KEY_PATH, master.toString("base64url") + "\n");
  console.log(`[encrypt-paid] マスター鍵を新しく作りました: ${MASTER_KEY_PATH}`);
  console.log("  中身をCloudflare Workerのシークレット PAID_MASTER_KEY に登録してください。");
}
// 記事の鍵 = HMAC-SHA256(マスター鍵, "hbarcg-paid:" + 記事名)。workers/paid-unlock.js と同じ計算
const key = createHmac("sha256", master).update(`hbarcg-paid:${name}`).digest();

// 暗号化するたびにIVは作り直す（同じ鍵でIVを使い回すとAES-GCMは安全でなくなる）
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
// ブラウザの Web Crypto は「暗号文 + 認証タグ」をひと続きで受け取るので、末尾にタグを付ける
const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);

// 購入前に見せる文字数。js/main.js と同じく、対談の発言者名・タグ・空白を除いて数える
const chars = plain
  .replace(/<p class="speaker">[\s\S]*?<\/p>/g, "")
  .replace(/<[^>]*>/g, "")
  .replace(/&[a-z0-9#]+;/gi, "x")
  .replace(/\s+/g, "").length;

const newBlock = [
  `${indent}<!-- paid:start -->`,
  `${indent}<div class="paid" data-price="${price}" data-buy-url="${buyUrl}" data-chars="${chars}"` +
    ` data-iv="${iv.toString("base64url")}" data-ciphertext="${ciphertext.toString("base64url")}">`,
  `${indent}  <p>この続きは有料です。表示するにはJavaScriptを有効にしてください。</p>`,
  `${indent}</div>`,
  `${indent}<!-- paid:end -->`,
].join("\n");

writeFileSync(pagePath, page.replace(blockPattern, newBlock));

console.log(`[encrypt-paid] ${pagePath} に続き（${chars}字）を暗号化して埋め込みました。`);
console.log("");
console.log("Stripeの決済リンクの「支払い後」→「ウェブサイトにリダイレクト」に、次のURLを設定してください。");
console.log("（鍵は含まれていないので、見られても問題ありません）");
console.log(`  ${UNLOCK_URL}?article=${name}&session_id={CHECKOUT_SESSION_ID}`);
