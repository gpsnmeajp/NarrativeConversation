// components/fab.js
// フローティングアクションボタン（最下部へスクロール）
import { qs } from "../utils/dom.js";

// 外部からも呼べるスクロール実装（タイムライン優先、無ければウィンドウ）
export function fabScrollToBottom() {
  // 物語タイムラインがあれば、オーバーフローしている時だけタイムラインをスクロール
  const timeline = document.getElementById("story-timeline");
  if (timeline) {
    const { clientHeight, scrollHeight } = timeline;
    const timelineHasOverflow = scrollHeight - clientHeight > 2;
    if (timelineHasOverflow) {
      try {
        timeline.scrollTo({ top: scrollHeight, behavior: "smooth" });
      } catch (_) {
        // 一部ブラウザ向けフォールバック
        timeline.scrollTop = scrollHeight;
      }
      return;
    }
    // タイムラインが存在するがオーバーフローしない場合はウィンドウ側へフォールバック
  }
  // フォールバック: ページ全体を最下部へ
  const top = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  try {
    window.scrollTo({ top, behavior: "smooth" });
  } catch (_) {
    window.scrollTo(0, top);
  }
}

export function mountFAB() {
  // 既に存在する場合は再利用
  let btn = document.getElementById("fab-scroll-bottom");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "fab-scroll-bottom";
    btn.className = "fab fab--to-bottom";
    btn.type = "button";
    btn.setAttribute("aria-label", "一番下までスクロール");
    btn.title = "一番下までスクロール";
    btn.innerHTML = getChevronDownSVG();
    document.body.appendChild(btn);
  }

  btn.addEventListener("click", fabScrollToBottom);

  // アクティブビューに応じた表示制御（オプション）
  const appMain = qs(".app-main");
  let lastTimelineEl = null;
  let resizeObserver = null;
  let contentObserver = null;
  // タイムライン内の動的変化に対応するための追加リスナー
  const onImgLoadCapture = () => updateVisibility();
  const onTransitionEnd = () => updateVisibility();
  const onAnimationEnd = () => updateVisibility();

  const getScrollRatio = () => {
    const timeline = document.getElementById("story-timeline");
    const doc = document.documentElement;
    const viewportH = doc.clientHeight;
    const pageH = Math.max(doc.scrollHeight, document.body.scrollHeight);
    const windowHasOverflow = pageH - viewportH > 2;

    if (timeline) {
      const { scrollTop, clientHeight, scrollHeight } = timeline;
      const timelineHasOverflow = scrollHeight - clientHeight > 2;
      if (timelineHasOverflow) {
        // タイムラインがスクロール可能な場合はタイムライン基準
        return (scrollTop + clientHeight) / scrollHeight;
      }
      // タイムラインにオーバーフローが無ければウィンドウ基準へフォールバック
      if (windowHasOverflow) {
        const top = window.pageYOffset || doc.scrollTop;
        return (top + viewportH) / pageH;
      }
      // どちらにもオーバーフローが無い（=ボタン不要）
      return 1;
    }
    // タイムラインが無い場合はウィンドウ基準
    const top = window.pageYOffset || doc.scrollTop;
    if (pageH <= 0) return 0;
    return (top + viewportH) / pageH;
  };

  const updateVisibility = () => {
    const activeView = appMain?.getAttribute("data-active-view");
    // 初期ロード直後に activeView が未設定/遷移中の場合は一旦表示しておく
    const isMain = activeView ? activeView === "main" : true;
    if (!isMain) {
      btn.style.display = "none";
      return;
    }

    // 現在のオーバーフロー状況を確認
    const timeline = document.getElementById("story-timeline");
    const doc = document.documentElement;
    const viewportH = doc.clientHeight;
    const pageH = Math.max(doc.scrollHeight, document.body.scrollHeight);
    const windowHasOverflow = pageH - viewportH > 2;
    const timelineHasOverflow = timeline ? (timeline.scrollHeight - timeline.clientHeight > 2) : false;

    // オーバーフローが何も無ければ非表示（ボタン不要）
    if (!timelineHasOverflow && !windowHasOverflow) {
      btn.style.display = "none";
      return;
    }

    const ratio = getScrollRatio();
    // 9割以上スクロール済みなら非表示、そうでなければ表示
    btn.style.display = ratio >= 0.9 ? "none" : "flex";
  };

  const attachScrollListeners = () => {
    const timeline = document.getElementById("story-timeline");
    if (lastTimelineEl !== timeline) {
      if (lastTimelineEl) {
        lastTimelineEl.removeEventListener("scroll", updateVisibility);
        // 追加で登録したイベントも解除
        lastTimelineEl.removeEventListener("load", onImgLoadCapture, true);
        lastTimelineEl.removeEventListener("transitionend", onTransitionEnd);
        lastTimelineEl.removeEventListener("animationend", onAnimationEnd);
        if (resizeObserver) resizeObserver.disconnect();
        if (contentObserver) contentObserver.disconnect();
      }
      if (timeline) {
        timeline.addEventListener("scroll", updateVisibility, { passive: true });
        // タイムライン配下の画像ロード完了で高さが変わるケースに対応
        timeline.addEventListener("load", onImgLoadCapture, true); // captureで子要素のloadを捕捉
        // CSSトランジション/アニメーション後の高さ変化にも対応
        timeline.addEventListener("transitionend", onTransitionEnd);
        timeline.addEventListener("animationend", onAnimationEnd);
        // サイズ変化（スクロール可能領域の変化）を監視
        if (window.ResizeObserver) {
          resizeObserver = new ResizeObserver(() => updateVisibility());
          resizeObserver.observe(timeline);
        }
        // 子要素の増減やサブツリー変化（例: テキスト変更・非同期レンダリング）を監視
        contentObserver = new MutationObserver(() => updateVisibility());
        contentObserver.observe(timeline, { childList: true, subtree: true });
      }
      lastTimelineEl = timeline;
    }
  };

  updateVisibility();
  attachScrollListeners();

  // ビュー切替（data-active-view の変更）
  const observer = new MutationObserver(() => {
    attachScrollListeners();
    updateVisibility();
  });
  if (appMain) {
    observer.observe(appMain, { attributes: true, attributeFilter: ["data-active-view"] });
  }

  // window 側のスクロールも監視（フォールバック用）
  window.addEventListener("scroll", updateVisibility, { passive: true });
  window.addEventListener("resize", updateVisibility, { passive: true });
}

function getChevronDownSVG() {
  // 塗りつぶしタイプ（モバイルでの線のみ表示の描画不具合回避）
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <path d="M12 16l-6-6h12l-6 6z"/>
    </svg>
  `;
}
