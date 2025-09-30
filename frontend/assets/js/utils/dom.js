// dom.js
// 軽量な DOM ヘルパー関数群。
// 目的: DOM 操作のボイラープレートを減らし、プロジェクト内で一貫した API を提供する。
// 注意: ここでは副作用を最小限にして、呼び出し元でイベントリスナ追加やスタイル操作を行います。

/**
 * qs(selector, root=document)
 * - document.querySelector の短縮ラッパー。
 * - root を指定するとそのコンテキスト内で検索します（テストやモーダル内部などで有用）。
 * @returns {Element|null}
 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * qsa(selector, root=document)
 * - querySelectorAll の結果を配列に変換して返すユーティリティ。
 * - NodeList を直接扱うよりも配列メソッドが使える点が利点です。
 * @returns {Array<Element>}
 */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * createElement(tag, options)
 * - 汎用的な要素生成ユーティリティ。
 * - options のサポート: className, dataset (オブジェクト), attrs (オブジェクト), text (テキスト), html (innerHTML), children (配列)
 * - 注意: html を使う場合は挿入する文字列が安全であることを保証してください（XSS のリスク）。
 * @returns {HTMLElement}
 */
export function createElement(tag, options = {}) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      el.dataset[key] = value;
    });
  }
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
  }
  if (options.text != null) {
    el.textContent = options.text;
  }
  if (options.html != null) {
    el.innerHTML = options.html;
  }
  if (options.children) {
    options.children.forEach((child) => {
      if (child) el.append(child);
    });
  }
  return el;
}

/**
 * clearChildren(el)
 * - 指定要素の子要素をすべて削除するユーティリティ。
 * - 単純なループで firstChild を削除していくことで、余分な再描画を避けつつ確実にクリアします。
 */
export function clearChildren(el) {
  while (el && el.firstChild) {
    el.removeChild(el.firstChild);
  }
}
