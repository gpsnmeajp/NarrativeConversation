// utils/diceHandlers.js
// ダイスロール機能の処理
// このモジュールはダイスロールの実行、結果表示、
// エントリタイプに応じた表示制御を担当します。

import { rollDice, formatDiceRoll } from "./diceRoll.js";
import { addNotification } from "../state/appState.js";
import {
  entryTypeSelect,
  diceRollSection,
  diceNotationInput,
  diceResultDiv,
  entryContent
} from "./domSelectors.js";

/**
 * ダイスロールセクションの表示/非表示を更新
 */
export function updateDiceRollVisibility() {
  const typeSelect = entryTypeSelect();
  const diceSection = diceRollSection();
  
  if (!typeSelect || !diceSection) return;
  
  const type = typeSelect.value;
  if (type === "dice_direction") {
    diceSection.style.display = "block";
  } else {
    diceSection.style.display = "none";
    // セクションを隠すときは結果もクリア
    const diceResult = diceResultDiv();
    if (diceResult) {
      diceResult.style.display = "none";
      diceResult.textContent = "";
    }
  }
}

/**
 * ダイスロールを実行し、結果を表示する
 */
export function handleDiceRoll() {
  const diceInput = diceNotationInput();
  const diceResult = diceResultDiv();
  const contentTextarea = entryContent();
  
  if (!diceInput || !diceResult) return;
  
  const diceNotation = diceInput.value.trim();
  if (!diceNotation) {
    addNotification({ variant: "error", message: "ダイス記法を入力してください" });
    return;
  }
  
  const rollResult = rollDice(diceNotation);
  const formattedResult = formatDiceRoll(rollResult);
  
  if (rollResult.error) {
    addNotification({ variant: "error", message: rollResult.error });
    diceResult.style.display = "none";
    return;
  }
  
  // 結果を表示
  diceResult.textContent = `🎲 ${formattedResult}`;
  diceResult.style.display = "block";
  diceResult.className = "dice-result success";
  const diceText = `【ダイスロール】${formattedResult} が出ました。\n行動: `;
  
  // 本文欄に結果を追加
  if (contentTextarea) {
    const currentContent = contentTextarea.value;
    const newContent = currentContent ? `${currentContent}\n\n${diceText}` : diceText;
    contentTextarea.value = newContent;
    
    // フォーカスを本文欄に移動し、カーソルを末尾に
    contentTextarea.focus();
    contentTextarea.setSelectionRange(contentTextarea.value.length, contentTextarea.value.length);
  }
}