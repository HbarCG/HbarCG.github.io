// エッセイ本文ページに、文字数と読了目安時間を表示する。
// 新しいエッセイを追加したときも、article.essay-body があれば自動的に計算される。
(function () {
  var article = document.querySelector(".essay-body");
  var meta = article && article.querySelector(".essay-meta");
  if (!meta) return;

  var body = article.cloneNode(true);
  var toRemove = body.querySelectorAll("h1, .essay-meta, .speaker, .paid");
  for (var i = 0; i < toRemove.length; i++) {
    toRemove[i].remove();
  }

  // 有料記事の続きは暗号化されているので、encrypt-paid.mjs が記録した字数を足す
  var paid = article.querySelector(".paid");
  var paidCount = paid ? Number(paid.getAttribute("data-chars")) || 0 : 0;

  var charCount = body.textContent.replace(/\s+/g, "").length + paidCount;
  var CHARS_PER_MINUTE = 500; // 日本語の黙読速度の目安
  var minutes = Math.max(1, Math.round(charCount / CHARS_PER_MINUTE));

  var stats = document.createElement("p");
  stats.className = "essay-stats";
  stats.textContent = charCount.toLocaleString("ja-JP") + "字" +
    (paidCount ? "（うち有料部分 " + paidCount.toLocaleString("ja-JP") + "字）" : "") +
    " ・ 読了目安 " + minutes + "分";
  meta.insertAdjacentElement("afterend", stats);
})();
