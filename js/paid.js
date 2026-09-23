// 有料記事の「続き」を表示する。
// 続きは scripts/encrypt-paid.mjs で暗号化され、.paid の data 属性に入っている。
// 鍵はStripeで支払ったあとの戻り先URL（…/#key=xxxx）で渡され、この端末のブラウザに保存される。
// 鍵がなければ購入ボタンを表示する。
(function () {
  var box = document.querySelector(".paid");
  if (!box) return;

  var storageKey = "hbarcg-paid-key:" + location.pathname;
  var key = takeKeyFromUrl();
  if (key) {
    save(storageKey, key);
  } else {
    key = load(storageKey);
  }

  if (!key) {
    showPaywall();
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    showPaywall("このブラウザでは続きを表示できません。最新のブラウザで開いてください。");
    return;
  }

  decrypt(key).then(
    function (html) {
      showContent(html, key);
    },
    function () {
      remove(storageKey);
      showPaywall("保存されていた鍵で続きを開けませんでした。購入済みの場合は、購入者用リンクを開き直してください。");
    }
  );

  // 戻り先URLの #key=… から鍵を取り出す。念のため ?key=… も受け付ける
  function takeKeyFromUrl() {
    var url = new URL(location.href);
    var hash = new URLSearchParams(url.hash.slice(1));
    var found = hash.get("key") || url.searchParams.get("key");
    if (!found) return null;

    // 鍵の入ったURLがそのまま共有されないよう、アドレスバーから消しておく
    hash.delete("key");
    url.searchParams.delete("key");
    url.hash = hash.toString();
    history.replaceState(null, "", url.toString());
    return found;
  }

  function decrypt(keyText) {
    return Promise.resolve()
      .then(function () {
        return crypto.subtle.importKey("raw", fromBase64Url(keyText), "AES-GCM", false, ["decrypt"]);
      })
      .then(function (cryptoKey) {
        return crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromBase64Url(box.dataset.iv) },
          cryptoKey,
          fromBase64Url(box.dataset.ciphertext)
        );
      })
      .then(function (buffer) {
        return new TextDecoder().decode(buffer);
      });
  }

  function showContent(html, keyText) {
    box.innerHTML = html;

    var link = location.origin + location.pathname + "#key=" + keyText;
    var note = el("p", "paid-owner-note", "購入済みの記事です。別の端末で読むときは、");
    var a = el("a", "", "購入者用リンク");
    a.href = link;
    note.appendChild(a);
    note.appendChild(document.createTextNode("を開いてください（ほかの人には共有しないでください）。"));
    box.appendChild(note);
  }

  function showPaywall(message) {
    var price = Number(box.dataset.price).toLocaleString("ja-JP");
    var chars = Number(box.dataset.chars).toLocaleString("ja-JP");

    box.innerHTML = "";
    box.classList.add("paywall");
    box.appendChild(el("p", "paywall-lead", "この続きは有料です（" + chars + "字）"));

    var buttonWrap = el("p", "", "");
    var button = el("a", "paywall-button", price + "円で続きを読む");
    button.href = box.dataset.buyUrl;
    buttonWrap.appendChild(button);
    box.appendChild(buttonWrap);

    if (message) {
      box.appendChild(el("p", "paywall-error", message));
    }

    var note = el("p", "paywall-note", "お支払いはStripeで行います。支払いが終わるとこのページに戻り、続きが表示されます。");
    note.appendChild(document.createElement("br"));
    var legal = el("a", "", "特定商取引法に基づく表記");
    legal.href = "/legal/";
    note.appendChild(legal);
    box.appendChild(note);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function fromBase64Url(text) {
    var base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // プライベートブラウズなどで保存できない場合もあるので、失敗しても止まらないようにする
  function save(name, value) {
    try { localStorage.setItem(name, value); } catch (e) {}
  }
  function load(name) {
    try { return localStorage.getItem(name); } catch (e) { return null; }
  }
  function remove(name) {
    try { localStorage.removeItem(name); } catch (e) {}
  }
})();
