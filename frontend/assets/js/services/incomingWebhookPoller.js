// services/incomingWebhookPoller.js
// Incoming Webhook をポーリングし、エントリの追加や生成を自動実行する。

import { getIncomingWebhook } from "./apiClient.js";
import { getMySessionId } from "./sessionManager.js";
import { addNotification, getState } from "../state/appState.js";
import { eventBus } from "../utils/eventBus.js";
import { appendEntry } from "../utils/entryHandlers.js";
import { generateContinuation, isAiGenerating } from "../utils/aiGeneration.js";

let timer = null;
let lastProcessedId = null; // このIDまで処理済み
let running = false;

/**
 * shouldRun()
 * - このポーリングを「いま実行してよいか」を判定する拡張ポイント。
 * - 生成中は false を返し、ポーリングを一時停止します（生成完了後に自動で再開）。
 * - 実際の開始/停止の大枠は sessionManager が行います（セッション奪取時に stop、再獲得時に start）。
 * - 将来の拡張例:
 *   - ドキュメント非表示時（document.hidden）の間は停止する
 *   - フォーカスが無いウィンドウでは停止する
 *   - 省電力モード時は間隔を伸ばす 等
 */
function shouldRun() {
  // 生成中は保留
  if (isAiGenerating()) return false;
  return true;
}

// 設定の有効化/無効化に応じて自動で開始/停止する
// - 無効化: 稼働中なら停止
// - 有効化: 未稼働なら開始
const handleSettingsChange = (settings) => {
  const enabled = !!settings?.enableIncomingWebhook;
  if (enabled && !running) {
    startIncomingWebhookPolling({ intervalMs: 1000 });
  } else if (!enabled && running) {
    stopIncomingWebhookPolling();
  }
};

// モジュール読み込み時にサブスクライブ
eventBus.on("state:change:settings", handleSettingsChange);

// 初期状態に合わせて整合
(() => {
  try {
    const enabled = !!getState()?.settings?.enableIncomingWebhook;
    if (enabled && !running) {
      // ここでは即時開始せず、アプリ初期化(app.js)での開始と二重にならないよう noop
      // 二重開始は startIncomingWebhookPolling 内の running ガードで防がれるが、
      // 初期化順の自由度を保つためあえて何もしない。
    }
  } catch (_) {}
})();

function normalizePayload(rec) {
  // バックエンドからの1レコード: { id, receivedAt, data }
  const data = rec?.data || {};
  const type = String(data.type || "").trim();
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
  const content = typeof data.content === "string" && data.content.trim() ? data.content : null;
  return { id: rec?.id, receivedAt: rec?.receivedAt, type, name, content };
}

async function processRecords(records) {
  for (const rec of records) {
    const { type, name, content } = normalizePayload(rec);
    if (!type) continue;

    if (type === "generate") {
      // 確認ダイアログなしで生成
      try {
        await generateContinuation(false);
      } catch (e) {
        console.error("Incoming generate failed", e);
        addNotification({ variant: "error", message: "Webhook起因の生成に失敗しました" });
      }
      continue;
    }

    // type: dialogue | action | narration | direction
    const allowed = new Set(["dialogue", "action", "narration", "direction"]);
    if (!allowed.has(type)) continue;
    // 生成以外は現在の設定に関わらず追加
    const entry = { type, name: name || null, content: content || "" };
    try {
      appendEntry(entry, { type: "end" });
      addNotification({ variant: "success", message: `Webhook: ${type} を追加しました` });
    } catch (e) {
      console.error("Failed to append entry from webhook", e);
      addNotification({ variant: "error", message: "Webhookのエントリ追加に失敗しました" });
    }
  }
}

async function tick() {
  if (!running || !shouldRun()) return;
  try {
    const query = {};
    if (Number.isInteger(lastProcessedId)) query.sinceId = lastProcessedId;
    const resp = await getIncomingWebhook(query);
    if (!resp || resp.enabled === false) {
      // 無効ならポーリング停止
      addNotification({ variant: "info", message: "Incoming Webhookが無効のためポーリングを停止しました" });
      stopIncomingWebhookPolling();
      return;
    }
    const recs = Array.isArray(resp.records) ? resp.records : [];
    if (recs.length) {
      await processRecords(recs);
      // 最大IDを更新
      const maxId = recs.reduce((m, r) => Math.max(m, r?.id || 0), lastProcessedId || 0);
      lastProcessedId = maxId;
    }
  } catch (e) {
    // ネットワークエラー等は継続
    console.warn("incoming webhook poll failed", e);
    // addNotification({ variant: "warn", message: "Incoming Webhookの取得に失敗しました（ネットワーク/サーバー）" });
  }
}

export function startIncomingWebhookPolling({ intervalMs = 1000, waitEnabledAttempts = 5, waitEnabledDelayMs = 400 } = {}) {
  if (running) return;
  running = true;
  // セッション獲得時点の既存データは無視する: 初回に current lastId を取得して sinceId に設定
  (async () => {
    try {
      let resp = null;
      let attempts = Math.max(0, waitEnabledAttempts | 0) + 1; // 最初の1回 + 追加リトライ回数
      while (attempts-- > 0) {
        try {
          resp = await getIncomingWebhook({ limit: 1 });
        } catch (_) {
          resp = null;
        }
        if (resp && resp.enabled === true) break;
        if (attempts <= 0) break;
        // バックエンド反映待ち（設定保存やサーバ側状態反映の遅延対策）
        await new Promise((r) => setTimeout(r, Math.max(100, waitEnabledDelayMs | 0)));
      }
      if (!resp || resp.enabled === false) {
        // 無効が継続しているため開始しない
        // addNotification({ variant: "info", message: "サーバー側でIncoming Webhookが無効のためポーリングを開始できませんでした" });
        running = false;
        return; // finally でタイマー開始しないようにする
      }
      if (resp && Number.isInteger(resp.lastId)) {
        lastProcessedId = resp.lastId;
      } else {
        lastProcessedId = null;
      }
    } catch (_) {
      lastProcessedId = null;
    } finally {
      // タイマー開始（running が維持されている場合のみ）
      if (running) {
        timer = setInterval(tick, Math.max(300, intervalMs | 0));
      }
    }
  })();
}

export function stopIncomingWebhookPolling() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export function resetIncomingWebhookProcessed() {
  lastProcessedId = null;
}