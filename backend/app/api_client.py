"""
OpenAI互換API中継機能および汎用Webhook中継

このモジュールは、
- Chat Completions API への純粋な中継
- 任意のURLへのJSON POST(Webhook) の中継
を提供します。
"""

import httpx
from typing import Dict, Any, Optional

class APIClient:
    """
    OpenAI互換API純粋中継クライアント
    
    フロントエンドからのペイロードをそのまま転送します。
    """
    
    async def chat_completion(
        self,
        base_url: str,
        api_key: str,
        payload: Dict[str, Any],
        timeout: float = 60.0,
    ) -> Dict[str, Any]:
        """
        Chat Completions APIへの純粋な中継

        Args:
            base_url: APIのベースURL
            api_key: APIキー
            payload: フロントエンドからのペイロード（そのまま転送）
            timeout: タイムアウト秒（既定60秒）
        Returns:
            Dict[str, Any]: APIからのレスポンス（そのまま）
        """
        # base_url が末尾にスラッシュを含まない場合は追加しておく。
        # これにより f-string で endpoint を生成する際の二重スラッシュや欠落を防ぐ。
        if not base_url.endswith('/'):
            base_url += '/'
        endpoint = f"{base_url}chat/completions"

        # リクエストヘッダーを組み立てる。
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/gpsnmeajp/NarrativeConversation",
            "X-Title": "NarrativeConversation",
        }

        # Async HTTP クライアントを用いて POST リクエストを送信する。
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                endpoint,
                json=payload,
                headers=headers,
            )

        # 外部のレスポンスをできるだけそのまま返すため、ステータスで例外は投げない
        status_code = response.status_code
        content_type = response.headers.get("content-type", "")

        # JSONならパース、そうでなければテキストとして返す
        body_json: Any | None = None
        body_text: str | None = None
        if "application/json" in content_type.lower():
            try:
                body_json = response.json()
            except Exception:
                # JSONと宣言されているがパースできない場合は生テキスト
                body_text = response.text

        if body_json is None:
            body_text = response.text

        return {
            "status_code": status_code,
            "content_type": content_type,
            "json": body_json,
            "text": body_text,
        }

    async def post_webhook(
        self,
        url: str,
        payload: Any,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """
        汎用Outgoing Webhook POST 中継

        Args:
            url: 送信先URL（http/https）
            payload: JSONとして送信するペイロード
            headers: 追加ヘッダー（Content-Typeは自動でapplication/jsonを設定）
            timeout: タイムアウト秒

        Returns:
            Dict[str, Any]: 上流のレスポンス（status_code, content_type, json/text）
        """
        send_headers = {
            "Content-Type": "application/json",
        }
        if headers:
            # ユーザー指定が優先
            send_headers.update(headers)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=send_headers)

            status_code = response.status_code
            content_type = response.headers.get("content-type", "")

            body_json: Any | None = None
            body_text: str | None = None
            if "application/json" in content_type.lower():
                try:
                    body_json = response.json()
                except Exception:
                    body_text = response.text
            if body_json is None:
                body_text = response.text

            return {
                "status_code": status_code,
                "content_type": content_type,
                "json": body_json,
                "text": body_text,
            }