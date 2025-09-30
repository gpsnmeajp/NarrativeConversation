// ナビゲーションビュー
// アプリ内のビュー切り替え（ナビゲーションバー）を担当するモジュール
import { eventBus } from "../utils/eventBus.js";
import { qsa, qs } from "../utils/dom.js";
import { getState, setState } from "../state/appState.js";

/**
 * ナビゲーションボタンのアクティブ状態を更新
 * @param {string} view 現在のビュー名
 */
function updateNavButtons(view) {
  qsa(".nav-button").forEach((button) => {
    const isActive = button.dataset.viewTarget === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

/**
 * ビューの表示・非表示を切り替え
 * @param {string} view 現在のビュー名
 */
function updateViews(view) {
  qsa(".view").forEach((section) => {
    const active = section.dataset.view === view;
    section.classList.toggle("active", active);
    if (active) {
      section.scrollTop = 0;
    }
  });
  const main = qs(".app-main");
  if (main) main.dataset.activeView = view;
}

/**
 * ナビゲーションボタンのクリックイベントハンドラ
 * @param {Event} event クリックイベント
 */
function handleNavClick(event) {
  if (!(event.target instanceof HTMLElement)) return;
  const view = event.target.dataset.viewTarget;
  if (!view) return;
  event.preventDefault();
  setState({ view });
}

export function mountNavigation() {
  qsa(".nav-button").forEach((button) => button.addEventListener("click", handleNavClick));
  const initialView = getState().view;
  updateNavButtons(initialView);
  updateViews(initialView);

  eventBus.on("state:change:view", (view) => {
    updateNavButtons(view);
    updateViews(view);
  });
}
