// utils/jsonActions.js
// <json>タグに含まれる任意JSONを受け取り、拡張可能なアクション実行基盤として処理する。
// 重要: スキーマは未定義。ここでは「解釈しない」ことを第一とし、
// - 受け取った値をそのままイベントとして配信
// - 既存/拡張ハンドラに委譲
// - 危険な外部作用はデフォルト無効（設定で明示的に許可）
// を実現する。

import { getState, addNotification } from "../state/appState.js";

/**
 * JSONアクションルーターの内部登録表
 * key: アクション名やタイプ識別子（任意）。
 * value: (payload, ctx) => Promise<void> | void
 */
const registry = new Map();

/**
 * イベントバス風の簡易ディスパッチ（DOM CustomEventを使用）
 * type: 'json-action' 固定。detail: { payload, context }
 */
function emitJsonEvent(payload, context) {
  try {
    const event = new CustomEvent("json-action", { detail: { payload, context } });
    document.dispatchEvent(event);
  } catch (e) {
    console.warn("emitJsonEvent failed", e);
  }
}

/**
 * ハンドラを登録する
 * @param {string} key 識別子（例: 'notify', 'save', 'webhook' など）。自由形式
 * @param {(payload:any, ctx:object)=>Promise<void>|void} handler 実行関数
 */
export function registerJsonAction(key, handler) {
  if (!key || typeof handler !== "function") return;
  registry.set(key, handler);
}

/** すべての登録を解除（テスト/再初期化用） */
export function clearJsonActions() {
  registry.clear();
}

/** 現在の登録を取得（デバッグ用） */
export function listJsonActions() {
  return Array.from(registry.keys());
}

/**
 * 任意JSONを安全に処理するエントリポイント。
 * 仕様は未定義のため、次の段階のみ実施する:
 * - そのままイベント発火（UI側で監視して自由に拡張可能）
 * - もし payload が { type } を持つ場合のみ、対応ハンドラがあれば呼び出す。
 *
 * @param {any} payload 任意のJSON（オブジェクト/配列/プリミティブ/null）
 * @param {object} context 付随情報（entry, index など）
 */
export async function processJsonPayload(payload, context = {}) {
  // まずはイベント配信（これは常に行い、監視側で勝手に拡張できるようにする）
  emitJsonEvent(payload, context);

  // システム既定の最小挙動:
  // - { type: string } を持つオブジェクトのみ、登録ハンドラに委譲
  const maybeType = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload.type
    : undefined;

  if (typeof maybeType !== "string") {
    // 型が無い/不明: ここでは何も決め打ちせず終了（スキーマ未定義のため）
    return;
  }

  const handler = registry.get(maybeType);
  if (!handler) return; // 未登録なら静かに無視

  const settings = getState()?.settings ?? {};
  const ctx = { ...context, settings};

  try {
    await handler(payload, ctx);
  } catch (e) {
    console.error("json action handler failed", e);
    addNotification({ variant: "error", message: `JSONアクションの実行に失敗しました: ${e?.message || e}` });
  }
}

// --- 最低限の参考実装（外部影響なし） ---
// 仕様は定義しない方針なので、ここでは登録しない。
// 利用側で以下のように登録可能:
// registerJsonAction('notify', (payload) => {
//   if (typeof payload?.message === 'string') {
//     addNotification({ variant: payload.variant || 'info', message: payload.message });
//   }
// });

export default {
  register: registerJsonAction,
  clear: clearJsonActions,
  list: listJsonActions,
  process: processJsonPayload,
};
