// utils/timelineAnimation.js
// タイムラインのアニメーション表示（タイプライター + ウェイト）を提供する共通ユーティリティ
import { getState, addNotification, updateFooter } from "../state/appState.js";
import { sendEntryWebhook, hasWebhookUrl } from "./webhook.js";
import { renderStoryEntry } from "../components/storyEntry.js";
import { storyTimeline } from "./domSelectors.js";
import { fabScrollToBottom } from "../components/fab.js";

// FAB のスクロールロジックを直接呼び出す
function triggerFabScroll() {
  try {
    fabScrollToBottom();
  } catch (_) {
    // 何らかの理由で未初期化の場合のみ、最低限のフォールバック
    const timeline = document.getElementById('story-timeline');
    if (timeline) {
      try { timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' }); }
      catch { timeline.scrollTop = timeline.scrollHeight; }
    } else {
      const top = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      try { window.scrollTo({ top, behavior: 'smooth' }); } catch { window.scrollTo(0, top); }
    }
  }
}

// ポーズ対応のスリープ（50ms刻みでポーリングしつつキャンセル/ポーズを反映）
function sleepWithPause(ms, controller, step = 50) {
  return new Promise((resolve) => {
    if (!controller || ms <= 0) return resolve();
    const start = performance.now();
    const tick = () => {
      if (controller.cancelled) return resolve();
      if (controller.paused) {
        controller._onResumeOnce(tick);
        return;
      }
      const elapsed = performance.now() - start;
      if (elapsed >= ms) return resolve();
      const id = setTimeout(tick, Math.min(step, ms - elapsed));
      controller.addCleanup(() => clearTimeout(id));
    };
    tick();
  });
}

// 実行中アニメーションを制御するための簡易コントローラ
class AnimationController {
  constructor() {
    this.cancelled = false;
    this.paused = false;
    this._cleanups = new Set();
    this._resumeWaiters = new Set();
  }
  cancel() {
    this.cancelled = true;
    this._cleanups.forEach((fn) => {
      try { fn(); } catch {}
    });
    this._cleanups.clear();
  }
  addCleanup(fn) {
    this._cleanups.add(fn);
  }
  pause() {
    if (this.cancelled) return;
    this.paused = true;
  }
  resume() {
    if (this.cancelled) return;
    this.paused = false;
    const waiters = Array.from(this._resumeWaiters);
    this._resumeWaiters.clear();
    waiters.forEach((cb) => { try { cb(); } catch {} });
  }
  _onResumeOnce(cb) {
    this._resumeWaiters.add(cb);
  }
}

let currentController = null;

// 全エントリーを完全表示で即時レンダリングし、最下部へスクロール
function renderFullTimeline() {
  const timeline = storyTimeline();
  if (!timeline) return;
  const { storyEntries } = getState();
  // キャラクターマップ
  const characterMap = new Map();
  try { (getState().characters || []).forEach(c => { if (c?.name) characterMap.set(c.name, c); }); } catch {}
  timeline.innerHTML = "";
  storyEntries.forEach((entry) => {
    const el = renderStoryEntry(entry, characterMap);
    timeline.append(el);
  });
  triggerFabScroll();
}

/**
 * 指定のテキストを1文字ずつ描画する
 * @param {HTMLElement} target - テキストを流し込む要素
 * @param {string} text - 出力する全文
 * @param {number} intervalSec - 1文字あたりの秒数
 * @param {AnimationController} controller - キャンセル制御用
 */
async function typewriter(target, text, intervalSec, controller) {
  if (!target) return;
  const dtMs = Math.max(0, Number(intervalSec) * 1000);
  target.textContent = "";
  for (let i = 0; i < text.length; i++) {
    if (controller?.cancelled) break;
    if (controller?.paused) {
      await new Promise((res) => controller._onResumeOnce(res));
      if (controller.cancelled) break;
    }
    target.textContent += text[i];
    if (dtMs > 0) await sleepWithPause(dtMs, controller, Math.min(50, dtMs));
  }
}

/**
 * タイムラインを「startIndex まで表示」し、その後のエントリをアニメーションで1つずつ表示
 * JSON, reject エントリはタイプライター/待機をスキップして即時表示します。
 * @param {number} startIndex - 開始する基準のエントリインデックス（この直後から表示）
 */
export async function animateFromIndex(startIndex, options = {}) {
  const timeline = storyTimeline();
  if (!timeline) return;
  const { storyEntries, settings } = getState();
  if (!Array.isArray(storyEntries) || storyEntries.length === 0) return;

  // 既存のアニメーションがあれば停止
  if (currentController) currentController.cancel();
  const controller = new AnimationController();
  currentController = controller;
  // 制御UIを表示
  showAnimationControls();

  const force = options.force === true;
  const enableAnimation = force ? true : (settings?.enableAnimation !== false); // 省略時は有効
  const intervalSec = Number(settings?.typingIntervalSeconds ?? 0.03);
  const waitSec = Number(settings?.waitSeconds ?? 0.5);

  // キャラクターマップ（名前 => キャラクター）
  const characterMap = new Map();
  try {
    (getState().characters || []).forEach(c => { if (c?.name) characterMap.set(c.name, c); });
  } catch {}

  // 1) タイムラインを startIndex まで再構築
  timeline.innerHTML = "";
  const clampIndex = Math.min(Math.max(0, startIndex), storyEntries.length - 1);
  for (let i = 0; i <= clampIndex; i++) {
    const el = renderStoryEntry(storyEntries[i], characterMap);
    timeline.append(el);
  }
  triggerFabScroll();

  // 2) 以後のエントリを1つずつ表示
  try {
    for (let i = clampIndex + 1; i < storyEntries.length; i++) {
      if (controller.cancelled) break;
      if (controller.paused) {
        await new Promise((res) => controller._onResumeOnce(res));
        if (controller.cancelled) break;
      }
      const entry = storyEntries[i];
      const el = renderStoryEntry(entry, characterMap);
      timeline.append(el);
      triggerFabScroll();

      // JSON / reject もWebhook送信（タイプライター/待機はスキップだがWebhook完了は待つ）
      if (entry.type === "json" || entry.type === "reject") {
        try {
          if (hasWebhookUrl()) {
            const currentCount = i - clampIndex;
            const totalCount = storyEntries.length - clampIndex - 1;
            await sendEntryWebhook(entry, { index: currentCount, total: totalCount });
          }
        } catch (e) {
          console.warn("Webhook送信に失敗", e);
          const msg = (e && (e.body || e.message)) ? String(e.body || e.message) : "不明なエラー";
          addNotification({ variant: "warn", message: "【Webhook送信に失敗】"+msg });
          // 失敗してもここでは次へ進む
        }
        continue; // 次へ（待機は不要）
      }

      // アニメーション無効時は即時表示のみ
      if (!enableAnimation) {
        // アニメーション無効なら即時表示のみ。Webhook送信は generateContinuation 側で一括実施。
        // ここでの個別送信はデッドコード化していたため撤去。
        continue;
      }

      // 非JSON: タイプライター適用（開始と同時にWebhook送信）
      const contentHost = el.querySelector('.entry-content');
      if (contentHost) {
        const candidates = Array.from(contentHost.children).filter(ch => ch.tagName === 'DIV' && !ch.classList.contains('reject-warning'));
        const textNode = candidates[candidates.length - 1];
        if (textNode) {
          const fullText = textNode.textContent ?? "";
          // Webhook送信を並列で開始
          const webhookPromise = (async () => {
            if (!hasWebhookUrl()) return; // 未設定なら送らない
            const fullEntry = { ...entry, content: fullText };
            const currentCount = i - clampIndex;
            const totalCount = storyEntries.length - clampIndex - 1;
            await sendEntryWebhook(fullEntry, { index: currentCount, total: totalCount });
          })();

          // タイプライター
          await typewriter(textNode, fullText, intervalSec, controller);

          // エントリ間の待機（待機とWebhookの遅い方に合わせる）
          const waitP = waitSec > 0 ? sleepWithPause(waitSec * 1000, controller) : Promise.resolve();
          try {
            await Promise.all([waitP, webhookPromise]);
          } catch (_) {
            // webhookPromise が失敗しても待機は完了しているはず。ここでは次へ進む。
          }
          continue; // 次のループへ
        }
      }
      // テキストノードが見つからなかった場合は従来どおり待機のみ
      if (waitSec > 0) await sleepWithPause(waitSec * 1000, controller);
    }
  } finally {
    // 完了/中断時: 表示を完全状態に整えて制御UIを隠す
    if (controller.cancelled) {
      // 停止ボタン等で中断された場合はフルレンダリング
      renderFullTimeline();
    }
    hideAnimationControls();
    if (currentController === controller) currentController = null;
  }
}

/**
 * 指定のエントリIDからアニメーションを開始（その直後のエントリから順に表示）
 * @param {string} entryId - 基準エントリID
 */
export async function startAnimationFromEntry(entryId, options = {}) {
  const { storyEntries } = getState();
  const startIdx = storyEntries.findIndex(e => e.id === entryId);
  if (startIdx === -1) return;
  await animateFromIndex(startIdx, options);
}

/** 停止API（任意） */
export function stopAnimation() {
  if (currentController) {
    currentController.cancel();
    // 即時に完全表示へ切り替え
    renderFullTimeline();
    hideAnimationControls();
    currentController = null;
  }
}

/** 一時停止/再開API */
export function pauseAnimation() {
  if (currentController) currentController.pause();
}
export function resumeAnimation() {
  if (currentController) currentController.resume();
}

// ===== アニメーション制御用フローティングボタン =====
let controlsMounted = false;
let controlsRoot = null;
let pauseBtn = null;
let stopBtn = null;
let repositionTimer = null;

function ensureControls() {
  if (controlsMounted && controlsRoot && document.body.contains(controlsRoot)) return;
  controlsRoot = document.createElement('div');
  controlsRoot.id = 'animation-controls';
  controlsRoot.style.position = 'fixed';
  // デフォルト位置（後でFABの位置に合わせて調整）
  controlsRoot.style.right = '16px';
  controlsRoot.style.bottom = '16px';
  controlsRoot.style.display = 'none';
  controlsRoot.style.gap = '10px';
  controlsRoot.style.zIndex = '10000';
  controlsRoot.style.flexDirection = 'row';
  controlsRoot.style.alignItems = 'center';
  controlsRoot.style.justifyContent = 'center';
  controlsRoot.style.pointerEvents = 'auto';
  controlsRoot.style.transition = 'opacity 0.2s ease';
  controlsRoot.style.opacity = '1';

  const mkBtn = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    // 初期はテキスト、後で必要に応じてSVGに差し替え
    b.innerHTML = '';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.width = '48px';
    b.style.height = '48px';
    b.style.borderRadius = '999px';
    b.style.border = 'none';
  b.style.boxShadow = 'var(--shadow-subtle)';
  b.style.background = 'var(--accent, #3b82f6)';
  b.style.color = 'white';
    b.style.fontSize = '20px';
    // 中央寄せ（フォント差異によるベースラインずれ対策）
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.justifyContent = 'center';
    b.style.lineHeight = '1';
    b.style.padding = '0';
    b.style.cursor = 'pointer';
    return b;
  };

  pauseBtn = mkBtn('', '一時停止');
  stopBtn = mkBtn('', '停止');
  stopBtn.style.background = 'var(--danger, #ef4444)';

  const host = document.createElement('div');
  host.style.display = 'flex';
  host.style.gap = '10px';
  host.appendChild(pauseBtn);
  host.appendChild(stopBtn);
  controlsRoot.appendChild(host);
  document.body.appendChild(controlsRoot);

  pauseBtn.addEventListener('click', () => {
    if (!currentController) return;
    if (currentController.paused) {
      currentController.resume();
      updateControlsUI();
    } else {
      currentController.pause();
      updateControlsUI();
    }
  });
  stopBtn.addEventListener('click', () => {
    if (!currentController) return;
    currentController.cancel();
    // 完全表示に切り替えてからUIを閉じる
    renderFullTimeline();
    hideAnimationControls();
    currentController = null;
  });

  controlsMounted = true;
  // 初期アイコン設定
  setPauseIcon(false); // 再生中=ポーズボタン表示
  setStopIcon();
}

function updateControlsUI() {
  if (!pauseBtn || !currentController) return;
  if (currentController.paused) {
    setPlayIcon();
    pauseBtn.title = '再開';
    pauseBtn.setAttribute('aria-label', '再開');
  } else {
    setPauseIcon(true);
    pauseBtn.title = '一時停止';
    pauseBtn.setAttribute('aria-label', '一時停止');
  }
}

// ===== SVGアイコン =====
function setPauseIcon(compact=false) {
  if (!pauseBtn) return;
  pauseBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <rect x="6" y="4" width="4" height="16"/>
      <rect x="14" y="4" width="4" height="16"/>
    </svg>
  `;
}
function setPlayIcon() {
  if (!pauseBtn) return;
  pauseBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M8 5v14l11-7-11-7z"/>
    </svg>
  `;
}
function setStopIcon() {
  if (!stopBtn) return;
  stopBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  `;
}

function showAnimationControls() {
  ensureControls();
  updateControlsUI();
  if (controlsRoot) {
    controlsRoot.style.display = 'block';
    controlsRoot.style.opacity = '1';
  }
  // 表示に合わせて位置を調整し続ける
  startRepositionLoop();
}

function hideAnimationControls() {
  if (controlsRoot) {
    controlsRoot.style.opacity = '0';
    controlsRoot.style.display = 'none';
  }
  stopRepositionLoop();
}

// ===== FABとの重なり回避: 横に並ぶよう動的配置 =====
function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function updateControlsPosition() {
  if (!controlsRoot) return;
  const fab = document.getElementById('fab-scroll-bottom');
  const gap = 12; // FABとの隙間
  if (fab && isVisible(fab)) {
    const rect = fab.getBoundingClientRect();
    // FABの左側に横並びで配置
    const rightPx = Math.max(16, window.innerWidth - rect.left + gap);
    const bottomPx = Math.max(16, window.innerHeight - rect.bottom);
    controlsRoot.style.right = `${rightPx}px`;
    controlsRoot.style.bottom = `${bottomPx}px`;
  } else {
    // FABが無い/非表示時は右下デフォルト
    controlsRoot.style.right = '16px';
    controlsRoot.style.bottom = '16px';
  }
}

function startRepositionLoop() {
  stopRepositionLoop();
  // スクロール・リサイズ・一定間隔での再計算
  const handler = () => updateControlsPosition();
  window.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('resize', handler, { passive: true });
  repositionTimer = {
    id: setInterval(handler, 300),
    handler,
  };
  // 初期配置
  updateControlsPosition();
}

function stopRepositionLoop() {
  if (repositionTimer) {
    clearInterval(repositionTimer.id);
    window.removeEventListener('scroll', repositionTimer.handler);
    window.removeEventListener('resize', repositionTimer.handler);
    repositionTimer = null;
  }
}
