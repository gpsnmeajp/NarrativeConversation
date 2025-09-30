/**
 * escapeXml(str)
 * - テキストを XML/HTML に安全に挿入するための簡易エスケープ関数
 * - 実運用ではより堅牢なサニタイズライブラリを検討してくださいが、本プロジェクトでは
 *   生成テキストを DOM に挿入する前の軽量な保護策として利用されます。
 */
export function escapeXml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * formatDateTime(date)
 * - Date オブジェクトまたは日付文字列を受け取り、
 *   'YYYY-MM-DD HH:MM' 形式の短い日時文字列に変換して返します。
 */
export function formatDateTime(date) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * truncate(str, length)
 * - 文字列を指定長で切り、超過する場合は末尾に省略記号を付けて返します。
 */
export function truncate(str = "", length = 80) {
  return str.length > length ? `${str.slice(0, length)}…` : str;
}
