// components/modal.js
// 汎用モーダルダイアログユーティリティ
// このモジュールはアプリ内でモーダルウィンドウを一元的に扱うための helper を提供します。
// - showModal: 任意のコンテンツとアクションでモーダルを表示し、閉じるための関数を返します。
// - closeModal: ルートにあるモーダルをクローズします。
// - showConfirmDialog: Promise を返す確認ダイアログ（OK/キャンセル）を簡単に生成します。

import { qs, clearChildren, createElement } from "../utils/dom.js";

const modalRoot = () => qs("#modal-root");

/**
 * showModal({ title, content, actions, closeOnBackdrop })
 * - content は文字列（HTML）または DOM Node を受け取ります。
 * - actions は配列で各要素に { label, className?, onClick? } を渡します。
 * - action.onClick が false を返すとモーダルは閉じません（確認処理など）。
 * - 戻り値: close() 関数（呼び出すとモーダルを閉じる）
 */
export function showModal({ title, content, actions = [], closeOnBackdrop = true }) {
  const root = modalRoot();
  if (!root) return () => {};

  const close = () => {
    clearChildren(root);
  };

  const backdrop = createElement("div", { className: "modal-backdrop" });
  backdrop.addEventListener("click", (event) => {
    // 背景クリックでモーダルを閉じる（クリックターゲットが backdrop の場合）
    if (event.target === backdrop && closeOnBackdrop) close();
  });

  const modal = createElement("div", { className: "modal" });
  if (title) {
    modal.append(createElement("h3", { text: title }));
  }
  if (typeof content === "string") {
    modal.append(createElement("div", { html: content }));
  } else if (content instanceof Node) {
    modal.append(content);
  }

  if (actions.length) {
    const actionRow = createElement("div", { className: "modal-actions" });
    actions.forEach((action) => {
      const button = createElement("button", {
        className: action.className ?? "secondary",
        text: action.label,
      });
      button.addEventListener("click", async () => {
        // action.onClick が false を返すとモーダルを閉じない契約
        const result = await action.onClick?.({ close });
        if (result !== false) close();
      });
      actionRow.append(button);
    });
    modal.append(actionRow);
  }

  backdrop.append(modal);
  clearChildren(root);
  root.append(backdrop);

  return close;
}

/**
 * closeModal()
 * - ルートに存在するモーダルをすべて閉じる（DOM をクリア）
 */
export function closeModal() {
  const root = modalRoot();
  if (!root) return;
  clearChildren(root);
}

/**
 * showConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm })
 * - Promise<boolean> を返す確認ダイアログを表示します。
 * - resolve(true) は確認、resolve(false) はキャンセルを示します。
 * - onConfirm が渡された場合は確認時に await されます（副作用実行のため）。
 */
export function showConfirmDialog({ title, message, confirmLabel = "実行", cancelLabel = "キャンセル", onConfirm }) {
  return new Promise((resolve) => {
    showModal({
      title,
      content: `<p>${message}</p>`,
      actions: [
        {
          label: cancelLabel,
          className: "secondary",
          onClick: ({ close }) => {
            close();
            resolve(false);
          }
        },
        {
          label: confirmLabel,
          className: "info",
          onClick: async ({ close }) => {
            close();
            if (onConfirm) {
              await onConfirm();
            }
            resolve(true);
          }
        }
      ]
    });
  });
}
