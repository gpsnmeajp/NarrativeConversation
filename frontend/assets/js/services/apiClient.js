// services/apiClient.js
// 軽量の API クライアントユーティリティ
// このモジュールはフロントエンドからバックエンドの簡易 API（ファイルI/O や AI プロキシ等）を
// 呼び出すための薄いラッパーを提供します。fetch を直接扱うのではなく、
// ここで共通のヘッダやエラーハンドリングを集中させることで、呼び出し側のコードを簡潔にします。
// 注意: ここでは動作の変更は行わず、呼び出しはすべて Promise を返します。

const JSON_HEADERS = {
  // JSON ボディを送信する際の共通ヘッダ。
  "Content-Type": "application/json",
};

/**
 * 汎用的なリクエスト関数
 * @param {string} path - API のエンドポイントパス
 * @param {Object} options - { method, body, headers, signal }
 * @returns {Promise<any>} パース済みのレスポンス
 */
/**
 * 汎用的な HTTP リクエストラッパー
 * - path: fetch に渡すパス（フルURL でも相対パスでも可）
 * - options: method, body, headers, signal
 *   - body が与えられた場合は JSON にシリアライズして送信します。
 *   - signal を渡すと AbortController によるキャンセルが可能です。
 * 戻り値:
 * - レスポンスの Content-Type が application/json の場合は JSON をパースして返します。
 * - それ以外はテキストを返します。
 * 例外:
 * - HTTP ステータスが 2xx でない場合はレスポンス本文を message として Error を投げます。
 */
async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
      // body がある場合のみ JSON シリアライズして送信
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    // ネットワーク層での失敗（DNS失敗、CORSブロック、接続不能など）
    const err = new Error(e?.message || "Network request failed");
    err.isNetworkError = true;
    err.name = e?.name || err.name;
    throw err;
  }

  // HTTP エラーは例外に変換して呼び出し元に伝える（ステータス情報を保持）
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text || response.statusText || `${response.status}`;
    // エラーメッセージの先頭にステータスコードを追加
    message = `HTTP [${response.status}] ${message}`;
    const error = new Error(message);
    error.status = response.status;
    error.statusText = response.statusText;
    error.body = text;
    try {
      error.data = text ? JSON.parse(text) : undefined;
    } catch (_) {
      // ignore
    }
    throw error;
  }

  // レスポンスの Content-Type を見て JSON ならパースして返す
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

// --- ファイル操作 API ---
/**
 * readFile(filePath)
 * - 指定ファイルのコンテンツを取得する。存在しない場合は null を返す。
 */
/**
 * readFile(filePath)
 * - 指定されたファイルの内容を取得します。
 * - 戻り値はファイルの文字列コンテンツ、存在しない場合は null を返します。
 * - 内部では POST /api/files/read を呼び出します（バックエンド実装に依存）。
 */
export async function readFile(filePath, options = {}) {
  const result = await request("/api/files/read", {
    method: "POST",
    body: { file_path: filePath },
    ...options,
  });
  return result?.content ?? null;
}

/**
 * writeFile(filePath, content)
 * - 指定ファイルに content を上書き保存する。
 */
/**
 * writeFile(filePath, content)
 * - 指定ファイルに content を上書き保存します。
 * - 成功時はバックエンドのレスポンスをそのまま返します。
 */
export async function writeFile(filePath, content, options = {}) {
  return request("/api/files/write", {
    method: "POST",
    body: { file_path: filePath, content },
    ...options,
  });
}

/**
 * deleteFile(filePath)
 * - 指定ファイルを削除する。
 */
/**
 * deleteFile(filePath)
 * - 指定ファイルを削除します。バックエンドの実装により成功/失敗の挙動が変わります。
 */
export async function deleteFile(filePath, options = {}) {
  return request("/api/files/delete", {
    method: "POST",
    body: { file_path: filePath },
    ...options,
  });
}

// --- AI / Chat API ラッパー ---
/**
 * chatCompletions({ baseUrl, apiKey, payload }, options)
 * - バックエンドの /api/ai/chat/completions エンドポイントを呼び出す。
 * - options.timeout をミリ秒で指定すると、AbortController によってタイムアウトを設定する。
 * - 戻り値は { responseBody, latency } 形式。
 */
/**
 * chatCompletions({ baseUrl, apiKey, payload }, options)
 * - AI 生成（チャット補完）用のラッパー。
 * - バックエンドの /api/ai/chat/completions に対して必要な情報を渡します。
 * - options.timeout をミリ秒で指定すると、内部で AbortController を使ってタイムアウトします。
 * - 戻り値は { responseBody, latency } の形で、responseBody はバックエンドからのパース済みレスポンスです。
 */
export async function chatCompletions({ baseUrl, apiKey, payload }, options = {}) {
  const controller = new AbortController();
  if (options.timeout) {
    // タイムアウト時にリクエストを中止する（AbortController）
    setTimeout(() => controller.abort(), options.timeout);
  }
  const startedAt = performance.now();
  const responseBody = await request("/api/ai/chat/completions", {
    method: "POST",
    body: {
      base_url: baseUrl,
      api_key: apiKey,
      payload,
    },
    signal: controller.signal,
  });
  const latency = performance.now() - startedAt;
  return { responseBody, latency };
}

/**
 * chatCompletionsLast({ baseUrl, apiKey, payload }, options)
 * - 直前の Chat Completions 結果を問い合わせます。
 * - バックエンドの /api/ai/chat/completions/last に、生成時と同一のリクエストボディを渡します。
 * - 戻り値は { responseBody, status }。204 の場合は responseBody は null になります。
 */
export async function chatCompletionsLast({ baseUrl, apiKey, payload }, options = {}) {
  const controller = new AbortController();
  if (options.timeout) {
    setTimeout(() => controller.abort(), options.timeout);
  }
  let response;
  try {
    response = await fetch("/api/ai/chat/completions/last", {
      method: "POST",
      headers: { ...JSON_HEADERS },
      body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, payload }),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e?.message || "Network request failed");
    err.isNetworkError = true;
    err.name = e?.name || err.name;
    throw err;
  }

  // 204 の場合は本文なしで成功扱い
  if (response.status === 204) {
    return { responseBody: null, status: 204 };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text || response.statusText || `${response.status}`;
    message = `HTTP [${response.status}] ${message}`;
    const error = new Error(message);
    error.status = response.status;
    error.statusText = response.statusText;
    error.body = text;
    try { error.data = text ? JSON.parse(text) : undefined; } catch (_) {}
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  const parsed = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { responseBody: parsed, status: response.status };
}

/**
 * healthCheck()
 * - バックエンドヘルスチェック用のシンプルヘルパー
 */
/**
 * healthCheck()
 * - バックエンドのヘルスチェックエンドポイントを呼び出します。
 * - 成功すればバックエンドの応答（JSON またはテキスト）を返します。
 */
export async function healthCheck() {
  return request("/api/health");
}

/**
 * postWebhook({ url, payload, headers?, timeoutSec? })
 * - バックエンドの /api/webhook/post を呼び出す。
 * - レスポンス本文は返らず、HTTPステータスのみが意味を持つ。
 */
export async function postWebhook({ url, payload, headers, timeoutSec }, options = {}) {
  const controller = new AbortController();
  if (timeoutSec && Number(timeoutSec) > 0) {
    setTimeout(() => controller.abort(), Number(timeoutSec) * 1000);
  }
  // バックエンドは本文を返さないため、request() はステータス200-299以外で例外を投げる。
  return request("/api/webhook/post", {
    method: "POST",
    body: {
      url,
      payload,
      headers,
      timeout: timeoutSec,
    },
    signal: controller.signal,
    ...options,
  });
}

// --- ブラウザセッション管理 API ---
/**
 * setActiveBrowser(sessionId)
 * - 現在アクティブなブラウザセッションを当該 sessionId に設定します。
 */
export async function setActiveBrowser(sessionId, options = {}) {
  return request("/api/browser/active", {
    method: "POST",
    body: { session_id: String(sessionId || "").trim() },
    ...options,
  });
}

/**
 * getActiveBrowser()
 * - 現在のアクティブブラウザセッション情報を取得します。
 * - 戻り値: { active: boolean, session_id: string|null, updated_at: string|null }
 */
export async function getActiveBrowser(options = {}) {
  return request("/api/browser/active", { method: "GET", ...options });
}

// --- Incoming Webhook Polling API ---
/**
 * getIncomingWebhook({ limit, sinceId })
 * - バックエンドの /api/webhook/incoming を呼び出し、受信済みのWebhook情報を取得します。
 * - limit: 1〜30（既定30）
 * - sinceId: このIDより大きいレコードのみ返す（任意）
 */
export async function getIncomingWebhook({ limit, sinceId } = {}, options = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(limit)) params.set("limit", String(Math.max(1, Math.min(30, limit))));
  if (Number.isFinite(sinceId)) params.set("sinceId", String(Math.max(0, sinceId | 0)));
  const qs = params.toString();
  const path = qs ? `/api/webhook/incoming?${qs}` : "/api/webhook/incoming";
  return request(path, { method: "GET", ...options });
}
