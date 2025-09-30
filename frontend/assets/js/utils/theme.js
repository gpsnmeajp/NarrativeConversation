// theme.js
// テーマ管理（light/dark）: 初期化、トグル、購読API

const STORAGE_KEY = "nc-theme";

export function detectPreferredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch (_) {
    // ignore
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function getCurrentTheme() {
  const a = document.documentElement.getAttribute("data-theme");
  if (a === "light" || a === "dark") return a;
  return detectPreferredTheme();
}

export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch (_) {
    // ignore
  }
  // 通知
  const ev = new CustomEvent("themechange", { detail: { theme: t } });
  window.dispatchEvent(ev);
}

export function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function initThemeListeners() {
  // OSのテーマ変更を反映（ユーザーが明示設定していない場合のみ）
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        applyTheme(mq.matches ? "dark" : "light");
      };
      // 一部ブラウザでは addEventListener が必要
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", handler);
      else if (typeof mq.addListener === "function") mq.addListener(handler);
    }
  } catch (_) {
    // ignore
  }
}
