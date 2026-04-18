const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

function cleanName(name) {
  // 『』で囲まれた部分を削除
  name = name.replace(/『[^』]*』/g, "");
  // 【】で囲まれた部分を削除
  name = name.replace(/【[^】]*】/g, "");
  // ［］で囲まれた部分を削除
  name = name.replace(/［[^］]*］/g, "");
  // 〔〕で囲まれた部分を削除
  name = name.replace(/〔[^〕]*〕/g, "");

  // 余計なワードを削除
  const noiseWords = [
    /爆買/g, /再販/g, /再生産/g, /新品/g, /送料無料/g, /即納/g, /即日/g,
    /在庫品/g, /発売済/g, /BANDAI SPIRITS/g, /バンダイスピリッツ/g,
    /色分け済みプラモデル/g, /色分け済み/g, /《[^》]*》/g,
    /在庫あり/g, /お得/g, /限定/g, /セール/g, /SALE/gi,
    /プレミアムバンダイ限定/g, /プレバン限定/g,
    /代引き不可/g, /〈プラモデル〉/g, /＜プラモデル＞/g,
    /<プラモデル>/g, /（プラモデル）/g, /\(プラモデル\)/g,
    /バンダイホビー/g, /バンダイスピリッツ/g,
  ];
  for (const w of noiseWords) name = name.replace(w, "");

  // 数字コードの括弧を削除（例：(0194873)、（6552））
  name = name.replace(/[（(][0-9]{4,}[）)]/g, "");

  // グレード・スケールのキーワードが出てきた位置から取り出す
  const startKeywords = [
    /\bMGSD\b/, /\bPG\b/, /\bRG\b/, /\bHG[A-Z\s]*\b/, /\bEG\b/, /\bSD\b/, /\bMG\b/,
    /1\/144/, /1\/100/, /1\/60/, /1\/72/, /1\/48/, /1\/35/, /1\/24/, /1\/12/,
  ];
  for (const kw of startKeywords) {
    const match = name.match(kw);
    if (match) {
      name = name.slice(name.indexOf(match[0]));
      break;
    }
  }

  // グレード・スケールの後ろの余計なものを削除
  const stopKeywords = [
    /\s+プラモデル/, /\s+バンダイ(?!ホビー)/, /\s+BANDAI/i,
    /\s+機動戦士ガンダム(?!X|W|F91|V|00|SEED)/, /\s+機動新世紀/, /\s+新機動/,
    /\s+鉄血のオルフェンズ/, /\s+水星の魔女/, /\s+宇宙世紀/,
    /\s+ガンダムSEED(?!DESTINY)/, /\s+ガンダムWing/, /\s+ガンダム00/,
    /\s+爆買/, /\s+再販/,
  ];
  for (const kw of stopKeywords) {
    const match = name.match(kw);
    if (match) name = name.slice(0, name.indexOf(match[0]));
  }

  // &amp; を & に
  name = name.replace(/&amp;/g, "&");

  // 連続スペース・前後スペースを整理
  name = name.replace(/\s+/g, " ").trim();

  return name;
}

function guessScale(name) {
  if (/\bMGSD\b/i.test(name)) return "MGSD";
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHG\b/i.test(name)) return "HG";
  if (/\bSD\b/i.test(name)) return "SD";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/1\/100/i.test(name)) return "1/100";
  if (/1\/144/i.test(name)) return "1/144";
  if (/1\/72/i.test(name)) return "1/72";
  if (/1\/60/i.test(name)) return "1/60";
  if (/1\/48/i.test(name)) return "1/48";
  if (/1\/35/i.test(name)) return "1/35";
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { grade, page = "1", q = "" } = req.query;
  if (!grade) return res.status(400).json({ error: "grade required" });

  const gradeKeywords = {
    MG:   "MG ガンダム プラモデル バンダイ",
    HG:   "HG ガンダム プラモデル バンダイ",
    RG:   "RG ガンダム プラモデル バンダイ",
    PG:   "PG ガンダム プラモデル バンダイ",
    SD:   "SD ガンダム BB戦士 バンダイ",
    MGSD: "MGSD ガンダム バンダイ",
    "30MM":  "30MM 30 MINUTES MISSIONS プラモデル バンダイ",
    "30MS":  "30MS 30 MINUTES SISTERS プラモデル バンダイ",
    "30MF":  "30MF 30 MINUTES FANTASY プラモデル バンダイ",
    "30MP":  "30MP 30 MINUTES PREFERENCE プラモデル バンダイ",
  };

  const baseKeyword = gradeKeywords[grade];
  if (!baseKeyword) return res.status(400).json({ error: "invalid grade" });

  // 30Minシリーズはガンダムを含まないのでキーワード生成を分岐
  const is30min = ["30MM", "30MS", "30MF", "30MP"].includes(grade);
  const keyword = q.trim()
    ? is30min
      ? `${grade} ${q.trim()} プラモデル`
      : `${grade} ${q.trim()} ガンダム プラモデル`
    : baseKeyword;
  const start = (Number(page) - 1) * 30 + 1;


  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&query=${encodeURIComponent(keyword)}&results=30&start=${start}&output=json`;
    const r = await fetch(url);
    const data = await r.json();

    if (data.Error) return res.status(400).json({ error: data.Error.Message });

    const seen = new Set();
    const items = (data?.hits || [])
      .map(item => ({
        name: cleanName(item.name || ""),
        scale: guessScale(item.name || ""),
        photoUrl: item.image?.medium || item.image?.small || "",
        jan: item.janCode || "",
        price: item.price ? String(item.price) : "",
      }))
      .filter(item => item.name.length > 2)
      .filter(item => {
        // グレード不一致を除外（例：HG検索でMGが混入するのを防ぐ）
        if (grade === 'HG' && /\bMG\b/.test(item.name) && !/\bHG\b/.test(item.name)) return false;
        if (grade === 'MG' && /\bHG\b/.test(item.name) && !/\bMG\b/.test(item.name)) return false;
        if (grade === 'RG' && !/\bRG\b/.test(item.name)) return false;
        if (grade === 'PG' && !/\bPG\b/.test(item.name)) return false;
        return true;
      })
      .filter(item => {
        const key = item.jan || item.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return res.json({ items, total: data?.totalResultsAvailable || 0, page: Number(page) });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
