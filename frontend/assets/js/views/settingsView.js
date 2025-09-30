// 設定ビュー
// API のエンドポイントやモデル、コスト設定、デバッグオプション等を編集する UI を提供する
import { qs } from "../utils/dom.js";
import { debounce } from "../utils/debounce.js";
import { eventBus } from "../utils/eventBus.js";
import { addNotification, getState, setSaveStatus, updateState } from "../state/appState.js";
import { saveSettings } from "../state/dataStore.js";
import { chatCompletions } from "../services/apiClient.js";
import { buildUserFriendlyError } from "../utils/errorHints.js";
import { rolePromptHistoryButton } from "../utils/domSelectors.js";
import { getHistory, deleteHistory } from "../utils/history.js";
import { showHistoryModal } from "../components/historyModal.js";

const form = () => qs("#settings-form");
const indicator = () => qs('[data-indicator="settings"]');
const baseUrlInput = () => qs("#settings-base-url");
const apiKeyInput = () => qs("#settings-api-key");
const modelInput = () => qs("#settings-model");
const rolePromptInput = () => qs("#settings-role-prompt");
const summaryPromptInput = () => qs("#settings-summary-prompt");
const jsonDefinitionInput = () => qs("#settings-json-definition");
const temperatureInput = () => qs("#settings-temperature");
const temperatureOutput = () => qs("#temperature-output");
const maxTokensInput = () => qs("#settings-max-tokens");
const inputCostInput = () => qs("#settings-input-cost");
const outputCostInput = () => qs("#settings-output-cost");
const webhookUrlInput = () => qs("#settings-webhook-url");
const enableIncomingWebhookCheckbox = () => qs("#settings-enable-incoming-webhook");
const networkTimeoutInput = () => qs("#settings-network-timeout");
// アニメーション設定
const typingIntervalInput = () => qs("#settings-typing-interval");
const waitSecondsInput = () => qs("#settings-wait-seconds");
const enableAnimationCheckbox = () => qs("#settings-enable-animation");
const hideAvatarsCheckbox = () => qs("#settings-hide-avatars");
// 生成前確認スキップ
const skipPreConfirmCheckbox = () => qs("#settings-skip-preconfirm");
const testButton = () => qs("#test-settings-button");
const testResult = () => qs("#settings-test-result");
const debugModeCheckbox = () => qs("#debug-mode-checkbox");
const debugConsole = () => qs("#debug-console");
const debugLogContainer = () => qs("#debug-log-container");
const clearDebugLogButton = () => qs("#clear-debug-log");
const exportDebugLogButton = () => qs("#export-debug-log");
const openManualButton = () => qs("#open-manual-button");
const MANUAL_URL = "https://github.com/gpsnmeajp/NarrativeConversation";

const debouncedSave = debounce(async () => {
  try {
    await saveSettings(getState().settings);
    setSaveStatus("settings", "saved");
    updateIndicator();
  } catch (error) {
    console.error("Failed to save settings", error);
    setSaveStatus("settings", "error");
    updateIndicator();
    addNotification({ variant: "error", message: "設定の保存に失敗しました" });
  }
}, 500);

/**
 * 保存ステータスインジケーターを更新
 */
function updateIndicator() {
  const status = getState().saveStatus.settings;
  const el = indicator();
  if (!el) return;
  el.dataset.status = status;
  if (status === "saving") {
    el.textContent = "保存中…";
  } else if (status === "saved") {
    el.textContent = "保存済み";
    setTimeout(() => {
      if (getState().saveStatus.settings === "saved") {
        setSaveStatus("settings", "idle");
        updateIndicator();
      }
    }, 1200);
  } else if (status === "error") {
    el.textContent = "保存失敗";
  } else {
    el.textContent = "保存済み";
  }
}

/**
 * フォームの入力欄に現在の設定値をバインドし、イベントリスナーを設定
 */
function bindFormInputs() {
  const settings = getState().settings;
  baseUrlInput().value = settings.baseUrl ?? "";
  apiKeyInput().value = settings.apiKey ?? "";
  modelInput().value = settings.model ?? "";
  rolePromptInput().value = settings.rolePrompt ?? "あなたは物語を作成するライトノベル作家です。";
  if (summaryPromptInput()) summaryPromptInput().value = settings.summaryPrompt ?? "";
  const jd = settings.jsonDefinition ?? "";
  if (jsonDefinitionInput()) jsonDefinitionInput().value = jd;
  temperatureInput().value = settings.temperature ?? 0.7;
  temperatureOutput().textContent = Number(settings.temperature ?? 0.7).toFixed(1);
  if (maxTokensInput()) maxTokensInput().value = settings.maxTokens ?? "";
  inputCostInput().value = Number(settings.inputTokenCost ?? 0.4).toFixed(2);
  outputCostInput().value = Number(settings.outputTokenCost ?? 1.6).toFixed(2);
  // 追加: アニメーション設定
  if (typingIntervalInput()) typingIntervalInput().value = Number(settings.typingIntervalSeconds ?? 0.03).toFixed(2);
  if (waitSecondsInput()) waitSecondsInput().value = Number(settings.waitSeconds ?? 0.5).toFixed(1);
  if (networkTimeoutInput()) networkTimeoutInput().value = Number(settings.networkTimeoutSeconds ?? 60).toFixed(1);
  if (enableAnimationCheckbox()) enableAnimationCheckbox().checked = Boolean(settings.enableAnimation ?? true);
  if (hideAvatarsCheckbox()) hideAvatarsCheckbox().checked = Boolean(settings.hideAvatars ?? false);
  if (skipPreConfirmCheckbox()) skipPreConfirmCheckbox().checked = Boolean(settings.skipPreGenerationConfirm ?? false);
  if (webhookUrlInput()) webhookUrlInput().value = settings.webhookUrl ?? "";
  if (enableIncomingWebhookCheckbox()) enableIncomingWebhookCheckbox().checked = Boolean(settings.enableIncomingWebhook ?? false);

  const handleChange = (event) => {
  const { name, type, value, checked } = event.target;
  let parsed = type === "checkbox" ? Boolean(checked) : value;
    if (name === "temperature") {
      parsed = Number(value);
      if (!Number.isFinite(parsed)) parsed = 0.7;
      parsed = Math.min(Math.max(parsed, 0), 99.9);
      temperatureOutput().textContent = parsed.toFixed(1);
    }
    if (name === "inputTokenCost" || name === "outputTokenCost") {
      parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
      event.target.value = parsed.toFixed(2);
    }
    if (name === "maxTokens") {
      // 空文字は null として扱う
      if (String(value).trim() === "") {
        parsed = null;
      } else {
        parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) parsed = null;
        else parsed = Math.floor(parsed);
      }
      // 表示整形
      if (event.target && parsed != null) event.target.value = String(parsed);
    }
    // 追加: アニメーション設定のバリデーション
    if (name === "typingIntervalSeconds") {
      parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
      event.target.value = parsed.toFixed(2);
    }
    if (name === "waitSeconds") {
      parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
      event.target.value = parsed.toFixed(1);
    }
    if (name === "networkTimeoutSeconds") {
      parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) parsed = 0;
      event.target.value = parsed.toFixed(1);
    }
    // 変更内容をまとめて state に反映するためのパッチ
    const nextPatch = { [name]: parsed };

    // モデル名が変更されたらトークン単価を両方 0 にリセット
    if (name === "model") {
      // 既に両方0の場合は通知を抑制（入力中の連続通知防止）
      const current = getState().settings;
      const wereBothZero = Number(current.inputTokenCost) === 0 && Number(current.outputTokenCost) === 0;

      nextPatch.inputTokenCost = 0;
      nextPatch.outputTokenCost = 0;
      // UI も即時反映
      const inCostEl = inputCostInput();
      const outCostEl = outputCostInput();
      if (inCostEl) inCostEl.value = (0).toFixed(2);
      if (outCostEl) outCostEl.value = (0).toFixed(2);
      if (!wereBothZero) {
        addNotification({
          variant: "info",
          message: "モデル変更に伴い、トークン単価（入力/出力）を0にリセットしました"
        });
      }
    }

    updateState("settings", (settings) => ({ ...settings, ...nextPatch }));
    setSaveStatus("settings", "saving");
    updateIndicator();
    debouncedSave();
  };

  [baseUrlInput(), apiKeyInput(), modelInput(), rolePromptInput(), jsonDefinitionInput(), temperatureInput(), inputCostInput(), outputCostInput(), typingIntervalInput(), waitSecondsInput(), networkTimeoutInput(), enableAnimationCheckbox(), hideAvatarsCheckbox(), webhookUrlInput()].filter(input => input !== null).forEach((input) => {
    input.addEventListener("input", handleChange);
  });
  if (summaryPromptInput()) summaryPromptInput().addEventListener("input", handleChange);
  if (maxTokensInput()) maxTokensInput().addEventListener("input", handleChange);
  // チェックボックスは change のほうが自然
  if (skipPreConfirmCheckbox()) {
    skipPreConfirmCheckbox().addEventListener("change", handleChange);
  }
  if (enableIncomingWebhookCheckbox()) {
    enableIncomingWebhookCheckbox().addEventListener("change", handleChange);
  }
  if (hideAvatarsCheckbox()) {
    hideAvatarsCheckbox().addEventListener("change", handleChange);
  }
}

async function handleTestConnection() {
  const { settings } = getState();
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    addNotification({ variant: "error", message: "BaseURL・APIキー・モデルを入力してください" });
    return;
  }

  const resultContainer = testResult();
  resultContainer.textContent = "⌛️ 接続テスト中…";

  // HTMLエスケープ用の簡易ユーティリティ
  const escapeHtml = (str = "") =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  try {
    const { responseBody, latency } = await chatCompletions({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      payload: {
        model: settings.model,
        temperature: Number(settings.temperature) || 0.7,
        messages: [
          { role: "system", content: "あなたはAIシステムの接続チェックツールです" },
          { role: "user", content: "これは接続テストです。正常に通信できていますか？" },
        ],
        max_tokens: 100,
      },
    }, { timeout: Math.max(0, Number(settings.networkTimeoutSeconds ?? 60)) * 1000 });
    const reply = responseBody?.choices?.[0]?.message?.content ?? "(応答なし)";
    resultContainer.innerHTML = `✅ 接続成功 (${latency.toFixed(0)} ms)<br />${reply}`;
    addNotification({ variant: "success", message: "接続テストに成功しました" });
  } catch (error) {
    console.error("Connection test failed", error);
  const { summary, hint, metaText } = buildUserFriendlyError(error);
    // メッセージ抽出（JSON文字列またはError.body）
    let rawDetail = error?.body || error?.message || "";
    if (!rawDetail && error?.data) {
      try { rawDetail = JSON.stringify(error.data, null, 2); } catch (_) {}
    }
    if (rawDetail.length > 2000) rawDetail = rawDetail.slice(0, 2000) + "\n... (truncated)";

    const escapeHtml = (str = "") => String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

    resultContainer.innerHTML = `
      <div class="test-summary">❌ ${escapeHtml(summary)}</div>
      <div class="test-hint">${escapeHtml(hint)}</div>
      ${metaText ? `
        <details style="margin-top:6px;">
          <summary>モデレーション/プロバイダー情報</summary>
          <pre class="error-detail" style="white-space:pre-wrap;">${escapeHtml(metaText)}</pre>
        </details>
      ` : ""}
      ${rawDetail ? `
        <details style="margin-top:6px;">
          <summary>詳細を表示</summary>
          <pre class="error-detail" style="white-space:pre-wrap;">${escapeHtml(rawDetail)}</pre>
        </details>
      ` : ""}
    `;
    addNotification({ variant: "error", message: "接続テストに失敗しました（詳細を参照）" });
  }
}

// デバッグログを保存する配列
let debugLogs = [];

// オリジナルのconsoleメソッドを保存
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
};

/**
 * デバッグログにエントリを追加
 * @param {string} level ログレベル
 * @param {Array} args ログ引数
 */
function addDebugLog(level, args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  const logEntry = {
    timestamp,
    level,
    message
  };
  
  debugLogs.push(logEntry);
  
  // 最大1000件のログを保持
  if (debugLogs.length > 1000) {
    debugLogs.shift();
  }
  
  updateDebugLogDisplay();
}

/**
 * デバッグログの表示を更新
 */
function updateDebugLogDisplay() {
  const container = debugLogContainer();
  if (!container) return;
  
  if (debugLogs.length === 0) {
    container.innerHTML = '<div class="debug-log-empty">デバッグログがここに表示されます</div>';
    return;
  }
  
  const logHTML = debugLogs.map(log => {
    const timeStr = new Date(log.timestamp).toLocaleTimeString('ja-JP');
    return `<div class="debug-log-entry log-${log.level}">
      <span class="debug-log-timestamp">[${timeStr}]</span>
      <span class="debug-log-level">[${log.level.toUpperCase()}]</span>
      <span class="debug-log-message">${log.message}</span>
    </div>`;
  }).join('');
  
  container.innerHTML = logHTML;
  
  // 最新のログまでスクロール
  container.scrollTop = container.scrollHeight;
}

/**
 * コンソールキャプチャを設定または解除
 */
function setupConsoleCapture() {
  const isDebugMode = localStorage.getItem('narrative-debug-mode') === 'true';
  
  if (isDebugMode) {
    // consoleをフック
    console.log = function(...args) {
      originalConsole.log.apply(console, args);
      addDebugLog('log', args);
    };
    
    console.error = function(...args) {
      originalConsole.error.apply(console, args);
      addDebugLog('error', args);
    };
    
    console.warn = function(...args) {
      originalConsole.warn.apply(console, args);
      addDebugLog('warn', args);
    };
    
    console.info = function(...args) {
      originalConsole.info.apply(console, args);
      addDebugLog('info', args);
    };
    
    console.debug = function(...args) {
      originalConsole.debug.apply(console, args);
      addDebugLog('debug', args);
    };
  } else {
    // オリジナルのconsoleに戻す
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  }
}

/**
 * デバッグモードのチェックボックス変更イベントハンドラ
 */
function handleDebugModeChange() {
  const isDebugMode = debugModeCheckbox().checked;
  localStorage.setItem('narrative-debug-mode', isDebugMode.toString());
  
  // デバッグコンソールの表示/非表示を切り替え
  const console = debugConsole();
  if (console) {
    console.style.display = isDebugMode ? 'block' : 'none';
  }
  
  // コンソールキャプチャの設定
  setupConsoleCapture();
  
  addNotification({ 
    variant: isDebugMode ? "info" : "success", 
    message: isDebugMode ? "デバッグモードを有効にしました" : "デバッグモードを無効にしました"
  });
}

/**
 * デバッグログをクリアするイベントハンドラ
 */
function handleClearDebugLog() {
  debugLogs = [];
  updateDebugLogDisplay();
  addNotification({ variant: "info", message: "デバッグログをクリアしました" });
}

/**
 * デバッグログをテキストファイルとしてエクスポートするイベントハンドラ
 */
function handleExportDebugLog() {
  if (debugLogs.length === 0) {
    addNotification({ variant: "warn", message: "エクスポートするログがありません" });
    return;
  }
  
  const logText = debugLogs.map(log => {
    const timeStr = new Date(log.timestamp).toLocaleString('ja-JP');
    return `[${timeStr}] [${log.level.toUpperCase()}] ${log.message}`;
  }).join('\n');
  
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `debug-log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  addNotification({ variant: "success", message: "デバッグログをエクスポートしました" });
}

export function mountSettingsView() {
  bindFormInputs();
  updateIndicator();
  testButton().addEventListener("click", handleTestConnection);

  // 役割設定の履歴ボタン
  const rpHistBtn = rolePromptHistoryButton();
  if (rpHistBtn) {
    rpHistBtn.addEventListener("click", async () => {
      const items = await getHistory("rolePrompt");
      showHistoryModal({
        type: "rolePrompt",
        items,
        onSelect: (text) => {
          const input = rolePromptInput();
          if (input) input.value = text;
          updateState("settings", (s) => ({ ...s, rolePrompt: text }));
          setSaveStatus("settings", "saving");
          // 即時保存
          saveSettings(getState().settings).catch(console.error);
        },
        onDelete: async (text) => {
          await deleteHistory("rolePrompt", text);
        }
      });
    });
  }
  
  // デバッグモードの状態を復元
  const isDebugMode = localStorage.getItem('narrative-debug-mode') === 'true';
  debugModeCheckbox().checked = isDebugMode;
  
  // デバッグコンソールの表示状態を設定
  const console = debugConsole();
  if (console) {
    console.style.display = isDebugMode ? 'block' : 'none';
  }
  
  // コンソールキャプチャを初期化
  setupConsoleCapture();
  updateDebugLogDisplay();
  
  // イベントリスナーを設定
  debugModeCheckbox().addEventListener("change", handleDebugModeChange);
  clearDebugLogButton().addEventListener("click", handleClearDebugLog);
  exportDebugLogButton().addEventListener("click", handleExportDebugLog);
  // 説明書ボタン
  const manualBtn = openManualButton();
  if (manualBtn) {
    manualBtn.addEventListener("click", () => {
      window.open(MANUAL_URL, "_blank", "noopener");
    });
  }

  eventBus.on("state:change:settings", (settings) => {
    const activeInputs = [baseUrlInput(), apiKeyInput(), modelInput(), rolePromptInput(), summaryPromptInput(), jsonDefinitionInput(), temperatureInput(), inputCostInput(), outputCostInput(), typingIntervalInput(), waitSecondsInput(), networkTimeoutInput(), enableAnimationCheckbox(), hideAvatarsCheckbox(), skipPreConfirmCheckbox(), webhookUrlInput(), enableIncomingWebhookCheckbox()].filter(input => input !== null);
    if (activeInputs.includes(document.activeElement)) {
      return;
    }
    baseUrlInput().value = settings.baseUrl ?? "";
    apiKeyInput().value = settings.apiKey ?? "";
    modelInput().value = settings.model ?? "";
    rolePromptInput().value = settings.rolePrompt ?? "あなたは物語を作成するライトノベル作家です。";
    if (summaryPromptInput()) summaryPromptInput().value = settings.summaryPrompt ?? "";
    const jsonInput = jsonDefinitionInput();
    if (jsonInput) jsonInput.value = settings.jsonDefinition ?? "";
    temperatureInput().value = settings.temperature ?? 0.7;
    temperatureOutput().textContent = Number(settings.temperature ?? 0.7).toFixed(1);
    inputCostInput().value = Number(settings.inputTokenCost ?? 0.4).toFixed(2);
    outputCostInput().value = Number(settings.outputTokenCost ?? 1.6).toFixed(2);
    if (maxTokensInput()) maxTokensInput().value = settings.maxTokens ?? "";
    if (typingIntervalInput()) typingIntervalInput().value = Number(settings.typingIntervalSeconds ?? 0.03).toFixed(2);
    if (waitSecondsInput()) waitSecondsInput().value = Number(settings.waitSeconds ?? 0.5).toFixed(1);
    if (enableAnimationCheckbox()) enableAnimationCheckbox().checked = Boolean(settings.enableAnimation ?? true);
    if (hideAvatarsCheckbox()) hideAvatarsCheckbox().checked = Boolean(settings.hideAvatars ?? false);
    if (skipPreConfirmCheckbox()) skipPreConfirmCheckbox().checked = Boolean(settings.skipPreGenerationConfirm ?? false);
    if (webhookUrlInput()) webhookUrlInput().value = settings.webhookUrl ?? "";
    if (enableIncomingWebhookCheckbox()) enableIncomingWebhookCheckbox().checked = Boolean(settings.enableIncomingWebhook ?? false);
    if (networkTimeoutInput()) networkTimeoutInput().value = Number(settings.networkTimeoutSeconds ?? 60).toFixed(1);
  });
}
