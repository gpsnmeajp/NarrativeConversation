// utils/aiGeneration.js
// AI生成機能とXML解析処理
// このモジュールはAIによる物語生成、XMLの解析、
// エラーハンドリング、競合チェックなどを担当します。

import { generateUUID } from "./uuid.js";
import { getState, updateState, addNotification, updateFooter } from "../state/appState.js";
import { saveStory } from "../state/dataStore.js";
import { chatCompletions, chatCompletionsLast } from "../services/apiClient.js";
import { showConfirmDialog } from "../components/modal.js";
import { showConflictConfirmModal } from "../components/conflictModal.js";
import { detectAllDataChanges } from "./storyConflict.js";
import { getSystemPrompt } from "./storyPrompts.js";
import { upsertHistoryBulk } from "./history.js";
import { appendEntry } from "./entryHandlers.js";
import { buildUserFriendlyError, formatErrorForTimeline } from "./errorHints.js";
import jsonActions from "./jsonActions.js";
import { renderStory, scrollToBottom } from "./storyRenderer.js";
import { startAnimationFromEntry, animateFromIndex } from "./timelineAnimation.js";
import { hasWebhookUrl, sendEntriesWebhookSequential } from "./webhook.js";
import { checkAndReloadAllData } from "../views/mainView.js";
import {
  generateButton,
  generateCharacterButton,
  addEntryButton,
  entryContent,
  generateCheckbox,
  footerTokens,
  footerLatency,
  footerCost,
  footerStatus,
  showGenerationOverlay,
  hideGenerationOverlay,
  showDataCheckOverlay,
  showGeneratingOverlay,
  updateOverlaySubtext
} from "./domSelectors.js";

let isGenerating = false;

/**
 * 生成処理の稼働状態を返す（外部参照用）
 * - true: 生成中 / false: アイドル
 */
export function isAiGenerating() {
  return isGenerating === true;
}

// LLM出力で起こりがちな部分欠損の終了タグを補完する簡易サニタイザ
// 例: `</dialogue` -> `</dialogue>`、`</d` -> `</dialogue>`（既知タグに前方一致する場合）
const KNOWN_CONTENT_TAGS = ["dialogue", "narration", "action", "json", "reject"];
function sanitizeXmlBeforeParse(raw) {
  let text = String(raw ?? "");
  // 0) 未閉じの name 属性の引用符を補う（例: name="アリス> → name="アリス">）
  //   - ダブルクォート版
  text = text.replace(/(<\w+[^>]*\bname="[^"><]*)(>)/g, "$1\"$2");
  //   - シングルクォート版
  text = text.replace(/(<\w+[^>]*\bname='[^'>]*)(>)/g, "$1'$2");
  // 1) `</name` のように '>' が欠けている終了タグを補う＋既知タグに補完
  text = text.replace(/<\/([a-zA-Z][\w-]*)(\s*>?)/g, (m, name, tail) => {
    // 既に '>' で閉じられている、または空白の後に '>' がある場合はそのまま
    if (/>/.test(tail)) return m;
    const lower = name.toLowerCase();
    const candidate = KNOWN_CONTENT_TAGS.find((t) => t.startsWith(lower)) || lower;
    return `</${candidate}>`;
  });
  // 2) まれに現れる二重 '>>' を単一 '>' に正規化
  text = text.replace(/<\/(?:[a-zA-Z][\w-]*)>>/g, (m) => m.replace(/>>/, ">"));
  return text;
}

/**
 * XML入力を構築する
 * @returns {string} XML形式の入力文字列
 */
export function buildXmlInput() {
  const { command, worldView, characters, storyEntries } = getState();
  const characterXml = characters
    .filter((c) => c && c.enabled !== false)
    .map(
      (character) => `  <character name="${(character.name ?? "").trim()}">
${(character.description ?? "").trim()}
  </character>`
    )
    .join("\n");
  const historyXml = storyEntries
    .map((entry) => {
      const tag = entry.type;
      const nameAttr = entry.name ? ` name="${entry.name}"` : "";
      return `  <${tag}${nameAttr}>${entry.content}</${tag}>`;
    })
    .join("\n");

  return `\n\n# 世界観\n<world_view>${worldView}</world_view>\n\n# キャラクター情報\n<characters>\n${characterXml}\n</characters>\n\n# 物語の履歴\n<history>\n${historyXml}\n</history>\n\n# 司令\n<command>${command}</command>\n\n# 開始\n物語の続きを作成してください。\n\n入出力はXMLライク形式で行います。プログラムによりパースしますので、指定した形式を厳密に厳守してください。\n`;
}



/**
 * 生成されたコンテンツを解析する
 * @param {string} text - 解析対象のテキスト
 * @returns {Object} 解析結果 {entries, rejects}
 */
function parseGeneratedContent(text) {
  try {
    // パース前サニタイズ（終了タグの部分欠損を補正）
    text = sanitizeXmlBeforeParse(text);
    // XMLタグのみを抽出する正規表現（開始タグから閉じタグまで、閉じタグは先頭一文字一致で修正）
    const xmlTagPattern = /<(\w+)(\s[^>]*)?>(.*?)<\/(\w*)>/gs;
    const xmlTags = [];
    let match;
    
    // すべてのXMLタグを抽出し、閉じタグを修正
    while ((match = xmlTagPattern.exec(text)) !== null) {
      const [fullMatch, openTag, attributes, content, closeTag] = match;
      
      // 閉じタグが開始タグと一致しない場合の修正処理
      if (openTag !== closeTag) {
        // 先頭一文字が一致するか、または空の場合は開始タグに合わせて修正
        if (closeTag === '' || closeTag[0] === openTag[0]) {
          const correctedTag = `<${openTag}${attributes || ''}>${content}</${openTag}>`;
          xmlTags.push(correctedTag);
          console.log(`XMLタグの閉じタグを修正: </${closeTag}> → </${openTag}>`);
        } else {
          // 先頭一文字も一致しない場合は元のまま追加
          xmlTags.push(fullMatch);
        }
      } else {
        // 開始タグと閉じタグが一致している場合はそのまま追加
        xmlTags.push(fullMatch);
      }
    }
    
    // XMLタグが見つからない場合はそのまま処理を続行
    let xmlContent = xmlTags.join('\n');
    
    // XMLタグが見つからない場合は、壊れた応答として扱いエラーにする
    if (xmlTags.length === 0) {
      const err = new Error("出力にXMLタグが検出されませんでした");
      err.name = "XMLParseError"; // リトライ対象
      // デバッグしやすいよう軽くログ
      console.warn('XMLタグが検出されませんでした:', {
        originalTextLength: text.length,
        textPreview: text
      });
      throw err;
    } else {
      console.log(`XMLタグを${xmlTags.length}個抽出しました`);
    }
    console.log(xmlContent);
        
    const wrapper = `<root>${xmlContent}</root>`;
    const parser = new DOMParser();
    const doc = parser.parseFromString(wrapper, "application/xml");
    
    if (doc.querySelector("parsererror")) {
      // 修正後もエラーがある場合、具体的なエラー情報を取得
      const errorElement = doc.querySelector("parsererror");
      const errorMessage = errorElement ? errorElement.textContent : "XMLパースエラー";
      throw new Error(`XML解析エラー: ${errorMessage}`);
    }
    
    const entries = [];
    const rejects = [];

    Array.from(doc.documentElement.children).forEach((node) => {
      const content = node.textContent?.trim() ?? "";
      if (!content) return;
      const name = node.getAttribute("name");
      const entry = {
        id: generateUUID(),
        type: node.nodeName,
        name: name || null,
        content,
        createdAt: new Date().toISOString(),
      };
      if (node.nodeName === "reject") {
        rejects.push(entry);
      } else {
        entries.push(entry);
      }
    });
    return { entries, rejects };
    
  } catch (error) {
    // 修正を試みても失敗した場合の詳細なエラー情報
    console.error("XML解析失敗:", {
      originalText: text,
      error: error.message
    });
    const e = new Error(`生成結果の解析に失敗しました: ${error.message}`);
    e.name = "XMLParseError"; // リトライ判定で利用
    throw e;
  }
}

// checkAndReloadAllData関数はmainView.jsで定義されているため、ここでは定義しない
// 代わりにインポートして使用する

/**
 * 詳細なデバッグ情報を収集する
 * @param {Error} error - エラーオブジェクト
 * @returns {Object} デバッグ情報
 */
function collectDebugInfo(error) {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    platform: navigator.platform,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    error: {
      name: error.name || 'Unknown',
      message: error.message || 'No message',
      stack: error.stack || 'No stack trace',
      cause: error.cause || null
    }
  };

  // ネットワーク関連の詳細情報
  if ('connection' in navigator) {
    debugInfo.connection = {
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt,
      saveData: navigator.connection.saveData
    };
  }

  return debugInfo;
}

/**
 * エラー情報からrejectエントリを作成する
 * @param {Error} error - エラーオブジェクト
 * @param {Object} additionalInfo - 追加のコンテキスト情報
 * @returns {Object} rejectエントリ
 */
function createErrorRejectEntry(error, additionalInfo = {}) {
  const debugInfo = collectDebugInfo(error);
  const isDebugMode = localStorage.getItem('narrative-debug-mode') === 'true';
  const content = formatErrorForTimeline(error, {
    ...additionalInfo,
    debugInfo,
  }, { debugMode: isDebugMode });
  return {
    id: generateUUID(),
    type: "reject",
    name: null,
    content,
    createdAt: new Date().toISOString(),
    isErrorReject: true,
    debugInfo,
  };
}

/**
 * 物語から既存のrejectエントリを削除する
 */
function removeExistingRejects() {
  updateState("storyEntries", (entries) => {
    return entries.filter(entry => entry.type !== "reject");
  });
  // メモ: ここでは即時保存はしていません。
  // 後続の appendEntry/saveStory が保存をトリガーするため、
  // rejectの削除のみで処理が終了しない限りは永続化されます。
}

/**
 * エントリ追加時の自動生成確認を表示
 * @returns {Promise<void>}
 */
export async function generateContinuationWithAutoConfirm() {
  if (isGenerating) return;
  const settings = getState().settings || {};
  if (settings.skipPreGenerationConfirm) {
    // 設定でスキップ指定がある場合は確認せずに実行
    await generateContinuation(false);
    return;
  }
  
  // エントリ追加時の自動生成用の確認ダイアログ
  const confirmed = await showConfirmDialog({
    title: "エントリ追加後の自動生成",
    message: "エントリが追加されました。設定に従ってAIが物語の続きを生成します。続行しますか？",
    confirmLabel: "生成開始",
    cancelLabel: "今回は生成しない"
  });
  
  if (!confirmed) {
    return;
  }
  
  // 確認後は通常の生成処理を呼び出し（確認ダイアログなし）
  await generateContinuation(false);
}

/**
 * エントリ追加忘れ確認モーダルを表示
 * @returns {Promise<string>} ユーザーの選択結果
 */
async function showEntryReminderModal() {
  return new Promise((resolve) => {
    // 現在の種別を取得してキャラクター関連かチェック
    const entryTypeSelect = document.querySelector("#entry-type");
    const currentType = entryTypeSelect?.value;
    const isCharacterType = currentType === 'character';
    
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    
    const modal = document.createElement("div");
    modal.className = "modal entry-reminder-modal";
    
    const title = document.createElement("h3");
    title.textContent = "エントリの追加を忘れていませんか？";
    
    const message = document.createElement("p");
    message.textContent = "入力欄に内容が入力されていますが、「追加と同時に続きも生成する」がオフになっているため、追加されずに内容の生成を行なおうとしています。\n\n本当にこのまま続きを生成しますか？";
    
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    
    const continueButton = document.createElement("button");
    continueButton.textContent = "このまま生成を強行する";
    continueButton.className = "secondary";
    
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "キャンセル";
    cancelButton.className = "primary";
    
    continueButton.addEventListener("click", () => {
      document.body.removeChild(backdrop);
      resolve('continue');
    });
    
    cancelButton.addEventListener("click", () => {
      document.body.removeChild(backdrop);
      resolve('cancel');
    });
    
    // キャラクター種別でない場合のみエントリー追加ボタンを表示
    if (!isCharacterType) {
      const addButton = document.createElement("button");
      addButton.textContent = "エントリーを追加して生成";
      addButton.className = "secondary";
      
      addButton.addEventListener("click", () => {
        document.body.removeChild(backdrop);
        resolve('add');
      });
      
      actions.appendChild(addButton);
    }
    
    actions.appendChild(continueButton);
    actions.appendChild(cancelButton);
    
    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    
    document.body.appendChild(backdrop);
  });
}

/**
 * AI生成の続きを実行する
 * @param {boolean} showConfirm - 確認ダイアログを表示するかどうか
 */
export async function generateContinuation(showConfirm = true) {
  if (isGenerating) return;
  
  console.log('generateContinuation: 開始');
  
  // エントリー追加忘れチェック
  const generateToggleChecked = generateCheckbox()?.checked;
  const entryContentValue = entryContent()?.value?.trim();
  
  if (!generateToggleChecked && entryContentValue) {
    const shouldAddEntry = await showEntryReminderModal();
    if (shouldAddEntry === 'add') {
      // エントリーを追加してから続き生成
      // addEntry関数は別のモジュールで定義されているため、イベントを発火
      const event = new CustomEvent('addEntryAndGenerate');
      document.dispatchEvent(event);
      return;
    } else if (shouldAddEntry === 'cancel') {
      return; // キャンセル
    }
    // 'continue'の場合は処理を続行
  }
  
  // データチェック中のオーバーレイを表示
  showDataCheckOverlay();
  
  try {
    // 競合チェックと全データの再読み込み
    const shouldContinue = await checkAndReloadAllData();
    console.log('generateContinuation: checkAndReloadAllData結果', shouldContinue);
    
    // データチェックのオーバーレイを非表示
    hideGenerationOverlay();
    
    if (!shouldContinue) {
      console.log('generateContinuation: 処理を中断（競合検知のため）');
      return; // 処理を中断
    }
  } catch (error) {
    // データチェックでエラーが発生した場合もオーバーレイを非表示
    hideGenerationOverlay();
    console.error('generateContinuation: checkAndReloadAllDataでエラー', error);
    // エラーハンドリングは checkAndReloadAllData 内で行われているため、ここでは処理を続行
  }
  
  const { settings } = getState();
  if (!settings.apiKey || !settings.baseUrl || !settings.model) {
    addNotification({ variant: "error", message: "設定でAPIキー・BaseURL・モデルを入力してください" });
    return;
  }

  // ここではまだ生成確定ではない（この後に確認ダイアログあり）ため、履歴保存は確認後に行う
  
  // 確認ダイアログを表示（必要な場合）
  const skipPre = Boolean(settings.skipPreGenerationConfirm);
  if (showConfirm && !skipPre) {
    const confirmed = await showConfirmDialog({
      title: "続きを生成",
      message: "AIが物語の続きを生成します。この処理には時間がかかる場合があります。続行しますか？",
      confirmLabel: "生成開始",
      cancelLabel: "キャンセル"
    });
    
    if (!confirmed) {
      return;
    }
  }
  // 生成を実行するタイミングで履歴に一括保存（先頭昇格・最大50）
  try {
    const state = getState();
    await upsertHistoryBulk({
      rolePrompt: state.settings?.rolePrompt ?? "",
      command: state.command ?? "",
      worldview: state.worldView ?? "",
    });
  } catch (e) {
    // 保存失敗は致命的ではないのでログのみに留める
    console.warn("履歴保存に失敗", e);
  }
  
  // 既存のrejectエントリを削除（エラー通知や前回のrejectをクリア）
  removeExistingRejects();
  renderStory();
  // アニメーション用の基準（削除後の現在長）
  const preCount = getState().storyEntries.length;
  const lastExistingId = preCount > 0 ? getState().storyEntries[preCount - 1].id : null;
  
  isGenerating = true;
  const generateBtn = generateButton();
  const generateCharBtn = generateCharacterButton();
  const addEntryBtn = addEntryButton();
  
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = "生成中…";
  }
  if (generateCharBtn) {
    generateCharBtn.disabled = true;
    generateCharBtn.textContent = "生成中…";
  }
  if (addEntryBtn) {
    addEntryBtn.disabled = true;
  }
  // 生成開始時は必ず生成中の文言を表示（データチェックからの切替を確実に上書き）
  showGeneratingOverlay();
  updateFooter({ status: "生成中…" });
  const prompt = getSystemPrompt() + buildXmlInput();
  // 生成停止指定: stopOnGenerate が有効なキャラクターの name="{キャラ名}" を stop に設定
    const bannedStops = (getState().characters || [])
      .filter((c) => c && c.stopOnGenerate && (c.name ?? "").trim())
      .flatMap((c) => {
        const nm = (c.name || "").trim();
        return [`name="${nm}`, `name='${nm}`]; // 終了欠損を想定して後ろ引用符はなし
      });

  const payload = {
    model: settings.model,
    messages: [
        { role: "system", content: prompt },
    ],
    temperature: Number(settings.temperature) || 0.7,
    transforms: [],
    ...(bannedStops.length ? { stop: bannedStops } : {}),
    ...(Number.isFinite(Number(settings.maxTokens)) && Number(settings.maxTokens) > 0 ? { max_tokens: Math.floor(Number(settings.maxTokens)) } : {}),
  };
  console.log("payload:", { ...payload, messages: `[${payload.messages.length} messages omitted]` });
  console.log(prompt);

  try {
    // リトライ戦略を外側（ネットワーク）と内側（パース/再生成）で分離
    const maxNetworkRetries = 2;   // 通信系のリトライ回数
    const maxParseRetries = 2;     // XMLパース失敗時の再生成回数

    let responseBody = null;
    let latency = 0;
    let message = null;
    let entries = [];
    let rejects = [];
    let parseHandledAsBan = false;
    let lastParseError = null;

    // 単一の生成試行（通信込み）を、通信系のみ独立カウントでリトライ
    const requestWithNetworkRetries = async () => {
      let netAttempt = 0;
      let localMessage = null;
      let localResponseBody = null;
      let localLatency = 0;
      while (netAttempt <= maxNetworkRetries) {
        try {
          const resultOnce = await chatCompletions({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            payload,
          }, { timeout: Math.max(0, Number(settings.networkTimeoutSeconds ?? 60)) * 1000 });
          localResponseBody = resultOnce.responseBody;
          localLatency = resultOnce.latency;
          localMessage = localResponseBody?.choices?.[0]?.message?.content;
          if (!localMessage) throw new Error("応答にコンテンツが含まれていません");
          break; // 成功
        } catch (err) {
          const isNetworkish = err?.isNetworkError === true;
          if (isNetworkish) {
            try {
              updateOverlaySubtext("接続異常。直前結果の復旧を試行中…");
              const { status, responseBody: lastBody } = await chatCompletionsLast({
                baseUrl: settings.baseUrl,
                apiKey: settings.apiKey,
                payload,
              }, { timeout: 15_000 });
              if (status !== 204 && lastBody) {
                localResponseBody = lastBody;
                localMessage = lastBody?.choices?.[0]?.message?.content;
                // 復旧で取得できた場合は成功として抜ける
                if (localMessage) break;
              }
            } catch (recoveryErr) {
              console.warn("API直後の復旧確認中にエラー", recoveryErr);
            }
            if (!localMessage) {
              if (netAttempt < maxNetworkRetries) {
                netAttempt += 1;
                updateOverlaySubtext(`通信エラー。リトライ中… (${netAttempt}/${maxNetworkRetries} 回目)`);
                updateFooter({ status: "リトライ中…" });
                const backoffMs = 500 * Math.pow(2, Math.max(0, netAttempt - 1));
                await new Promise((r) => setTimeout(r, backoffMs));
                continue;
              } else {
                throw err;
              }
            }
          } else {
            // 通信系以外はそのまま上位へ
            throw err;
          }
        }
      }
      return { localMessage, localResponseBody, localLatency };
    };

    // まず最初の生成を試行（通信リトライのみ）
    {
      const { localMessage, localResponseBody, localLatency } = await requestWithNetworkRetries();
      message = localMessage;
      responseBody = localResponseBody;
      latency = localLatency;
    }

    const tryParseOnce = () => {
      try {
        const parsed = parseGeneratedContent(message);
        entries = parsed.entries;
        rejects = parsed.rejects;
        return true;
      } catch (parseError) {
        // 禁止キャラ stop による中断の可能性を推定
        const likelyStoppedByBan = (() => {
          if (!message) return false;
          const text = String(message);
          const tagOpenTruncated = /<\s*(dialogue|action)\b[^>]*$/i.test(text);
          return tagOpenTruncated;
        })();

        if (likelyStoppedByBan) {
          const content = ["❌️ 禁止指定キャラによる生成中止"].join("\n");
          const rejectEntry = {
            id: generateUUID(),
            type: "reject",
            name: null,
            content,
            createdAt: new Date().toISOString(),
            isErrorReject: false,
          };
          appendEntry(rejectEntry, { type: "end" });
          renderStory();
          parseHandledAsBan = true;
          return true; // 処理を終了（成功扱い）
        }

        lastParseError = parseError;
        return false;
      }
    };

    // 1回目のパース
    let parsedOk = tryParseOnce();

    // 失敗したら、パース用の独立したループで再生成を試行
    if (!parsedOk && !parseHandledAsBan) {
      for (let i = 1; i <= maxParseRetries; i += 1) {
        const isXmlParseError = lastParseError?.name === "XMLParseError" || /生成結果の解析に失敗/.test(lastParseError?.message || "");
        if (!isXmlParseError) break; // XML以外は即断念
        updateOverlaySubtext(`XML解析エラー。リトライ中… (${i}/${maxParseRetries} 回目)`);
        updateFooter({ status: "リトライ中…" });
        const { localMessage, localResponseBody, localLatency } = await requestWithNetworkRetries();
        message = localMessage;
        responseBody = localResponseBody;
        latency = localLatency;
        parsedOk = tryParseOnce();
        if (parsedOk) break;
      }
    }

    // 全ての試行後も失敗している場合はエラーを投げる
    if (!parseHandledAsBan && (!parsedOk || (entries.length === 0 && rejects.length === 0))) {
      throw lastParseError || new Error("生成結果の解析に失敗しました");
    }
    if (entries.length) {
      entries.forEach((entry) => appendEntry(entry, { type: "end" }));
      renderStory();
      // アニメーション有効時は自動スクロールを抑止（後でアニメ側が実施）
      if (!getState().settings?.enableAnimation) {
        setTimeout(() => scrollToBottom(true), 100);
      }
    }
    // json タグの処理（スキーマ未定義のため、極力非破壊的に）
    try {
      const jsonEntries = entries.filter((e) => e.type === "json");
      for (const je of jsonEntries) {
        let parsed;
        try {
          parsed = JSON.parse(je.content);
        } catch (e) {
          // 失敗は reject として通知し、処理継続
          const rejectEntry = createErrorRejectEntry(
            new Error("<json>の内容をJSONとして解析できませんでした"),
            { userHint: { summary: "jsonタグのパースに失敗", hint: e?.message || "不正なJSONです" } }
          );
          appendEntry(rejectEntry, { type: "end" });
          continue;
        }
        await jsonActions.process(parsed, { source: "ai", entry: je });
      }
      if (jsonEntries.length) {
        renderStory();
      }
    } catch (jsonProcErr) {
      console.error("json entries processing failed", jsonProcErr);
      const rejectEntry = createErrorRejectEntry(jsonProcErr, { userHint: { summary: "JSONアクションの処理に失敗しました" } });
      appendEntry(rejectEntry, { type: "end" });
      renderStory();
    }
    // rejectタグもエントリとして物語タイムラインに追加
    if (rejects.length) {
      rejects.forEach((reject) => appendEntry(reject, { type: "end" }));
      renderStory();
    }

    // 生成で追加されたエントリに対してアニメーションを適用（設定が有効な場合）
    try {
      const settings = getState().settings || {};
      const totalCount = getState().storyEntries.length;
      const addedCount = Math.max(0, totalCount - preCount);
      
      console.log('generateContinuation: アニメーション/Webhook処理開始', {
        enableAnimation: settings.enableAnimation,
        addedCount,
        webhookUrl: settings.webhookUrl,
        preCount,
        totalCount
      });
      
      if (settings.enableAnimation && addedCount > 0) {
        console.log('generateContinuation: アニメーション開始');
        // preCount === 0 の場合は先頭から、そうでなければ最後の既存IDから開始
        if (preCount === 0) {
          // -1 から開始すると先頭エントリーからアニメーション
          // 非同期に開始してUIスレッドをブロックしない
          setTimeout(() => animateFromIndex(-1), 0);
        } else if (lastExistingId) {
          setTimeout(() => startAnimationFromEntry(lastExistingId), 0);
        }
      } else if (!settings.enableAnimation && addedCount > 0 && hasWebhookUrl()) {
        // アニメーション無効時: 追加分をバックグラウンドで送信（UIブロックしない）
        const storyEntries = getState().storyEntries || [];
        const recentEntries = storyEntries.slice(-addedCount);
        console.log('generateContinuation: アニメーション無効時のWebhook送信をバックグラウンドで開始');
        // 失敗時はコンソールに記録。ユーザーの生成完了は待たない。
        Promise.resolve()
          .then(() =>
            sendEntriesWebhookSequential(recentEntries, {
              showStatus: true,       // 進捗はフッターに表示
              notifyOnError: false,   // BG中はトースト連発を避ける（集計で最後に1回出す）
              statusLabel: "Webhook送信中（BG）…",
            })
          )
          .then((result) => {
            if (!result) return;
            const { total, success, failed } = result;
            if (failed === 0) {
              addNotification({ variant: "success", message: `Webhook送信が完了しました（${success}/${total}）` });
            } else if (success > 0) {
              addNotification({ variant: "warning", message: `Webhook送信完了（成功 ${success}/${total}、失敗 ${failed}）` });
            } else {
              addNotification({ variant: "error", message: `Webhook送信に失敗しました（${failed}/${total}）` });
            }
          })
          .catch((e) => console.warn('バックグラウンドWebhook送信エラー', e));
      } else {
        console.log('generateContinuation: アニメーション/Webhook送信なし', {
          reason: !addedCount ? 'エントリ追加なし' : !settings.webhookUrl ? 'WebhookURLなし' : 'その他'
        });
      }
    } catch (e) {
      console.warn("Failed to start timeline animation or webhook after generation", e);
    }

  const usage = responseBody?.usage ?? {};
    const promptTokens = usage.prompt_tokens ?? null;
    const completionTokens = usage.completion_tokens ?? null;
    const totalTokens = usage.total_tokens ?? (promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null);
    const inputCost = Number(settings.inputTokenCost ?? 0) / 1_000_000;
    const outputCost = Number(settings.outputTokenCost ?? 0) / 1_000_000;
    const estimatedCost = promptTokens != null || completionTokens != null
      ? ((promptTokens ?? 0) * inputCost) + ((completionTokens ?? 0) * outputCost)
      : null;
    const cost = estimatedCost != null ? `$${estimatedCost.toFixed(4)} 目安` : "N/A";
    updateFooter({
      tokens: totalTokens ?? "-",
      latency: `${latency.toFixed(0)} ms`,
      cost,
      status: "完了",
    });
    addNotification({ variant: "success", message: "物語の続きを生成しました" });
    
    // 2秒後にステータスを待機中に戻す
    setTimeout(() => {
      if (getState().footer?.status === "完了") {
        updateFooter({ status: "待機中" });
      }
    }, 2000);
  } catch (error) {
    console.error("Generation failed", error);
    updateFooter({ status: "失敗" });
    
    // 追加のコンテキスト情報を収集
    const additionalInfo = {};
    
    // リクエストペイロードが存在する場合は追加
    if (payload) {
      additionalInfo.requestPayload = {
        model: payload.model,
        max_tokens: payload.max_tokens,
        temperature: payload.temperature,
        stop: Array.isArray(payload.stop) ? payload.stop : payload.stop ? [payload.stop] : undefined,
        prompt_length: payload.messages ? payload.messages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0) : 0,
        messages_count: payload.messages ? payload.messages.length : 0
      };
    }
    
  // ユーザー向けヒントを付与
  const hintInfo = buildUserFriendlyError(error);
  additionalInfo.userHint = hintInfo;
  // エラー情報をrejectエントリとして物語タイムラインに追加
  const errorReject = createErrorRejectEntry(error, additionalInfo);
    appendEntry(errorReject, { type: "end" });
    renderStory();
    
  addNotification({ variant: "error", message: hintInfo?.summary || error.message || "生成に失敗しました" });
  } finally {
    isGenerating = false;
    const generateBtn = generateButton();
    const generateCharBtn = generateCharacterButton();
    const addEntryBtn = addEntryButton();
    
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = "続きを生成";
    }
    if (generateCharBtn) {
      generateCharBtn.disabled = false;
      generateCharBtn.textContent = "続きを生成";
    }
    if (addEntryBtn) {
      addEntryBtn.disabled = false;
    }
    hideGenerationOverlay();
    // 生成処理が完了したら、まだ生成中状態の場合は待機中に戻す
    const currentStatus = getState().footer?.status;
    if (currentStatus === "生成中…") {
      updateFooter({ status: "待機中" });
    }
  }
}

/**
 * フッター表示を更新する
 */
export function updateFooterDisplay() {
  const footer = getState().footer;
  const tokensEl = footerTokens();
  const latencyEl = footerLatency();
  const costEl = footerCost();
  const statusEl = footerStatus();

  if (tokensEl) tokensEl.textContent = footer.tokens ?? "-";
  if (latencyEl) latencyEl.textContent = footer.latency ?? "-";
  if (costEl) costEl.textContent = footer.cost ?? "-";
  if (statusEl) statusEl.textContent = footer.status ?? "待機中";
}

/**
 * 生成中かどうかを取得する
 * @returns {boolean} 生成中の場合はtrue
 */
export function getIsGenerating() {
  return isGenerating;
}