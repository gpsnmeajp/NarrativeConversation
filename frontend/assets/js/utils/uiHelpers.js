// utils/uiHelpers.js
// ボタンを「実行中」状態にして処理の完了後に元へ戻す小ヘルパー

/**
 * ボタンを実行中状態にして、処理関数の前後で自動的に復元する
 * @param {HTMLButtonElement} button 対象ボタン
 * @param {string} busyLabel 実行中ラベル（例: "生成中…"）
 * @param {() => Promise<any>} fn 実行する非同期処理
 */
export async function withBusy(button, busyLabel, fn) {
  if (!button || typeof fn !== 'function') return await fn();
  const originalDisabled = button.disabled;
  const originalLabel = button.textContent;
  try {
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    return await fn();
  } finally {
    button.disabled = originalDisabled;
    button.textContent = originalLabel;
  }
}
