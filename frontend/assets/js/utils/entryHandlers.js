// utils/entryHandlers.js
// ストーリーエントリの追加、編集、削除に関する機能
// このモジュールはエントリの操作、フォーム作成、
// アクション実行などを担当します。

import { qs, qsa, createElement } from "./dom.js";
import { escapeXml } from "./string.js";
import { generateUUID } from "./uuid.js";
import { getState, updateState, addNotification } from "../state/appState.js";
import { saveStory, createStory, switchStory } from "../state/dataStore.js";
import { showModal } from "../components/modal.js";
import {
  entryTypeSelect,
  entryCharacterSelect,
  entryContent,
  generateCheckbox
} from "./domSelectors.js";
import { renderStory, renderStorySelector, updateCharacterPicker } from "./storyRenderer.js";
import { entryActions } from "../constants/entryActions.js";
import { startAnimationFromEntry } from "./timelineAnimation.js";
// import { renderStoryManagementView } from "./storyManagement.js"; // 循環参照回避

// 旧mainView.jsの挙動に合わせ、エントリ変更時の保存を500msでデバウンス
let storySaveTimer = null;
function scheduleStorySave() {
  clearTimeout(storySaveTimer);
  storySaveTimer = setTimeout(async () => {
    try {
      await saveStory(getState().storyEntries);
    } catch (error) {
      console.error("Failed to save story", error);
      addNotification({ variant: "error", message: "物語の保存に失敗しました" });
    }
  }, 500);
}

/**
 * デバウンス中の保存を即時フラッシュする
 * - 競合検知など、リモート読み込みと整合させたい直前に呼び出す
 */
export async function flushPendingStorySave() {
  try {
    if (storySaveTimer) {
      clearTimeout(storySaveTimer);
      storySaveTimer = null;
    }
    await saveStory(getState().storyEntries);
  } catch (error) {
    // フラッシュ失敗は致命的ではないため、ログに留める
    console.warn("flushPendingStorySave: 即時保存に失敗", error);
  }
}

/**
 * エントリをストーリーに追加するヘルパー
 * @param {Object} entry - 追加するエントリ
 * @param {Object} [position] - 挿入位置
 */
export function appendEntry(entry, position) {
  updateState("storyEntries", (entries) => {
    const enhanced = { 
      ...entry, 
      id: entry.id ?? generateUUID(), 
      createdAt: entry.createdAt ?? new Date().toISOString() 
    };
    if (!position || position.type === "end") {
      return [...entries, enhanced];
    }
    const index = entries.findIndex((item) => item.id === position.entryId);
    if (index === -1) return [...entries, enhanced];
    if (position.type === "before") {
      const next = [...entries];
      next.splice(index, 0, enhanced);
      return next;
    }
    if (position.type === "after") {
      const next = [...entries];
      next.splice(index + 1, 0, enhanced);
      return next;
    }
    return [...entries, enhanced];
  });
  scheduleStorySave();
}

/**
 * 既存エントリを更新する
 * @param {string} entryId - 更新対象のエントリ ID
 * @param {Object} patch - 更新内容のパッチ
 */
export function updateEntry(entryId, patch) {
  updateState("storyEntries", (entries) =>
    entries.map((entry) =>
      entry.id === entryId
        ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
        : entry
    )
  );
  scheduleStorySave();
}

/**
 * エントリを削除する
 * @param {string} entryId - 削除対象のエントリ ID
 */
export function removeEntry(entryId) {
  updateState("storyEntries", (entries) => entries.filter((entry) => entry.id !== entryId));
  scheduleStorySave();
}

/**
 * 指定エントリ以降をすべて削除する
 * @param {string} entryId - 基準となるエントリ ID
 */
export function deleteAllEntriesAfter(entryId) {
  const { storyEntries } = getState();
  const entryIndex = storyEntries.findIndex((entry) => entry.id === entryId);
  
  if (entryIndex === -1) {
    addNotification({ variant: "error", message: "指定されたエントリが見つかりません" });
    return;
  }

  const entriesToKeep = storyEntries.slice(0, entryIndex + 1);
  const deletedCount = storyEntries.length - entriesToKeep.length;
  
  updateState("storyEntries", () => entriesToKeep);
  scheduleStorySave();
  
  addNotification({ 
    variant: "success", 
    message: `${deletedCount}個のエントリを削除しました` 
  });
  
  // タイムラインを更新
  renderStory();
}

/**
 * 分岐作成用モーダルを表示する
 * @param {Array<Object>} entriesToCopy - コピー対象エントリ
 * @param {Object} selectedEntry - 選択された基準エントリ
 */
function showBranchCreationModal(entriesToCopy, selectedEntry) {
  const form = createElement("form", { className: "branch-creation-form" });
  
  const { storyFileMap, currentStoryId } = getState();
  const currentStory = storyFileMap?.[currentStoryId];
  const currentTitle = currentStory?.title || '物語';
  
  const titleLabel = createElement("label", {
    className: "text-label",
    html: `<span>新しい物語のタイトル</span><input type="text" name="title" value="分岐 - ${currentTitle}" required />`,
  });
  
  const descriptionLabel = createElement("label", {
    className: "text-label",
    html: `<span>説明 (任意)</span><textarea name="description" rows="3" placeholder="この物語の概要"></textarea>`,
  });
  
  const infoText = createElement("p", {
    html: `選択したエントリまでの <strong>${entriesToCopy.length}個</strong> のエントリをコピーして、新しい物語ファイルを作成します。`,
  });
  
  const cancelButton = createElement("button", {
    text: "キャンセル",
    className: "secondary",
    type: "button",
  });
  
  const createButton = createElement("button", {
    text: "分岐を作成",
    className: "primary",
    type: "submit",
  });
  
  const buttonsDiv = createElement("div", {
    style: "display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;",
  });
  
  buttonsDiv.append(cancelButton, createButton);
  form.append(titleLabel, descriptionLabel, infoText, buttonsDiv);
  
  const close = showModal({
    title: "分岐を作成",
    content: form,
  });
  
  cancelButton.addEventListener("click", close);
  
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const title = formData.get("title").trim();
    const description = formData.get("description").trim();
    
    if (!title) {
      addNotification({ variant: "error", message: "タイトルを入力してください" });
      return;
    }
    
    try {
      createButton.disabled = true;
      createButton.textContent = "作成中...";
      
      await createBranchStory(title, description, entriesToCopy);
      
      addNotification({ 
        variant: "success", 
        message: `分岐「${title}」を作成しました` 
      });
      
      close();
    } catch (error) {
      console.error("Branch creation failed", error);
      addNotification({ 
        variant: "error", 
        message: error.message || "分岐の作成に失敗しました" 
      });
      
      createButton.disabled = false;
      createButton.textContent = "分岐を作成";
    }
  });
}

/**
 * 分岐先の物語を作成してエントリをコピーする
 * @param {string} title - 新しい物語のタイトル
 * @param {string} description - 新しい物語の説明
 * @param {Array<Object>} entriesToCopy - コピー対象エントリ
 */
async function createBranchStory(title, description, entriesToCopy) {
  try {
    // 新しい物語ファイルを作成
    const newStory = await createStory({ title, description });
    
    // エントリをコピー（新しいIDとタイムスタンプを付与）
    const now = new Date().toISOString();
    const copiedEntries = entriesToCopy.map(entry => ({
      ...entry,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    
    // 新しい物語ファイルにエントリを保存
    await saveStory(copiedEntries, newStory.id);
    
    // 作成した物語に切り替え
    await switchStory(newStory.id);
    
    // UIを更新（イベント経由で処理）
    document.dispatchEvent(new CustomEvent('refreshStoryManagement'));
    document.dispatchEvent(new CustomEvent('setStoryView', { detail: 'timeline' }));
    
    return newStory;
  } catch (error) {
    console.error("Failed to create branch story:", error);
    throw new Error("分岐の作成に失敗しました");
  }
}

/**
 * エントリ作成/編集用モーダルフォームを構築する
 * @param {Object} initial - 初期値
 * @returns {Object} フォーム要素とコントロール要素
 */
function buildEntryForm(initial = {}) {
  const form = createElement("form", { className: "entry-modal-form" });
  const typeLabel = createElement("label", {
    className: "text-label",
    html: '<span>種別</span><select name="type"><option value="character">キャラクター</option><option value="narration">地の文</option><option value="dice_direction">指示(ダイスロール)</option><option value="direction">指示</option></select>',
  });
  const characterOptions = getState().characters
    .map((character) => `<option value="${character.name}">${character.name}</option>`)
    .join("");
  const characterLabel = createElement("label", {
    className: "text-label",
    html: `<span>キャラクター</span><select name="name"><option value="">選択</option>${characterOptions}</select>`
      + '<small style="color:var(--muted-text);font-size:0.85rem;">種別がキャラクターの場合に必須です</small>',
  });
  
  // キャラクター種別の場合の発言・行動選択
  const actionTypeLabel = createElement("div", {
    className: "character-action-modal-buttons",
    html: '<div style="display: flex; gap: 8px; margin: 8px 0;"><button type="button" data-action-type="action" class="primary">行動として保存</button><button type="button" data-action-type="dialogue" class="secondary">発言として保存</button></div>',
  });
  
  const contentLabel = createElement("label", {
    className: "text-label",
    html: '<span>本文</span><textarea name="content" rows="6" required></textarea>',
  });

  const submitRow = createElement("div", { className: "modal-actions" });
  const cancelButton = createElement("button", { className: "secondary", text: "キャンセル", attrs: { type: "button" } });
  const submitButton = createElement("button", { className: "accent", text: "保存", attrs: { type: "submit" } });
  submitRow.append(cancelButton, submitButton);

  form.append(typeLabel, characterLabel, actionTypeLabel, contentLabel, submitRow);

  const typeSelect = form.querySelector('select[name="type"]');
  const nameSelect = form.querySelector('select[name="name"]');
  const contentInput = form.querySelector('textarea[name="content"]');
  const dialogueBtn = form.querySelector('[data-action-type="dialogue"]');
  const actionBtn = form.querySelector('[data-action-type="action"]');

  // 初期値の適切な設定
  if (initial.type === "dialogue" || initial.type === "action") {
    typeSelect.value = "character";
  } else {
    typeSelect.value = initial.type ?? "character";
  }
  nameSelect.value = initial.name ?? "";
  contentInput.value = initial.content ?? "";

  let selectedActionType = initial.type === "action" ? "action" : "dialogue";

  const updateCharacterVisibility = () => {
    const requiresCharacter = typeSelect.value === "character";
    if (requiresCharacter) {
      characterLabel.style.display = "flex";
      actionTypeLabel.style.display = "block";
      submitButton.style.display = "none";
    } else {
      characterLabel.style.display = "none";
      actionTypeLabel.style.display = "none";
      submitButton.style.display = "";
      nameSelect.value = "";
    }
    
    // モーダル内の種別選択にも色を適用
    const type = typeSelect.value;
    typeSelect.className = typeSelect.className.replace(/type-\w+/g, '');
    typeSelect.classList.add(`type-${type}`);
  };
  updateCharacterVisibility();
  typeSelect.addEventListener("change", updateCharacterVisibility);

  // アクション種別ボタンのハンドリング
  dialogueBtn.addEventListener("click", () => {
    selectedActionType = "dialogue";
    handleModalFormSubmit();
  });
  actionBtn.addEventListener("click", () => {
    selectedActionType = "action";
    handleModalFormSubmit();
  });

  function handleModalFormSubmit() {
    const rawType = typeSelect.value === "character" ? selectedActionType : typeSelect.value;
    const type = rawType === "dice_direction" ? "direction" : rawType;
    const name = nameSelect.value;
    const content = contentInput.value.trim();
    
    if (!content) {
      addNotification({ variant: "error", message: "本文を入力してください" });
      return;
    }
    if (rawType === selectedActionType && typeSelect.value === "character" && !name) {
      addNotification({ variant: "error", message: "キャラクターを選択してください" });
      return;
    }
    
    // フォームが有効な場合、submitイベントを発火
    const event = new CustomEvent("modalFormSubmit", {
      detail: { type, name: name || null, content }
    });
    form.dispatchEvent(event);
  }

  return { form, typeSelect, nameSelect, contentInput, cancelButton };
}

/**
 * エントリに対するアクションを実行する
 * @param {string} action - 実行するアクション
 * @param {string} entryId - 対象エントリID
 */
export function performEntryAction(action, entryId) {
  const { storyEntries } = getState();
  const entry = storyEntries.find((item) => item.id === entryId);
  if (!entry) return;

  if (action === "delete") {
    showModal({
      title: "エントリを削除",
      content: `<p>選択したエントリを削除しますか？</p><p>${escapeXml(entry.content).slice(0, 120)}</p>`,
      actions: [
        { label: "キャンセル", className: "secondary", onClick: ({ close }) => close() },
        {
          label: "削除",
          className: "danger",
          onClick: ({ close }) => {
            removeEntry(entryId);
            close();
          },
        },
      ],
    });
    return;
  }

  if (action === "deleteAllAfter") {
    const entryIndex = storyEntries.findIndex((item) => item.id === entryId);
    if (entryIndex === -1) return;
    
    const entriesToDelete = storyEntries.slice(entryIndex + 1);
    if (entriesToDelete.length === 0) {
      addNotification({ variant: "info", message: "これより後のエントリがありません" });
      return;
    }

    showModal({
      title: "これより後のエントリをすべて削除",
      content: `<p>選択したエントリより後にある <strong>${entriesToDelete.length}個</strong> のエントリをすべて削除しますか？</p><p>この操作は元に戻すことができません。</p>`,
      actions: [
        { label: "キャンセル", className: "secondary", onClick: ({ close }) => close() },
        {
          label: `${entriesToDelete.length}個のエントリを削除`,
          className: "danger",
          onClick: ({ close }) => {
            deleteAllEntriesAfter(entryId);
            close();
          },
        },
      ],
    });
    return;
  }

  if (action === "branchFromHere") {
    const entryIndex = storyEntries.findIndex((item) => item.id === entryId);
    if (entryIndex === -1) return;
    
    const entriesToCopy = storyEntries.slice(0, entryIndex + 1);
    
    showBranchCreationModal(entriesToCopy, entry);
    return;
  }

  if (action === "animateFromHere") {
    // 現在のエントリ以降を表示上クリアし、アニメーション開始（ユーザー明示起動なので強制）
    startAnimationFromEntry(entryId, { force: true }).catch(console.error);
    return;
  }

  const { form, typeSelect, nameSelect, contentInput, cancelButton } = buildEntryForm(entry);
  const close = showModal({ title: action === "edit" ? "エントリを編集" : "エントリを挿入", content: form });

  cancelButton.addEventListener("click", close);
  
  // 新しいカスタムイベントハンドラ
  form.addEventListener("modalFormSubmit", (event) => {
    const { type, name, content } = event.detail;
    const payload = {
      type,
      name: name || null,
      content,
    };
    if (action === "edit") {
      updateEntry(entryId, payload);
    } else {
      const position = { entryId, type: action === "insertBefore" ? "before" : "after" };
      appendEntry(payload, position);
    }
    close();
  });
  
  // 従来のsubmitイベント（地の文・指示用）
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const rawType = typeSelect.value;
    const type = rawType === "dice_direction" ? "direction" : rawType;
    const name = nameSelect.value;
    const content = contentInput.value.trim();
    if (!content) {
      addNotification({ variant: "error", message: "本文を入力してください" });
      return;
    }
    const payload = {
      type,
      name: name || null,
      content,
    };
    if (action === "edit") {
      updateEntry(entryId, payload);
    } else {
      const position = { entryId, type: action === "insertBefore" ? "before" : "after" };
      appendEntry(payload, position);
    }
    close();
  });
}

/**
 * フォームからエントリオブジェクトを構築する
 * @returns {Object} 構築されたエントリ
 */
export function buildEntryFromForm() {
  const typeSelect = entryTypeSelect();
  const characterSelect = entryCharacterSelect();
  const contentTextarea = entryContent();
  
  if (!typeSelect || !contentTextarea) {
    throw new Error("フォーム要素が見つかりません");
  }
  
  const rawType = typeSelect.value;
  const type = rawType === "dice_direction" ? "direction" : rawType;
  const name = characterSelect?.value || null;
  const content = contentTextarea.value.trim();
  
  if (!content) {
    throw new Error("本文を入力してください");
  }
  
  // キャラクター種別の場合は、具体的なタイプ（dialogue/action）が必要
  if (type === "character") {
    throw new Error("発言追加または行動追加ボタンを使用してください");
  } else if (["dialogue", "action"].includes(type) && !name) {
    throw new Error("キャラクターを選択してください");
  }
  
  return {
    id: generateUUID(),
    type,
    name: (type === "character" || ["dialogue", "action"].includes(type)) ? name : null,
    content,
    createdAt: new Date().toISOString(),
  };
}

/**
 * エントリフォームをクリアする
 */
export function clearEntryForm() {
  const contentTextarea = entryContent();
  
  if (contentTextarea) contentTextarea.value = "";
  // 旧動作に合わせてトグル状態は変更しない
}

/**
 * すべてのエントリメニューを非表示にする
 */
export function hideAllEntryMenus() {
  qsa(".story-entry").forEach((entry) => entry.classList.remove("show-actions"));
  // ポータル表示中のメニューがあれば閉じる
  try { closeEntryMenuPortal(); } catch (_) {}
}

/**
 * タイムラインクリックイベントを処理する
 * @param {Event} event - クリックイベント
 */
export function handleTimelineClick(event) {
  // JSON折りたたみのsummaryクリック時はメニューをトグルしない
  if (event.target.closest('.entry-json-details summary')) {
    return;
  }
  const actionButton = event.target.closest("button[data-action]");
  const entryEl = event.target.closest(".story-entry");
  if (!entryEl) return;
  const entryId = entryEl.dataset.id;

  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action && entryId) {
      performEntryAction(action, entryId);
    }
    return;
  }

  // モバイル（768px以下）の場合は中央オーバーレイのメニューを表示
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    hideAllEntryMenus();
    openEntryActionsOverlay(entryEl);
    return;
  }

  // デスクトップはエントリ内ではなく、body直下へポータル化して表示
  const isActive = entryEl.classList.contains("show-actions");
  hideAllEntryMenus();
  if (!isActive) {
    openEntryMenuPortal(entryEl);
  }
}

/**
 * モバイル向け: エントリ操作メニューをモーダルオーバーレイで中央表示
 * @param {HTMLElement} entryEl
 */
function openEntryActionsOverlay(entryEl) {
  const entryId = entryEl?.dataset?.id;
  if (!entryId) return;

  // モーダル用のコンテンツを生成
  const container = document.createElement('div');
  container.className = 'entry-actions-overlay-content';
  container.innerHTML = `
    <div class="conflict-modal-content">
      <p class="conflict-message" style="margin-top:0">このエントリに対して実行する操作を選んでください。</p>
      <div class="changes-list">
      </div>
    </div>
  `;

  const listHost = container.querySelector('.changes-list');
  entryActions.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entry-actions-overlay-button info';
    btn.textContent = label;
    btn.dataset.action = key;
    listHost.appendChild(btn);
  });

  // モーダルを開く
  const close = showModal({ title: 'エントリの操作', content: container });

  // スクロール抑止（開いている間のみ）
  document.body.classList.add('modal-open');

  // ESCで閉じる
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      cleanup();
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const cleanup = () => {
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKeyDown);
  };

  // 背景クリック等で閉じられた場合のクリーンアップ
  const observer = new MutationObserver(() => {
    // モーダルルートが空になったら終了処理
    const root = document.querySelector('#modal-root');
    if (root && root.children.length === 0) {
      cleanup();
      observer.disconnect();
    }
  });
  const root = document.querySelector('#modal-root');
  if (root) observer.observe(root, { childList: true });

  // ボタンクリックでアクション実行
  listHost.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;
    cleanup();
    close();
    performEntryAction(action, entryId);
  });
}

// ===========================
// デスクトップ向け: メニューポータル
// ===========================
let currentMenuPortal = null;

function buildPortalMenu(entryId) {
  const menu = document.createElement('div');
  menu.className = 'entry-actions-menu is-portal';
  menu.style.display = 'flex';
  menu.style.flexDirection = 'column';
  menu.style.gap = '8px';
  menu.setAttribute('role', 'menu');

  entryActions.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.action = key;
    btn.setAttribute('role', 'menuitem');
    menu.appendChild(btn);
  });

  // クリックでアクション実行
  const onClick = (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;
    closeEntryMenuPortal();
    performEntryAction(action, entryId);
  };
  menu.addEventListener('click', onClick);

  return { menu, destroy: () => menu.removeEventListener('click', onClick) };
}

function positionMenuFixed(menuEl, entryEl) {
  // エントリの矩形を取得
  const rect = entryEl.getBoundingClientRect();
  // 一旦表示してサイズを測る
  menuEl.style.visibility = 'hidden';
  menuEl.style.position = 'fixed';
  menuEl.style.top = '0px';
  menuEl.style.left = '0px';
  document.body.appendChild(menuEl);
  const menuRect = menuEl.getBoundingClientRect();

  const margin = 12; // エントリ右上からのオフセット
  let top = rect.top + margin;
  let left = rect.right - menuRect.width - margin;

  // 画面外にはみ出さないようにクランプ
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (left + menuRect.width > vw - 8) left = Math.max(8, vw - menuRect.width - 8);
  if (top + menuRect.height > vh - 8) top = Math.max(8, vh - menuRect.height - 8);

  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
  menuEl.style.visibility = 'visible';
}

function openEntryMenuPortal(entryEl) {
  const entryId = entryEl?.dataset?.id;
  if (!entryId) return;

  // 既存を閉じる
  closeEntryMenuPortal();

  const { menu, destroy } = buildPortalMenu(entryId);
  positionMenuFixed(menu, entryEl);

  // 外側クリックで閉じる
  const onDocClick = (e) => {
    if (menu.contains(e.target)) return;
    closeEntryMenuPortal();
  };
  // スクロールやリサイズで閉じる（位置追従はせず簡易化）
  const onScroll = () => closeEntryMenuPortal();
  const onResize = () => closeEntryMenuPortal();
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize, true);

  currentMenuPortal = {
    menu,
    cleanup: () => {
      try { destroy(); } catch (_) {}
      document.removeEventListener('click', onDocClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize, true);
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      currentMenuPortal = null;
    }
  };
}

function closeEntryMenuPortal() {
  if (!currentMenuPortal) return;
  currentMenuPortal.cleanup();
}