// utils/domSelectors.js
// メインビューで使用されるDOM要素セレクター関数群
// このモジュールはDOM要素への参照を効率的に管理し、
// 他のモジュールから再利用できるようにします。

import { qs, qsa } from "./dom.js";

// Command関連
export const commandInputField = () => qs("#command-input");
export const commandIndicator = () => qs('[data-indicator="command"]');
export const commandHistoryButton = () => qs('#command-history-button');

// Story Timeline関連
export const storyTimeline = () => qs("#story-timeline");
export const storySelector = () => qs("#story-selector");
export const storyViewContainer = () => qs('[data-role="story-views"]');
export const storyTabButtons = () => qsa('[data-story-tab]');

// Entry Form関連
export const entryForm = () => qs("#entry-form");
export const entryTypeSelect = () => qs("#entry-type");
export const entryCharacterSelect = () => qs("#entry-character");
export const entryCharacterFace = () => qs('[data-role="character-face"]');
export const entryContent = () => qs("#entry-content");

// Generation関連
export const generateButton = () => qs("#generate-next-button");
export const generateCharacterButton = () => qs("#generate-next-character-button");
export const generateCheckbox = () => qs("#entry-generate-toggle");
export const generationOverlay = () => qs("#generation-overlay");

// Entry Actions関連
export const addEntryButton = () => qs("#add-entry-button");
export const characterActionButtons = () => qs('[data-role="character-actions"]');
export const addDialogueButton = () => qs("#add-dialogue-button");
export const addActionButton = () => qs("#add-action-button");

// Dice Roll関連
export const diceRollSection = () => qs('[data-role="dice-roll-section"]');
export const diceNotationInput = () => qs("#dice-notation");
export const rollDiceButton = () => qs("#roll-dice-button");
export const diceResultDiv = () => qs("#dice-result");

// Footer関連
export const footerTokens = () => qs("#footer-tokens");
export const footerLatency = () => qs("#footer-latency");
export const footerCost = () => qs("#footer-cost");
export const footerStatus = () => qs("#footer-status");

// Story Management関連
export const storySummaryForm = () => qs("#story-summary-form");
export const storyCreateFormEl = () => qs("#story-create-form");
export const storyDeleteSelect = () => qs("#story-delete-select");
export const storyDeleteButton = () => qs("#story-delete-button");
export const storyRenameForm = () => qs("#story-rename-form");
export const storyRenameSelect = () => qs("#story-rename-select");
export const storyRenameTitle = () => qs("#story-rename-title");
export const storyRenameDescription = () => qs("#story-rename-description");
export const storyRenameButton = () => qs("#story-rename-button");

// Status関連
export const storySummaryStatus = () => qs('[data-role="summary-status"]');
export const storyCreateStatus = () => qs('[data-role="create-status"]');
export const storyDeleteStatus = () => qs('[data-role="delete-status"]');
export const storyRenameStatus = () => qs('[data-role="rename-status"]');
export const storySummaryButton = () => qs("#story-summary-start-button");
// エクスポート用
export const storyExportGenerateButton = () => qs("#story-export-generate-button");
export const storyExportCopyButton = () => qs("#story-export-copy-button");
export const storyExportTextarea = () => qs("#story-export-text");
export const storyExportStatus = () => qs('[data-role="export-status"]');
export const storyExportFormatSelect = () => qs("#story-export-format");
export const storyExportIncludeActionName = () => qs("#story-export-include-action-name");
export const storyExportIncludeDialogueName = () => qs("#story-export-include-dialogue-name");

// Main App関連
export const appMainEl = () => qs("main.app-main");
// World / Settings 付近の履歴ボタン
export const worldViewHistoryButton = () => qs('#worldview-history-button');
export const rolePromptHistoryButton = () => qs('#roleprompt-history-button');

// オーバーレイ内のテキスト要素を取得
export const generationOverlayText = () => qs(".generation-text");
export const generationOverlaySubtext = () => qs(".generation-subtext");

// 共通のオーバーレイ制御関数
// デフォルト文言をJS側に集約（HTML初期値に依存しない）
const OVERLAY_MESSAGES = {
  generating: {
    text: "物語を生成しています…",
    subtext: "AIが物語の続きを考えています"
  },
  dataCheck: {
    text: "データをチェック中…",
    subtext: "最新データとの差分を確認しています"
  },
  summary: {
    text: "要約を生成しています…",
    subtext: "これまでの物語の要約を作成中"
  }
};

/**
 * 生成オーバーレイを表示する
 * @param {Object} options - オプション
 * @param {string} options.text - メインテキスト
 * @param {string} options.subtext - サブテキスト
 */
export function showGenerationOverlay(options = {}) {
  const overlay = generationOverlay();
  if (overlay) {
    // テキストの更新（未指定時は生成中メッセージを適用）
    const textEl = generationOverlayText();
    const subtextEl = generationOverlaySubtext();

    const msg = {
      text: options.text ?? OVERLAY_MESSAGES.generating.text,
      subtext: options.subtext ?? OVERLAY_MESSAGES.generating.subtext
    };
    if (textEl) textEl.textContent = msg.text;
    if (subtextEl) subtextEl.textContent = msg.subtext;
    
    overlay.classList.add("show");
  }
}

/**
 * 生成オーバーレイを非表示にする
 */
export function hideGenerationOverlay() {
  const overlay = generationOverlay();
  if (overlay) {
    overlay.classList.remove("show");
  }
}

/**
 * データチェック用のオーバーレイを表示する
 */
export function showDataCheckOverlay() {
  showGenerationOverlay({
    text: OVERLAY_MESSAGES.dataCheck.text,
    subtext: OVERLAY_MESSAGES.dataCheck.subtext
  });
}

/**
 * 生成中用のオーバーレイを表示する（明示的）
 */
export function showGeneratingOverlay() {
  showGenerationOverlay({
    text: OVERLAY_MESSAGES.generating.text,
    subtext: OVERLAY_MESSAGES.generating.subtext
  });
}

/**
 * 要約中用のオーバーレイを表示する（明示的）
 */
export function showSummaryOverlay() {
  showGenerationOverlay({
    text: OVERLAY_MESSAGES.summary.text,
    subtext: OVERLAY_MESSAGES.summary.subtext
  });
}

/**
 * オーバーレイのサブテキストだけを更新する
 * （オーバーレイが非表示でも要素があれば書き換える）
 */
export function updateOverlaySubtext(subtext) {
  const subtextEl = generationOverlaySubtext();
  if (subtextEl && typeof subtext === "string") {
    subtextEl.textContent = subtext;
  }
}

/**
 * モードに応じてオーバーレイ文言を設定する（表示状態は変更しない）
 * @param {('generating'|'data-check'|'summary')} mode
 */
export function setOverlayMode(mode) {
  const textEl = generationOverlayText();
  const subtextEl = generationOverlaySubtext();
  const map = {
    "generating": OVERLAY_MESSAGES.generating,
    "data-check": OVERLAY_MESSAGES.dataCheck,
    "summary": OVERLAY_MESSAGES.summary
  };
  const msg = map[mode] || OVERLAY_MESSAGES.generating;
  if (textEl) textEl.textContent = msg.text;
  if (subtextEl) subtextEl.textContent = msg.subtext;
}
