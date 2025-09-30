// app.js
// フロントエンドのエントリーポイント。各ビュー・コンポーネントのマウントと初期データの読み込みを行う。
// ここではアプリ起動のオーケストレーションのみを担い、実際のデータ取得は各モジュールに委譲する。
import { loadInitialData } from "./state/dataStore.js";
import { mountNavigation } from "./views/navigationView.js";
import { mountMainView } from "./views/mainView.js";
import { mountWorldView } from "./views/worldView.js";
import { mountCharactersView } from "./views/charactersView.js";
import { mountSettingsView } from "./views/settingsView.js";
import { mountNotifications } from "./components/notifications.js";
import { mountFAB } from "./components/fab.js";
import { mountWelcomeOverlay } from "./components/welcomeOverlay.js";
import { addNotification, markReady } from "./state/appState.js";
import { initHashRouting } from "./utils/router.js";
import { initThemeListeners, toggleTheme, getCurrentTheme } from "./utils/theme.js";
import { startSessionManagement } from "./services/sessionManager.js";
import { startIncomingWebhookPolling } from "./services/incomingWebhookPoller.js";

async function bootstrap() {
  // テーマ: OS/保存値の監視
  initThemeListeners();

  // DOM にビューや通知コンテナをマウントする
  mountNotifications();
  mountNavigation();
  mountMainView();
  mountWorldView();
  mountCharactersView();
  mountSettingsView();
  mountFAB();
  // APIキー未設定時のウェルカムガイド
  mountWelcomeOverlay();

  // ルーティング初期化（URLハッシュと状態を同期）
  initHashRouting();

  // アクティブセッション管理（ID生成→獲得→1秒ポーリング）
  startSessionManagement({ intervalMs: 1000 });

  // テーマトグル配線（デリゲーションで安定化）
  const reflectLabel = () => {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const theme = getCurrentTheme();
    btn.textContent = theme === "dark" ? "☀️ ライト" : "🌙 ダーク";
  };
  reflectLabel();
  window.addEventListener("themechange", reflectLabel);
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("#theme-toggle") : null;
    if (!target) return;
    e.preventDefault();
    toggleTheme();
    reflectLabel();
  });

  try {
    // 必要な初期データを読み込み、ロード完了を通知する
    await loadInitialData();
    markReady();
    // セッション獲得済みの想定で Incoming Webhook ポーリング開始（初回はlastId基準で既存を無視）
    startIncomingWebhookPolling({ intervalMs: 1000 });
  } catch (error) {
    // 初期化に失敗した場合はログ出力とユーザー通知のみ行う
    console.error("Application failed to initialize", error);
    addNotification({ variant: "error", message: "アプリケーションの初期化に失敗しました" });
  }
}

// DOM が準備出来たらアプリを起動
document.addEventListener("DOMContentLoaded", bootstrap);
