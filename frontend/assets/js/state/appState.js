// appState.js
// アプリケーション全体で共有するクライアントサイドの状態管理モジュール。
// - 単一の `state` オブジェクトを内部に保持するシンプルなストア実装。
// - `eventBus` を通じて状態変更イベントを発行し、UI コンポーネントが購読して再描画できるようにする。
// - このモジュールは副作用を最小限にし、直接ファイル I/O やネットワークは行わない（dataStore 等と組み合わせて使用）。
import { eventBus } from "../utils/eventBus.js";
import { generateUUID } from "../utils/uuid.js";

// 設定のデフォルト値。ユーザー指定が無い場合、この値にフォールバックする。
const DEFAULT_SETTINGS = {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: "google/gemini-2.5-flash",
    temperature: 0.7,
    // 生成時の最大トークン数（未指定/null の場合はプロバイダ既定）
    maxTokens: 32*1024,
    inputTokenCost: 0.30,
    outputTokenCost: 2.50,
    enableAnimation: true,
    // タイムラインでアバターを表示しない
    hideAvatars: false,
    // 生成前の確認ダイアログをスキップするか
    skipPreGenerationConfirm: false,
    // アニメーション関連
    typingIntervalSeconds: 0.02, // 1文字あたりの表示間隔（秒）
    waitSeconds: 1.5, // 各種待機時間（秒）
    // 通信全般の既定タイムアウト（秒）
    networkTimeoutSeconds: 60,
    rolePrompt: "あなたは物語を作成するライトノベル作家です。\n\nユーザーが提供するキャラクターの名前、性格、設定に基づいて、魅力的な物語を作成してください。\n物語は短い地の文と対話の形式で進行します。\n\n世界観やキャラクター情報を参照し、物語の続きを作成してください。",
    // 要約生成に使うシステムプロンプト（UIで編集可能）
    summaryPrompt: "あなたは熟練のライトノベル編集者です。新しい章を開始しますので、ここまでの与えられた物語を読み込み、内容を忠実に保ちながら三人称の地の文で前章のあらすじとして要約してください。\n- 出力はプレーンテキストの日本語で、2000字以内程度を目安にしてください。\n- 新しい出来事や情報を付け加えず、与えられた内容のみを整理してください。\n- 重要な会話を除き直接的な会話表現は避け、会話が行われた事実や意図を地の文で描写してください。\n- シーンの流れと感情の推移が自然になるよう段落を分けてください。",
    jsonDefinition: "",
    webhookUrl: "",
    // Incoming Webhook を有効にするか（受信連携）
    enableIncomingWebhook: false,
};

// コマンド入力のデフォルト文字列
const DEFAULT_COMMAND = "物語を作成してください";

// ストアが保持する初期状態のスキーマ定義（UI 側はこれを前提に動作する）
const INITIAL_STATE = {
    ready: false, // アプリの初期化完了フラグ
    loading: false, // 読み込み中フラグ
    error: null, // グローバルエラー情報
    view: "main", // 現在の表示ビュー識別子
    saveStatus: {
        command: "idle",
        worldView: "idle",
        settings: "idle",
    },
    settings: { ...DEFAULT_SETTINGS },
    worldView: "",
    command: DEFAULT_COMMAND,
    characters: [],
    storyEntries: [],
    currentStoryId: null,
    storyIndex: [],
    storyFileMap: {},
    notifications: [],
    footer: {
        tokens: null,
        latency: null,
        cost: null,
        status: "待機中",
    },
};

// 内部で保持する mutable な状態オブジェクト。外部からは getState()/setState() 経由で操作する。
let state = structuredClone(INITIAL_STATE);

/**
 * emitChange(keys)
 * - 状態が変更されたことを eventBus 経由で通知するユーティリティ。
 * - 2 種類のイベントを発行します:
 *   - 'state:change' -> 全体の状態と変更されたキー配列を通知
 *   - 'state:change:<key>' -> 各キー単位での変更を通知（UI の微更新に便利）
 * - keys が空配列の場合は全体変更通知のみを行います。
 * - 注意: 発行は同期的に行われ、受信側のハンドラが長時間実行されると
 *   呼び出し元のフローに影響するため、受信側は必要に応じて非同期処理を行ってください。
 * @param {Array<string>} keys - 変更されたキー名の配列
 */
function emitChange(keys = []) {
    eventBus.emit("state:change", { state, keys });
    keys.forEach((key) => eventBus.emit(`state:change:${key}`, state[key]));
}

/**
 * getState()
 * - 現在の状態オブジェクトを返します。
 * - 戻り値は内部の mutable な state への参照です。呼び出し元で直接変更すると
 *   一貫性が失われる可能性があるため、読み取り専用として扱うか
 *   `updateState` / `setState` 経由で変更してください。
 * @returns {Object} state
 */
export function getState() {
    return state;
}

/**
 * resetState()
 * - 状態を INITIAL_STATE にリセットします。
 * - 主にテストやユーザー切替時の初期化用です。
 * - リセット後はすべての初期キーについて state:change イベントを発行します。
 */
export function resetState() {
    state = structuredClone(INITIAL_STATE);
    emitChange(Object.keys(INITIAL_STATE));
}

/**
 * setState(partialState)
 * - 部分的な state オブジェクトを受け取り、既存のキーのみを上書きします。
 * - 未知のキーは無視され、警告がコンソールに出ます。
 * - 変更されたキーごとに state:change:<key> イベントを発行します。
 * @param {Object} partialState - 更新対象の部分的な state
 */
export function setState(partialState = {}) {
    const changedKeys = [];
    Object.entries(partialState).forEach(([key, value]) => {
        if (key in state) {
            state[key] = value;
            changedKeys.push(key);
        } else {
            console.warn(`[appState] Unknown state key: ${key}`);
        }
    });
    if (changedKeys.length) emitChange(changedKeys);
}

/**
 * updateState(key, updater)
 * - 指定したキーの値を関数形式で安全に更新するユーティリティ。
 * - updater には現在の値のディープコピー（structuredClone）が渡されるため、
 *   参照破壊を避けられます。
 * - 例: updateState('notifications', (n) => [...n, newItem])
 * @param {string} key - 更新対象の state キー
 * @param {function} updater - 現在の値を受け取り、次の値を返す関数
 */
export function updateState(key, updater) {
    if (!(key in state)) {
        console.warn(`[appState] Cannot update missing key ${key}`);
        return;
    }
    const nextValue = updater(structuredClone(state[key]));
    state[key] = nextValue;
    emitChange([key]);
}

/**
 * setSaveStatus(target, status)
 * - ファイル保存等の進捗表示用に saveStatus を更新します。
 * - target は 'command' | 'worldView' | 'settings' 等を想定。
 */
export function setSaveStatus(target, status) {
    state.saveStatus[target] = status;
    emitChange(["saveStatus"]);
}

/**
 * updateFooter(partial)
 * - フッターに表示する情報（トークン数やレイテンシなど）を部分更新します。
 * - partial に必要なキーのみを入れて呼び出してください。
 */
export function updateFooter(partial) {
    state.footer = { ...state.footer, ...partial };
    emitChange(["footer"]);
}

/**
 * addNotification(notification)
 * - 一時的なユーザー通知を追加します。
 * - notification: { message, variant?, duration? }
 * - 戻り値は内部で割り当てた通知 ID。後で removeNotification(id) で削除可能です。
 */
export function addNotification(notification) {
    const id = generateUUID();
    const payload = { id, duration: 4000, variant: "info", ...notification };
    state.notifications = [...state.notifications, payload];
    emitChange(["notifications"]);
    return id;
}

/**
 * removeNotification(id)
 * - 指定した通知を削除します。
 * - 存在しない id を渡しても安全に動作します。
 */
export function removeNotification(id) {
    state.notifications = state.notifications.filter((item) => item.id !== id);
    emitChange(["notifications"]);
}

/**
 * markReady()
 * - アプリケーションの初期化完了を示すフラグを立てます。
 */
export function markReady() {
    state.ready = true;
    emitChange(["ready"]);
}

// 外部で参照するためのデフォルト値をエクスポート
export const defaults = {
    settings: DEFAULT_SETTINGS,
    command: DEFAULT_COMMAND,
};
