// GmailのSMTP(STARTTLS)で1通だけメールを送るための最小クライアント。
// 依存パッケージなし（Node組み込みのnet/tlsのみ）。日本語件名・本文はBase64でエンコードする。

import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const HOST = "smtp.gmail.com";
const PORT = 587;

function waitForResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      // 複数行応答は "250-..." の続きが "250 ..." (ハイフンなし)で終わる
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    }
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function sendCommand(socket, command) {
  socket.write(command + "\r\n");
  const response = await waitForResponse(socket);
  const code = parseInt(response.slice(0, 3), 10);
  if (code >= 400) {
    throw new Error(`SMTPエラー: ${command} -> ${response}`);
  }
  return response;
}

function wrapBase64(base64) {
  const lines = [];
  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

function encodeMimeHeader(str) {
  if (/^[\x00-\x7F]*$/.test(str)) {
    return str;
  }
  return `=?UTF-8?B?${Buffer.from(str, "utf8").toString("base64")}?=`;
}

export async function sendEmail({ user, appPassword, to, subject, text }) {
  const rawSocket = netConnect({ host: HOST, port: PORT });
  await new Promise((resolve, reject) => {
    rawSocket.once("connect", resolve);
    rawSocket.once("error", reject);
  });
  await waitForResponse(rawSocket); // 220 greeting

  await sendCommand(rawSocket, "EHLO localhost");
  await sendCommand(rawSocket, "STARTTLS");

  const socket = tlsConnect({ socket: rawSocket, servername: HOST });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  await sendCommand(socket, "EHLO localhost");
  await sendCommand(socket, "AUTH LOGIN");
  await sendCommand(socket, Buffer.from(user, "utf8").toString("base64"));
  await sendCommand(socket, Buffer.from(appPassword, "utf8").toString("base64"));

  await sendCommand(socket, `MAIL FROM:<${user}>`);
  await sendCommand(socket, `RCPT TO:<${to}>`);
  await sendCommand(socket, "DATA");

  const bodyBase64 = wrapBase64(Buffer.from(text, "utf8").toString("base64"));
  const message = [
    `From: ${user}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
    ".",
  ].join("\r\n");

  await sendCommand(socket, message);
  await sendCommand(socket, "QUIT");
  socket.end();
}
