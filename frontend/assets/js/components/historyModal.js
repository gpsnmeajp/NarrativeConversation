// components/historyModal.js
// 履歴の一覧表示・選択・削除を行うモーダル

import { showModal } from "./modal.js";
import { createElement } from "../utils/dom.js";

/**
 * 履歴モーダルを表示
 * @param {Object} params
 * @param {"rolePrompt"|"command"|"worldview"} params.type - 対象タイプ
 * @param {Array<{text:string, updatedAt:string, count?:number}>} params.items - 履歴配列
 * @param {(text:string)=>void} params.onSelect - 選択時のコールバック
 * @param {(text:string)=>Promise<void>} params.onDelete - 削除時の非同期コールバック
 */
export function showHistoryModal({ type, items, onSelect, onDelete }) {
  const titleMap = { rolePrompt: "役割設定の履歴", command: "司令の履歴", worldview: "世界観の履歴" };
  const container = document.createElement("div");
  container.className = "history-modal";
  let close;

  if (!items?.length) {
    container.innerHTML = `<p>履歴はまだありません。</p>`;
  } else {
    const list = document.createElement("ul");
    list.className = "history-list";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const main = document.createElement("div");
      main.className = "history-item__main";
      const text = document.createElement("div");
      text.className = "history-text";
      text.textContent = item.text;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      const date = new Date(item.updatedAt);
      meta.textContent = `${date.toLocaleString()}  回数:${item.count ?? 1}`;
      main.append(text, meta);

      const actions = document.createElement("div");
      actions.className = "history-item__actions";
      const selectBtn = createElement("button", { className: "primary", text: "選択" });
      const deleteBtn = createElement("button", { className: "danger", text: "削除" });
      // 選択後にモーダルを閉じる（クロージャで close を参照）
      selectBtn.addEventListener("click", () => {
        onSelect?.(item.text);
        try { close?.(); } catch {}
      });
      deleteBtn.addEventListener("click", async () => {
        await onDelete?.(item.text);
        // UIからも即時削除
        li.remove();
        if (!list.children.length) {
          list.replaceWith(document.createTextNode("履歴はまだありません。"));
        }
      });
      actions.append(selectBtn, deleteBtn);

      li.append(main, actions);
      list.append(li);
    });
    container.append(list);
  }

  close = showModal({
    title: titleMap[type] ?? "履歴",
    content: container,
    actions: [
      { label: "閉じる", className: "secondary" }
    ]
  });
}
