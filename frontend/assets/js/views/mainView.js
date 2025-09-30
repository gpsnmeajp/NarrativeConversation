// views/mainView.js
// メインのストーリー編集ビュー（リファクタリング版）
// このファイルは統合的なマウント関数とイベントハンドリングのみを担当し、
// 具体的な機能は分割されたモジュールに委譲します。

import { qs } from "../utils/dom.js";
import { debounce } from "../utils/debounce.js";
import { generateUUID } from "../utils/uuid.js";
import { detectAllDataChanges } from "../utils/storyConflict.js";
import { eventBus } from "../utils/eventBus.js";
import {
  addNotification,
  getState,
  setSaveStatus,
  updateState,
} from "../state/appState.js";
import { saveCommand, switchStory, loadEntrySettings, saveEntrySettings } from "../state/dataStore.js";
import { showConfirmDialog } from "../components/modal.js";
import { showConflictConfirmModal } from "../components/conflictModal.js";
import { generationOverlayText, generationOverlaySubtext, commandHistoryButton, updateOverlaySubtext } from "../utils/domSelectors.js";
import { hideGenerationOverlay } from "../utils/domSelectors.js";
import { getHistory, upsertHistory, deleteHistory } from "../utils/history.js";
import { showHistoryModal } from "../components/historyModal.js";

// 分割されたモジュールをインポート
import {
  commandInputField,
  commandIndicator,
  storySelector,
  storyViewContainer,
  storyTabButtons,
  entryForm,
  entryTypeSelect,
  entryCharacterSelect,
  entryContent,
  generateCheckbox,
  addEntryButton,
  characterActionButtons,
  addDialogueButton,
  addActionButton,
  rollDiceButton,
  storyTimeline,
  appMainEl,
  storySummaryForm,
  storyCreateFormEl,
  storyDeleteButton,
  storyDeleteSelect,
  storyRenameForm,
  storyRenameSelect,
  storyRenameTitle,
  storyRenameDescription,
  storyRenameButton,
  generateButton,
  generateCharacterButton
} from "../utils/domSelectors.js";

import {
  renderStory,
  renderStorySelector,
  updateCharacterPicker,
  updateCharacterFace,
  updateCharacterActionButtons,
  updateEntryTypeStyles,
  scrollToBottom
} from "../utils/storyRenderer.js";

import {
  appendEntry,
  buildEntryFromForm,
  clearEntryForm,
  hideAllEntryMenus,
  handleTimelineClick,
  performEntryAction,
  flushPendingStorySave
} from "../utils/entryHandlers.js";

import {
  updateDiceRollVisibility,
  handleDiceRoll
} from "../utils/diceHandlers.js";

import {
  generateContinuation,
  generateContinuationWithAutoConfirm,
  updateFooterDisplay
} from "../utils/aiGeneration.js";

import {
  renderStoryManagementView,
  handleStorySummaryFormSubmit,
  handleStoryCreateFormSubmit,
  handleStoryDelete,
  handleStoryRename,
  updateRenameFormFields
} from "../utils/storyManagement.js";

// エントリ設定の復元に関する内部フラグ
let pendingCharacterToRestore = null; // characters 読み込み後に反映したい保存済みキャラ名
let didAttemptCharacterRestore = false; // 一度復元を試みたか

// debouncedCommandSave
// - コマンド入力の変更を 600ms デバウンスして保存するヘルパー
const debouncedCommandSave = debounce(async (value) => {
  try {
    await saveCommand(value);
    setSaveStatus("command", "saved");
    updateCommandIndicator();
  } catch (error) {
    console.error("Command save failed", error);
    setSaveStatus("command", "error");
    updateCommandIndicator();
    addNotification({ variant: "error", message: "司令の保存に失敗しました" });
  }
}, 600);

/**
 * コマンドの保存状態インジケーターを更新
 */
function updateCommandIndicator() {
  const indicator = commandIndicator();
  if (!indicator) return;
  const status = getState().saveStatus.command;
  indicator.dataset.status = status;
  if (status === "saving") {
    indicator.textContent = "保存中…";
  } else if (status === "saved") {
    indicator.textContent = "保存済み";
    setTimeout(() => {
      if (getState().saveStatus.command === "saved") {
        setSaveStatus("command", "idle");
        updateCommandIndicator();
      }
    }, 1200);
  } else if (status === "error") {
    indicator.textContent = "保存失敗";
  } else {
    indicator.textContent = "保存済み";
  }
}

/**
 * コマンドテキストエリアの入力イベントハンドラ
 * @param {Event} event - 入力イベント
 */
function handleCommandInput(event) {
  const value = event.target.value;
  updateState("command", () => value);
  setSaveStatus("command", "saving");
  updateCommandIndicator();
  debouncedCommandSave(value);
}

/**
 * ビューを切り替える（timeline / management）
 * @param {string} mode - 切り替えるモード
 */
export function setStoryView(mode) {
  const targetMode = mode === "management" ? "management" : "timeline";
  const container = storyViewContainer();
  if (container) {
    container.dataset.active = targetMode;
  }
  storyTabButtons().forEach((button) => {
    const isActive = button.dataset.storyTab === targetMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    const panelId = button.getAttribute("aria-controls");
    if (panelId) {
      const panel = qs(`#${panelId}`);
      if (panel) {
        if (isActive) {
          panel.removeAttribute("hidden");
        } else if (!panel.hasAttribute("hidden")) {
          panel.setAttribute("hidden", "");
        }
      }
    }
  });
  const main = appMainEl();
  if (main) {
    main.dataset.storyMode = targetMode;
  }
}

/**
 * ストーリー切り替えイベントハンドラ
 * @param {Event} event - 変更イベント
 */
function handleStoryChange(event) {
  const storyId = event.target.value;
  if (!storyId) return;
  switchStory(storyId).catch((error) => {
    console.error("Failed to switch story", error);
    addNotification({ variant: "error", message: "物語の切り替えに失敗しました" });
  });
}

/**
 * データチェック進捗を更新する
 * @param {string} message - 表示するメッセージ
 */
function updateDataCheckProgress(message) {
  updateOverlaySubtext(message);
}

/**
 * 全体データの競合をチェックして再読み込みを行う
 * @returns {Promise<boolean>} 処理を続行する場合true、中断する場合false
 */
export async function checkAndReloadAllData() {
  try {
    console.log('checkAndReloadAllData: 開始');
    // ローカルの変更がデバウンス保存待ちの場合、ここで即時保存して整合させる
    await flushPendingStorySave();
    updateDataCheckProgress("現在のデータを収集中...");
    // 現在の全データを収集
    const currentState = getState();
    console.log('checkAndReloadAllData: 全体状態', currentState);
    const currentData = {
      storyEntries: currentState.storyEntries || [],
      worldView: currentState.worldView || '',
      characters: currentState.characters || [],
      settings: currentState.settings || {}
    };
    console.log('checkAndReloadAllData: 現在のデータ', currentData);
    
    // リモートから最新データを読み込み
    updateDataCheckProgress("最新データを読み込み中...");
    const {
      getStoryEntries,
      loadWorldView,
      loadCharacters, 
      loadSettingsFromFile
    } = await import("../state/dataStore.js");
    
    console.log('checkAndReloadAllData: データストア関数を取得');
    
    const remoteData = {
      worldView: await loadWorldView(),
      characters: await loadCharacters(),
      settings: await loadSettingsFromFile()
    };
    console.log('checkAndReloadAllData: リモートデータ（物語前）', remoteData);
    
    // currentStoryの状態を詳細に確認
    console.log('checkAndReloadAllData: currentState.currentStory', currentState.currentStory);
    
    // 物語が選択されていない場合は、ストーリーインデックスから取得を試行
    let storyToLoad = currentState.currentStory;
    if (!storyToLoad) {
      console.log('checkAndReloadAllData: currentStoryが未設定、ストーリーインデックスから取得を試行');
      try {
        const { loadStoryIndex } = await import("../state/dataStore.js");
        const storyIndex = await loadStoryIndex();
        if (storyIndex && storyIndex.stories && storyIndex.stories.length > 0) {
          // アクティブな物語があればそれを、なければ最初の物語を使用
          const activeStory = storyIndex.stories.find(s => s.id === storyIndex.activeStoryId) || storyIndex.stories[0];
          storyToLoad = activeStory;
          console.log('checkAndReloadAllData: デフォルト物語を設定', storyToLoad);
          // 注意: state は currentStoryId と storyFileMap を前提としているため
          // ここで currentStory を直接更新しない（不要かつ無効なキー）
        }
      } catch (error) {
        console.error('checkAndReloadAllData: ストーリーインデックス読み込みエラー', error);
      }
    }
    
    // 物語データを読み込み
    if (storyToLoad && storyToLoad.filePath) {
      updateDataCheckProgress("物語データを読み込み中...");
      console.log('checkAndReloadAllData: 物語データを読み込み中', storyToLoad.filePath);
      try {
        remoteData.storyEntries = await getStoryEntries(storyToLoad.filePath);
        console.log('checkAndReloadAllData: 物語データ読み込み完了', remoteData.storyEntries.length);
      } catch (error) {
        console.error('checkAndReloadAllData: getStoryEntriesでエラー', error);
        remoteData.storyEntries = currentData.storyEntries;
      }
    } else {
      console.log('checkAndReloadAllData: 物語が選択されていない - 既存データを使用');
      remoteData.storyEntries = currentData.storyEntries;
    }
    
    console.log('checkAndReloadAllData: 完全なリモートデータ', remoteData);
    
    // 変更を検知
    updateDataCheckProgress("データの差分を分析中...");
    const changes = detectAllDataChanges(currentData, remoteData);
    console.log('checkAndReloadAllData: 変更検知結果', changes);
    
    if (changes.hasChanges) {
      console.log('データの変更を検知:', changes);
      
      // ユーザーに確認を求める
      // モーダルを前面に出すため、先にスピナーオーバーレイを必ず閉じる
      try { hideGenerationOverlay(); } catch (_) {}
      const shouldContinue = await showConflictConfirmModal(changes);
      
      if (!shouldContinue) {
        // 最新版を読み込み直す
        if (changes.storyChanges && remoteData.storyEntries) {
          updateState("storyEntries", () => remoteData.storyEntries);
          renderStory();
        }
        if (changes.worldViewChanged) {
          updateState("worldView", () => remoteData.worldView);
        }
        if (changes.charactersChanged) {
          updateState("characters", () => remoteData.characters);
        }
        if (changes.settingsChanged) {
          updateState("settings", () => remoteData.settings);
        }
        
        addNotification({ 
          variant: "info", 
          message: `データを最新版に更新しました (${changes.summary})` 
        });
        return false; // 処理を中断
      } else {
        // 上書きして続行する場合の警告
        addNotification({ 
          variant: "warn", 
          message: "他端末の変更を上書きして処理を続行します" 
        });
        return true; // 処理を続行
      }
    }
    
    // 変更がない場合は続行
    return true;
    
  } catch (error) {
    console.error('checkAndReloadAllData: エラー発生:', error);
    addNotification({ 
      variant: "error", 
      message: "データの再読み込みに失敗しました。処理を続行します。" 
    });
    return true; // エラーの場合は続行（従来の動作を維持）
  }
}

/**
 * エントリフォーム送信処理
 * @param {Event} event - フォーム送信イベント
 */
async function handleEntryFormSubmit(event) {
  event.preventDefault();
  
  // 競合チェックと全データの再読み込み
  const shouldContinue = await checkAndReloadAllData();
  if (!shouldContinue) {
    return; // 処理を中断
  }
  
  try {
    const entry = buildEntryFromForm();
    appendEntry(entry, { type: "end" });
    clearEntryForm();
    hideAllEntryMenus();
    addNotification({ variant: "success", message: "エントリを追加しました" });
    
    // エントリ追加後に滑らかにスクロール
    setTimeout(() => scrollToBottom(true), 100);
    
    if (generateCheckbox()?.checked) {
      generateContinuationWithAutoConfirm();
    }
  } catch (error) {
    addNotification({ variant: "error", message: error.message ?? "エントリ追加に失敗しました" });
  }
}

/**
 * キャラクターアクション処理（発言・行動）
 * @param {string} actionType - アクションタイプ（dialogue / action）
 */
async function handleCharacterAction(actionType) {
  // 競合チェックと全データの再読み込み
  const shouldContinue = await checkAndReloadAllData();
  if (!shouldContinue) {
    return; // 処理を中断
  }
  
  try {
    const character = entryCharacterSelect()?.value;
    const content = entryContent()?.value?.trim();
    
    if (!content) {
      throw new Error("本文を入力してください");
    }
    if (!character) {
      throw new Error("キャラクターを選択してください");
    }
    
    const entry = {
      id: generateUUID(),
      type: actionType,
      name: character,
      content,
      createdAt: new Date().toISOString(),
    };
    
    appendEntry(entry, { type: "end" });
    clearEntryForm();
    hideAllEntryMenus();
    
    const actionLabel = actionType === "dialogue" ? "発言" : "行動";
    addNotification({ variant: "success", message: `${actionLabel}を追加しました` });
    
    // エントリ追加後に滑らかにスクロール
    setTimeout(() => scrollToBottom(true), 100);
    
    if (generateCheckbox()?.checked) {
      generateContinuationWithAutoConfirm();
    }
  } catch (error) {
    addNotification({ variant: "error", message: error.message ?? "エントリ追加に失敗しました" });
  }
}



/**
 * エントリ追加処理（カスタムイベント対応）
 */
async function addEntry() {
  const form = entryForm();
  if (form) {
    // フォーム送信イベントを発火
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
}

/**
 * イベントハンドラーをバインド
 */
function bindMainEvents() {
  const commandInput = commandInputField();
  if (commandInput) {
    commandInput.value = getState().command;
    commandInput.addEventListener("input", handleCommandInput);
  }

  // 司令の履歴ボタン
  const cmdHistBtn = commandHistoryButton();
  if (cmdHistBtn) {
    cmdHistBtn.addEventListener("click", async () => {
      const items = await getHistory("command");
      showHistoryModal({
        type: "command",
        items,
        onSelect: (text) => {
          const input = commandInputField();
          if (input) input.value = text;
          updateState("command", () => text);
          // 即時保存（debounceと二重でもOK）
          saveCommand(text).catch(console.error);
        },
        onDelete: async (text) => {
          await deleteHistory("command", text);
        }
      });
    });
  }

  const form = entryForm();
  if (form) {
    form.addEventListener("submit", handleEntryFormSubmit);
  }

  const typeSelect = entryTypeSelect();
  if (typeSelect) {
    typeSelect.addEventListener("change", async () => {
      updateCharacterPicker();
      updateCharacterFace();
      updateEntryTypeStyles();
      updateDiceRollVisibility();
      // 種別を保存
      try {
        const current = await loadEntrySettings();
        await saveEntrySettings({
          ...current,
          type: typeSelect.value,
        });
      } catch (e) {
        console.warn("Failed to save entry type", e);
      }
    });
  }

  // ダイスロールボタンのイベント
  const diceBtn = rollDiceButton();
  if (diceBtn) {
    diceBtn.addEventListener("click", handleDiceRoll);
  }

  const characterSelect = entryCharacterSelect();
  if (characterSelect) {
    characterSelect.addEventListener("change", async () => {
      updateCharacterFace();
      updateCharacterActionButtons();
      // キャラクター選択を保存
      try {
        const current = await loadEntrySettings();
        const value = characterSelect.value || null;
        await saveEntrySettings({
          ...current,
          character: value,
        });
      } catch (e) {
        console.warn("Failed to save entry character", e);
      }
    });
  }
  
  // 新しいキャラクター発言・行動ボタンのイベント
  const dialogueBtn = addDialogueButton();
  const actionBtn = addActionButton();
  if (dialogueBtn) {
    dialogueBtn.addEventListener("click", async () => await handleCharacterAction("dialogue"));
  }
  if (actionBtn) {
    actionBtn.addEventListener("click", async () => await handleCharacterAction("action"));
  }

  // 本文以外の入力欄の自動保存: チェックボックスとダイス記法
  const autoGenCb = generateCheckbox();
  if (autoGenCb) {
    autoGenCb.addEventListener("change", async () => {
      try {
        const current = await loadEntrySettings();
        await saveEntrySettings({ ...current, autoGenerate: !!autoGenCb.checked });
      } catch (e) {
        console.warn("Failed to save autoGenerate toggle", e);
      }
    });
  }
  const diceInput = document.querySelector('#dice-notation');
  if (diceInput) {
    diceInput.addEventListener("input", debounce(async () => {
      try {
        const current = await loadEntrySettings();
        const value = diceInput.value?.trim() || "1d6";
        await saveEntrySettings({ ...current, diceNotation: value });
      } catch (e) {
        console.warn("Failed to save dice notation", e);
      }
    }, 400));
  }
  
  const timelineRoot = storyTimeline();
  if (timelineRoot) {
    timelineRoot.addEventListener("click", handleTimelineClick);
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".story-entry")) hideAllEntryMenus();
  });

  const selector = storySelector();
  if (selector) {
    selector.addEventListener("change", handleStoryChange);
  }

  storyTabButtons().forEach((button) => {
    button.addEventListener("click", () => setStoryView(button.dataset.storyTab));
  });

  // ストーリー管理関連のイベント
  const summaryForm = storySummaryForm();
  if (summaryForm) {
    summaryForm.addEventListener("submit", handleStorySummaryFormSubmit);
  }

  const createForm = storyCreateFormEl();
  if (createForm) {
    createForm.addEventListener("submit", handleStoryCreateFormSubmit);
  }

  const deleteBtn = storyDeleteButton();
  if (deleteBtn) {
    deleteBtn.addEventListener("click", handleStoryDelete);
  }

  const deleteSelectEl = storyDeleteSelect();
  if (deleteSelectEl) {
    deleteSelectEl.addEventListener("change", () => {
      const button = storyDeleteButton();
      if (button) {
        button.disabled = getState().storyIndex.length <= 1 || !deleteSelectEl.value;
      }
    });
  }

  const renameForm = storyRenameForm();
  if (renameForm) {
    renameForm.addEventListener("submit", handleStoryRename);
  }

  const renameSelectEl = storyRenameSelect();
  if (renameSelectEl) {
    renameSelectEl.addEventListener("change", () => {
      const button = storyRenameButton();
      const { storyFileMap } = getState();
      const selectedStoryId = renameSelectEl.value;
      
      if (button) {
        button.disabled = !selectedStoryId;
      }
      
      if (selectedStoryId) {
        updateRenameFormFields(selectedStoryId, storyFileMap);
      } else {
        const titleInput = storyRenameTitle();
        const descriptionInput = storyRenameDescription();
        if (titleInput) titleInput.value = "";
        if (descriptionInput) descriptionInput.value = "";
      }
    });
  }

  // AI生成ボタンのイベント（フォーム内は撤去済みのため、右上とモバイルのみ）
  // デスクトップ用：『続きを生成』ボタン（右上ツールバー）
  const generateBtnDesktop = document.querySelector('#generate-next-button-desktop');
  if (generateBtnDesktop) {
    generateBtnDesktop.addEventListener('click', generateContinuation);
  }
  // モバイル用：『続きを生成』ボタン（簡易バー）
  const generateBtnMobile = document.querySelector('#generate-next-button-mobile');
  if (generateBtnMobile) {
    generateBtnMobile.addEventListener('click', generateContinuation);
  }
  // キャラクター用フォーム内ボタンは撤去済み

  // カスタムイベントの処理
  // 「追加して生成」: まずエントリ追加を発火し、その後に生成を実行
  document.addEventListener('addEntryAndGenerate', async () => {
    try {
      // 厳密な待機: storyEntries の状態更新イベントを1回だけ待ってから生成を開始
      const timeoutMs = 5000;
      let timeoutId;
      const waitForEntriesChange = new Promise((resolve, reject) => {
        const off = eventBus.once('state:change:storyEntries', () => {
          clearTimeout(timeoutId);
          resolve();
        });
        // バリデーション等でエントリが追加されない場合に無限待機を避ける
        timeoutId = setTimeout(() => {
          off();
          reject(new Error('state:change:storyEntries timeout'));
        }, timeoutMs);
      });

      // フォーム submit を発火してエントリ追加を試行
      await addEntry();
      // storyEntries 変更イベントを待機（成功時のみ続行）
      await waitForEntriesChange;
      // 追加が反映されたことを確認後に生成を実行（確認ダイアログなし）
      await generateContinuation(false);
    } catch (e) {
      if (e?.message?.includes('timeout')) {
        addNotification({ variant: 'warning', message: 'エントリが追加されなかったため、生成を中止しました' });
      } else {
        console.error('addEntryAndGenerate ハンドリングに失敗', e);
      }
    }
  });

  // モバイル用：入力欄の展開/折りたたみトグル
  const expandToggle = document.querySelector('#mobile-entry-expand-toggle');
  if (expandToggle) {
    const updateToggleLabel = () => {
      const expanded = document.body.classList.contains('mobile-entry-expanded');
      expandToggle.textContent = expanded ? '閉じる' : '開く';
      expandToggle.setAttribute('aria-expanded', String(expanded));
    };
    expandToggle.addEventListener('click', () => {
      document.body.classList.toggle('mobile-entry-expanded');
      updateToggleLabel();
    });
    // 初期状態は折りたたみ
    document.body.classList.remove('mobile-entry-expanded');
    updateToggleLabel();
  }
}

/**
 * メインビューをマウントする
 */
export function mountMainView() {
  bindMainEvents();
  setStoryView("timeline");
  updateCommandIndicator();
  renderStory();
  renderStorySelector();
  renderStoryManagementView();
  updateCharacterPicker();
  updateEntryTypeStyles();
  updateDiceRollVisibility();
  updateFooterDisplay();

  // entry_settings.json から本文以外のUI状態を復元
  (async () => {
    try {
      const settings = await loadEntrySettings();
      // 種別
      const typeSelect = entryTypeSelect();
      if (typeSelect) {
        typeSelect.value = settings.type;
        // UI連動
        updateEntryTypeStyles();
        updateDiceRollVisibility();
      }
      // キャラクター: 現在のリストから存在チェック
      const charSelect = entryCharacterSelect();
      if (charSelect) {
        // ここでは保存ファイルを書き換えず、後で characters がロードされたタイミングで最終判断する
        pendingCharacterToRestore = settings.character || null;
        const currentChars = Array.from(charSelect.options).map(o => o.value);
        if (pendingCharacterToRestore && currentChars.includes(pendingCharacterToRestore)) {
          charSelect.value = pendingCharacterToRestore;
        } else {
          charSelect.value = "";
        }
        updateCharacterFace();
        updateCharacterActionButtons();
      }
      // 自動生成トグル
      const autoGen = generateCheckbox();
      if (autoGen) autoGen.checked = !!settings.autoGenerate;
      // ダイス記法
      const diceInput = document.querySelector('#dice-notation');
      if (diceInput) diceInput.value = settings.diceNotation || "1d6";
    } catch (e) {
      console.warn("Failed to restore entry settings", e);
    }
  })();

  eventBus.on("state:change:storyEntries", () => {
    renderStory();
    renderStoryManagementView();
  });
  eventBus.on("state:change:characters", () => {
    updateCharacterPicker();
    updateCharacterActionButtons();
    renderStory();
    renderStoryManagementView();
    // キャラクター一覧が利用可能になったタイミングで復元を最終決定
    (async () => {
      try {
        const select = entryCharacterSelect();
        if (!select) return;
        // すでに一度判定済みなら何もしない
        if (didAttemptCharacterRestore) return;
        // 保存済み値を取得（pending が無ければファイルから）
        let target = pendingCharacterToRestore;
        if (!target) {
          const saved = await loadEntrySettings();
          target = saved.character || null;
        }
        const options = Array.from(select.options).map(o => o.value);
        if (target && options.includes(target)) {
          // 復元成功
          select.value = target;
          updateCharacterActionButtons();
          updateCharacterFace();
        } else if (target) {
          // 保存されていたキャラが存在しない → UIを未選択にし、保存もnullへ更新
          select.value = "";
          try {
            const saved = await loadEntrySettings();
            await saveEntrySettings({ ...saved, character: null });
          } catch (_) {}
          updateCharacterActionButtons();
          updateCharacterFace();
        }
        didAttemptCharacterRestore = true;
        pendingCharacterToRestore = null;
      } catch (e) {
        // noop
      }
    })();

    // 以降の更新でも、選択中キャラが一覧から消えたら未選択へ戻して保存
    (async () => {
      try {
        const select = entryCharacterSelect();
        if (!select) return;
        const current = select.value || "";
        if (!current) return; // 既に未選択
        const exists = Array.from(select.options).some(o => o.value === current);
        if (!exists) {
          select.value = "";
          try {
            const saved = await loadEntrySettings();
            await saveEntrySettings({ ...saved, character: null });
          } catch (_) {}
          updateCharacterActionButtons();
          updateCharacterFace();
        }
      } catch (_) {}
    })();
  });
  eventBus.on("state:change:storyIndex", () => {
    renderStorySelector();
    renderStoryManagementView();
  });
  eventBus.on("state:change:currentStoryId", () => {
    renderStorySelector();
    renderStoryManagementView();
  });
  eventBus.on("state:change:command", (value) => {
    const input = commandInputField();
    if (input && document.activeElement !== input) input.value = value;
  });
  eventBus.on("state:change:footer", updateFooterDisplay);

  // 設定変更時（例: アバター非表示切替）はタイムラインを再描画
  eventBus.on("state:change:settings", () => {
    renderStory();
  });
}