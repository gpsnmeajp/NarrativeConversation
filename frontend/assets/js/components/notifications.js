// トースト通知の表示を管理するコンポーネント
// components/notifications.js
// トースト通知（小さな一時メッセージ）を DOM に表示するコンポーネント。
// - appState の notifications に変更があったら render を呼び出す。

import { eventBus } from "../utils/eventBus.js";
import { qs, clearChildren, createElement } from "../utils/dom.js";
import { removeNotification } from "../state/appState.js";

const container = () => qs("#toast-container");

/**
 * renderToast(notification)
 * - 単一のトースト要素を作成し、自動で timeout 後に削除する挙動を提供します。
 * - notification: { id, message, variant?, duration? }
 * - duration はミリ秒。指定がない場合は 4000ms。
 */
function renderToast(notification) {
  const toast = createElement("div", {
    className: "toast",
    dataset: { variant: notification.variant ?? "info" },
    text: notification.message,
  });

  const duration = notification.duration ?? 4000;
  setTimeout(() => {
    // フェードアウト -> DOM 削除 -> 状態から通知を削除
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
      removeNotification(notification.id);
    }, 250);
  }, duration);
  return toast;
}

/**
 * render(notifications)
 * - 現在の通知配列を受け取り、DOM 上に存在しない通知のみを追加して表示します。
 * - 既存の DOM 通知は保持するため、重複チェックを行います。
 */
function render(notifications) {
  const root = container();
  if (!root) return;
  // DOM 上の既存通知と重複しないように新しい通知のみ追加する
  const currentIds = new Set(Array.from(root.children).map((child) => child.dataset.id));
  notifications.forEach((notification) => {
    if (!currentIds.has(notification.id)) {
      const toast = renderToast(notification);
      toast.dataset.id = notification.id;
      root.append(toast);
    }
  });
}

/**
 * mountNotifications()
 * - アプリ起動時に呼び出して、state の notifications 変更イベントを監視することで
 *   トーストを自動でレンダリングします。
 */
export function mountNotifications() {
  eventBus.on("state:change:notifications", render);
}
