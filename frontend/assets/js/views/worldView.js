// 世界観編集ビュー
// 世界観の長文テキストを編集・保存するための UI を提供する
import { qs } from "../utils/dom.js";
import { debounce } from "../utils/debounce.js";
import { eventBus } from "../utils/eventBus.js";
import { getState, setSaveStatus, updateState } from "../state/appState.js";
import { saveWorldView } from "../state/dataStore.js";
import { addNotification } from "../state/appState.js";
import { worldViewHistoryButton } from "../utils/domSelectors.js";
import { getHistory, deleteHistory } from "../utils/history.js";
import { showHistoryModal } from "../components/historyModal.js";

const textarea = () => qs("#worldview-textarea");
const indicator = () => qs('[data-indicator="worldView"]');

const debouncedSave = debounce(async (value) => {
  try {
    await saveWorldView(value);
    setSaveStatus("worldView", "saved");
    updateIndicator();
  } catch (error) {
    console.error("World view save failed", error);
    setSaveStatus("worldView", "error");
    updateIndicator();
    addNotification({ variant: "error", message: "世界観の保存に失敗しました" });
  }
}, 600);

/**
 * 保存ステータスインジケーターを更新
 */
function updateIndicator() {
  const status = getState().saveStatus.worldView;
  const el = indicator();
  if (!el) return;
  el.dataset.status = status;
  if (status === "saving") {
    el.textContent = "保存中…";
  } else if (status === "saved") {
    el.textContent = "保存済み";
    setTimeout(() => {
      if (getState().saveStatus.worldView === "saved") {
        setSaveStatus("worldView", "idle");
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
 * テキストエリアの入力イベントハンドラ
 * @param {Event} event 入力イベント
 */
function handleInput(event) {
  const value = event.target.value;
  updateState("worldView", () => value);
  setSaveStatus("worldView", "saving");
  updateIndicator();
  debouncedSave(value);
}

export function mountWorldView() {
  const input = textarea();
  if (!input) return;
  input.value = getState().worldView;
  input.addEventListener("input", handleInput);
  updateIndicator();

  // 履歴ボタン
  const histBtn = worldViewHistoryButton();
  if (histBtn) {
    histBtn.addEventListener("click", async () => {
      const items = await getHistory("worldview");
      showHistoryModal({
        type: "worldview",
        items,
        onSelect: (text) => {
          input.value = text;
          updateState("worldView", () => text);
          setSaveStatus("worldView", "saving");
          saveWorldView(text).catch(console.error);
        },
        onDelete: async (text) => {
          await deleteHistory("worldview", text);
        }
      });
    });
  }

  eventBus.on("state:change:worldView", (value) => {
    if (document.activeElement === input) return;
    input.value = value;
  });
}
