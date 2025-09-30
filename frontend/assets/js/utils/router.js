// utils/router.js
// シンプルなハッシュルーター。URL の #<view> と appState.view を双方向同期する。
import { eventBus } from "./eventBus.js";
import { getState, setState } from "../state/appState.js";

const VALID_VIEWS = new Set(["main", "world", "characters", "settings"]);

function parseHash() {
  const raw = (location.hash || "").trim();
  if (!raw) return null;
  // 先頭の#や#/を取り除く
  const cleaned = raw.replace(/^#\/?/, "");
  // フラグメントの先頭セグメントのみを使用（#view/xxx -> view）
  const [first] = cleaned.split("/");
  return first || null;
}

function coerceViewFromHash() {
  const v = parseHash();
  if (v && VALID_VIEWS.has(v)) return v;
  return "main"; // フォールバック
}

let isProgrammaticHashUpdate = false;

function applyStateToHash(view) {
  const nextHash = `#${view}`;
  if (location.hash === nextHash) return;
  isProgrammaticHashUpdate = true;
  // 履歴を積む挙動でOK。必要に応じて replace へ変更可能。
  location.hash = nextHash;
}

function applyHashToState() {
  const targetView = coerceViewFromHash();
  if (getState().view !== targetView) {
    setState({ view: targetView });
  }
}

/**
 * ハッシュルーティング初期化
 * - 初期表示時に location.hash を解釈して view を設定
 * - view の変更に追随して location.hash を更新
 * - location.hash の変更に追随して view を更新
 */
export function initHashRouting() {
  // 初期同期（URL -> state）
  applyHashToState();

  // state -> URL
  eventBus.on("state:change:view", (view) => {
    applyStateToHash(view);
  });

  // URL -> state
  window.addEventListener("hashchange", () => {
    if (isProgrammaticHashUpdate) {
      // プログラムによる更新で発火したイベントは無視
      isProgrammaticHashUpdate = false;
      return;
    }
    applyHashToState();
  });
}
