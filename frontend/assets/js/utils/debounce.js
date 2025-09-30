// 汎用的なデバウンス関数
// 連続した呼び出しをまとめ、最後の呼び出しのみを指定時間後に実行する
export function debounce(fn, wait = 400) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}
