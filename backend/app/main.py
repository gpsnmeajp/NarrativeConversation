"""
NARRATIVE_CONVERSATION バックエンドメインサーバー

このアプリケーションは、対話型小説生成アプリのバックエンドサーバーです。
以下の機能を提供します：
1. plain textファイルの読み書き
2. OpenAI互換API（Chat Completions API）への純粋中継
3. フロントエンドの静的ファイル配信
4. 汎用Webhook(JSON POST) の中継（応答本文はサーバーログに記録し、フロントにはステータスコードのみ返却）

アーキテクチャに従い、データのパース・フォーマット・JSON処理は
すべてフロントエンドで行います。
"""

from fastapi import FastAPI, HTTPException, Request
import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel, Field, HttpUrl, field_validator
from typing import Dict, Any, Optional, Mapping
from datetime import datetime, timezone
import json
from json import JSONDecodeError
from urllib.parse import urlparse, urlunparse
import logging
from pathlib import Path
import uvicorn
import sys
import os
import asyncio

# アプリケーション内モジュールのインポート
from .file_manager import FileManager
from .api_client import APIClient
from .middleware import APILoggingMiddleware
from .logger import api_logger

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPIアプリケーション初期化
app = FastAPI(
    title="NARRATIVE_CONVERSATION Backend",
    description="対話型小説生成アプリケーションのバックエンドAPI",
    version="1.0.0"
)

# CORS設定（フロントエンドからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番環境では具体的なドメインを指定
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# APIログミドルウェアを追加
app.add_middleware(APILoggingMiddleware)

# グローバル変数でインスタンスを管理
file_manager = FileManager()
api_client = APIClient()

# アクティブブラウザセッションのオンメモリ管理
app.state.active_browser_session_id = None
app.state.active_browser_updated_at = None

# Incoming Webhook のオンメモリストア
app.state.incoming_webhook_counter = 0
app.state.incoming_webhook_records = []  # 各要素: { id: int, receivedAt: iso8601, data: Any }

# 直前の Chat Completion 結果（オンメモリ）
# 構造: {
#   "req": {"base_url": str, "api_key": str, "payload": Dict[str, Any]},
#   "res": {"status_code": int, "content_type": str, "json": Any|None, "text": str|None},
#   "stored_at": str(ISO8601)
# }
app.state.last_chat_completion_entry = None

# 同一Chatリクエストの併走抑止/待機用の共有状態
# key: base_url + api_key + payload(JSON正規化) で一意化
# 値: {"event": asyncio.Event, "result": Optional[Dict[str, Any]], "created_at": iso8601}
app.state.chat_pending_map = {}
app.state.chat_pending_lock = asyncio.Lock()

def _load_settings_network_timeout_seconds(default: float = 60.0) -> float:
    """settings.json の networkTimeoutSeconds を読み取り、秒を float で返す。エラー時は default。"""
    try:
        from .path_utils import get_data_directory
        settings_path = get_data_directory() / "settings.json"
        if not settings_path.exists():
            return float(default)
        with open(settings_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        v = data.get("networkTimeoutSeconds")
        if isinstance(v, (int, float)) and v >= 0:
            return float(v)
        return float(default)
    except Exception:
        return float(default)

def get_request_id(request: Request) -> Optional[str]:
    """
    リクエストIDを取得（ミドルウェアで設定される）
    
    Args:
        request: HTTPリクエスト
        
    Returns:
        Optional[str]: リクエストID
    """
    return getattr(request.state, 'request_id', None)

# Pydanticモデル定義（リクエスト/レスポンス用）

class FileReadRequest(BaseModel):
    """ファイル読み取りリクエスト"""
    file_path: str = Field(..., description="読み取るファイルのパス（dataディレクトリからの相対パス）")

class FileWriteRequest(BaseModel):
    """ファイル書き込みリクエスト"""
    file_path: str = Field(..., description="書き込むファイルのパス（dataディレクトリからの相対パス）")
    content: str = Field(..., description="書き込む内容（plain text）")

class FileDeleteRequest(BaseModel):
    """ファイル削除リクエスト"""
    file_path: str = Field(..., description="削除するファイルのパス（dataディレクトリからの相対パス）")

class ChatCompletionRequest(BaseModel):
    """Chat Completions API純粋中継リクエスト"""
    base_url: str = Field(..., description="APIのベースURL")
    api_key: str = Field(..., description="APIキー")
    payload: Dict[str, Any] = Field(..., description="フロントエンドからのペイロード（そのまま転送）")

class WebhookPostRequest(BaseModel):
    """任意URLへのJSON POST中継リクエスト"""
    url: HttpUrl = Field(..., description="送信先URL（http/https）")
    payload: Any = Field(..., description="送信するJSONペイロード")
    headers: Optional[Mapping[str, str]] = Field(None, description="追加ヘッダー（任意）")
    timeout: Optional[float] = Field(30.0, description="タイムアウト秒（デフォルト30秒）")

    @field_validator("url")
    def validate_scheme(cls, v: HttpUrl):
        if v.scheme not in ("http", "https"):
            raise ValueError("URL scheme must be http or https")
        return v

# urlparse の型アノテーション回避用ラッパー（Pylance誤検知対策）
def _parse_url(s: str) -> Any:
    return urlparse(s)


def _canonicalize_payload(payload: Dict[str, Any]) -> str:
    """ペイロードをキー生成用に安定ソート・最小区切りでJSON化。"""
    try:
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        # JSON化できない場合はreprでフォールバック
        return repr(payload)


def _make_chat_key(base_url: str, api_key: str, payload: Dict[str, Any]) -> str:
    """chat completion用の一意キーを生成"""
    return f"{(base_url or '').strip()}|{(api_key or '').strip()}|{_canonicalize_payload(payload or {})}"


async def _cleanup_pending_later(key: str, created_at: str, delay: float = 5.0) -> None:
    """待機者が結果を取り終える猶予を置いて pending を掃除。"""
    try:
        await asyncio.sleep(delay)
        async with app.state.chat_pending_lock:
            holder = app.state.chat_pending_map.get(key)
            if holder and holder.get("created_at") == created_at:
                event = holder.get("event")
                if isinstance(event, asyncio.Event) and event.is_set():
                    # 完了済みの古いエントリを削除
                    try:
                        del app.state.chat_pending_map[key]
                    except Exception:
                        pass
    except Exception:
        # クリーンアップ失敗は致命的ではない
        pass


# ===== ブラウザセッション管理 API =====

class ActiveBrowserSetRequest(BaseModel):
    """アクティブブラウザセッション設定リクエスト"""
    session_id: str = Field(..., description="アクティブにするブラウザセッション識別子（非空文字列）")

    @field_validator("session_id")
    def non_empty(cls, v: str):
        if not isinstance(v, str) or not v.strip():
            raise ValueError("session_id must be a non-empty string")
        return v.strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.post("/api/browser/active")
async def set_active_browser(request_data: ActiveBrowserSetRequest, request: Request):
    """
    現在アクティブなブラウザセッションを設定します。

    Body: { "session_id": "<string>" }
    Returns: { "success": true, "session_id": "...", "updated_at": "ISO8601" }
    """
    try:
        app.state.active_browser_session_id = request_data.session_id
        app.state.active_browser_updated_at = datetime.now(timezone.utc)

        response_body = {
            "success": True,
            "session_id": app.state.active_browser_session_id,
            "updated_at": app.state.active_browser_updated_at.isoformat(),
        }

        # レスポンスボディをログ記録
        request_id = get_request_id(request)
        api_logger.log_response_body(
            method=request.method,
            path=str(request.url.path),
            response_body=response_body,
            request_id=request_id,
        )

        return response_body
    except Exception as e:
        logger.error(f"Error setting active browser session: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to set active browser: {str(e)}")


@app.get("/api/browser/active")
async def get_active_browser(request: Request):
    """
    現在のアクティブブラウザセッションを取得します（ポーリング用）。

    Returns: { "active": bool, "session_id": string | null, "updated_at": string | null }
    """
    try:
        session_id = app.state.active_browser_session_id
        updated_at = app.state.active_browser_updated_at
        response_body = {
            "active": bool(session_id),
            "session_id": session_id if session_id else None,
            "updated_at": updated_at.isoformat() if updated_at else None,
        }

        # # レスポンスボディをログ記録
        # request_id = get_request_id(request)
        # api_logger.log_response_body(
        #     method=request.method,
        #     path=str(request.url.path),
        #     response_body=response_body,
        #     request_id=request_id,
        # )

        return response_body
    except Exception as e:
        logger.error(f"Error getting active browser session: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get active browser: {str(e)}")

# ファイル操作エンドポイント

@app.post("/api/files/read")
async def read_file(request_data: FileReadRequest, request: Request):
    """
    ファイル読み取りエンドポイント
    
    指定されたファイルの内容をplain textとして返します。
    許可された拡張子: .txt, .json, .jsonl
    ファイルが存在しない場合はnullを返します。
    """
    try:
        content = await file_manager.read_file(request_data.file_path)
        response_body = {
            "success": True,
            "content": content,
            "file_path": request_data.file_path
        }
        
        # # レスポンスボディをログ記録
        # request_id = get_request_id(request)
        # api_logger.log_response_body(
        #     method=request.method,
        #     path=str(request.url.path),
        #     response_body=response_body,
        #     request_id=request_id
        # )
        
        return response_body
    except ValueError as e:
        # パス検証エラー
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error reading file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

@app.post("/api/files/write")
async def write_file(request_data: FileWriteRequest, request: Request):
    """
    ファイル書き込みエンドポイント
    
    指定されたファイルにplain textの内容を書き込みます。
    許可された拡張子: .txt, .json, .jsonl
    ディレクトリが存在しない場合は自動作成されます。
    """
    try:
        success = await file_manager.write_file(request_data.file_path, request_data.content)
        response_body = {
            "success": success,
            "file_path": request_data.file_path,
            "content_length": len(request_data.content)
        }
        
        # レスポンスボディをログ記録
        request_id = get_request_id(request)
        api_logger.log_response_body(
            method=request.method,
            path=str(request.url.path),
            response_body=response_body,
            request_id=request_id
        )
        
        return response_body
    except ValueError as e:
        # パス検証エラー
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error writing file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to write file: {str(e)}")

@app.post("/api/files/delete")
async def delete_file(request_data: FileDeleteRequest, request: Request):
    """
    ファイル削除エンドポイント
    
    指定されたファイルを削除します。
    許可された拡張子: .txt, .json, .jsonl
    ファイルが存在しない場合でも成功を返します。
    """
    try:
        success = await file_manager.delete_file(request_data.file_path)
        response_body = {
            "success": success,
            "file_path": request_data.file_path
        }
        
        # レスポンスボディをログ記録
        request_id = get_request_id(request)
        api_logger.log_response_body(
            method=request.method,
            path=str(request.url.path),
            response_body=response_body,
            request_id=request_id
        )
        
        return response_body
    except ValueError as e:
        # パス検証エラー
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error deleting file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")



# AI API純粋中継エンドポイント

@app.post("/api/ai/chat/completions")
async def chat_completions(request_data: ChatCompletionRequest, request: Request):
    """
    Chat Completions API純粋中継エンドポイント
    
    フロントエンドからのペイロードをそのままOpenAI互換APIに転送し、
    レスポンスをそのまま返します。
    """
    # セキュリティ: 設定ファイルの Base URL と一致するかを検証
    def _normalize_base_url(u: str) -> str:
        try:
            p = _parse_url(u.strip())
            scheme = (p.scheme or "").lower()
            netloc = (p.netloc or "").lower()
            # 末尾スラッシュは無視して比較
            path = (p.path or "").rstrip("/")
            return urlunparse((scheme, netloc, path, "", "", ""))
        except Exception:
            # パースできない場合は素の文字列で末尾スラッシュのみ正規化
            return (u or "").strip().rstrip("/")

    def _load_settings_base_url() -> Optional[str]:
        try:
            from .path_utils import get_data_directory
            settings_path = get_data_directory() / "settings.json"
            if not settings_path.exists():
                logger.warning("settings.json not found; baseUrl consistency check skipped")
                return None
            with open(settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            base_url = data.get("baseUrl")
            if isinstance(base_url, str) and base_url.strip():
                return base_url
            logger.warning("settings.json missing 'baseUrl'; consistency check skipped")
            return None
        except Exception as e:
            logger.error(f"Failed to read settings.json for baseUrl check: {e}")
            return None

    expected = _load_settings_base_url()
    if expected:
        provided = request_data.base_url
        if _normalize_base_url(provided) != _normalize_base_url(expected):
            logger.error("Security error: baseUrl mismatch", extra={
                "provided": provided,
                "expected": "(hidden)"
            })
            raise HTTPException(status_code=403, detail="Security error: Base URL mismatch")

    key = _make_chat_key(request_data.base_url, request_data.api_key, request_data.payload)
    # すでに同一キーの処理が進行中なら、完了まで待機して結果を共有（重複呼び出しの抑止）
    wait_timeout = _load_settings_network_timeout_seconds(60.0) + 5.0
    async with app.state.chat_pending_lock:
        holder = app.state.chat_pending_map.get(key)
        if holder is not None:
            evt = holder.get("event")
            if isinstance(evt, asyncio.Event) and not evt.is_set():
                event: Optional[asyncio.Event] = evt
            else:
                event = None
        else:
            event = None

    if event is not None:
        try:
            await asyncio.wait_for(event.wait(), timeout=wait_timeout)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Upstream request still in progress (timeout)")

        # 完了後の結果を返す（このブランチは並走の重複だけが通る）
        result = (app.state.chat_pending_map.get(key) or {}).get("result")
        if not result:
            # イベントは完了したが結果がないのは異常
            raise HTTPException(status_code=500, detail="No result available after waiting")

        # last_chat_completion_entry も更新
        # エラーはキャッシュしない
        try:
            status_code_tmp = int(result.get("status_code", 200))
            if status_code_tmp < 400:
                app.state.last_chat_completion_entry = {
                    "req": {
                        "base_url": request_data.base_url,
                        "api_key": request_data.api_key,
                        "payload": request_data.payload,
                    },
                    "res": result,
                    "stored_at": _now_iso(),
                }
        except Exception:
            pass

        status_code = int(result.get("status_code", 200))
        content_type = result.get("content_type") or "application/json"
        headers = {"Content-Type": content_type}
        if result.get("json") is not None:
            return JSONResponse(content=result["json"], status_code=status_code, headers=headers)
        else:
            return Response(content=result.get("text", ""), status_code=status_code, media_type=content_type)

    # ここまで来たら初回リクエスト。pendingを登録して上流呼び出し
    async with app.state.chat_pending_lock:
        # 二重登録防止のため再確認
        if key not in app.state.chat_pending_map:
            app.state.chat_pending_map[key] = {
                "event": asyncio.Event(),
                "result": None,
                "created_at": _now_iso(),
            }
        holder = app.state.chat_pending_map[key]
        event = holder["event"]

    try:
        # ペイロードをそのまま転送し、レスポンスをそのまま返す
        timeout_sec = _load_settings_network_timeout_seconds(60.0)
        upstream = await api_client.chat_completion(
            base_url=request_data.base_url,
            api_key=request_data.api_key,
            payload=request_data.payload,
            timeout=float(timeout_sec),
        )

        # 結果を pending_map に保存し、待機者を解放
        async with app.state.chat_pending_lock:
            holder = app.state.chat_pending_map.get(key)
            if holder is not None:
                holder["result"] = upstream
                holder_event: asyncio.Event = holder["event"]
                holder_event.set()
                try:
                    created_at = holder.get("created_at")
                    if isinstance(created_at, str):
                        asyncio.create_task(_cleanup_pending_later(key, created_at))
                except Exception:
                    pass

        # 直前の結果を保存
        # 成功時のみ直前結果として保存（エラーはキャッシュしない）
        try:
            status_code_tmp = int(upstream.get("status_code", 200))
            if status_code_tmp < 400:
                app.state.last_chat_completion_entry = {
                    "req": {
                        "base_url": request_data.base_url,
                        "api_key": request_data.api_key,
                        "payload": request_data.payload,
                    },
                    "res": upstream,
                    "stored_at": _now_iso(),
                }
        except Exception:
            pass

        # レスポンスボディをログ記録（デバッグのため完全記録）
        request_id = get_request_id(request)
        api_logger.log_response_body(
            method=request.method,
            path=str(request.url.path),
            response_body=upstream,
            request_id=request_id
        )

        # 上流のレスポンスをできるだけそのまま返す
        status_code = int(upstream.get("status_code", 200))
        content_type = upstream.get("content_type") or "application/json"
        headers = {"Content-Type": content_type}

        if upstream.get("json") is not None:
            return JSONResponse(content=upstream["json"], status_code=status_code, headers=headers)
        else:
            return Response(content=upstream.get("text", ""), status_code=status_code, media_type=content_type)

    except httpx.HTTPError as e:
        # 上流との通信エラー
        logger.error(f"HTTP error in chat completion: {str(e)}")
        # 待機者へもエラーを通知できるよう、エラー結果を格納してEventを立てる
        async with app.state.chat_pending_lock:
            holder = app.state.chat_pending_map.get(key)
            if holder is not None:
                holder["result"] = {
                    "status_code": 502,
                    "content_type": "application/json",
                    "json": {"error": f"Upstream request failed: {str(e)}"},
                }
                holder["event"].set()
                try:
                    created_at = holder.get("created_at")
                    if isinstance(created_at, str):
                        asyncio.create_task(_cleanup_pending_later(key, created_at))
                except Exception:
                    pass
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {str(e)}")
    except Exception as e:
        logger.error(f"Error in chat completion: {str(e)}")
        async with app.state.chat_pending_lock:
            holder = app.state.chat_pending_map.get(key)
            if holder is not None:
                holder["result"] = {
                    "status_code": 500,
                    "content_type": "application/json",
                    "json": {"error": f"AI API request failed: {str(e)}"},
                }
                holder["event"].set()
                try:
                    created_at = holder.get("created_at")
                    if isinstance(created_at, str):
                        asyncio.create_task(_cleanup_pending_later(key, created_at))
                except Exception:
                    pass
        raise HTTPException(status_code=500, detail=f"AI API request failed: {str(e)}")
    finally:
        # 後片付け: 結果は残すが、pendingイベントは解除済み。メモリ肥大化防止に古いキーを一定数で整理しても良い（簡易版では残す）。
        pass


# 直前の Chat Completion 結果取得エンドポイント

@app.post("/api/ai/chat/completions/last")
async def get_last_chat_completion(request_data: ChatCompletionRequest, request: Request):
    """
    直前の Chat Completions 結果を取得します。

    - 引数(base_url, api_key, payload)が直前に保存した要求と完全一致する場合のみ、保存済みの結果を返します。
    - 一致しない、または保存が存在しない場合は 204 No Content を返します。
    """
    try:
        entry = getattr(app.state, "last_chat_completion_entry", None)
        key = _make_chat_key(request_data.base_url, request_data.api_key, request_data.payload)
        if not entry:
            # まだ保存済みがない場合、同一キーの処理が進行中なら待機（完了済みは待たない）
            wait_timeout = _load_settings_network_timeout_seconds(60.0) + 5.0
            async with app.state.chat_pending_lock:
                holder = app.state.chat_pending_map.get(key)
                if holder is not None:
                    evt = holder.get("event")
                    can_wait = isinstance(evt, asyncio.Event) and not evt.is_set()
                else:
                    can_wait = False
            if not can_wait:
                return Response(status_code=204)
            try:
                await asyncio.wait_for(holder["event"].wait(), timeout=wait_timeout)  # type: ignore
            except asyncio.TimeoutError:
                return Response(status_code=204)
            upstream = (app.state.chat_pending_map.get(key) or {}).get("result") or {}
        else:
            req = entry.get("req") or {}
            # 完全一致判定（base_url, api_key は文字列の完全一致、payload は dict の構造比較）
            same = (
                req.get("base_url") == request_data.base_url
                and req.get("api_key") == request_data.api_key
                and req.get("payload") == request_data.payload
            )
            if not same:
                # 一致しないが、同一キーの処理が進行中なら待機して返す（完了済みは待たない）
                wait_timeout = _load_settings_network_timeout_seconds(60.0) + 5.0
                async with app.state.chat_pending_lock:
                    holder = app.state.chat_pending_map.get(key)
                    if holder is not None:
                        evt = holder.get("event")
                        can_wait = isinstance(evt, asyncio.Event) and not evt.is_set()
                    else:
                        can_wait = False
                if not can_wait:
                    return Response(status_code=204)
                try:
                    await asyncio.wait_for(holder["event"].wait(), timeout=wait_timeout)  # type: ignore
                except asyncio.TimeoutError:
                    return Response(status_code=204)
                upstream = (app.state.chat_pending_map.get(key) or {}).get("result") or {}
            else:
                upstream = entry.get("res") or {}
        status_code = int(upstream.get("status_code", 200))
        content_type = upstream.get("content_type") or "application/json"
        headers = {"Content-Type": content_type}

        # レスポンスボディをログ記録（デバッグのため）
        request_id = get_request_id(request)
        try:
            api_logger.log_response_body(
                method=request.method,
                path=str(request.url.path),
                response_body=upstream,
                request_id=request_id,
            )
        except Exception:
            pass

        if upstream.get("json") is not None:
            return JSONResponse(content=upstream["json"], status_code=status_code, headers=headers)
        else:
            return Response(content=upstream.get("text", ""), status_code=status_code, media_type=content_type)

    except Exception as e:
        logger.error(f"Error getting last chat completion: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get last chat completion: {str(e)}")


# Outgoing Webhook 中継エンドポイント

@app.post("/api/webhook/post")
async def webhook_post(request_data: WebhookPostRequest, request: Request):
    """
    汎用Outgoing Webhook POST中継エンドポイント

    - 指定URLに対して JSON の POST を行います。
    - 上流のレスポンス本文はサーバーログに記録し、クライアントへはステータスコードのみ返します。
    - セキュリティとして http/https のみ受け付け、settings.json の webhookUrl と一致するURLに限定します。
    - タイムアウトはクライアント指定（既定30秒）。
    """
    # セキュリティ: 設定ファイルの Webhook URL と一致するかを検証
    def _normalize_url(u: str) -> str:
        try:
            p = _parse_url(u.strip())
            scheme = (p.scheme or "").lower()
            netloc = (p.netloc or "").lower()
            # 末尾スラッシュは無視して比較（クエリ/フラグメントは無視）
            path = (p.path or "").rstrip("/")
            return urlunparse((scheme, netloc, path, "", "", ""))
        except Exception:
            return (u or "").strip().rstrip("/")

    def _load_settings_webhook_url() -> Optional[str]:
        try:
            from .path_utils import get_data_directory
            settings_path = get_data_directory() / "settings.json"
            if not settings_path.exists():
                logger.warning("settings.json not found; webhookUrl consistency check skipped")
                return None
            with open(settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            webhook_url = data.get("webhookUrl")
            if isinstance(webhook_url, str) and webhook_url.strip():
                return webhook_url
            logger.warning("settings.json missing 'webhookUrl'; consistency check skipped")
            return None
        except Exception as e:
            logger.error(f"Failed to read settings.json for webhookUrl check: {e}")
            return None

    expected = _load_settings_webhook_url()
    if expected:
        provided = str(request_data.url)
        if _normalize_url(provided) != _normalize_url(expected):
            logger.error(
                "Security error: webhookUrl mismatch",
                extra={"provided": provided, "expected": "(hidden)"},
            )
            raise HTTPException(status_code=403, detail="Security error: Webhook URL mismatch")

    try:
        default_timeout = _load_settings_network_timeout_seconds(30.0)
        upstream = await api_client.post_webhook(
            url=str(request_data.url),
            payload=request_data.payload,
            headers=dict(request_data.headers) if request_data.headers else None,
            timeout=float(request_data.timeout or default_timeout),
        )

        # レスポンスボディをログ記録
        request_id = get_request_id(request)
        api_logger.log_response_body(
            method=request.method,
            path=str(request.url.path),
            response_body=upstream,
            request_id=request_id,
        )

        # フロントエンドには本文を返さず、ステータスコードのみ返す
        status_code = int(upstream.get("status_code", 200))
        return Response(status_code=status_code)

    except httpx.HTTPError as e:
        logger.error(f"HTTP error in webhook post: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {str(e)}")
    except Exception as e:
        logger.error(f"Error in webhook post: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Webhook request failed: {str(e)}")


# Incoming Webhook 受信エンドポイント（GET/POST）

def _load_enable_incoming_webhook_flag() -> bool:
    """settings.json の enableIncomingWebhook を読み取り、有効かどうか返す。既定は False。"""
    try:
        from .path_utils import get_data_directory
        settings_path = get_data_directory() / "settings.json"
        if not settings_path.exists():
            logger.warning("settings.json not found; enableIncomingWebhook check defaults to False")
            return False
        with open(settings_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        val = data.get("enableIncomingWebhook")
        return bool(val) is True and val is True
    except Exception as e:
        logger.error(f"Failed to read settings.json for enableIncomingWebhook check: {e}")
        return False


def _query_params_to_json(q: Any) -> Dict[str, Any]:
    """QueryParams (multi-dict) を JSON 風の dict に変換。重複キーは配列にする。"""
    try:
        # Starlette QueryParams 互換: getlist を使う
        result: Dict[str, Any] = {}
        keys = set(q.keys()) if hasattr(q, "keys") else set(list(q))
        for k in keys:
            getlist = getattr(q, "getlist", None)
            if callable(getlist):
                values = getlist(k)
            else:
                # getattr fallback to .get
                values = q.get(k) if hasattr(q, "get") else None
            if isinstance(values, list):
                if len(values) == 1:
                    result[k] = values[0]
                else:
                    result[k] = values
            else:
                result[k] = values
        return result
    except Exception:
        # フォールバック: そのまま dict() 化を試みる
        try:
            return dict(q)
        except Exception:
            return {}


@app.api_route("/webhook", methods=["GET", "POST"])
async def incoming_webhook(request: Request):
    """
    Incoming Webhook 受信エンドポイント

    - GET: クエリパラメータを JSON 構造に変換して受け入れる
    - POST: JSON ボディをそのまま受け入れる（JSON 以外は 400）
    - 受け入れたデータはオンメモリのリングバッファに記録する（最大30件）
    - 同一内容でも、受信日時とインクリメントカウンタで識別可能
    - settings.json の enableIncomingWebhook が True の場合のみ受け入れ
    """
    # セキュリティ: 設定で無効なら拒否
    if not _load_enable_incoming_webhook_flag():
        raise HTTPException(status_code=403, detail="Incoming Webhook is disabled by settings")

    # データ抽出
    data: Any
    if request.method == "GET":
        data = _query_params_to_json(request.query_params)
    else:  # POST
        try:
            data = await request.json()
        except JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse JSON body: {e}")

    # 記録（最大30件保持）
    app.state.incoming_webhook_counter += 1
    record = {
        "id": app.state.incoming_webhook_counter,
        "receivedAt": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    app.state.incoming_webhook_records.append(record)
    if len(app.state.incoming_webhook_records) > 30:
        # 古いものから削除（最大30件）
        app.state.incoming_webhook_records = app.state.incoming_webhook_records[-30:]

    # レスポンス: 受理情報のみ返す
    return JSONResponse({
        "success": True,
        "id": record["id"],
        "receivedAt": record["receivedAt"],
        "size": len(app.state.incoming_webhook_records),
    })


@app.get("/api/webhook/incoming")
async def list_incoming_webhook(request: Request):
    """
    Incoming Webhook の受信状況をポーリングするエンドポイント。

    Query:
      - limit: 返す最大件数（1〜30、既定30）
      - sinceId: このIDより大きいIDのレコードのみ返す（任意）

    Response:
      {
        enabled: bool,
        size: number,      # 現在保持している件数
        maxSize: 30,
        lastId: number|null,
        lastReceivedAt: string|null,
        records: Array<{ id, receivedAt, data }>
      }
    """
    enabled = _load_enable_incoming_webhook_flag()
    # disabled の場合でも、メタ情報は返す（records は空）

    # パラメータ取り出し
    qp = request.query_params
    try:
        limit_raw = qp.get("limit") if hasattr(qp, "get") else None
        limit = int(limit_raw) if (limit_raw is not None and str(limit_raw).strip()) else 30
    except Exception:
        limit = 30
    limit = max(1, min(30, limit))

    try:
        since_raw = qp.get("sinceId") if hasattr(qp, "get") else None
        since_id = int(since_raw) if (since_raw is not None and str(since_raw).strip()) else None
    except Exception:
        since_id = None

    records = []
    if enabled:
        all_recs = app.state.incoming_webhook_records or []
        if since_id is not None:
            filtered = [r for r in all_recs if isinstance(r.get("id"), int) and r["id"] > since_id]
        else:
            filtered = list(all_recs)
        records = filtered[-limit:]

    size = len(app.state.incoming_webhook_records or [])
    last = app.state.incoming_webhook_records[-1] if size > 0 else None

    body = {
        "enabled": enabled,
        "size": size,
        "maxSize": 30,
        "lastId": (last.get("id") if last else None),
        "lastReceivedAt": (last.get("receivedAt") if last else None),
        "records": records,
    }

    # レスポンスログ（軽量メタのみ）
    request_id = get_request_id(request)
    api_logger.log_response_body(
        method=request.method,
        path=str(request.url.path),
        response_body={k: body[k] for k in ("enabled","size","maxSize","lastId","lastReceivedAt")},
        request_id=request_id,
    )

    return JSONResponse(body)


# ヘルスチェックエンドポイント

@app.get("/api/health")
async def health_check(request: Request):
    """
    ヘルスチェックエンドポイント
    
    サーバーの稼働状況を確認します。
    """
    response_body = {
        "status": "healthy",
        "service": "NARRATIVE_CONVERSATION Backend",
        "version": "1.0.0"
    }
    
    # # レスポンスボディをログ記録
    # request_id = get_request_id(request)
    # api_logger.log_response_body(
    #     method=request.method,
    #     path=str(request.url.path),
    #     response_body=response_body,
    #     request_id=request_id
    # )
    
    return response_body

# 静的ファイル配信設定

# フロントエンドの静的ファイルを配信
def get_frontend_path():
    """PyInstaller実行時とソースコード実行時の両方に対応したフロントエンドパスを取得"""
    if getattr(sys, 'frozen', False):
        # PyInstallerで実行ファイル化されている場合
        # sys._MEIPASS は PyInstaller が展開した一時フォルダのパス
        bundle_dir = Path(getattr(sys, '_MEIPASS'))
        frontend_path = bundle_dir / "frontend"
        logger.info(f"PyInstaller mode: bundle_dir={bundle_dir}")
    else:
        # 通常のPython実行の場合
        frontend_path = Path(__file__).parent.parent.parent / "frontend"
        logger.info(f"Development mode: source directory")
    
    return frontend_path

frontend_path = get_frontend_path()
logger.info(f"Resolved frontend path: {frontend_path}")

if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
    logger.info(f"Frontend files served from: {frontend_path}")
else:
    logger.warning(f"Frontend directory not found: {frontend_path}")
    # フロントエンドファイルの一覧を確認（デバッグ用）
    if hasattr(sys, '_MEIPASS'):
        logger.info(f"Available files in bundle: {list(Path(getattr(sys, '_MEIPASS')).iterdir())}")
    else:
        parent_dir = frontend_path.parent
        if parent_dir.exists():
            logger.info(f"Available files in parent directory: {list(parent_dir.iterdir())}")

# ルートパスでindex.htmlを配信
@app.get("/")
async def serve_index():
    """
    ルートパスでindex.htmlを配信
    
    フロントエンドのメインページを返します。
    """
    current_frontend_path = get_frontend_path()
    index_file = current_frontend_path / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    else:
        return JSONResponse(
            status_code=404,
            content={"message": "Frontend not found. Please build the frontend first."}
        )

# エラーハンドラー

@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    """
    404エラーハンドラー
    
    存在しないパスへのアクセス時の処理
    """
    return JSONResponse(
        status_code=404,
        content={
            "message": "Endpoint not found",
            "path": str(request.url.path)
        }
    )

@app.exception_handler(500)
async def internal_error_handler(request: Request, exc):
    """
    500エラーハンドラー
    
    内部サーバーエラー時の処理
    """
    logger.error(f"Internal server error: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "message": "Internal server error",
            "detail": str(exc)
        }
    )

# アプリケーション起動設定

if __name__ == "__main__":
    # 開発モードでサーバー起動
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 開発時のホットリロード
        log_level="info"
    )