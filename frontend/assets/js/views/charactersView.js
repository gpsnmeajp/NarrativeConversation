// キャラクター管理ビュー
// キャラクターの一覧表示、作成、編集、削除を行うための UI ロジック
import { qs, qsa, createElement, clearChildren } from "../utils/dom.js";
import { debounce } from "../utils/debounce.js";
import { generateUUID } from "../utils/uuid.js";
import { eventBus } from "../utils/eventBus.js";
import { addNotification, getState, updateState } from "../state/appState.js";
import { saveCharacters } from "../state/dataStore.js";
import { showModal } from "../components/modal.js";

let selectedId = null;
let unsubscribers = [];

const debouncedSave = debounce(async () => {
  const characters = getState().characters;
  try {
    await saveCharacters(characters);
  } catch (error) {
    console.error("Failed to save characters", error);
    addNotification({ variant: "error", message: "キャラクターの保存に失敗しました" });
  }
}, 600);

/**
 * キャラクターリストのDOM要素を取得
 * @returns {HTMLElement} キャラクターリスト要素
 */
function characterListRoot() {
  return qs("#character-list");
}

/**
 * キャラクターフォームのDOM要素を取得
 * @returns {HTMLElement} キャラクターフォーム要素
 */
function formRoot() {
  return qs("#character-form");
}

/**
 * 空状態表示要素を取得
 * @returns {HTMLElement} 空状態表示要素
 */
function emptyState() {
  return qs(".character-empty");
}

/**
 * キャラクターのアバターを生成
 * @param {Object} character キャラクターオブジェクト
 * @returns {string} アバターのHTML
 */
function avatarFor(character) {
  if (character?.icon) {
    return `<img src="${character.icon}" alt="${character.name}" />`;
  }
  const initial = character?.name?.trim()?.at(0) ?? "?";
  return `<span>${initial}</span>`;
}

/**
 * キャラクターリストをレンダリング
 */
function renderCharacterList() {
  const characters = getState().characters;
  const list = characterListRoot();
  if (!list) return;
  clearChildren(list);
  characters.forEach((character) => {
    const item = createElement("li", {
      className: `character-item${character.enabled === false ? " is-disabled" : ""}`,
      dataset: { id: character.id },
      children: [
        createElement("div", { className: "character-avatar", html: avatarFor(character) }),
        createElement("div", {
          className: "character-meta",
          html: `<strong>${character.name || "(無名)"}</strong>${
            character.enabled === false ? ' <span class="badge-disabled" aria-label="無効">無効</span>' : ""
          }<br /><span>${character.description ? character.description.slice(0, 36) : ""}</span>`,
        }),
      ],
    });
    item.addEventListener("click", () => selectCharacter(character.id));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCharacter(character.id);
      }
    });
    item.setAttribute("tabindex", "0");
    if (character.id === selectedId) {
      item.classList.add("active");
    }
    list.append(item);
  });
}

/**
 * キャラクターを選択
 * @param {string} id キャラクターID
 */
function selectCharacter(id) {
  selectedId = id;
  renderCharacterList();
  renderCharacterForm();
}

function renderCharacterForm() {
  const form = formRoot();
  const empty = emptyState();
  if (!form || !empty) return;
  const detail = form.closest('.character-detail');
  const characters = getState().characters;
  const character = characters.find((c) => c.id === selectedId);
  if (!character) {
    form.hidden = true;
    form.style.display = "none"; // 確実に非表示にする
    empty.dataset.state = "empty";
    empty.style.display = ""; // CSSのデフォルト値に戻す
    if (detail) detail.classList.add("empty-state");
    return;
  }
  empty.dataset.state = "hidden";
  form.hidden = false;
  form.style.display = ""; // CSSのデフォルト値に戻す
  if (detail) detail.classList.remove("empty-state");
  qs("#character-name").value = character.name ?? "";
  qs("#character-description").value = character.description ?? "";
  const enabledCheckbox = qs("#character-enabled");
  const stopOnGenerateCheckbox = qs("#character-stop-on-generate");
  if (enabledCheckbox) {
    enabledCheckbox.checked = character.enabled !== false; // デフォルトtrue
  }
  if (stopOnGenerateCheckbox) {
    stopOnGenerateCheckbox.checked = Boolean(character.stopOnGenerate);
  }
  const preview = qs("#character-icon-preview");
  if (character.icon) {
    preview.src = character.icon;
    preview.hidden = false;
  } else {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
}

async function handleIconUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    addNotification({ variant: "error", message: "画像ファイルを選択してください" });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    updateCharacter(selectedId, { icon: reader.result });
  };
  reader.readAsDataURL(file);
}

function updateCharacter(id, patch) {
  updateState("characters", (characters) =>
    characters.map((character) =>
      character.id === id ? { ...character, ...patch, updatedAt: new Date().toISOString() } : character
    )
  );
  renderCharacterList();
  renderCharacterForm();
  debouncedSave();
}

function removeCharacter() {
  if (!selectedId) return;
  updateState("characters", (characters) => characters.filter((c) => c.id !== selectedId));
  selectedId = null;
  renderCharacterList();
  renderCharacterForm();
  debouncedSave();
}

function createCharacter() {
  const id = generateUUID();
  const character = {
    id,
    name: "新しいキャラクター",
    description: "",
    icon: "",
    enabled: true,
    stopOnGenerate: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  updateState("characters", (characters) => [...characters, character]);
  selectedId = id;
  renderCharacterList();
  renderCharacterForm();
  debouncedSave();
}

function clearIcon() {
  if (!selectedId) return;
  updateCharacter(selectedId, { icon: "" });
  qs("#character-icon").value = "";
}

function bindFormEvents() {
  const nameInput = qs("#character-name");
  const descriptionInput = qs("#character-description");
  const enabledInput = qs("#character-enabled");
  const stopOnGenerateInput = qs("#character-stop-on-generate");
  const iconInput = qs("#character-icon");
  const deleteButton = qs("#delete-character-button");
  const clearButton = qs("#clear-icon-button");

  nameInput.addEventListener("input", (event) => {
    if (!selectedId) return;
    updateCharacter(selectedId, { name: event.target.value });
  });
  descriptionInput.addEventListener("input", (event) => {
    if (!selectedId) return;
    updateCharacter(selectedId, { description: event.target.value });
  });
  if (enabledInput) {
    enabledInput.addEventListener("change", (event) => {
      if (!selectedId) return;
      updateCharacter(selectedId, { enabled: !!event.target.checked });
    });
  }
  if (stopOnGenerateInput) {
    stopOnGenerateInput.addEventListener("change", (event) => {
      if (!selectedId) return;
      updateCharacter(selectedId, { stopOnGenerate: !!event.target.checked });
    });
  }
  iconInput.addEventListener("change", handleIconUpload);
  deleteButton.addEventListener("click", () => {
    if (!selectedId) return;
    const character = getState().characters.find((c) => c.id === selectedId);
    showModal({
      title: "キャラクターを削除",
      content: `<p>「${character?.name ?? "無名"}」を削除しますか？この操作は元に戻せません。</p>`,
      actions: [
        {
          label: "キャンセル",
          className: "secondary",
          onClick: ({ close }) => close(),
        },
        {
          label: "削除",
          className: "danger",
          onClick: ({ close }) => {
            removeCharacter();
            close();
          },
        },
      ],
    });
  });
  clearButton.addEventListener("click", clearIcon);
}

export function mountCharactersView() {
  // 初期化時に選択状態をリセット
  selectedId = null;
  const createButton = qs("#create-character-button");
  if (createButton) createButton.addEventListener("click", createCharacter);
  bindFormEvents();
  renderCharacterList();
  renderCharacterForm();

  unsubscribers.push(
    eventBus.on("state:change:characters", () => {
      if (selectedId && !getState().characters.some((c) => c.id === selectedId)) {
        selectedId = null;
      }
      renderCharacterList();
      renderCharacterForm();
    })
  );
}

export function unmountCharactersView() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  selectedId = null;
}
