// components/storyEntry.js
// 物語の単一エントリを DOM 要素としてレンダリングするモジュール
import { createElement } from "../utils/dom.js";
import { entryActions } from "../constants/entryActions.js";
import { getState } from "../state/appState.js";
import { formatDateTime } from "../utils/string.js";

function buildAvatar(entry, characterMap) {
  // 左側の大きなアバター（正方形・固定サイズ）を返す
  // アバターが無い場合も枠だけを表示してレイアウトを揃える
  const name = entry.name;
  const character = name ? characterMap.get(name) : undefined;
  const html = character?.icon
    ? `<img src="${character.icon}" alt="${name}" />`
    : ""; // 代替テキストや文字は出さず、枠線のみ
  return createElement("div", { className: "entry-avatar", html });
}

function buildCharacterLabel(entry) {
  // メタ行に表示するキャラクター名（小さめのピル表示、アイコンは含めない）
  if (!entry.name) return null;
  const html = `<span>${entry.name}</span>` + (entry.meta?.subType ? `<span>・${entry.meta.subType}</span>` : "");
  return createElement("div", { className: "entry-character", html });
}

export function renderStoryEntry(entry, characterMap) {
  const entryEl = createElement("article", {
    className: "story-entry",
    dataset: { id: entry.id, kind: entry.type },
  });

  // 右カラムのボディ（メタ行＋本文）
  const bodyEl = createElement("div", { className: "entry-body" });
  const metaRow = createElement("div", { className: "entry-meta" });
  const typeLabel = createElement("span", {
    className: "entry-type-label",
    text: labelForType(entry.type),
  });
  // 未知タイプの場合は黒背景スタイルを付与
  if (!isKnownType(entry.type)) {
    typeLabel.classList.add("entry-type-label--unknown");
  }
  metaRow.append(typeLabel);

  if (entry.name) {
    const label = buildCharacterLabel(entry);
    if (label) metaRow.append(label);
  }

  const timestamp = entry.updatedAt ?? entry.createdAt;
  if (timestamp) {
    metaRow.append(
      createElement("span", {
        className: "entry-timestamp",
        text: formatDateTime(timestamp),
      })
    );
  }

  // action タイプは括弧でくくって表示する（既に括弧付きならそのまま）
  let displayContent = entry.content;
  if (entry.type === "action" && displayContent) {
    const trimmed = displayContent.trim();
    if (!(trimmed.startsWith("（") && trimmed.endsWith("）")) && 
        !(trimmed.startsWith("(") && trimmed.endsWith(")"))) {
      displayContent = `（${displayContent}）`;
    }
  }

  const content = createElement("div", { className: "entry-content" });

  // reject タイプの場合、警告メッセージを追加して編集者に注意を促す
  if (entry.type === "reject") {
    const warningMsg = createElement("div", {
      className: "reject-warning",
      text: "⚠️この通知は物語タイムラインに含まれません。次の生成前にこの情報は消去されます。",
    });
    content.append(warningMsg);
  }

  if (entry.type === "json") {
    // JSONは整形表示＋デフォルト折りたたみ
    let pretty = displayContent;
    let isValid = false;
    try {
      const v = JSON.parse(displayContent);
      pretty = JSON.stringify(v, null, 2);
      isValid = true;
    } catch (_) {
      // パース不可時はそのまま表示
    }
    const details = createElement("details", { className: "entry-json-details" });
    // プレビュー行（閉じている時だけ見せる）
    const previewText = isValid
      ? (() => {
          try { return JSON.stringify(JSON.parse(displayContent)); } catch { return displayContent.replace(/\s+/g, " ").trim(); }
        })()
      : displayContent.replace(/\s+/g, " ").trim();
    const previewLine = createElement("div", { className: "entry-json-preview", text: previewText });

    // トグル用の小さなテキストボタン
    const summary = createElement("summary", { text: "▶詳細を表示" });
    const pre = createElement("pre", { className: "entry-json", text: pretty });
    details.append(summary, pre);
    content.append(previewLine, details);

    // 開閉でテキストとプレビュー表示を切り替え（排他的）
    details.addEventListener("toggle", () => {
      const isOpen = details.open;
      summary.textContent = isOpen ? "▼詳細を隠す" : "▶詳細を表示";
      if (previewLine) previewLine.style.display = isOpen ? "none" : "";
    });
  } else {
    const contentText = createElement("div", { text: displayContent });
    content.append(contentText);
  }

  bodyEl.append(metaRow, content);

  // 設定に応じてアバター表示を切り替え
  const hideAvatars = Boolean(getState().settings?.hideAvatars);
  if (hideAvatars) {
    entryEl.classList.add("no-avatar");
    entryEl.append(bodyEl);
  } else {
    const avatarEl = buildAvatar(entry, characterMap);
    entryEl.append(avatarEl, bodyEl);
  }

  const menu = createElement("div", { className: "entry-actions-menu" });
  entryActions.forEach((action) => {
    // 各操作は dataset.action 属性で識別され、イベントハンドラ側で処理される想定
    const button = createElement("button", { text: action.label, dataset: { action: action.key } });
    menu.append(button);
  });

  entryEl.append(menu);
  return entryEl;
}

function labelForType(type) {
  switch (type) {
    case "dialogue":
      return "発言";
    case "action":
      return "行動";
    case "narration":
      return "地の文";
    case "dice_direction":
      return "指示(ダイスロール)";
    case "direction":
      return "指示";
    case "reject":
      return "失敗";
    case "json":
      return "JSON";
    default:
      return `不明(${type})`;
  }
}

// 既知タイプ判定のヘルパー
function isKnownType(type) {
  switch (type) {
    case "dialogue":
    case "action":
    case "narration":
    case "dice_direction":
    case "direction":
    case "reject":
    case "json":
      return true;
    default:
      return false;
  }
}
