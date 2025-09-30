/**
 * UUID生成ユーティリティ
 * crypto.randomUUIDが利用できない環境でも動作する
 */

/**
 * UUID v4を生成する
 * @returns {string} UUID文字列
 */
export function generateUUID() {
  // crypto.randomUUIDが利用可能な場合はそれを使用
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // フォールバック実装（RFC 4122準拠のUUID v4）
  // 環境によっては crypto.randomUUID が使えないブラウザや古い環境があるため
  // その場合に Math.random ベースの実装で UUIDv4 を生成する
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}