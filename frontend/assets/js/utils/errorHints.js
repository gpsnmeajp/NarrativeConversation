// utils/errorHints.js
// HTTPステータスコードやネットワークエラーから、ユーザー向けに分かりやすい日本語のヒント文を生成

const STATUS_HINTS = {
  400: "リクエストが不正です。入力値の不足・形式の誤り、またはCORSの問題が考えられます。",
  401: "認証に失敗しました。APIキーが無効か期限切れの可能性があります。",
  402: "クレジット残高不足です。クレジットを追加して再試行してください。",
  403: "入力がモデレーションで拒否されました。内容を見直してください。",
  408: "タイムアウトしました。再試行するか、Base URLやネットワーク環境をご確認ください。",
  429: "リクエストが多すぎます。しばらく待ってから再試行してください。",
  502: "通信に失敗しました。接続先が合っている場合、選択したモデルがダウンしているか、不正な応答を返しました。モデル変更や再試行を検討してください。",
  503: "要求を満たすプロバイダが見つかりません。ルーティング条件やモデル設定を見直してください。",
};

function stringify(value, max = 1200) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
  } catch {
    return String(value);
  }
}

function formatModerationMetadata(meta) {
  const reasons = Array.isArray(meta?.reasons) && meta.reasons.length ? `理由: ${meta.reasons.join(', ')}` : null;
  const flagged = meta?.flagged_input ? `該当箇所: ${meta.flagged_input}` : null;
  const provider = meta?.provider_name ? `プロバイダー: ${meta.provider_name}` : null;
  const model = meta?.model_slug ? `モデル: ${meta.model_slug}` : null;
  return ["[モデレーション情報]", reasons, flagged, provider, model].filter(Boolean).join("\n");
}

function formatProviderMetadata(meta) {
  const provider = meta?.provider_name ? `プロバイダー: ${meta.provider_name}` : null;
  const raw = meta?.raw != null ? `詳細: ${stringify(meta.raw)}` : null;
  return ["[プロバイダーエラー情報]", provider, raw].filter(Boolean).join("\n");
}

export function buildUserFriendlyError(error) {
  // トークン超過（コンテキスト長超過）の先行検知（400でもこちらを優先表示）
  const tokenLimitInfo = (() => {
    try {
      // OpenAI互換の error.code / error.type
      const e = error?.data?.error;
      const code = e?.code || e?.type;
      const metaType = e?.metadata?.type;
      const explicitCodeHit = /context_length_exceeded|tokens_exceeded/i.test(String(code || '')) || /context_length_exceeded/i.test(String(metaType || ''));

      // 代表的なメッセージパターン
      const candidates = [];
      if (typeof e?.message === 'string') candidates.push(e.message);
      if (typeof error?.message === 'string') candidates.push(error.message);
      if (error?.body) {
        const b = error.body;
        if (typeof b === 'string') candidates.push(b);
        if (typeof b === 'object') {
          const m = b?.error?.message || b?.message;
          if (typeof m === 'string') candidates.push(m);
        }
      }

      const msgJoined = candidates.filter(Boolean).join('\n');
      const tokenMsgHit = /maximum\s+context\s+length\s+is\s+\d+\s+tokens|context\s+length\s+exceeded|too\s+many\s+tokens|prompt\s+too\s+long|token\s+limit/i.test(msgJoined);

      if (!(explicitCodeHit || tokenMsgHit)) return null;

      // 可能なら数値を抽出
      // 例: "maximum context length is 4095 tokens. However, you requested about 38212 tokens (5444 of text input, 32768 in the output)."
      const maxMatch = msgJoined.match(/maximum\s+context\s+length\s+is\s+(\d+)\s+tokens/i);
      const reqMatch = msgJoined.match(/requested\s+(?:about\s+)?(\d+)\s+tokens/i);
      const inOutMatch = msgJoined.match(/\((\d+)\s+of\s+text\s+input,\s+(\d+)\s+in\s+the\s+output\)/i);

      const info = {
        max: maxMatch ? Number(maxMatch[1]) : undefined,
        requested: reqMatch ? Number(reqMatch[1]) : undefined,
        input: inOutMatch ? Number(inOutMatch[1]) : undefined,
        output: inOutMatch ? Number(inOutMatch[2]) : undefined,
      };
      return info;
    } catch {
      return null;
    }
  })();

  if (tokenLimitInfo) {
    const parts = [];
    if (typeof tokenLimitInfo.max === 'number' && typeof tokenLimitInfo.requested === 'number') {
      parts.push(`最大 ${tokenLimitInfo.max} トークンに対して ${tokenLimitInfo.requested} トークンを要求しました。`);
    }
    if (typeof tokenLimitInfo.input === 'number' || typeof tokenLimitInfo.output === 'number') {
      const io = `（入力: ${tokenLimitInfo.input ?? '-'} / 出力: ${tokenLimitInfo.output ?? '-'}）`;
      parts.push(io);
    }
    return {
      summary: '物語の長さが上限を超えました。削除、分岐、要約して新しい物語を作るなど履歴を短くしてください。',
      hint: parts.length ? parts.join(' ') : 'またはより長いコンテキストに対応したモデルへの切り替えを検討してください。',
    };
  }

  // ネットワーク層の失敗
  if (error?.isNetworkError) {
    return {
      summary: "HTTPレスポンスが返ってきませんでした。ベースURLやネットワーク、CORS設定に問題がある可能性があります。",
      hint: "Base URLが正しいか（例: https://openrouter.ai/api/v1）、VPN/プロキシやCORSの影響がないか確認してください。",
    };
  }

  // HTTPステータスからヒント
  const status = error?.status;
  if (status && STATUS_HINTS[status]) {
    return {
      summary: STATUS_HINTS[status],
      hint: `HTTP ${status}${error.statusText ? ` (${error.statusText})` : ""}`,
    };
  }

  // JSONエラー本文に OpenAI 互換の構造がある場合
  const data = error?.data;
  if (data?.error) {
    const e = data.error;
    const parts = [e.message, e.type && `(type: ${e.type})`, e.code && `(code: ${e.code})`].filter(Boolean);
    let metaText;
    if (e.metadata && (Array.isArray(e.metadata.reasons) || e.metadata.flagged_input)) {
      metaText = formatModerationMetadata(e.metadata);
    } else if (e.metadata && (e.metadata.raw != null || e.metadata.provider_name)) {
      metaText = formatProviderMetadata(e.metadata);
    }
    return {
      summary: parts.join(" "),
      hint: "入力や設定を見直して再試行してください。",
      metaText,
    };
  }

  // フォールバック
  const msg = error?.message || "不明なエラーが発生しました";
  return { summary: msg, hint: "入力や設定、ネットワーク状態をご確認ください。" };
}

/**
 * タイムライン（rejectエントリ）向けの統一エラーフォーマッタ
 * - debugMode: true で詳細、false で簡潔。ただし HTTP/モデレーション/プロバイダーは詳細を含む
 * - additional: { userHint, requestPayload, apiResponse, debugInfo }
 */
export function formatErrorForTimeline(error, additional = {}, { debugMode = false } = {}) {
  const base = buildUserFriendlyError(error) || {};

  const isHttp = typeof error?.status === 'number';
  const hasMeta = Boolean(base?.metaText);
  const needsDetailInNonDebug = isHttp || hasMeta;

  const headline = `【エラー】${base.summary || '生成に失敗しました'}`;
  const lines = [headline];

  if (base.hint) {
    lines.push(`【内容】${base.hint}`);
  }

  // Helper: safe stringify with truncation
  const trim = (val, max = 1500) => {
    try {
      const s = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
    } catch {
      const s = String(val ?? "");
      return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
    }
  };

  // Non-debug minimal, but include details for HTTP/moderation/provider
  if (!debugMode) {
    if (hasMeta && base.metaText) {
      lines.push(base.metaText);
    }
    return lines.join('\n');
  }

  // Debug mode: concise but useful details
  if (isHttp) {
    lines.push(`[HTTP] ステータス: ${error.status}${error.statusText ? ` (${error.statusText})` : ''}`);
    if (error.body || error.data) {
      lines.push(`サーバー応答:\n${trim(error.body || error.data)}`);
    }
  }
  if (hasMeta && base.metaText) {
    lines.push(base.metaText);
  }
  if (additional.requestPayload) {
    lines.push(`[リクエスト]\n${trim(additional.requestPayload)}`);
  }
  if (additional.apiResponse) {
    lines.push(`[API応答]\n${trim(additional.apiResponse)}`);
  }
  if (additional.debugInfo) {
    const di = additional.debugInfo;
    lines.push(`[環境] UA: ${di.userAgent} | 画面: ${di.viewport} | 言語: ${di.language} | 時刻: ${di.timestamp}`);
  }
  if (error?.stack) {
    const stack = String(error.stack).split('\n').slice(0, 8).join('\n');
    lines.push(`[スタック]`);
    lines.push(stack);
  }
  return lines.join('\n');
}
