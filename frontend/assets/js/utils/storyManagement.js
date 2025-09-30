// utils/storyManagement.js
// ストーリーの管理機能（作成・削除・リネーム・要約・統計）
// このモジュールはストーリーファイルの管理、統計計算、
// 管理画面の表示更新などを担当します。

import { qs, qsa, clearChildren, createElement } from "./dom.js";
import { escapeXml } from "./string.js";
import { generateUUID } from "./uuid.js";
import { getState, updateState, addNotification, updateFooter } from "../state/appState.js";
import { saveStory, createStory, deleteStory, renameStory } from "../state/dataStore.js";
import { chatCompletions } from "../services/apiClient.js";
import { buildUserFriendlyError } from "./errorHints.js";
import { showConfirmDialog } from "../components/modal.js";
import { getSummarySystemPrompt, STORY_TYPE_LABELS } from "./storyPrompts.js";
import { formatStoryForBlog, formatStoryAsXml } from "./storyExport.js";
import { scrollToBottom } from "./storyRenderer.js";
import { withBusy } from "./uiHelpers.js";
import {
  storySummaryForm,
  storyCreateFormEl,
  storyDeleteSelect,
  storyDeleteButton,
  storyRenameForm,
  storyRenameSelect,
  storyRenameTitle,
  storyRenameDescription,
  storyRenameButton,
  storySummaryStatus,
  storyCreateStatus,
  storyDeleteStatus,
  storyRenameStatus,
  storySummaryButton,
  showGenerationOverlay,
  hideGenerationOverlay,
  showSummaryOverlay
} from "./domSelectors.js";

const numberFormatter = new Intl.NumberFormat("ja-JP");
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

/**
 * 日付をフォーマットして表示
 * @param {string} value - 日付文字列
 * @returns {string} フォーマット済みの日付
 */
function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return dateTimeFormatter.format(date);
}

/**
 * 現在のストーリーの統計情報を計算
 * @returns {Object} ストーリーの統計情報
 */
function calculateStoryStats() {
  const state = getState();
  const entries = state.storyEntries ?? [];
  const story = state.storyFileMap?.[state.currentStoryId] ?? null;
  const typeCounts = entries.reduce((acc, entry) => {
    const type = entry.type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  const uniqueCharacters = new Set(entries.filter((entry) => entry.name).map((entry) => entry.name)).size;
  const lastEntry = entries.at(-1) ?? null;
  const totalCharacters = entries.reduce((total, entry) => total + (entry.content?.length ?? 0), 0);
  
  return {
    title: story?.title ?? "未設定の物語",
    totalEntries: entries.length,
    typeCounts,
    uniqueCharacters,
    totalCharacters,
    createdAt: story?.createdAt ?? null,
    updatedAt: story?.updatedAt ?? null,
    lastEntryAt: lastEntry?.updatedAt ?? lastEntry?.createdAt ?? null,
  };
}

/**
 * ストーリー統計を表示
 */
function renderStoryStats() {
  const list = qs('[data-role="story-stats"]');
  if (!list) return;
  clearChildren(list);
  const stats = calculateStoryStats();

  const typeItems = Object.entries(STORY_TYPE_LABELS)
    .filter(([type]) => (stats.typeCounts[type] ?? 0) > 0)
    .map(([type, label]) => ({
      label: `${label}数`,
      value: `${numberFormatter.format(stats.typeCounts[type])} 件`,
    }));

  const items = [
    { label: "タイトル", value: stats.title },
    { label: "エントリ数", value: `${numberFormatter.format(stats.totalEntries)} 件` },
    ...typeItems,
    { label: "登場キャラクター数", value: `${numberFormatter.format(stats.uniqueCharacters)} 人` },
    { label: "総文字数", value: `${numberFormatter.format(stats.totalCharacters)} 文字` },
    { label: "最終更新", value: formatDate(stats.updatedAt) },
    { label: "最新エントリ", value: formatDate(stats.lastEntryAt) },
  ];

  items.forEach(({ label, value }) => {
    const dt = createElement("dt", { text: label });
    const dd = createElement("dd", { text: value });
    list.append(dt, dd);
  });
}

/**
 * ストーリーリネーム用のリストを表示
 */
function renderStoryRenameList() {
  const select = storyRenameSelect();
  const button = storyRenameButton();
  const titleInput = storyRenameTitle();
  const descriptionInput = storyRenameDescription();
  if (!select) return;
  
  const { storyIndex, currentStoryId, storyFileMap } = getState();
  const previous = select.value;
  clearChildren(select);

  // 初期選択用のプレースホルダー
  const placeholderOption = createElement("option", {
    text: "リネームする物語を選択してください",
    attrs: { value: "", disabled: true },
  });
  select.append(placeholderOption);

  storyIndex.forEach((story) => {
    const isCurrent = story.id === currentStoryId;
    const option = createElement("option", {
      text: isCurrent ? `${story.title}（現在）` : story.title,
      attrs: { value: story.id },
    });
    select.append(option);
  });

  if (storyIndex.some((story) => story.id === previous)) {
    select.value = previous;
    updateRenameFormFields(previous, storyFileMap);
  } else {
    select.value = "";
    if (titleInput) titleInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
  }

  if (button) {
    button.disabled = !select.value;
  }
}

/**
 * リネームフォームのフィールドを更新
 * @param {string} storyId - ストーリーID
 * @param {Object} storyFileMap - ストーリーファイルマップ
 */
export function updateRenameFormFields(storyId, storyFileMap) {
  const story = storyFileMap?.[storyId];
  const titleInput = storyRenameTitle();
  const descriptionInput = storyRenameDescription();
  
  if (story && titleInput) {
    titleInput.value = story.title || "";
  }
  if (story && descriptionInput) {
    descriptionInput.value = story.description || "";
  }
}

/**
 * ストーリー削除用のリストを表示
 */
function renderStoryDeleteList() {
  const select = storyDeleteSelect();
  const button = storyDeleteButton();
  if (!select) return;
  const { storyIndex, currentStoryId } = getState();
  const previous = select.value;
  clearChildren(select);
  let fallbackId = null;

  storyIndex.forEach((story) => {
    const isCurrent = story.id === currentStoryId;
    const option = createElement("option", {
      text: isCurrent ? `${story.title}（現在）` : story.title,
      attrs: { value: story.id },
    });
    if (!fallbackId || (!isCurrent && fallbackId === currentStoryId)) {
      fallbackId = story.id;
    }
    select.append(option);
  });

  if (storyIndex.some((story) => story.id === previous)) {
    select.value = previous;
  } else if (fallbackId) {
    select.value = fallbackId;
  }

  if (button) {
    button.disabled = storyIndex.length <= 1 || !select.value;
  }
}

/**
 * ストーリー管理ビューをレンダリング
 */
export function renderStoryManagementView() {
  renderStoryStats();
  renderStoryRenameList();
  renderStoryDeleteList();
  setupStoryExportSection();
}

// --- エクスポート機能 ---
import {
  storyExportGenerateButton,
  storyExportCopyButton,
  storyExportTextarea,
  storyExportStatus,
  storyExportFormatSelect,
  storyExportIncludeActionName,
  storyExportIncludeDialogueName,
} from "./domSelectors.js";

/**
 * エクスポートのUI配線
 */
function setupStoryExportSection() {
  const genBtn = storyExportGenerateButton();
  const copyBtn = storyExportCopyButton();
  const textarea = storyExportTextarea();
  const statusEl = storyExportStatus();
  const formatSel = storyExportFormatSelect();
  const includeActionNameCheckbox = storyExportIncludeActionName();
  const includeDialogueNameCheckbox = storyExportIncludeDialogueName();

  if (!genBtn || !copyBtn || !textarea) return;

  // 出力形式がXMLのときはチェックボックスを無効化（テキスト出力時のみ有効）
  const syncIncludeNameOptionsAvailability = () => {
    const isXml = formatSel?.value === "xml";
    if (includeActionNameCheckbox) {
      includeActionNameCheckbox.disabled = !!isXml;
      includeActionNameCheckbox.title = isXml ? "XML形式では適用されません" : "";
    }
    if (includeDialogueNameCheckbox) {
      includeDialogueNameCheckbox.disabled = !!isXml;
      includeDialogueNameCheckbox.title = isXml ? "XML形式では適用されません" : "";
    }
  };
  syncIncludeNameOptionsAvailability();
  if (formatSel) {
    formatSel.addEventListener("change", syncIncludeNameOptionsAvailability);
  }

  // 二重バインド防止のため onclick を直接設定
  genBtn.onclick = () => {
    try {
      const { storyEntries } = getState();
      const format = formatSel?.value || "text";
      const text = format === "xml"
        ? formatStoryAsXml(storyEntries || [], { wrap: true })
        : formatStoryForBlog(storyEntries || [], {
            includeActionName: !!includeActionNameCheckbox?.checked,
            includeDialogueName: !!includeDialogueNameCheckbox?.checked,
          });
      textarea.value = text;
      setManagementStatus(statusEl, `出力を生成しました（${text.split("\n").length}行）`);
    } catch (e) {
      console.error("Export generate failed", e);
      setManagementStatus(statusEl, "エクスポートの生成に失敗しました");
    }
  };

  copyBtn.onclick = async () => {
    const value = textarea.value ?? "";
    if (!value.trim()) {
      setManagementStatus(statusEl, "コピーする内容がありません");
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // フォールバック
        textarea.select();
        document.execCommand("copy");
      }
      setManagementStatus(statusEl, "クリップボードへコピーしました");
    } catch (e) {
      console.error("Export copy failed", e);
      setManagementStatus(statusEl, "コピーに失敗しました");
    }
  };
}

/**
 * 管理画面のステータスメッセージを設定
 * @param {HTMLElement} element - ステータスを表示する要素
 * @param {string} message - メッセージ
 * @param {string} variant - メッセージの種類
 */
export function setManagementStatus(element, message = "", variant = "info") {
  if (!element) return;
  element.textContent = message;
  if (message) {
    element.dataset.variant = variant;
  } else {
    delete element.dataset.variant;
  }
}

/**
 * プロンプト用の文字列をサニタイズ
 * @param {string} value - サニタイズする値
 * @param {string} fallback - デフォルト値
 * @returns {string} サニタイズされた文字列
 */
function sanitizeForPrompt(value, fallback = "未設定") {
  const text = (value ?? "").toString().trim();
  return text ? text : fallback;
}

/**
 * サマリー用のプロンプトを構築
 * @returns {string} サマリープロンプト
 */
function buildSummaryPrompt() {
  const state = getState();
  const { storyEntries, command, worldView, characters, storyFileMap, currentStoryId } = state;
  const story = storyFileMap?.[currentStoryId];
  const entries = storyEntries ?? [];

  const characterLines = (characters ?? [])
    .filter((character) => character.name)
    .map((character) => {
      const description = sanitizeForPrompt(character.description, "詳細なし");
      return `- ${character.name}: ${description}`;
    });

  const entryLines = entries.map((entry, index) => {
    const label = STORY_TYPE_LABELS[entry.type] ?? (entry.type ?? "不明");
    const name = entry.name ? `（${entry.name}）` : "";
    const content = sanitizeForPrompt(entry.content, "内容なし").replace(/\s+/g, " ");
    return `${index + 1}. [${label}${name}] ${content}`;
  });

  const sections = [
    `# 物語タイトル\n${sanitizeForPrompt(story?.title, "未設定の物語")}`,
    `# 世界観\n${sanitizeForPrompt(worldView, "未設定")}`,
    `# キャラクター\n${characterLines.length ? characterLines.join("\n") : "特記事項なし"}`,
    `# 物語のタイムライン\n${entryLines.length ? entryLines.join("\n") : "エントリなし"}`,
  ];

  return sections.join("\n\n");
}

/**
 * AI による物語要約を生成
 * @returns {Promise<string>} 生成された要約
 */
async function generateNarrativeSummary() {
  const { settings, storyEntries } = getState();
  if (!settings?.apiKey || !settings?.baseUrl || !settings?.model) {
    throw new Error("設定でAPIキー・BaseURL・モデルを入力してください");
  }
  if (!storyEntries?.length) {
    throw new Error("要約する物語エントリがありません");
  }

  const payload = {
    model: settings.model,
    messages: [
      { role: "system", content: getSummarySystemPrompt() },
      { role: "user", content: buildSummaryPrompt() },
    ],
    temperature: Number(settings.temperature ?? 0.7),
  };

  const { responseBody } = await chatCompletions({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    payload,
  }, { timeout: Math.max(0, Number(settings.networkTimeoutSeconds ?? 60)) * 1000 });

  const summary = responseBody?.choices?.[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error("要約の応答にコンテンツが含まれていません");
  }
  return summary;
}





/**
 * ストーリー要約フォームの送信処理
 * @param {Event} event - フォーム送信イベント
 */
export async function handleStorySummaryFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const statusEl = storySummaryStatus();
  const button = storySummaryButton();
  const formData = new FormData(form);
  const title = (formData.get("title") ?? "").toString().trim();
  const description = (formData.get("description") ?? "").toString();

  if (!title) {
    setManagementStatus(statusEl, "タイトルを入力してください", "error");
    addNotification({ variant: "error", message: "新しい物語のタイトルを入力してください" });
    return;
  }

  // 確認ダイアログを表示
  const confirmed = await showConfirmDialog({
    title: "物語の要約を開始",
    message: "現在の物語を要約して新しい物語として保存します。この処理には時間がかかる場合があります。続行しますか？",
    confirmLabel: "要約開始",
    cancelLabel: "キャンセル"
  });
  
  if (!confirmed) {
    return;
  }

  setManagementStatus(statusEl, "要約を生成しています…", "info");
  // 要約処理中は明示的に要約モードの文言を出す
  showSummaryOverlay();
  updateFooter({ status: "要約生成中…" });

  await withBusy(button, "要約生成中…", async () => {
    const summary = await generateNarrativeSummary();
    setManagementStatus(statusEl, "要約が完了しました。新しい物語を作成しています…", "info");
    const story = await createStory({ title, description });
    const now = new Date().toISOString();
    const summaryEntry = {
      id: generateUUID(),
      type: "narration",
      name: null,
      content: summary,
      createdAt: now,
      updatedAt: now,
    };
    updateState("storyEntries", () => [summaryEntry]);
    await saveStory([summaryEntry], story.id);
    setManagementStatus(statusEl, "要約した物語を作成しました。", "success");
    addNotification({ variant: "success", message: "要約した物語を新規作成しました" });
    form.reset();
    
    // ビューを切り替えて管理画面を更新
    const { setStoryView } = await import("../views/mainView.js");
    setStoryView("timeline");
    renderStoryManagementView();
    setTimeout(() => scrollToBottom(true), 150);
  }).catch(async (error) => {
    console.error("Summary creation failed", error);
    const hint = buildUserFriendlyError(error);
    const message = hint?.summary || error.message || "要約に失敗しました";
    setManagementStatus(statusEl, message, "error");
    addNotification({ variant: "error", message });
  }).finally(() => {
    hideGenerationOverlay();
    updateFooter({ status: "待機中" });
  });
}

/**
 * ストーリー作成フォームの送信処理
 * @param {Event} event - フォーム送信イベント
 */
export async function handleStoryCreateFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const statusEl = storyCreateStatus();
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const title = (formData.get("title") ?? "").toString().trim();
  const description = (formData.get("description") ?? "").toString();

  if (!title) {
    setManagementStatus(statusEl, "タイトルを入力してください", "error");
    addNotification({ variant: "error", message: "物語のタイトルを入力してください" });
    return;
  }

  setManagementStatus(statusEl, "物語を作成しています…", "info");
  if (submitButton) {
    submitButton.dataset.originalLabel = submitButton.dataset.originalLabel ?? submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "作成中…";
  }

  try {
    await createStory({ title, description });
    setManagementStatus(statusEl, "物語を作成しました", "success");
    addNotification({ variant: "success", message: "新しい物語を作成しました" });
    form.reset();
    
    // ビューを切り替えて管理画面を更新
    const { setStoryView } = await import("../views/mainView.js");
    setStoryView("timeline");
    renderStoryManagementView();
  } catch (error) {
    console.error("Create story failed", error);
    const message = error.message ?? "物語の作成に失敗しました";
    setManagementStatus(statusEl, message, "error");
    addNotification({ variant: "error", message });
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalLabel ?? "作成する";
    }
  }
}

/**
 * ストーリー削除処理
 */
export async function handleStoryDelete() {
  const select = storyDeleteSelect();
  const statusEl = storyDeleteStatus();
  const button = storyDeleteButton();
  if (!select || !select.value) return;

  const { storyIndex, storyFileMap } = getState();
  if (storyIndex.length <= 1) {
    setManagementStatus(statusEl, "物語は最低1つ必要です", "error");
    addNotification({ variant: "error", message: "これ以上削除できません" });
    return;
  }

  const storyId = select.value;
  const story = storyFileMap?.[storyId];
  const confirmed = await showConfirmDialog({
    title: "物語を削除",
    message: `${story?.title ?? "選択した物語"} を削除しますか？この操作は元に戻せません。`,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル",
  });
  if (!confirmed) return;

  setManagementStatus(statusEl, "削除しています…", "info");
  if (button) {
    button.dataset.originalLabel = button.dataset.originalLabel ?? button.textContent;
    button.disabled = true;
    button.textContent = "削除中…";
  }

  try {
    await deleteStory(storyId);
    setManagementStatus(statusEl, "物語を削除しました", "success");
    addNotification({ variant: "success", message: "物語を削除しました" });
    renderStoryManagementView();
  } catch (error) {
    console.error("Delete story failed", error);
    const message = error.message ?? "物語の削除に失敗しました";
    setManagementStatus(statusEl, message, "error");
    addNotification({ variant: "error", message });
  } finally {
    if (button) {
      button.disabled = getState().storyIndex.length <= 1 || !select.value;
      button.textContent = button.dataset.originalLabel ?? "選択した物語を削除";
    }
  }
}

/**
 * ストーリーリネーム処理
 * @param {Event} event - フォーム送信イベント
 */
export async function handleStoryRename(event) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  const storyId = formData.get("story-id");
  const newTitle = formData.get("title");
  const newDescription = formData.get("description");

  if (!storyId || !newTitle?.trim()) {
    addNotification({ variant: "error", message: "物語とタイトルを選択してください" });
    return;
  }

  const statusEl = storyRenameStatus();
  const button = storyRenameButton();
  
  if (!statusEl || !button) return;

  setManagementStatus(statusEl, "更新しています…", "info");
  if (button) {
    button.dataset.originalLabel = button.dataset.originalLabel ?? button.textContent;
    button.disabled = true;
    button.textContent = "更新中…";
  }

  try {
    await renameStory(storyId, newTitle, newDescription || "");
    setManagementStatus(statusEl, "物語を更新しました", "success");
    addNotification({ variant: "success", message: "物語を更新しました" });
    renderStoryManagementView();
    
    // フォームをクリア
    form.reset();
    updateRenameFormFields("", getState().storyFileMap);
  } catch (error) {
    console.error("Rename story failed", error);
    const message = error.message ?? "物語の更新に失敗しました";
    setManagementStatus(statusEl, message, "error");
    addNotification({ variant: "error", message });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel ?? "物語を更新";
    }
  }
}