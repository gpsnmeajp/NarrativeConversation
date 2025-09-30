// utils/webhook.js
// Webhook送信処理の共通ユーティリティ

import { getState, addNotification, updateFooter } from "../state/appState.js";
import { postWebhook } from "../services/apiClient.js";

/** Webhook URL が設定されているか */
export function hasWebhookUrl() {
  try {
    const url = (getState().settings?.webhookUrl || "").trim();
    return Boolean(url);
  } catch {
    return false;
  }
}

/**
 * 単一エントリをWebhook送信
 * 失敗時は warning 通知し、例外を再throwします（呼び出し側で制御可能にするため）。
 */
export async function sendEntryWebhook(
  entry,
  { index = 1, total = 1, url, showStatus = true, notifyOnError = true, statusLabel = "Webhook送信中…" } = {}
) {
  const safeUrl = (url ?? getState().settings?.webhookUrl ?? "").trim();
  if (!safeUrl) return;

  try {
    if (showStatus) updateFooter({ status: `${statusLabel} (${index}/${total})` });
    const payload = {
      type: entry.type,
      name: entry.name || null,
      content: entry.content ?? "",
      createdAt: entry.createdAt || new Date().toISOString(),
      storyId: getState().currentStoryId || null,
    };
  const timeoutSec = Math.max(0, Number(getState().settings?.networkTimeoutSeconds ?? 60));
  await postWebhook({ url: safeUrl, payload, timeoutSec });
    if (showStatus) updateFooter({ status: "待機中" });
  } catch (e) {
    const msg = (e && (e.body || e.message)) ? String(e.body || e.message) : "不明なエラー";
    if (notifyOnError) addNotification({ variant: "warn", message: "【Webhook送信に失敗】" + msg });
    if (showStatus) updateFooter({ status: "待機中" });
    throw e;
  }
}

/**
 * 複数エントリを順次Webhook送信
 */
export async function sendEntriesWebhookSequential(
  entries,
  { url, showStatus = true, notifyOnError = true, statusLabel = "Webhook送信中…" } = {}
) {
  const list = Array.isArray(entries) ? entries : [];
  const total = list.length;
  if (!total) return;
  const safeUrl = (url ?? getState().settings?.webhookUrl ?? "").trim();
  if (!safeUrl) return;

  let success = 0;
  const failures = [];
  for (let i = 0; i < total; i++) {
    const entry = list[i];
    try {
      await sendEntryWebhook(entry, {
        index: i + 1,
        total,
        url: safeUrl,
        showStatus,
        notifyOnError,
        statusLabel,
      });
      success += 1;
    } catch (e) {
      failures.push({ index: i, error: e, type: entry?.type, name: entry?.name });
      // 続行して残りのエントリも送信
    }
  }
  return { total, success, failed: failures.length, failures };
}
