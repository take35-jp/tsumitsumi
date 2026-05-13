// 商品名クリーニング・スケール/シリーズ推測ヘルパー
// admin.html の cleanName / guessScale / guessSeries をサーバ側に移植
// 同期処理のみ・依存なし。auto-seed.js から import

// ====== cleanName ======
// 18ステップの商品名クリーニング（admin.html v9.10 と同等）
export function cleanName(name) {
  if (!name) return '';
  let s = String(name);

  // 0. HTML entities & 全角空白
  s = s.replace(/　/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"');

  // 1. スケール表記の正規化 "1 / 144" → "1/144"
  s = s.replace(/(1)\s*\/\s*(\d{2,3})/g, '$1/$2');

  // 2. 全角英数→半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // 3. 装飾記号の除去
  s = s.replace(/[★☆♪♡♥◆◇●○◎■□▼▽▲△※〇♦♣♠❤❥]/g, ' ');

  // 4. プレバン関連の除去
  s = s.replace(/プレ(?:バン|ミアムバンダイ)\s*限定/g, ' ');
  s = s.replace(/プレ(?:バン|ミアムバンダイ)\s*[＆&]\s*/g, ' ');
  s = s.replace(/プレ(?:バン|ミアムバンダイ)/g, ' ');
  s = s.replace(/プレミアム\s*バンダイ/g, ' ');

  // 4-2. 限定店表記
  s = s.replace(/バンダイホビーサイト限定/g, ' ');
  s = s.replace(/ホビーオンラインショップ限定/g, ' ');
  s = s.replace(/ホビーオンライン限定/g, ' ');
  s = s.replace(/ガンダムベース限定/g, ' ');
  s = s.replace(/魂ウェブ商店限定/g, ' ');

  // 4-3. {PTM}
  s = s.replace(/\{PTM\}/g, ' ');

  // 4-4. 返品種別+任意のアルファベット
  s = s.replace(/返品種別[A-Za-z]?/g, ' ');

  // 5. 予約・発売予定日の除去
  const tailPats = [
    /[\[【［]\s*予約[^】］\]]*?[\]】］]/g,
    /[\[【［]\s*\d{4}年\s*\d{1,2}月[^】］\]]*?[\]】］]/g,
    /[《〈]\s*\d{1,2}月\s*予約\s*[》〉]/g,
    /[《〈]\s*予約\s*[》〉]/g,
    /[《〈][^》〉]*?(?:予約|発売|出荷|発送)[^》〉]*?[》〉]/g,
    /予約\s*\d{4}年\s*\d{1,2}月[^\s]*?(?:発送|出荷|発売)?\s*予定/g,
    /\d{4}年\s*\d{1,2}月\s*(?:発送|出荷|発売)\s*予定/g,
    /予約販売/g,
    /予約商品/g,
    /\d{4}\/\d{1,2}\/\d{1,2}\s*(?:発売|出荷|発送)/g,
    /\d{1,2}月\s*(?:発売|出荷|発送)\s*予定/g,
  ];
  for (const p of tailPats) s = s.replace(p, ' ');

  // 6. メーカー型番カッコ
  s = s.replace(/[（(][A-Z]{1,5}\d{4,}[）)]/g, ' ');
  s = s.replace(/[（(]\d{4,}[）)]/g, ' ');

  // 7. 販売店名
  const shopNames = ['駿河屋','スルガヤ','トイザらス','ヨドバシ','ヨドバシカメラ','ホビコレ','ジョーシン','あみあみ','ビックカメラ','楽天ブックス','Amazon','アマゾン','ハピネット','ホビーオンライン','ホビーストック','ハーミットグリーンキャブ','メーカー特典','店舗特典','特典','TSUTAYA','HMV','ジョーシンwebショップ'];

  // 8. 汚いコンテンツのカッコを消す
  const noiseKWs = ['再販','再生産','新品','中古','未使用','未組立','未開封','送料無料','送料込','即納','即日','プレバン','プレミアムバンダイ','代引','クーポン','セール','特価','最安','予約','ポイント','アウトレット','訳あり','箱痛み','店舗限定','数量限定','一人','人気','在庫','返品種別', ...shopNames];
  function isDirty(c) {
    for (const w of noiseKWs) if (c.includes(w)) return true;
    if (/\d{4}年/.test(c)) return true;
    return false;
  }
  function procBrackets(str, ob, cb) {
    let out = ''; let i = 0;
    while (i < str.length) {
      if (str[i] === ob) {
        const end = str.indexOf(cb, i + 1);
        if (end === -1) { out += str[i]; i++; continue; }
        const ct = str.substring(i + 1, end);
        out += isDirty(ct) ? ' ' : str.substring(i, end + 1);
        i = end + 1;
      } else { out += str[i]; i++; }
    }
    return out;
  }
  for (const [ob, cb] of [['『', '』'], ['【', '】'], ['［', '］'], ['[', ']'], ['（', '）'], ['(', ')'], ['｛', '｝'], ['{', '}'], ['《', '》'], ['〈', '〉']]) {
    s = procBrackets(s, ob, cb);
  }

  // 9. 販売店名が単独で入ってる場合
  for (const sp of shopNames) {
    const esc = sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`(^|\\s)${esc}(\\s|$)`, 'g'), ' ');
  }

  // 9.5. {PTM} と 返品種別[A-Z]?
  s = s.replace(/\{PTM\}/g, ' ');
  s = s.replace(/返品種別[A-Z]?/g, ' ');

  // 10. ノイズキーワードの直接除去
  const NOISE = ['爆買','再販','再生産','新品','中古','未使用','未組立','未組み立て','未開封','送料無料','送料込み','送料込','即納','即日発送','即日','代引き不可','代引不可','クーポン','セール','特価','最安値','最安','プラスチックモデルキット','スケールプラモデル','プラモデル組立キット','組み立て式','組立式','組立キット','組立てキット','プラモデル','プラモ','株式会社','お一人様1点限り','お一人様1点','お一人様限定','1点限り','1人1点','数量限定','店舗限定','人気商品','在庫あり','即出荷','メーカー在庫品','正規品','日本正規品','ポイント10倍','ポイント還元','ポイントUP','アウトレット','訳あり','箱痛み','箱ダメージ','輸入品','並行輸入','早期予約','予約特典','予約限定','期間限定','限定版','大人気','話題沸騰','話題','定番','人気','おもちゃ','玩具','フィギュア','コレクション玩具','キャラクターグッズ','プラスチック製','プラモデル本体','【中古】','{PTM}','【PTM】','［PTM］','[PTM]','｛PTM｝','エントリーで','MAX10倍','スーパーDEAL','RAKUTENカード','楽天スーパーSALE','スーパーSALE','SALE','sale'];
  for (const w of NOISE) s = s.split(w).join(' ');

  // 11. 壽屋/コトブキヤ表記の正規化
  s = s.replace(/^\s*壽屋\s*[（(]\s*コトブキヤ\s*[）)]\s*/, '');
  s = s.replace(/^\s*壽屋\s+/, '');

  // 11-2. バンダイスピリッツ系表記の統合除去
  s = s.replace(/バンダイ\s*スピリッツ/g, ' ');
  s = s.replace(/BANDAI\s*SPIRITS/gi, ' ');

  // 12. メーカー名の除去
  const trailMakers = ['BANDAI SPIRITS','バンダイ スピリッツ','バンダイスピリッツ','バンダイ','BANDAI','SPIRITS','コトブキヤ','KOTOBUKIYA','タミヤ','TAMIYA','ハセガワ','HASEGAWA','フジミ','FUJIMI','アオシマ','AOSHIMA','ファインモールド','グッドスマイルカンパニー','グッスマ','ウェーブ','WAVE','ボークス','VOLKS','壽屋','マックスファクトリー','MAX FACTORY','ピットロード','プラッツ','童友社'];
  trailMakers.sort((a, b) => b.length - a.length);
  for (const m of trailMakers) {
    const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('\\s+' + esc + '\\s*$'), '');
    s = s.replace(new RegExp('\\s+' + esc + '\\s+[A-Z][A-Za-z]+\\s*$'), '');
  }
  for (const m of trailMakers) {
    const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('^\\s*' + esc + '\\s+'), '');
  }

  // 12-2. 単独「SPIRITS」が末尾に残ったケース
  s = s.replace(/\s+SPIRITS\s*$/i, '');

  // 12-3. 冒頭のSPIRITS残骸
  s = s.replace(/^SPIRITS\s*[\(\[（［]/, '(');
  s = s.replace(/^SPIRITS\s+/, '');
  s = s.replace(/^BANDAI\s+/, '');
  s = s.replace(/(^|[\s\(\)\[\]【】［］『』（）/])BANDAI(?![A-Za-z])/g, '$1');
  s = s.replace(/(^|[\s\(\)\[\]【】［］『』（）/])SPIRITS(?![A-Za-z])/g, '$1');

  // 13. 単独13桁数字
  s = s.replace(/\s+\d{13}\s*$/, '');
  s = s.replace(/^\s*\d{13}\s+/, '');
  s = s.replace(/\s+\d{13}\s+/g, ' ');
  s = s.replace(/^[A-Z]-\d{13}\s+/, '');
  s = s.replace(/\s+[A-Z]-\d{13}\s+/g, ' ');
  s = s.replace(/\s+[A-Z]-\d{13}\s*$/, '');

  // 14. スケール・サイズ表記の整理
  s = s.replace(/\/?全高約?\d+(?:\.\d+)?\s*(?:mm|cm|ｍｍ|ｃｍ)/g, '');
  s = s.replace(/\/?\d+(?:\.\d+)?\s*(?:mm|cm)スケール/g, '');
  s = s.replace(/(1\/\d{2,3})スケール/g, '$1');
  s = s.replace(/1\/1スケール\s*\/?/g, ' ');

  // 15. 末尾の型番
  s = s.replace(/\s+[A-Z]{1,5}\d{2,5}[A-Z]?\s*$/, '');

  // 16. & の整理
  s = s.replace(/\s+[＆&]\s+/g, ' ');
  s = s.replace(/\s*[＆&]\s*$/, '');
  s = s.replace(/^\s*[＆&]\s*/, '');
  s = s.replace(/^\s*[／/・]\s*/, '');
  s = s.replace(/\s*[／/]\s*$/, '');

  // 17. {PTM}類のあらゆる表記
  s = s.replace(/[\{｛【\[［]\s*PTM\s*[\}｝】\]］]/gi, ' ');

  // 17-2. 空括弧消去
  s = s.replace(/\s*[\(\[（［【『｛]\s*[\)\]）］】』｝]\s*/g, ' ');
  s = s.replace(/[\(\[（［【『｛]\s+[\)\]）］】』｝]/g, ' ');

  // 18. 連続スペース・前後トリム
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[\s　・/／\-—–]+|[\s　・/／\-—–]+$/g, '');

  return s;
}

// ====== guessScale ======
// SCALE_OPTIONS（App.jsx）と整合する値のみを返す。グレード優先、次に数値スケール。
export function guessScale(name) {
  if (!name) return '';
  // グレード（長いものから・順序が重要）
  if (/\bMGSD\b/i.test(name)) return 'MGSD';
  if (/\bMGEX\b/i.test(name)) return 'MG'; // MGEX は MG にフォールバック
  if (/RE\/100/i.test(name)) return 'RE/100';
  if (/FULL\s*MECHANICS|フルメカニクス/i.test(name)) return 'フルメカニクス';
  if (/\bPG\b/i.test(name)) return 'PG';
  if (/\bRG\b/i.test(name)) return 'RG';
  if (/\bHGUC\b|\bHGCE\b|\bHGAC\b|\bHGFC\b/i.test(name)) return 'HG';
  if (/\bHG\b/i.test(name)) return 'HG';
  if (/\bMG\b/i.test(name)) return 'MG';
  if (/\bEG\b/i.test(name)) return 'EG';
  if (/\bSD\b|BB戦士/i.test(name)) return 'SD';
  // 数値スケール
  if (/1\/1700\b/.test(name)) return '1/1700';
  if (/1\/550\b/.test(name)) return '1/550';
  if (/1\/144\b/.test(name)) return '1/144';
  if (/1\/100\b/.test(name)) return '1/100';
  if (/1\/72\b/.test(name)) return '1/72';
  if (/1\/60\b/.test(name)) return '1/60';
  if (/1\/48\b/.test(name)) return '1/48';
  if (/1\/35\b/.test(name)) return '1/35';
  if (/1\/32\b/.test(name)) return '1/32';
  if (/1\/24\b/.test(name)) return '1/24';
  if (/1\/20\b/.test(name)) return '1/20';
  if (/1\/12\b/.test(name)) return '1/12';
  // デカール
  if (/デカール|decal/i.test(name)) return 'デカール';
  return '';
}

// ====== guessSeries ======
// 商品名から作品名（シリーズ）を推測する。長い名前を優先マッチ
const _SERIES = [
  // ガンダム作品
  '機動戦士ガンダム ククルス・ドアンの島','ククルス・ドアンの島',
  '機動戦士ガンダム 閃光のハサウェイ','閃光のハサウェイ','ハサウェイ',
  '機動戦士ガンダム 水星の魔女','水星の魔女',
  '機動戦士ガンダム 復讐のレクイエム','復讐のレクイエム',
  '機動戦士ガンダム ジ・オリジン','ジ・オリジン','THE ORIGIN','ORIGIN',
  '機動戦士ガンダムNT','ガンダムNT','GUNDAM NT','機動戦士ガンダム ナラティブ','ナラティブ',
  '機動戦士ガンダムUC','ガンダムUC','GUNDAM UC','ユニコーン',
  '機動戦士ガンダムF91','ガンダムF91','F91',
  '機動戦士ガンダム0080 ポケットの中の戦争','ポケットの中の戦争','0080',
  '機動戦士ガンダム0083 STARDUST MEMORY','スターダストメモリー','0083',
  '機動戦士ガンダム MS IGLOO','MS IGLOO','イグルー',
  '機動戦士Vガンダム','Vガンダム',
  '機動戦士ガンダムZZ','ZZガンダム','ガンダムZZ','ZZ',
  '機動戦士Zガンダム','Zガンダム',
  '機動戦士ガンダム 鉄血のオルフェンズ','鉄血のオルフェンズ','鉄血',
  '機動戦士ガンダムSEED FREEDOM','SEED FREEDOM',
  '機動戦士ガンダムSEED DESTINY','SEED DESTINY','ガンダムSEED DESTINY',
  '機動戦士ガンダムSEED','ガンダムSEED','SEED',
  '機動戦士ガンダム00','ガンダム00','GUNDAM 00','ダブルオー','OO',
  '機動戦士ガンダムAGE','ガンダムAGE',
  '機動戦士クロスボーンガンダム','クロスボーンガンダム','クロスボーン',
  '機動武闘伝Gガンダム','Gガンダム',
  '新機動戦記ガンダムW','ガンダムW','ガンダムウイング','GUNDAM WING',
  '機動新世紀ガンダムX','ガンダムX',
  '∀ガンダム','ターンエー',
  '逆襲のシャア','シャアの逆襲','CCA',
  '機動戦士ガンダム THE ORIGIN',
  '機動戦士ガンダム',
  // ビルド系
  'ガンダムビルドメタバース','ビルドメタバース',
  'ガンダムビルドリアル','ビルドリアル',
  'ガンダムビルドダイバーズRe:RISE','ビルドダイバーズRe:RISE',
  'ガンダムビルドダイバーズ','ビルドダイバーズ',
  'ガンダムビルドファイターズトライ','ビルドファイターズトライ',
  'ガンダムビルドファイターズ','ビルドファイターズ',
  // SD系
  'SDガンダム外伝','SDガンダム ワールドヒーローズ','SDガンダムワールドヒーローズ',
  'SDガンダム三国伝','SDガンダム 三国伝','三国伝',
  '武者頑駄無','武者ガンダム',
  'ナイトガンダム','騎士ガンダム',
  // その他人気作品
  'エヴァンゲリオン','EVANGELION',
  'マクロス',
  'バーチャロン',
  'フレームアームズ・ガール','フレームアームズガール','FRAME ARMS GIRL','FA:G',
  'フレームアームズ','FRAME ARMS','FA:',
  'メガミデバイス','MEGAMI DEVICE',
  'ヘキサギア','HEXA GEAR',
  'ボーダーブレイク',
  'ファイブスター物語','F.S.S.','FSS',
  'スパロボ','スーパーロボット大戦',
  'バトルテック',
  'ULTRAMAN','ウルトラマン',
  'ゴジラ',
  '仮面ライダー',
  'スター・ウォーズ','スターウォーズ','STAR WARS',
];

export function guessSeries(name) {
  if (!name) return '';
  for (const sr of _SERIES) {
    const esc = sr.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const re = new RegExp('(?:^|[\\s/／・|｜])(' + esc + ')(?=\\s|$|[^A-Za-z0-9々])', 'i');
    if (re.test(name)) return sr;
  }
  return '';
}

// ====== guessSeriesForMaker ======
// メーカー別のフォールバック・シリーズ判定（guessSeries が拾えなかった場合の保険）
export function guessSeriesForMaker(name, maker) {
  const n = name || '';
  switch (maker) {
    case 'バンダイ':
      if (/30MM|30 Minutes Missions/i.test(n)) return '30 Minutes Missions';
      if (/30MS|30 Minutes Sisters/i.test(n)) return '30 Minutes Sisters';
      if (/30MF|30 Minutes Fantasy/i.test(n)) return '30 Minutes Fantasy';
      if (/Figure-rise/i.test(n)) return 'Figure-rise Standard';
      if (/ポケモン|ポケットモンスター|ポケプラ/i.test(n)) return 'ポケプラ';
      if (/ゾイド|ZOIDS/i.test(n)) return 'ゾイド';
      if (/ウルトラマン/i.test(n)) return 'ウルトラマン（バンダイ）';
      if (/仮面ライダー/i.test(n)) return '仮面ライダー（バンダイ）';
      if (/ハロプラ|HAROPLA/i.test(n)) return 'ハロプラ';
      if (/エヴァ|エヴァンゲリオン|EVA/i.test(n)) return '新世紀エヴァンゲリオン';
      if (/マクロス/i.test(n)) return 'マクロス（バンダイ）';
      if (/スターウォーズ|STAR WARS/i.test(n)) return 'スターウォーズ（バンダイ）';
      if (/ミニ四駆/i.test(n)) return 'ミニ四駆';
      if (/ガンダム|Gundam|HG|MG|RG|PG|EG|SD|MGSD|MGEX/i.test(n)) return 'ガンプラ';
      return 'ガンプラ';
    case 'タミヤ':
      if (/1\/35|AFV|戦車|装甲|軍用車|ハーフトラック|ジープ|トラック/i.test(n)) return 'タミヤ 戦車・AFV';
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母|潜水艦/i.test(n)) return 'タミヤ 艦船';
      if (/1\/48|1\/72|飛行機|戦闘機|爆撃機|輸送機|ヘリ/i.test(n)) return 'タミヤ 飛行機';
      if (/1\/12|バイク|オートバイ|モーターサイクル/i.test(n)) return 'タミヤ バイク';
      if (/1\/24|1\/20|車|カー|レーシング|スポーツ|F1|フォーミュラ/i.test(n)) return 'タミヤ 自動車';
      if (/ミニ四駆|ミニ4駆/i.test(n)) return 'ミニ四駆';
      return 'タミヤ';
    case 'ハセガワ':
      if (/1\/72|1\/48|1\/32|飛行機|戦闘機|爆撃機|輸送機|ヘリ|航空機/i.test(n)) return 'ハセガワ 飛行機';
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母/i.test(n)) return 'ハセガワ 艦船';
      if (/1\/24|車|カー/i.test(n)) return 'ハセガワ 自動車';
      if (/マクロス|バルキリー/i.test(n)) return 'マクロス（ハセガワ）';
      if (/エヴァ|エヴァンゲリオン/i.test(n)) return '新世紀エヴァンゲリオン';
      return 'ハセガワ';
    case 'アオシマ':
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母|自衛隊/i.test(n)) return 'アオシマ 艦船';
      if (/宇宙戦艦ヤマト|ヤマト/i.test(n)) return '宇宙戦艦ヤマト';
      if (/1\/24|車|カー|族車/i.test(n)) return 'アオシマ 自動車';
      return 'アオシマ';
    case 'フジミ':
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母/i.test(n)) return 'フジミ 艦船';
      if (/1\/24|車|カー/i.test(n)) return 'フジミ 自動車';
      if (/1\/72|1\/48|飛行機/i.test(n)) return 'フジミ 飛行機';
      return 'フジミ';
    case 'ピットロード':
      if (/艦船|戦艦|駆逐艦|護衛艦|潜水艦/i.test(n)) return 'ピットロード 艦船';
      if (/航空機|飛行機|戦闘機/i.test(n)) return 'ピットロード 航空機';
      return 'ピットロード';
    case 'ファインモールド':
      if (/スターウォーズ|STAR WARS/i.test(n)) return 'スターウォーズ（ファインモールド）';
      if (/飛行機|戦闘機|航空機/i.test(n)) return 'ファインモールド 飛行機';
      return 'ファインモールド';
    case 'ウェーブ':
      if (/マシーネンクリーガー|Ma\.K\.|S\.F\.3\.D/i.test(n)) return 'マシーネンクリーガー';
      return 'ウェーブ';
    case 'コトブキヤ':
      if (/フレームアームズ・ガール|フレームアームズガール|FA:G|FAG/i.test(n)) return 'フレームアームズ・ガール';
      if (/フレームアームズ|FRAME ARMS|FA:/i.test(n)) return 'フレームアームズ';
      if (/メガミデバイス|MEGAMI DEVICE/i.test(n)) return 'メガミデバイス';
      if (/ヘキサギア|HEXA GEAR/i.test(n)) return 'ヘキサギア';
      if (/M\.S\.G|MSG/i.test(n)) return 'M.S.G';
      if (/ファイブスター|F\.S\.S\.|FSS/i.test(n)) return 'ファイブスター物語';
      return 'コトブキヤ';
    case 'グッドスマイルカンパニー':
      if (/MODEROID/i.test(n)) return 'MODEROID';
      return 'グッドスマイル';
    case 'マックスファクトリー':
      if (/PLAMAX/i.test(n)) return 'PLAMAX';
      return 'マックスファクトリー';
    default:
      return maker || '';
  }
}
