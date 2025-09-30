// utils/storyExport.js
// 物語エントリ(JSONL配列)をブログ貼り付け用のプレーンテキストや
// XMLライク文字列に整形するユーティリティ

// XMLライク整形ではエスケープを行わない方針（json含む）

/**
 * 外側の括弧を1組だけ取り除く（ASCII/全角の両方に対応）
 * @param {string} text
 * @returns {string}
 */
function stripOuterParens(text) {
  if (!text) return "";
  const t = text.trim();
  // 全角（）, 半角()
  if ((t.startsWith("(") && t.endsWith(")")) || (t.startsWith("（") && t.endsWith("）"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * すでに「」で囲まれているか判定
 * @param {string} text
 */
function isQuotedJa(text) {
  if (!text) return false;
  const t = text.trim();
  return t.startsWith("「") && t.endsWith("」");
}

/**
 * プレーンテキストとして安全に扱うための軽い整形
 * - 改行はそのままにする（ブログ側で整形）
 * - 先頭末尾の空白をトリム
 * @param {string} text
 */
function sanitize(text) {
  return (text ?? "").toString().replace(/\r\n?/g, "\n").trim();
}

/**
 * ブログ貼り付け用に整形
 * ルール:
 * - reject は除外
 * - direction は行頭に【...】で見出し化
 * - narration は行頭に"* "を付ける
 * - action は `Name (text)`（name が無ければ `(text)`）
 * - dialogue は `Name 「text」`（name 無ければ `「text」`）。既に「」で囲まれていれば重ねて囲まない
 * 入力配列の順序は保持
 * @param {Array<{type:string, content:string, name?:string}>} entries
 * @param {{ includeActionName?: boolean, includeDialogueName?: boolean }} [options] - アクション/発言の前に名前を付けるか（各デフォルト: true）
 * @returns {string}
 */
export function formatStoryForBlog(entries, options = {}) {
  const { includeActionName = true, includeDialogueName = true } = options;
  if (!Array.isArray(entries)) return "";
  const lines = [];
  let prevGroup = null; // 'narration' | 'direction' | 'other' | null

  const groupOf = (t) => (t === "narration" ? "narration" : t === "direction" ? "direction" : "other");

  for (const entry of entries) {
    if (!entry || !entry.type) continue;
    const type = entry.type;
    if (type === "reject") continue; // 物語に含めない

    const content = sanitize(entry.content);
    const group = groupOf(type);

    switch (type) {
      case "direction": {
        if (!content) break;
        // 異なるグループ間の境界では空行を1つ挿入
        if (prevGroup !== null && prevGroup !== group && lines.at(-1) !== "") {
          lines.push("");
        }
        lines.push(`【${content}】`);
        prevGroup = group;
        break;
      }
      case "narration": {
        if (!content) break;
        // 異なるグループ間の境界では空行を1つ挿入
        if (prevGroup !== null && prevGroup !== group && lines.at(-1) !== "") {
          lines.push("");
        }
        lines.push(`* ${content}`);
        prevGroup = group;
        break;
      }
      case "action": {
        if (!content) break;
        if (prevGroup !== null && prevGroup !== group && lines.at(-1) !== "") {
          lines.push("");
        }
        const act = stripOuterParens(content);
        if (includeActionName && entry.name && entry.name.trim()) {
          lines.push(`${entry.name.trim()} (${act})`);
        } else {
          lines.push(`(${act})`);
        }
        prevGroup = group;
        break;
      }
      case "dialogue": {
        if (!content) break;
        if (prevGroup !== null && prevGroup !== group && lines.at(-1) !== "") {
          lines.push("");
        }
        const quoted = isQuotedJa(content) ? content.trim() : `「${content}」`;
        if (includeDialogueName && entry.name && entry.name.trim()) {
          lines.push(`${entry.name.trim()} ${quoted}`);
        } else {
          lines.push(quoted);
        }
        prevGroup = group;
        break;
      }
      default: {
        // 未知タイプは無視（将来の拡張余地）
        break;
      }
    }
  }

  // 末尾の空行を整理
  let result = lines.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n").trimEnd();
  return result;
}

export default formatStoryForBlog;

/**
 * エントリ配列をXMLライク文字列に整形
 * rejectは除外し、name属性は存在する場合のみ付与します。
 * デフォルトでは <history> でラップしません。
 * @param {Array<{type:string, content:string, name?:string}>} entries
 * @param {{wrap?: boolean}} options
 * @returns {string}
 */
export function formatStoryAsXml(entries, options = {}) {
  const { wrap = false } = options;
  if (!Array.isArray(entries)) return "";
  const lines = entries
    .filter((e) => e && e.type && e.type !== "reject")
    .map((entry) => {
      const tag = entry.type;
      const nameAttr = entry.name ? ` name="${entry.name}"` : "";
      // json タイプはもちろん、他タイプも生で埋め込む
      if (tag === "json") {
        const raw = (entry.content ?? "").toString();
        return `<${tag}${nameAttr}>${raw}</${tag}>`;
      }
      const body = (entry.content ?? "").toString();
      return `<${tag}${nameAttr}>${body}</${tag}>`;
    });
  const inner = lines.join("\n");
  return wrap ? `<history>\n${inner}\n</history>` : inner;
}
