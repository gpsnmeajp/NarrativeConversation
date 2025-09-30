// components/welcomeOverlay.js
// APIキー未設定時に表示する「ようこそ」オーバーレイ（モーダル）
// メイン画面が開かれたタイミングで表示し、設定画面への導線と説明書リンクを提供する。

import { showModal } from "./modal.js";
import { eventBus } from "../utils/eventBus.js";
import { getState, setState } from "../state/appState.js";

const MANUAL_URL = "https://github.com/gpsnmeajp/NarrativeConversation";

function isApiKeyMissing() {
    const apiKey = (getState().settings?.apiKey ?? "").trim();
    return apiKey.length === 0;
}

function isMainViewActive() {
    return getState().view === "main";
}

let currentlyOpen = false;
let hasShownOnce = false; // セッション中は一度だけ表示

export function maybeShowWelcomeOverlay() {
    if (currentlyOpen) return;
    if (hasShownOnce) return;
    if (!isMainViewActive()) return;
    if (!isApiKeyMissing()) return;

    currentlyOpen = true;
    hasShownOnce = true;
    const close = showModal({
        title: "ようこそ 👋",
        content: `
      <div class="welcome-overlay">
        <p>はじめまして！このアプリで物語を生成するには、まず「設定」でAPIの接続情報を入力してください。</p>
        <ul class="welcome-tips">
          <li>Base URL・APIキー・モデル名を設定します</li>
          <li>接続テストで疎通を確認できます</li>
        </ul>
      </div>
    `,
        actions: [
            {
                label: "設定を開く",
                className: "primary",
                onClick: () => {
                    setState({ view: "settings" });
                },
            },
            {
                label: "説明書を開く",
                className: "secondary",
                onClick: () => {
                    // 新しいタブで開く
                    window.open(MANUAL_URL, "_blank", "noopener");
                    // モーダルを閉じない
                    return false;
                },
            },
            {
                label: "閉じる",
                className: "secondary",
                onClick: () => {
                    // 何もしない（閉じるだけ）
                },
            },
        ],
    });

    // showModalはcloseを返す契約。閉じた後のフラグを戻す。
    // モーダル外クリックでも閉じたらフラグを戻すため、少し遅延して監視。
    // シンプルに1ティック後にDOMが消えたかを確認する仕組みにする。
    const restoreFlag = () => {
        currentlyOpen = false;
    };
    // closeをラップ
    const originalClose = close;
    const wrappedClose = () => {
        try { originalClose(); } finally { restoreFlag(); }
    };
    // 置き換えはできないので、unload時に戻すことはせず、
    // actions内はモーダル側でcloseが呼ばれた後に破棄される。
    // 背景クリック時にも閉じたらフラグを戻すように短いポーリングを入れる。
    let poll = 0;
    const interval = setInterval(() => {
        const root = document.querySelector("#modal-root");
        if (!root || root.childElementCount === 0) {
            clearInterval(interval);
            restoreFlag();
        }
        if (++poll > 100) { // ~10秒で安全に諦める
            clearInterval(interval);
            restoreFlag();
        }
    }, 100);

    // ついでに戻り値としてclose相当を返す
    return wrappedClose;
}

// 初期化：関連する状態変化での表示をフック
export function mountWelcomeOverlay() {
    // アプリ準備完了時（初期データロード後）
    eventBus.on("state:change:ready", () => {
        maybeShowWelcomeOverlay();
    });
    // ビューがメインになった時
    eventBus.on("state:change:view", () => {
        maybeShowWelcomeOverlay();
    });
    // 設定が更新され、APIキーが空のまま → メイン表示中なら促す
    eventBus.on("state:change:settings", () => {
        maybeShowWelcomeOverlay();
    });
}
