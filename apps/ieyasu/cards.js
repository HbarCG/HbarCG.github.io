// 家康の憂鬱（試作版）の物語・出来事カード・制度。
// 文章や数値はここだけを直せばよい（game.js はこのデータを読んで動くだけ）。
//
// ■ 効果（effects / fail）に書けるもの
//   ikou: 威光 / minshin: 民心 / chotei: 朝廷   … 幕府の状態（0〜100）
//   ryo: 現金（万両）。マイナスは出費。invest: true の選択肢では「投資」として城・普請の資産になる
//   borrow: 商人から借りる額（万両）。現金と借入が同じだけ増える
//   rice: 蔵米（万両ぶん） / kokudaka: 天領の石高（万石） / mine: 金銀山の産出（万両/年）
//   trade: 運上金・交易の収入（万両/年） / ooku: 大奥の費え（万両/年）
//   jisseki: 実績（制度を整えるのに使う） / health: 将軍の健康
//   heir: { seimu: 2 } など … いちばん年上の若君の能力
//
// ■ 選択肢（options）に書けるもの
//   label: ボタンの文言
//   tag:   この選択肢を好む将軍の性格（慎重・豪胆・寛大・倹約・華美）。好みに合うと将軍が乗り気で取り組み、育つ
//   grow:  将軍が乗り気で取り組んだとき伸びる能力（seimu 政務 / bui 武威 / jintoku 人徳）
//   check: { stat: 'seimu', dc: 11 } … 成否が将軍（と担当の役職）の能力で決まる。失敗時は fail / failText
//   invest: true … 出費を「投資」として扱う（キャッシュフロー表の投資の欄に入り、資産になる）
//   text:  結果の文章
//
// ■ カードに書けるもの
//   scene: 場面の絵の名前（art.js の SCENES。castle / fire / ship など）
//   minYear: この年以降に出る / when: 出る条件（関数） / weight: 出やすさ（標準1）
//   kind: 'famine'（飢饉）や 'foreign'（異国）。対応する制度があると悪い効果が半分になる
//   once: true … 一度しか出ない

window.IEYASU_DATA = {
  // ─────────────────────────────── プロローグ（史実パート）
  prologue: [
    {
      year: 1616,
      title: '駿府にて',
      mood: 'worry',
      scene: 'sickbed',
      text: [
        '元和二年、駿府城。天下を平らげて十余年、わしの命もいよいよ尽きようとしておる。',
        '七十五年。よう生きた。……生きたが、どうにも落ち着かぬ。わしが死んだあと、この幕府は本当に続くのか。',
      ],
    },
    {
      year: 1616,
      title: '最後の布石',
      scene: 'castle',
      text: [
        '死ぬ前に、ひとつだけ布石を打っておこう。何もかもは無理じゃ。いちばん大事なものをひとつ選ぶ。',
      ],
      choices: [
        {
          label: '御三家を固める',
          institution: 'gosanke',
          text: '尾張・紀伊・水戸。本家に跡継ぎが絶えたとき、ここから迎えればよい。保険は地味じゃが、効く。',
        },
        {
          label: '金山・銀山を幕府が握る',
          institution: 'kinzan',
          text: '佐渡の金、石見の銀。銭のない政は、どれほど立派でも長くは続かぬ。',
        },
        {
          label: '朝廷と縁を結ぶ',
          institution: 'konin',
          text: '孫娘の和子を帝のもとへ。力で押さえるより、身内になってしまうほうが揉めぬ。',
        },
      ],
    },
    {
      year: 1617,
      title: '東照大権現',
      scene: 'heaven',
      text: [
        '……気がつくと、日光の山の上におった。なんと、わしは神として祀られたらしい。東照大権現。仰々しい名じゃ。',
        '体はない。声も届かぬ。できるのは見ていることだけ。息子の秀忠は真面目じゃが、慎重がすぎる。見ていて肩がこる。肩はないが。',
      ],
    },
    {
      year: 1623,
      title: '三代・家光',
      scene: 'hall',
      text: [
        '秀忠が退き、孫の家光が三代将軍となった。',
        'こやつは妙にわしを慕っておる。なにかにつけて「権現様」と手を合わせに来る。……悪い気はせぬ。',
      ],
    },
    {
      year: 1636,
      title: '東照宮、完成',
      scene: 'shrine',
      text: [
        '寛永十三年。家光が日光の社を建て直した。金箔、極彩色、見上げるほどの彫り物。……やりすぎじゃ。わしは質素が好きなのじゃ。',
        'だが、参拝の者たちの祈りが流れ込んでくるにつれて、体の奥から力がみなぎってきた。体はないが。',
      ],
    },
    {
      year: 1637,
      title: '雲の上の家光',
      mood: 'worry',
      scene: 'heaven',
      text: [
        '翌年の春。雲の上で、見覚えのある顔に出くわした。',
        '「権現様……面目ございませぬ。病には勝てませなんだ」',
        '「それにしても妙ですな。史実どおりなら、私は四十八まで生きて、息子の家綱に跡を譲るはずでしたのに。どうも、この世はどこかで筋書きが狂うたようで……」',
        'シジツ？ 何の話じゃ。……いや、それどころではない。おぬしがここにおるということは、幕府はどうなる。世継ぎもまだおらぬというのに！',
      ],
    },
    {
      year: 1637,
      title: '権現、降臨',
      mood: 'worry',
      scene: 'descend',
      text: [
        'のんびり見物しておる場合ではない。いても立ってもおられず、気がつけば、わしは霊体となって江戸城に降りておった。東照宮の力が、ここまで運んでくれたらしい。',
        '城では、家光の異母弟・保科正之が新しい将軍に立てられておった。堅物じゃが、信の置ける男じゃ。家光の側室が身ごもっておったのが、せめてもの救いよ。',
        '「権現様、それがしもお供いたします」……家光までついてきおった。じゃが、体もない霊のわしらに、いったい何ができるというのか。',
      ],
    },
  ],

  // ─────────────────────────────── 制度（代をまたいで残る）
  // cost: 整えるのに要る実績 / ryo: 整えるのにかかる費用（万両。投資として扱う）
  // upkeep: 毎年の維持費（万両） / on: 整えたときに一度だけ起きる効果 / yearly: 毎年の効果
  institutions: [
    { id: 'gosanke', name: '御三家', cost: 0, prologueOnly: true, desc: '本家に跡継ぎがいないとき、ここから将軍を迎えられる。' },
    { id: 'kinzan', name: '金山・銀山の直轄', cost: 0, prologueOnly: true, desc: '金銀山の産出が年15万両増える。', on: { mine: 15 } },
    { id: 'konin', name: '朝廷との縁組', cost: 0, prologueOnly: true, upkeep: 2, desc: '毎年、朝廷+1。維持費 年2万両。', yearly: { chotei: 1 } },
    { id: 'sankin', name: '参勤交代', cost: 6, ryo: 10, requires: { ikou: 35 }, desc: '大名に江戸と国元を往復させ、力を削ぐ。毎年、威光+1。（威光35以上で整えられる）', yearly: { ikou: 1 } },
    { id: 'kanjo', name: '勘定所の整備', cost: 6, ryo: 30, upkeep: 3, desc: '金の出入りを役所で管理する。年貢の取り立てが8%増え、経費が5%減る。維持費 年3万両。' },
    { id: 'shinden', name: '新田開発の奨励', cost: 5, ryo: 60, desc: '荒れ地を田に変える。天領の石高が30万石増える。', on: { kokudaka: 30 } },
    { id: 'terauke', name: '寺請制度', cost: 5, ryo: 10, upkeep: 2, desc: '寺が民を把握し、暮らしが落ち着く。毎年、民心+1。維持費 年2万両。', yearly: { minshin: 1 } },
    { id: 'meyasu', name: '目安箱', cost: 5, ryo: 5, upkeep: 1, desc: '民の訴えを将軍が直接読む。毎年、民心+1。維持費 年1万両。', yearly: { minshin: 1 } },
    { id: 'shasan', name: '日光社参の定例化', cost: 4, ryo: 10, upkeep: 8, desc: '歴代将軍が日光に参る決まり。毎年、威光+1、朝廷+1。維持費 年8万両。', yearly: { ikou: 1, chotei: 1 } },
    { id: 'gakumon', name: '学問所', cost: 5, ryo: 25, upkeep: 3, desc: '若君の教育の効果が上がる（1回の教育で+1多く伸びる）。維持費 年3万両。' },
    { id: 'kakoimai', name: '囲米（備蓄の蔵）', cost: 5, ryo: 20, upkeep: 2, desc: '蔵米を30万両ぶん蓄え、飢饉の悪い効果を半分にする。維持費 年2万両。', guards: 'famine', on: { rice: 30 } },
    { id: 'nagasaki', name: '長崎奉行', cost: 5, ryo: 20, upkeep: 2, desc: '交易を管理する。運上金・交易の収入が年8万両増え、異国との出来事の悪い効果が半分になる。維持費 年2万両。', guards: 'foreign', on: { trade: 8 } },
  ],

  // ─────────────────────────────── 出来事カード
  cards: [
    {
      id: 'castle-repair',
      scene: 'castle',
      title: '無断の城普請',
      text: '西国の大名が、届け出もなく城の石垣を積み直しているという。',
      ieyasu: '福島の一件を思い出すのう。甘く見れば、ほかの大名もまねをする。',
      options: [
        { label: '改易する', tag: '豪胆', grow: 'bui', check: { stat: 'bui', dc: 10 },
          effects: { ikou: 8, minshin: -2 }, text: '大名は国を取り上げられた。諸国の大名は震え上がった。',
          fail: { ikou: -6, minshin: -3 }, failText: '家臣団が城に立てこもり、鎮めるのに手間取った。幕府の威光に傷がついた。' },
        { label: '叱りつけて済ませる', tag: '寛大', grow: 'jintoku',
          effects: { ikou: -3, chotei: 1 }, text: '大名は平伏して詫びた。だが「その程度か」とささやく者もいる。' },
        { label: '罰として川の普請を命じる', tag: '倹約', grow: 'seimu',
          effects: { ikou: 3, kokudaka: 5, minshin: 2 }, text: '大名の金で堤が築かれ、田が広がった。叱るより、働かせるほうが得じゃ。' },
      ],
    },
    {
      id: 'famine-sign',
      scene: 'famine',
      title: '凶作の兆し',
      kind: 'famine',
      text: '長雨が続き、東国の稲の育ちが悪い。このままでは秋の年貢は望めない。',
      ieyasu: '民は生かさず殺さず、などと言われるが……殺してしもうては元も子もない。',
      options: [
        { label: '年貢を減らす', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -40, minshin: 8 }, text: '村々に安堵が広がった。そのぶん、幕府の蔵は軽くなった。' },
        { label: '蔵の米を貸し出す', tag: '慎重', grow: 'seimu',
          effects: { ryo: -20, minshin: 4, jisseki: 1 }, text: '翌年に返す約束で米を貸した。手堅いやり方じゃ。' },
        { label: '例年どおり取り立てる', tag: '倹約', grow: 'bui',
          effects: { ryo: 20, minshin: -10 }, text: '蔵は満ちたが、村から逃げ出す者が出はじめた。' },
      ],
    },
    {
      id: 'nikko-visit',
      scene: 'shrine',
      title: '日光社参',
      text: '将軍が日光へ参りたいと言い出した。行列を整えるには、相応の費用がかかる。',
      ieyasu: 'わしのために金を使うな……と言いたいところじゃが、来てくれると力がわくのも確かでのう。',
      options: [
        { label: '盛大に参る', tag: '華美', grow: 'bui',
          effects: { ryo: -40, ikou: 8 }, text: '十万を超える行列が日光へ向かった。諸大名は将軍の威勢を思い知った。' },
        { label: '質素に参る', tag: '倹約', grow: 'jintoku',
          effects: { ryo: -15, ikou: 3, minshin: 1 }, text: '小さな行列だったが、心はこもっていた。' },
        { label: '今年は見送る', tag: '慎重', grow: 'seimu',
          effects: { ikou: -4, ryo: 5 }, text: '社参は取りやめになった。……少し寂しい。' },
      ],
    },
    {
      id: 'court-rank',
      scene: 'court',
      title: '朝廷の官位',
      text: '朝廷が、幕府に相談なく大名に官位を授けようとしている。',
      ieyasu: '朝廷は敵ではない。だが、大名と朝廷が直に結びつくのは、いちばん危うい。',
      options: [
        { label: '厳しく抗議する', tag: '豪胆', grow: 'bui',
          effects: { chotei: -8, ikou: 5 }, text: '朝廷は授与を取り下げた。公家たちの目は冷ややかだ。' },
        { label: '黙って見過ごす', tag: '寛大', grow: 'jintoku',
          effects: { chotei: 4, ikou: -5 }, text: '朝廷は満足したようだ。大名たちは、京へ顔を向けはじめた。' },
        { label: '公家に贈り物をして根回しする', tag: '華美', grow: 'seimu',
          effects: { ryo: -25, chotei: 5, ikou: 1 }, text: '話は穏やかにまとまった。金は減ったが、角は立たなかった。' },
      ],
    },
    {
      id: 'edo-fire',
      scene: 'fire',
      title: '江戸の大火',
      text: '江戸の町が三日三晩燃え続けた。焼け出された者があふれている。',
      ieyasu: '江戸は燃える町じゃ。燃えたあとにどう建て直すかで、将軍の器が知れる。',
      options: [
        { label: '町人に再建の金を出す', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -50, minshin: 9 }, text: '町はすぐに息を吹き返した。「公方様のおかげ」と人々は言う。' },
        { label: '火除地を設けて町を作り直す', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 11 }, invest: true,
          effects: { ryo: -30, minshin: 4, jisseki: 3 }, text: '広い通りと空き地が設けられた。次の火事は、ここで止まるだろう。',
          fail: { ryo: -40, minshin: -4 }, failText: '立ち退きをめぐって揉め、工事は進まなかった。' },
        { label: '城の再建を急ぐ', tag: '華美', grow: 'bui', invest: true,
          effects: { ryo: -40, ikou: 4, minshin: -6 }, text: '天守は元の姿を取り戻した。町はまだ焼け野原のままだ。' },
      ],
    },
    {
      id: 'southern-ships',
      scene: 'ship',
      title: '南蛮船',
      kind: 'foreign',
      text: '異国の船が交易を求めて港に来た。宣教師も乗っているらしい。',
      ieyasu: '交易はもうかる。だが、信仰が一緒についてくると厄介じゃ。',
      options: [
        { label: '交易を広く認める', tag: '豪胆', grow: 'seimu', check: { stat: 'seimu', dc: 11 },
          effects: { ryo: 20, trade: 5, chotei: -2 }, text: '珍しい品と銀が流れ込んだ。交易の上がりは、これから毎年入ってくる。',
          fail: { ryo: 20, minshin: -6, ikou: -3 }, failText: 'もうけは出たが、禁じた教えが西国でひそかに広まりはじめた。' },
        { label: '港を一つに限る', tag: '慎重', grow: 'seimu',
          effects: { trade: 2, ikou: 2 }, text: '交易は細く、しかし確かに続くことになった。' },
        { label: '追い返す', tag: '倹約', grow: 'bui',
          effects: { ikou: 2, ryo: -10 }, text: '船は去った。静かになったが、得たものもない。' },
      ],
    },
    {
      id: 'ronin',
      scene: 'ronin',
      title: '浪人の不満',
      text: '取りつぶされた家の浪人たちが江戸に集まり、不穏な噂が立っている。',
      ieyasu: '大名を潰せば、浪人が生まれる。威光の裏側じゃな。',
      options: [
        { label: '厳しく取り締まる', tag: '豪胆', grow: 'bui',
          effects: { ikou: 4, minshin: -4 }, text: '首謀者は捕らえられた。だが、浪人たちの恨みは消えていない。' },
        { label: '仕官の道を開く', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -20, minshin: 3, ikou: 2 }, text: '働き口を得た浪人たちは、刀を筆に持ち替えた。' },
        { label: 'しばらく様子を見る', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 12 },
          effects: { jisseki: 1 }, text: '噂は噂のまま立ち消えた。',
          fail: { ikou: -9, minshin: -3 }, failText: '浪人たちが決起した。鎮めはしたが、幕府の油断を世に知らしめた。' },
      ],
    },
    {
      id: 'mine-decline',
      scene: 'mine',
      title: '金山の衰え',
      text: '佐渡の金の出が年々細っている。このままでは幕府の蔵が持たない。',
      ieyasu: '山はいつか尽きる。尽きたあとのことを考えておくのが政じゃ。',
      options: [
        { label: '新しい鉱山を探させる', tag: '豪胆', grow: 'seimu', check: { stat: 'seimu', dc: 12 }, invest: true,
          effects: { ryo: -20, mine: 12, jisseki: 1 }, text: '新たな鉱脈が見つかった。山師たちは大喜びだ。',
          fail: { ryo: -25 }, failText: '掘っても掘っても何も出なかった。費用だけがかさんだ。' },
        { label: '小判の質を落として数を増やす', tag: '華美', grow: 'seimu',
          effects: { ryo: 50, minshin: -6 }, text: '改鋳の差益で蔵は潤った。だが、物の値がじわじわと上がりはじめた。' },
        { label: '倹約令を出す', tag: '倹約', grow: 'jintoku',
          effects: { ooku: -4, minshin: -3 }, text: '城中から華やかさが消え、大奥の費えも削られた。息苦しいが、蔵は守られた。' },
      ],
    },
    {
      id: 'roju-feud',
      scene: 'hall',
      title: '老中の争い',
      text: '二人の老中が政の方針をめぐって激しく対立し、城中が二つに割れている。',
      ieyasu: '家臣の争いを放っておくのがいちばんいかん。だが、どちらかを切れば、恨みが残る。',
      options: [
        { label: '一方を罷免する', tag: '豪胆', grow: 'bui',
          effects: { ikou: 4, jisseki: -1 }, text: '城中は静まった。罷免された側の家臣は、口を閉ざしている。' },
        { label: '双方の顔を立てる', tag: '寛大', grow: 'jintoku',
          effects: { ikou: -2, minshin: 1 }, text: '争いは収まったように見える。決めるべきことは、先送りになった。' },
        { label: '将軍みずから裁く', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 11 },
          effects: { ikou: 5, jisseki: 2 }, text: '将軍の裁きに、両者とも納得した。見事じゃ。',
          fail: { ikou: -5 }, failText: '裁きは筋が通らず、双方の不満を買った。' },
      ],
    },
    {
      id: 'tozama-marriage',
      scene: 'palanquin',
      title: '外様の縁組',
      text: '有力な外様大名同士が、幕府の許しを得ずに縁組をまとめようとしている。',
      ieyasu: '大名同士が手を結ぶ。それがいちばん恐ろしい。わしは身をもって知っておる。',
      options: [
        { label: '縁組を禁じる', tag: '慎重', grow: 'bui',
          effects: { ikou: 4, minshin: -1 }, text: '縁組は取りやめになった。大名たちは不満そうだ。' },
        { label: '許してやる', tag: '寛大', grow: 'jintoku',
          effects: { ikou: -6, chotei: 1 }, text: '両家は喜んだ。西国の結びつきは、少し強くなった。' },
        { label: '徳川の姫を嫁がせて間に入る', tag: '華美', grow: 'seimu',
          effects: { ryo: -25, ikou: 6 }, text: '姫の輿入れは盛大だった。これで、どちらの家も身内じゃ。' },
      ],
    },
    {
      id: 'good-harvest',
      scene: 'harvest',
      title: '豊作',
      text: '今年は天候に恵まれ、どの国も大豊作だ。',
      ieyasu: '良い年こそ、気を抜くな。悪い年は必ず来る。',
      options: [
        { label: '蔵に蓄える', tag: '倹約', grow: 'seimu',
          effects: { rice: 40 }, text: '蔵が米俵で埋まった。これで少々の凶作には耐えられる。' },
        { label: '祭りを盛大に許す', tag: '華美', grow: 'jintoku',
          effects: { minshin: 7, ryo: 10 }, text: '町も村も、笛と太鼓でにぎわった。' },
        { label: '年貢を少し下げる', tag: '寛大', grow: 'jintoku',
          effects: { minshin: 8, ryo: 10 }, text: '「こんな年もあるものか」と、百姓たちは顔を見合わせた。' },
      ],
    },
    {
      id: 'river-work',
      scene: 'river',
      title: '大河の治水',
      text: '毎年のように暴れる大河を、堤で押さえてほしいという訴えが続いている。',
      ieyasu: '利根川の流れを変えたのは、わしの代からの大仕事じゃった。',
      options: [
        { label: '大名に手伝わせる', tag: '豪胆', grow: 'bui',
          effects: { ikou: 3, minshin: 3, kokudaka: 4 }, text: '大名たちが人足を出し、堤が築かれた。大名の懐は痛んだ。' },
        { label: '幕府の金で築く', tag: '寛大', grow: 'jintoku', invest: true,
          effects: { ryo: -40, kokudaka: 15, minshin: 5, jisseki: 2 }, text: '立派な堤が完成し、水につかっていた田がよみがえった。「公方様の堤」と呼ばれている。' },
        { label: '後回しにする', tag: '倹約', grow: 'seimu',
          effects: { minshin: -4, ryo: 5 }, text: '今年は持ちこたえた。来年はわからない。' },
      ],
    },
    {
      id: 'ikki',
      scene: 'ikki',
      title: '一揆',
      text: '重い年貢に耐えかねた百姓たちが、代官所に押し寄せた。',
      ieyasu: '一揆が起きるのは、上がしくじったときじゃ。百姓が悪いのではない。',
      options: [
        { label: '兵を出して鎮める', tag: '豪胆', grow: 'bui',
          effects: { ikou: 3, minshin: -8 }, text: '一揆は鎮まった。村には重い沈黙が残った。' },
        { label: '訴えを聞き入れる', tag: '寛大', grow: 'jintoku',
          effects: { minshin: 6, ikou: -4, ryo: -10 }, text: '年貢は軽くなった。「訴えれば通る」と思う者も出てきた。' },
        { label: '代官を調べて処罰する', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 10 },
          effects: { minshin: 6, ikou: 1, jisseki: 1 }, text: '代官の不正が明らかになった。百姓たちは矛を収めた。',
          fail: { minshin: -3, ikou: -3 }, failText: '調べは長引き、その間に一揆は隣の村へ広がった。' },
      ],
    },
    {
      id: 'shogun-ill',
      scene: 'sickbed',
      title: '将軍の不調',
      text: '将軍が近ごろ、ひどく疲れた顔をしている。政務の詰めすぎだと侍医は言う。',
      ieyasu: '体を壊しては、何もかも終わりじゃ。わしは薬を自分で調合しておった。',
      options: [
        { label: 'しばらく静養する', tag: '慎重', grow: 'jintoku',
          effects: { health: 10, ikou: -3 }, text: '将軍は顔色を取り戻した。そのあいだ、政は少し滞った。' },
        { label: 'かまわず政務を続ける', tag: '豪胆', grow: 'seimu',
          effects: { health: -8, jisseki: 2 }, text: '仕事ははかどった。将軍の咳が、少し増えた。' },
        { label: '名医を呼び寄せる', tag: '華美', grow: 'jintoku',
          effects: { health: 8, ryo: -25 }, text: '高名な医者の薬はよく効いた。値段もよく効いた。' },
      ],
    },
    {
      id: 'court-poor',
      scene: 'court',
      title: '朝廷の窮乏',
      text: '御所の修繕もままならないほど、朝廷の暮らし向きが苦しいらしい。',
      ieyasu: '朝廷を困らせて得することはない。かといって、太らせすぎるのも考えものじゃ。',
      options: [
        { label: '献金する', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -30, chotei: 10 }, text: '御所は修繕された。帝からねぎらいの言葉が届いた。' },
        { label: '断る', tag: '倹約', grow: 'seimu',
          effects: { chotei: -7, ryo: 5 }, text: '公家たちは黙った。黙っているときの公家が、いちばん怖い。' },
        { label: '所領を少し加える', tag: '華美', grow: 'seimu',
          effects: { ryo: -15, chotei: 6, ikou: -1 }, text: '朝廷の領地が増えた。毎年の負担にならぬよう、ほどほどにした。' },
      ],
    },
    {
      id: 'tutor',
      scene: 'study',
      title: '若君の教育係',
      when: (s) => s.heirs.length > 0,
      text: '若君の教育係を誰にするか、家臣たちの意見が割れている。',
      ieyasu: '誰に育てられるかで、人は決まる。わしは今川の人質のころに学んだことが、いちばん役に立った。',
      options: [
        { label: '厳格な儒学者', tag: '慎重', grow: 'seimu',
          effects: { heir: { seimu: 2 }, ryo: -5 }, text: '若君は朝から晩まで書物と向き合っている。' },
        { label: '剣の達人', tag: '豪胆', grow: 'bui',
          effects: { heir: { bui: 2 }, ryo: -5 }, text: '若君の掛け声が、庭から毎朝聞こえてくる。' },
        { label: '温和な老僧', tag: '寛大', grow: 'jintoku',
          effects: { heir: { jintoku: 2 }, ryo: -5 }, text: '若君は、下働きの者の名前まで覚えるようになった。' },
      ],
    },
    {
      id: 'earthquake',
      scene: 'earthquake',
      title: '大地震',
      text: '関東を大きな地震が襲った。城の石垣も崩れ、町は混乱している。',
      ieyasu: 'こればかりは、誰のせいでもない。だからこそ、どう動くかが見られる。',
      options: [
        { label: '救い小屋を建てる', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -40, minshin: 7 }, text: '炊き出しの煙が、あちこちに立ちのぼった。' },
        { label: '城の石垣を先に直す', tag: '豪胆', grow: 'bui', invest: true,
          effects: { ryo: -30, ikou: 4, minshin: -5 }, text: '城は元に戻った。町はまだ瓦礫の中だ。' },
        { label: '大名に復興を割り振る', tag: '倹約', grow: 'seimu', check: { stat: 'seimu', dc: 11 },
          effects: { ryo: -10, minshin: 4, ikou: 2 }, text: '大名たちの手で、町は手際よく片づけられた。',
          fail: { minshin: -4, ikou: -3 }, failText: '大名たちは互いに押しつけ合い、復興は遅れた。' },
      ],
    },
    {
      id: 'merchant-loan',
      scene: 'money',
      title: '大坂の豪商',
      text: '大坂の豪商が、幕府に大金を貸してもよいと申し出てきた。',
      ieyasu: '商人の力が、刀より強くなる日が来るのかもしれぬ。',
      options: [
        { label: '借りる', tag: '豪胆', grow: 'seimu',
          effects: { borrow: 60, ikou: -4 }, text: '蔵は潤った。だが、借りた金には利息がつく。商人に頭が上がらなくなった。' },
        { label: '代わりに運上金を課す', tag: '倹約', grow: 'seimu',
          effects: { trade: 4, minshin: -2 }, text: '商人たちは渋い顔で、毎年の運上金を納めることになった。' },
        { label: '丁重に断る', tag: '慎重', grow: 'jintoku',
          effects: { ikou: 1 }, text: '豪商は笑って帰っていった。その笑みが少し気になる。' },
      ],
    },
    {
      id: 'shrine-repair',
      scene: 'shrine',
      title: '東照宮の修繕',
      text: '日光の社の彩色が色あせてきた。修繕には大きな費用がかかる。',
      ieyasu: 'わしの家じゃ。……いや、私情は挟まぬ。挟まぬが、直してくれるとうれしい。',
      options: [
        { label: '全面的に修繕する', tag: '華美', grow: 'bui',
          effects: { ryo: -45, ikou: 6, chotei: 2 }, invest: true, text: '社は建てたときの輝きを取り戻した。力がみなぎる。' },
        { label: '傷んだところだけ直す', tag: '倹約', grow: 'seimu',
          effects: { ryo: -15, ikou: 2 }, invest: true, text: '目立つところだけ塗り直された。まあ、これで十分じゃ。' },
        { label: '今は見送る', tag: '慎重', grow: 'seimu',
          effects: { ikou: -3 }, text: '修繕は先延ばしになった。……雨漏りが冷たい。' },
      ],
    },
    {
      id: 'roads',
      scene: 'road',
      title: '街道の整備',
      text: '五街道の宿場が荒れ、旅人や荷が滞りがちだと報せが届いた。',
      ieyasu: '道は国の血の巡りじゃ。詰まれば、体じゅうが弱る。',
      options: [
        { label: '宿場に手当てを出す', tag: '寛大', grow: 'jintoku', invest: true,
          effects: { ryo: -25, trade: 2, minshin: 3, jisseki: 2 }, text: '宿場は息を吹き返し、荷が流れはじめた。' },
        { label: '関所の取り締まりを強める', tag: '慎重', grow: 'bui',
          effects: { ikou: 4, minshin: -3 }, text: '怪しい者は通れなくなった。まっとうな旅人も通りにくくなった。' },
        { label: '宿場の運営を商人に任せる', tag: '豪胆', grow: 'seimu', check: { stat: 'seimu', dc: 10 },
          effects: { trade: 3, minshin: 2 }, text: '商人たちはうまく宿場を回し、上がりの一部を納めてきた。',
          fail: { minshin: -4 }, failText: '宿代がつり上がり、旅人の不満が噴き出した。' },
      ],
    },
    {
      id: 'kanjo-fraud',
      scene: 'money',
      title: '勘定方の不正',
      text: '幕府の金を扱う役人が、帳簿をごまかして私腹を肥やしていたことがわかった。',
      ieyasu: '一人の不正は、仕組みの穴を教えてくれる。穴を塞がねば、また誰かが落ちる。',
      options: [
        { label: '厳罰に処す', tag: '豪胆', grow: 'bui',
          effects: { ikou: 3, ryo: 10 }, text: '役人は切腹を命じられた。役所の空気が張りつめた。' },
        { label: '帳簿の改めを仕組みにする', tag: '慎重', grow: 'seimu',
          effects: { ryo: 20, jisseki: 2 }, text: '毎月、別の者が帳簿を改めることになった。地味じゃが、これが効く。' },
        { label: '穏便に返させる', tag: '寛大', grow: 'jintoku',
          effects: { ryo: 15, ikou: -3 }, text: '金は戻った。「見つかっても返せばよい」と思う者も出るだろう。' },
      ],
    },
    {
      id: 'ooku',
      scene: 'banquet',
      title: '大奥の勢い',
      text: '大奥の女中たちの数が増え、その費えが幕府の蔵を圧迫している。',
      ieyasu: '奥のことは奥に任せる。じゃが、蔵が空になるのは困る。',
      options: [
        { label: '人数を減らす', tag: '倹約', grow: 'seimu',
          effects: { ooku: -4, ikou: -2 }, text: '大奥は縮小され、毎年の費えが減った。奥向きからの風当たりが強い。' },
        { label: 'そのままにする', tag: '寛大', grow: 'jintoku',
          effects: { minshin: 1 }, text: '城中は和やかだ。費えはこれまでどおり、毎年かかる。' },
        { label: '華やかさを競わせる', tag: '華美', grow: 'bui',
          effects: { ooku: 4, chotei: 3, ikou: 2 }, text: '大奥の華やかさは京にまで聞こえた。毎年の費用もまた、聞こえた。' },
      ],
    },
    {
      id: 'falconry',
      scene: 'falcon',
      title: '鷹狩り',
      text: '将軍が鷹狩りに出たいと言っている。供の者や村々への負担は小さくない。',
      ieyasu: '鷹狩りはよいぞ。体も鍛えられるし、領地の様子も見える。わしも大好きじゃった。',
      options: [
        { label: '盛大に出かける', tag: '華美', grow: 'bui',
          effects: { health: 5, ryo: -15, minshin: -2, ikou: 2 }, text: '将軍は大きな獲物を仕留めて上機嫌だ。' },
        { label: '村の様子を見ながら回る', tag: '寛大', grow: 'jintoku',
          effects: { health: 4, minshin: 3 }, text: '将軍は村の暮らしを自分の目で見た。得るものが多かったようだ。' },
        { label: '取りやめる', tag: '倹約', grow: 'seimu',
          effects: { health: -2, ryo: 5 }, text: '将軍は城にこもって書類と向き合った。' },
      ],
    },
    {
      id: 'scholar',
      scene: 'study',
      title: '学問の流行',
      text: '儒学が武士のあいだで流行している。学問を幕府として後押しすべきか。',
      ieyasu: '戦のない世には、刀より書物で人を治めることになる。わしもそう考えておった。',
      options: [
        { label: '学者を召し抱える', tag: '華美', grow: 'seimu',
          effects: { ryo: -25, jisseki: 3, chotei: 2 }, text: '高名な学者が城に招かれた。政に理屈が通るようになった。' },
        { label: '奨励するだけにとどめる', tag: '慎重', grow: 'seimu',
          effects: { jisseki: 1 }, text: '学問は武士のたしなみとして広まっていった。' },
        { label: '武芸を重んじる', tag: '豪胆', grow: 'bui',
          effects: { ikou: 3, jisseki: -1 }, text: '「武士は武をもって立つべし」と将軍は言い切った。' },
      ],
    },
    {
      id: 'epidemic',
      scene: 'sickbed',
      title: '疫病',
      text: '江戸で疱瘡がはやり、子どもたちが次々と倒れている。',
      ieyasu: '若君にうつらねばよいが……。',
      options: [
        { label: '医者を町に遣わす', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -30, minshin: 6 }, text: '町の医者が増え、ひどい広がりは防げた。' },
        { label: '城の出入りを厳しく限る', tag: '慎重', grow: 'seimu',
          effects: { health: 3, minshin: -4 }, text: '城の中は守られた。町の人々は見捨てられたと感じている。' },
        { label: '寺社に祈祷させる', tag: '華美', grow: 'jintoku',
          effects: { ryo: -15, minshin: 3 }, text: '祈りの声が江戸じゅうに響いた。効いたかどうかは、わからぬ。' },
      ],
    },
    {
      id: 'loyal-retainer',
      scene: 'hall',
      title: '直言の家臣',
      text: '若い家臣が、将軍の政を面と向かって批判する書状を差し出してきた。',
      ieyasu: '耳に痛いことを言う家臣は宝じゃ。本多正信がそうであった。',
      options: [
        { label: '重く用いる', tag: '寛大', grow: 'jintoku',
          effects: { jisseki: 3, ikou: -1 }, text: '家臣は抜擢され、政のほころびを次々と繕いはじめた。' },
        { label: '無礼として遠ざける', tag: '豪胆', grow: 'bui',
          effects: { ikou: 2, jisseki: -1 }, text: '城中の者たちは口をつぐむようになった。' },
        { label: '書状だけ読んでおく', tag: '慎重', grow: 'seimu',
          effects: { jisseki: 1 }, text: '将軍は黙って書状を読み、いくつかの政を改めた。' },
      ],
    },
    {
      id: 'heir-sick',
      scene: 'sickbed',
      title: '若君の病',
      when: (s) => s.heirs.some((h) => h.age < 15),
      text: '幼い若君が高い熱を出し、三日三晩うなされている。',
      ieyasu: '子が病むのは、何度見てもつらい。神になっても、それは変わらぬ。',
      options: [
        { label: '名医を集める', tag: '華美', grow: 'jintoku',
          effects: { ryo: -30, heir: { kenko: 2 } }, text: '若君は持ち直した。前よりも丈夫になったようにさえ見える。' },
        { label: '日光に祈らせる', tag: '慎重', grow: 'jintoku',
          effects: { ryo: -3, heir: { kenko: 1 } }, text: '祈りが届いた。……わしが聞いておるのだから、届くに決まっておる。' },
        { label: '侍医に任せる', tag: '倹約', grow: 'seimu',
          effects: { heir: { kenko: -1 } }, text: '若君は回復したが、少し体が弱くなった。' },
      ],
    },
    {
      id: 'daimyo-debt',
      scene: 'money',
      title: '大名の借金',
      text: '多くの大名が商人からの借金に苦しみ、幕府に救いを求めてきた。',
      ieyasu: '大名が弱るのは、幕府にとって悪いことばかりではない。じゃが、潰れられても困る。',
      options: [
        { label: '借金を棒引きにさせる', tag: '豪胆', grow: 'bui',
          effects: { ikou: 5, ryo: -10, minshin: -3 }, text: '大名は救われた。商人たちは大損をして、幕府を恨んでいる。' },
        { label: '幕府が金を貸す', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -35, ikou: 4 }, text: '大名たちは幕府に恩を感じた。返ってくるかは、わからない。' },
        { label: '自分で何とかさせる', tag: '倹約', grow: 'seimu',
          effects: { ikou: -3, ryo: 5 }, text: '大名たちは幕府を頼りないと感じたようだ。' },
      ],
    },
    {
      id: 'new-fields',
      scene: 'harvest',
      title: '新田開発の願い',
      text: '代官から、荒れ野を切り開いて田にしたいという願いが上がってきた。元手はかかるが、うまくいけば年貢が増える。',
      ieyasu: '米を増やすには、田を増やすしかない。じゃが、借金をしてまでやるかどうかは、よう考えよ。',
      options: [
        { label: '幕府の金で大きく開く', tag: '豪胆', grow: 'seimu', check: { stat: 'seimu', dc: 11 }, invest: true,
          effects: { ryo: -60, kokudaka: 25, jisseki: 1 }, text: '見渡すかぎりの新田が生まれた。来年から年貢が増える。',
          fail: { ryo: -60, kokudaka: 8 }, failText: '水が引けず、田になったのは一部だけだった。' },
        { label: '町人に開かせて上がりを分ける', tag: '倹約', grow: 'seimu',
          effects: { kokudaka: 10, minshin: 1 }, text: '商人の金で田が開かれた。幕府の取り分は少ないが、元手はかからない。' },
        { label: '今は見送る', tag: '慎重', grow: 'jintoku',
          effects: {}, text: '荒れ野は荒れ野のまま残った。' },
      ],
    },
    {
      id: 'rice-price',
      scene: 'money',
      title: '米の値崩れ',
      minYear: 1660,
      text: '豊作続きで米の値が下がり、年貢米を売っても思うような金にならない。一方で、ほかの品の値は上がっている。',
      ieyasu: '米で俸禄をもらう武士は、米が安いと困る。商人ばかりが肥えていく。妙な世の中になったものじゃ。',
      options: [
        { label: '蔵米を買い上げて値を支える', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -30, rice: 30, ikou: 2 }, text: '米の値は持ち直した。蔵には米俵が積み上がった。' },
        { label: '商人に御用金を出させる', tag: '豪胆', grow: 'bui',
          effects: { ryo: 40, trade: -2, minshin: -3 }, text: '商人たちから大金を集めた。だが商いは冷え込んだ。' },
        { label: '経費を切り詰めてしのぐ', tag: '倹約', grow: 'seimu',
          effects: { ooku: -2, ikou: -2 }, text: '城中の費えが削られた。旗本たちは不満を漏らしている。' },
      ],
    },

    // ───────── 年が進むと来る大きな試練
    {
      id: 'great-famine',
      scene: 'famine',
      title: '大飢饉',
      kind: 'famine',
      minYear: 1680,
      trial: true,
      text: '冷たい夏が二年続き、諸国で大飢饉となった。道ばたに倒れる者が後を絶たない。',
      ieyasu: 'これは試練じゃ。ここでしくじれば、幕府への信は地に落ちる。',
      options: [
        { label: '蔵をすべて開く', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -80, minshin: 6 }, text: '幕府の米で多くの命が救われた。蔵は空になった。' },
        { label: '米の値を抑えるお触れを出す', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 13 },
          effects: { ryo: -30, minshin: 2, jisseki: 2 }, text: '買い占めは抑えられ、米は行き渡った。',
          fail: { ryo: -20, minshin: -14 }, failText: 'お触れは守られず、米の値は天井知らずに上がった。' },
        { label: '城下の米を守る', tag: '倹約', grow: 'bui',
          effects: { ryo: -10, minshin: -18, ikou: 2 }, text: '江戸は飢えずにすんだ。地方では打ちこわしが相次いでいる。' },
      ],
    },
    {
      id: 'daimyo-league',
      scene: 'league',
      title: '大名連合の噂',
      minYear: 1660,
      trial: true,
      when: (s) => s.shogunate.ikou < 50,
      text: '西国の大名たちが密かに使者を行き来させ、何かを企んでいるらしい。',
      ieyasu: '関ヶ原を思い出す。あのとき、わしは西に勝った。今度は、守る側じゃ。',
      options: [
        { label: '先手を打って国替えを命じる', tag: '豪胆', grow: 'bui', check: { stat: 'bui', dc: 13 },
          effects: { ikou: 10 }, text: '大名たちは命に従った。企みは芽のうちに摘まれた。',
          fail: { ikou: -14, minshin: -4 }, failText: '大名たちは命を拒んだ。幕府の命令が通らないことが、天下に知れた。' },
        { label: '密偵を放って探る', tag: '慎重', grow: 'seimu', check: { stat: 'seimu', dc: 12 },
          effects: { ikou: 5, jisseki: 2 }, text: '企みの中心にいた家老が突き止められ、連合は崩れた。',
          fail: { ikou: -8 }, failText: '密偵は捕らえられ、幕府の疑いが大名たちの結束を固めてしまった。' },
        { label: '宴に招いて懐柔する', tag: '華美', grow: 'jintoku',
          effects: { ryo: -50, ikou: 3, chotei: 1 }, text: '盛大な宴の席で、大名たちは将軍に杯を捧げた。いまのところは。' },
      ],
    },
    {
      id: 'black-ships',
      scene: 'blackship',
      title: '異国の黒い船',
      kind: 'foreign',
      minYear: 1780,
      trial: true,
      text: '見たこともない大きな黒い船が湾に現れ、国を開けと迫ってきた。大砲がこちらを向いている。',
      ieyasu: '……来たか。いつか来ると思っておった。三浦按針から聞いた海の向こうの話を、もっと真剣に聞いておくべきじゃった。',
      options: [
        { label: '国を開いて交易する', tag: '豪胆', grow: 'seimu', check: { stat: 'seimu', dc: 14 },
          effects: { trade: 10, chotei: -6, ikou: -2 }, text: '幕府は異国と約定を結んだ。新しい品と考えが、どっと流れ込んできた。',
          fail: { ryo: -30, chotei: -12, ikou: -10 }, failText: '不利な約定を結ばされた。「幕府は弱腰だ」と、朝廷も大名も声を上げた。' },
        { label: '打ち払う', tag: '倹約', grow: 'bui', check: { stat: 'bui', dc: 15 },
          effects: { ikou: 8, chotei: 6 }, text: '黒い船は沖へ去った。今回は。',
          fail: { ikou: -16, ryo: -40 }, failText: '砲台は一瞬で沈黙した。力の差を、天下が思い知った。' },
        { label: '回答を一年待たせる', tag: '慎重', grow: 'seimu',
          effects: { ikou: -5, chotei: -2, jisseki: 1 }, text: '異国の船は「来年また来る」と言い残して去った。' },
      ],
    },
    {
      id: 'court-defiance',
      scene: 'court',
      title: '朝廷の不満',
      minYear: 1700,
      trial: true,
      when: (s) => s.shogunate.chotei < 40,
      text: '帝が幕府の政に不満をもち、ひそかに大名へ書状を送っているという噂が立った。',
      ieyasu: '朝廷と大名が結べば、幕府は「朝敵」にされかねん。それだけは避けねばならぬ。',
      options: [
        { label: '詫びて献上品を贈る', tag: '寛大', grow: 'jintoku',
          effects: { ryo: -50, chotei: 14, ikou: -3 }, text: '帝の機嫌は直った。幕府が頭を下げた形になった。' },
        { label: '京都所司代に見張らせる', tag: '慎重', grow: 'seimu',
          effects: { chotei: -4, ikou: 5 }, text: '御所の出入りは厳しく改められた。公家たちは息をひそめている。' },
        { label: '帝に譲位を迫る', tag: '豪胆', grow: 'bui', check: { stat: 'bui', dc: 14 },
          effects: { chotei: 6, ikou: 8 }, text: '新しい帝は幕府に好意的だ。強引じゃったが、うまくいった。',
          fail: { chotei: -18, ikou: -6 }, failText: '公家たちが一斉に反発した。幕府は朝廷を敵に回してしまった。' },
      ],
    },
  ],

  // ─────────────────────────────── 初回のチュートリアル
  // 案内役は霊体の家光。プレイヤー（家康＝権現様）に話しかける。
  // target: 光らせる場所（CSSセレクタ）。省くと画面の真ん中で話すだけ。
  // tab: その手順を見せる前に開くメニュー
  tutorial: [
    {
      text: '権現様、お気づきになりましたか。どうやら、霊体の権現様がお決めになったことが、そのまま幕府の政となるようでございます。……なぜかは、私にもとんとわかりませぬが。',
    },
    {
      text: 'ならば、権現様に采配をふるっていただくほかありませぬ。久しぶりの幕府の切り盛り、勝手がわからぬのも無理はございませぬ。この家光が、ひととおりご案内いたします。',
    },
    {
      target: '#topbar',
      text: 'いちばん上の帯が、いまの幕府のありさまにございます。威光・民心・朝廷の三つと、金蔵の現金、商人からの借入。どれかが0になるか、借入が上限を超えると「倒幕の危機」となりまする。',
    },
    {
      target: '#stage .iy-options',
      tab: 'seimu',
      text: '毎年ひとつ、出来事が起こります。どう応じるかは権現様がお決めくだされ。費用や成否の見込みも添えてございます。「将軍の好み」に合うお裁きなら、将軍は乗り気で取り組み、育ってまいります。',
    },
    {
      target: '#tabbar',
      text: '下の帯がお役目の一覧にございます。出来事を片づけたら「政務の間」で若君の教育や制度の整備を。「年を越す」を押せば、一年の決算となります。',
    },
    {
      target: '#tabbar [data-tab="finance"]',
      text: '「財務」では、金の出入り（キャッシュフロー計算書）と蔵の中身（バランスシート）が見られます。年貢は石高で決まりますが、物価は年々上がるもの。……東照宮を建てすぎた私が申すのも何ですが、稼ぐ力を育てねば、いずれ赤字になりまする。',
    },
    {
      target: '#tabbar [data-tab="org"]',
      text: '「組織」では、老中や勘定奉行などの役職に家臣を就けます。私の頃の信綱も、いずれは老いて辞めてゆきましょう。空席ができると赤い印がつきますゆえ、お見落としなきよう。',
    },
    {
      target: '#tabbar [data-tab="family"]',
      text: '「家系図」では、歴代の将軍や若君の能力と働きぶりをたどれます。私の子、竹千代のことも、どうかよしなに。跡継ぎを育てて代をつなぐことこそ、肝要にございます。',
    },
    {
      target: '#guide-button',
      text: 'お迷いの折は、この「ガイド」をいつでもお開きくだされ。私もおそばに控えております。では権現様、ご采配を。',
    },
  ],

  // ─────────────────────────────── いつでも見られるガイド
  guide: [
    {
      title: '目的',
      body: [
        'あなたは霊体となって江戸城に降りた家康（権現様）。将軍を支えて、徳川幕府を経営する。倒幕されるまでがひとつの遊び。',
        '幕府が開府から何年続いたかが記録になる。史実の幕府は約265年。これを超えられるか。',
      ],
    },
    {
      title: '1年の流れ',
      body: [
        '① 出来事が1つ起きる。選択肢から対応を選ぶ。',
        '② 結果を見て「政務の間」へ。若君の教育、制度の整備、代替わりを決める。',
        '③ 必要なら、財務（借入・返済）や組織（家臣の配置）を見直す。',
        '④「年を越す（決算）」を押す。収入と支出が帳簿につき、人は歳をとり、次の年になる。',
      ],
    },
    {
      title: '上の帯の見方',
      body: [
        '威光：大名が幕府を恐れ、従う力。時代が下るほど自然に下がりやすい。大目付の腕で支えられる。',
        '民心：民の暮らしと満足。年貢の取れ高にも響く。町奉行の腕で支えられる。',
        '朝廷：朝廷との関係。京都所司代の腕で支えられる。',
        '現金と借入：単位は万両。借入の右の数字が借りられる上限（その年の歳入の2倍）。',
        '実績：政がうまく回ると毎年たまる。制度を整えるのに使う。',
      ],
    },
    {
      title: '出来事と将軍の性格',
      body: [
        '将軍には慎重・豪胆・寛大・倹約・華美のいずれかの性格がある。',
        '「将軍の好み」と書かれた選択肢を選ぶと、将軍は乗り気で取り組み、能力が1上がる。好みに合わなくても選べる。',
        '成否が分かれる選択肢には見込みが出る。将軍の能力と、担当の役職（政務＝老中、武威＝大目付、人徳＝町奉行）の腕で決まる。',
        '費用は物価に合わせて年々上がる。「投資」と書かれた出費は、城や堤などの資産として残る。',
      ],
    },
    {
      title: 'お金（財務）',
      body: [
        '収入：年貢（天領の石高×民心×将軍と勘定奉行の腕）、金銀山（年々細る）、運上金・交易（商いとともに伸びる）。',
        '支出：旗本・御家人の俸禄、家臣の俸禄、大奥の費え、朝廷・寺社への費え、制度の維持費、借入の利息。',
        '物価は年々上がるが、年貢は石高で決まるので追いつかない。新田開発（石高）や長崎奉行・交易（運上金）で稼ぐ力を育てよう。',
        '現金が尽きると、商人から自動で借りてしのぐ（威光が少し下がる）。借入には年8%の利息がつく。',
        'キャッシュフロー計算書は、営業（年貢と経費）・投資（普請と制度）・財務（借入と返済）に分けて表示する。過去30年の決算も見られる。',
      ],
    },
    {
      title: '組織と家臣',
      body: [
        '役職は6つ。老中・勘定奉行・町奉行・大目付・京都所司代・寺社奉行。役職ごとに見る能力（政務・算用・武威・人望）が違う。',
        '空席のままだと、その役目の働きが大きく落ちる。メニューの「組織」に赤い印がついたら空席がある。',
        '家臣は役目の中で腕を上げ、60歳前後で職を辞す。毎年2人の登用候補が現れるので、早めに育てておこう。',
        '控えの家臣にも俸禄の半額がかかる。抱えすぎにも注意。',
      ],
    },
    {
      title: '若君と代替わり',
      body: [
        '将軍が若いうちに、若君が生まれることがある（最大3人）。',
        '20歳までは、1年に1回「師をつける」ことができる（教育費がかかる）。学問＝政務、武芸＝武威、人の道＝人徳、養生＝健康。',
        '成人した若君がいれば、いつでも将軍を隠居させて代替わりできる。15歳未満で将軍になると威光が下がる。',
        '若君がいないまま将軍が亡くなると、御三家があれば御三家から迎える。なければ跡目争いになり、大きな痛手を受ける。',
      ],
    },
    {
      title: '制度',
      body: [
        '実績と費用を使って整える。一度整えた制度は代をまたいで残る。',
        '毎年の効果があるもの、整えたときに一度だけ効くもの、悪い出来事を和らげるものがある。維持費がかかるものもある。',
      ],
    },
    {
      title: '倒幕の危機',
      body: [
        '威光・民心・朝廷のどれかが0になるか、借入が上限を超えると「倒幕の危機」になる。',
        '3年のうちに、威光・民心・朝廷をすべて10より上にし、借入を上限以下に戻せば危機を脱する。戻せなければゲームオーバー。',
        '年が進むほど、大飢饉・大名連合・黒船などの大きな試練が来やすくなる。',
      ],
    },
    {
      title: 'うまくやるコツ',
      body: [
        '序盤の黒字のうちに、新田開発の奨励や長崎奉行など「稼ぐ力」を育てる制度に投資しておく。',
        '大奥の費えは毎年かかる。減らせる出来事が来たら考えどき。',
        '老中と勘定奉行には腕のいい家臣を。若い有望な候補は、控えにしてでも早めに召し抱える。',
        '若君の教育は、のちの将軍の能力そのもの。お金に余裕があるうちに。',
      ],
    },
  ],
};
