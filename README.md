# HbarCG.github.io

個人で運営する、文章・思考・実験のためのサイト。

## 目的

- 書きたかったエッセイを継続的に公開する
- 日常的に考えたこと、ビジネスアイデア、社会や人間についての考察を文章として残す
- 将来的に小さなWebアプリや実験的なサービスも公開する
- note、Xなどの外部プラットフォームに依存せず、自分で所有・管理する

## 技術構成

意図的にシンプルにしてある。

- 素のHTML / CSS / JavaScript（フレームワーク・ビルドツールなし）
- ホスティング：[GitHub Pages](https://pages.github.com/)
- バージョン管理：Git / GitHub

## フォルダ構成

```
.
├── index.html            トップページ
├── about/                自己紹介
├── essays/                エッセイ一覧・各エッセイ
├── apps/                  将来のWebアプリ置き場
├── css/style.css          全ページ共通スタイル
├── js/main.js             全ページ共通スクリプト（現状ほぼ未使用）
├── images/                画像置き場
├── docs/editorial-guidelines.md  編集方針のメモ
├── robots.txt             検索エンジン向けの設定
└── sitemap.xml            検索エンジン向けのページ一覧
```

## 新しいエッセイを追加する手順

1. 直近のエッセイのフォルダ（例：`essays/007-two-kinds-of-fun/`）をコピーし、`essays/008-たとえば/` のような名前でリネームする
2. 中の `index.html` を開き、タイトル・日付・本文を書き換える。`<head>` 内の次の項目も新しいエッセイに合わせる
   - `<title>` と `<meta name="description">`
   - `canonical` と `og:url` のURL（フォルダ名）
   - `og:title`（タイトル）と `og:description`（descriptionと同じ文）
3. `essays/index.html` の一覧に新しいエッセイへのリンクを1行追加する
4. `sitemap.xml` に新しいエッセイのURLを1行追加する

## 公開

`main` ブランチの内容がそのまま https://HbarCG.github.io/ に公開される。
