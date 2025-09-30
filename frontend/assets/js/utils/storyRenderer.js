// utils/storyRenderer.js
// ストーリータイムラインの表示とレンダリング機能
// このモジュールはストーリーエントリの表示、スクロール、
// キャラクター表示の更新などを担当します。

import { qs, clearChildren, createElement } from "./dom.js";
import { getState } from "../state/appState.js";
import { renderStoryEntry } from "../components/storyEntry.js";
import { 
  storyTimeline, 
  storySelector,
  entryCharacterSelect,
  entryCharacterFace,
  characterActionButtons,
  addDialogueButton,
  addActionButton,
  entryTypeSelect,
  addEntryButton
} from "./domSelectors.js";

/**
 * キャラクターを名前をキーとしたMapに変換
 * @returns {Map} キャラクターマップ
 */
function getCharacterMap() {
  const map = new Map();
  getState().characters.forEach((character) => {
    if (character.name) map.set(character.name, character);
  });
  return map;
}

/**
 * ストーリータイムラインをレンダリング
 */
export function renderStory() {
  const root = storyTimeline();
  if (!root) return;
  const { storyEntries } = getState();
  const characterMap = getCharacterMap();
  clearChildren(root);
  storyEntries.forEach((entry) => {
    const entryEl = renderStoryEntry(entry, characterMap);
    root.append(entryEl);
  });
  
  // ストーリータイムラインを最下部にスクロール
  scrollToBottom();
}

/**
 * ストーリータイムラインを最下部までスクロール
 * @param {boolean} smooth - 滑らかなスクロールを行うかどうか
 */
export function scrollToBottom(smooth = false) {
  const root = storyTimeline();
  if (!root) return;

  // requestAnimationFrameを使用してDOMの更新後にスクロール
  requestAnimationFrame(() => {
    if (smooth) {
      root.scrollTo({
        top: root.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      root.scrollTop = root.scrollHeight;
    }
  });
}

/**
 * ストーリーセレクターをレンダリング
 */
export function renderStorySelector() {
  const selector = storySelector();
  if (!selector) return;
  const { storyIndex, currentStoryId } = getState();
  clearChildren(selector);
  storyIndex.forEach((story) => {
    const option = createElement("option", {
      text: story.title,
      attrs: { value: story.id },
    });
    if (story.id === currentStoryId) option.selected = true;
    selector.append(option);
  });
}

/**
 * キャラクターピッカーを更新
 */
export function updateCharacterPicker() {
  const select = entryCharacterSelect();
  const face = entryCharacterFace();
  const actionButtons = characterActionButtons();
  const normalButtons = qs("#normal-entry-buttons");
  const type = entryTypeSelect()?.value;
  const requiresCharacter = type === "character";
  const previous = select?.value;
  
  if (!select) return;
  
  clearChildren(select);

  if (requiresCharacter) {
    select.parentElement.classList.add("show");
    // CSSにレイアウトを委ねる（デスクトップ=flex、モバイル=grid）
    if (actionButtons) actionButtons.style.display = "";
    if (normalButtons) normalButtons.style.display = "none";
    select.append(
      createElement("option", {
        text: "キャラクターを選択",
        attrs: { value: "" },
      })
    );
  } else {
    select.parentElement.classList.remove("show");
    if (actionButtons) actionButtons.style.display = "none";
    if (normalButtons) normalButtons.style.display = "flex";
    if (face) face.innerHTML = "";
  }

  const characters = getState().characters.filter((c) => c && c.enabled !== false);
  characters.forEach((character) => {
    select.append(
      createElement("option", {
        text: character.name,
        attrs: { value: character.name },
      })
    );
  });

  if (requiresCharacter) {
    const exists = characters.some((c) => c.name === previous);
    select.value = exists ? previous : "";
    updateCharacterActionButtons();
  } else {
    select.value = "";
  }
  updateCharacterFace();
  updateEntryTypeStyles();
}

/**
 * キャラクターの顔画像を更新
 */
export function updateCharacterFace() {
  const select = entryCharacterSelect();
  const face = entryCharacterFace();
  const mobileFace = document.querySelector('#mobile-character-face');
  if (!face) return;
  const name = select?.value;
  if (!name) {
    face.innerHTML = "";
    if (mobileFace) mobileFace.innerHTML = "";
    return;
  }
  const character = getState().characters.find((c) => c.name === name);
  if (character?.icon) {
    face.innerHTML = `<img src="${character.icon}" alt="${name}" />`;
    if (mobileFace) mobileFace.innerHTML = `<img src="${character.icon}" alt="${name}" />`;
  } else {
    face.innerHTML = `<span>${name.at(0) ?? "?"}</span>`;
    if (mobileFace) mobileFace.innerHTML = `<span>${name.at(0) ?? "?"}</span>`;
  }
}

/**
 * キャラクターアクションボタンを更新
 */
export function updateCharacterActionButtons() {
  const actionButtons = characterActionButtons();
  const dialogueBtn = addDialogueButton();
  const actionBtn = addActionButton();
  const character = entryCharacterSelect()?.value;
  
  if (actionButtons && dialogueBtn && actionBtn) {
    const isDisabled = !character;
    dialogueBtn.disabled = isDisabled;
    actionBtn.disabled = isDisabled;
  }
}

/**
 * エントリタイプのスタイルを更新
 */
export function updateEntryTypeStyles() {
  const typeSelect = entryTypeSelect();
  const addButton = addEntryButton();
  const type = typeSelect?.value;
  
  if (!typeSelect || !type) return;
  
  // ドロップダウンのスタイル更新
  typeSelect.className = typeSelect.className.replace(/type-\w+/g, '');
  typeSelect.classList.add(`type-${type}`);
  
  // エントリ追加ボタンのスタイル更新（キャラクター以外の場合のみ）
  if (addButton && type !== "character") {
    addButton.className = addButton.className.replace(/type-\w+/g, '');
    addButton.classList.add(`type-${type}`);
  }
}