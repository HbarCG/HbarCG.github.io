// Xの4つのキーが正しく設定されているかだけを確認するスクリプト。
// 何も投稿せず、GET /2/users/me を呼んで自分のアカウント情報が取れるか確認する。

import { buildOAuthHeader, getCredentialsFromEnv } from "./x-oauth.mjs";

const { credentials, missing } = getCredentialsFromEnv();

if (!credentials) {
  console.error(`[verify-x-auth] 未設定のSecretsがあります: ${missing.join(", ")}`);
  process.exit(1);
}

const url = "https://api.x.com/2/users/me";
const authHeader = buildOAuthHeader({ url, method: "GET", credentials });

const response = await fetch(url, {
  method: "GET",
  headers: { Authorization: authHeader },
});

const body = await response.text();

if (!response.ok) {
  console.error(`[verify-x-auth] 認証に失敗しました (${response.status}): ${body}`);
  process.exit(1);
}

console.log("[verify-x-auth] 認証に成功しました。");
console.log(body);
