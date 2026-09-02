# Androidストア（HbarCG Store）運用メモ

`store/`以下で公開しているF-Droid互換の独自Androidアプリ配信リポジトリを、
今後どう更新するかのメモです。作業の頻度が低く忘れやすいので、ここに残します。

## 新しいアプリを追加する手順

WSL(Ubuntu)を開いて作業する。

1. APKを `~/fdroid-workdir/repo/` に置く
2. インデックスを再生成する

   ```bash
   cd ~/fdroid-workdir
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   export ANDROID_HOME=/root/android-sdk
   export PATH="/root/android-sdk/build-tools/35.0.0:/root/android-sdk/platform-tools:$JAVA_HOME/bin:/usr/bin:/bin"
   /root/fdroid-venv/bin/fdroid update --create-metadata
   ```

3. **entry.jarを必ず手動で作り直す**（下の「なぜentry.jarを作り直す必要があるのか」を参照）

   ```bash
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   export PATH="$JAVA_HOME/bin:/usr/bin:/bin"
   REPO=/root/fdroid-workdir/repo
   KS=/root/fdroid-workdir/keystore.p12
   ALIAS=$(grep '^repo_keyalias:' /root/fdroid-workdir/config.yml | sed 's/^repo_keyalias: *//')
   PASS=$(grep '^keystorepass:' /root/fdroid-workdir/config.yml | sed 's/^keystorepass: *//')

   WORK=/root/fix_entry_jar
   rm -rf "$WORK" && mkdir -p "$WORK"
   cp "$REPO/entry.json" "$WORK/"
   cd "$WORK"
   jar cfM entry_unsigned.jar entry.json
   jarsigner -keystore "$KS" -storetype PKCS12 -storepass "$PASS" \
     -signedjar entry_signed.jar entry_unsigned.jar "$ALIAS"
   cp entry_signed.jar "$REPO/entry.jar"

   # 確認: 「internal inconsistencies」の警告が出なければOK
   jarsigner -verify -verbose "$REPO/entry.jar"
   ```

4. `repo/` の中身をサイトの `store/repo/` にコピーする（`status/` フォルダは除く）

   ```bash
   cp -r /root/fdroid-workdir/repo/. /mnt/c/claude/ltshinfleet.github.io/store/repo/
   rm -rf /mnt/c/claude/ltshinfleet.github.io/store/repo/status
   ```

   ※ ローカルのフォルダ名を`HbarCG.github.io`などに変更済みの場合は、上記パスをそのフォルダ名に読み替える。

5. `git add store/repo/` → コミット → push

## なぜentry.jarを作り直す必要があるのか

`fdroid update`（fdroidserver 2.4.5, Python実装）が生成する`entry.jar`は、
`JarFile`で読んだ場合と`JarInputStream`で読んだ場合とで中身が食い違う、
内部的に不整合なZIP/JAR構造になっている。

F-Droidクライアント（1.23.2で確認）はストリーミング方式の検証を使うため、
このentry.jarを正しく読めず、リポジトリ追加時に

```
java.io.FileNotFoundException: No files found for https://.../store/repo
```

というエラーで同期に失敗する。標準の`jar`コマンドで作り直し、`jarsigner`で
署名し直すと、この不整合が解消され正常に読めるようになる（原因未特定の
fdroidserver側の既知の癖と思われる。新しいバージョンで直っていれば、
この手動修正は不要になっている可能性がある）。

## リポジトリURLを変更する場合の注意

`config.yml`の`repo_url`を変更したとき（独自ドメイン導入など）は、
`fdroid update`をやり直して`index-v2.json`内の`address`フィールドを
更新する必要がある。`address`が古いURLのままだと、F-Droidクライアントは
「これはミラーです」と誤認識し、正しく同期できなくなる
（2026-09にGitHubアカウント名変更でこれが実際に起きた）。

## 署名鍵（keystore.p12）について

- 保管場所: WSL内 `~/fdroid-workdir/keystore.p12`（このgitリポジトリには含めない）
- エイリアスとパスワードは同じディレクトリの`config.yml`内
  （`repo_keyalias:` / `keystorepass:`）
- **紛失するとリポジトリの「身元」を維持できなくなる**（クライアント側で
  別のリポジトリとして扱われ、フィンガープリント不一致になる）ので、
  パスワードマネージャーなど別の場所に必ずバックアップしておくこと
