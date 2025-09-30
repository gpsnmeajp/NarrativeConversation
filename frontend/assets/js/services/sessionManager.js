// services/sessionManager.js
// アクティブブラウザセッションの取得・監視・再取得を行うユーティリティ。

import { generateUUID } from "../utils/uuid.js";
import { showModal } from "../components/modal.js";
import { setActiveBrowser, getActiveBrowser } from "./apiClient.js";
import { addNotification } from "../state/appState.js";
import { startIncomingWebhookPolling, stopIncomingWebhookPolling } from "./incomingWebhookPoller.js";
import { loadInitialData } from "../state/dataStore.js";

let mySessionId = null;
let pollTimer = null;
let overlayClose = null; // 現在表示中のオーバーレイを閉じる関数
let overlayOpen = false;

function openLostOverlay() {
  if (overlayOpen) return;
  overlayOpen = true;
  overlayClose = showModal({
    title: "ほかの端末で画面を開いています",
    content: `
      <div class="session-lost-overlay">
        <p>データ損失防止のため、複数の端末で同時に利用することはできません。</p>
        <p>この画面は休眠状態に入りました。ボタンを押すとこの端末での利用を再開します。</p>
      </div>
    `,
    closeOnBackdrop: false,
    actions: [
      {
        label: "利用を再開する",
        className: "primary",
        onClick: async () => {
          try {
            await setActiveBrowser(mySessionId);
            // セッション再獲得に成功したら全データを再読み込み
            try {
              await loadInitialData();
            } catch (reloadErr) {
              console.error("Failed to reload data after session reacquire", reloadErr);
              // 再読み込み失敗時もセッション自体は獲得済みなので通知のみ
              addNotification({ variant: "error", message: "データの再読み込みに失敗しました" });
            }
            addNotification({ variant: "info", message: "セッションを獲得しました" });
            // 受信ポーリング再開（このタイミングで初期lastIdを取得するため、stop→startではなくstartが内部でlastId取得）
            startIncomingWebhookPolling({ intervalMs: 1000 });
            closeOverlay();
          } catch (e) {
            console.error("Failed to reacquire session", e);
            addNotification({ variant: "error", message: "セッションの獲得に失敗しました" });
            return false; // モーダルを閉じない
          }
        },
      },
    ],
  });
}

function closeOverlay() {
  if (overlayClose) {
    try { overlayClose(); } catch (_) {}
  }
  overlayClose = null;
  overlayOpen = false;
}

async function initialAcquire() {
  mySessionId = generateUUID();
  try {
    await setActiveBrowser(mySessionId);
    addNotification({ variant: "info", message: "セッションを獲得しました" });
  } catch (e) {
    console.error("Failed to set active session on startup", e);
    addNotification({ variant: "error", message: "セッション獲得に失敗しました" });
  }
}

async function pollOnce() {
  try {
    const info = await getActiveBrowser();
    const activeId = info?.session_id ?? null;
    const isActive = activeId && String(activeId) === String(mySessionId);
    if (isActive) {
      // 自分がアクティブ：オーバーレイが出ていたら閉じる
      if (overlayOpen) closeOverlay();
    } else {
      // アクティブでない：オーバーレイを表示
      openLostOverlay();
      // 競合回避のため、Incoming Webhook のポーリングを停止
      stopIncomingWebhookPolling();
    }
  } catch (e) {
    // ネットワーク等の一時的障害はポーリング継続
    console.warn("Active session poll failed", e);
  }
}

export function startSessionManagement({ intervalMs = 1000 } = {}) {
  if (pollTimer) return; // 二重起動防止
  initialAcquire();
  pollTimer = setInterval(pollOnce, Math.max(300, intervalMs | 0));
}

export function stopSessionManagement() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  closeOverlay();
}

export function getMySessionId() {
  return mySessionId;
}
