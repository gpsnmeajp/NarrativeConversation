"""
API ログミドルウェア

全てのAPIリクエスト・レスポンスを自動的にログに記録するミドルウェアです。
"""

import time
import uuid
import json
import copy
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Callable

from .logger import api_logger

class APILoggingMiddleware(BaseHTTPMiddleware):
    """
    API要求・応答ログミドルウェア
    
    全てのHTTPリクエスト・レスポンスを自動的にログファイルに記録します。
    """
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        リクエスト・レスポンスの処理とログ記録
        
        Args:
            request: HTTPリクエスト
            call_next: 次のミドルウェア/エンドポイント
            
        Returns:
            Response: HTTPレスポンス
        """
        # リクエストIDを生成
        request_id = str(uuid.uuid4())
        
        # リクエストIDをstateに保存（エンドポイントで使用可能にする）
        request.state.request_id = request_id
        
        # 処理開始時刻
        start_time = time.time()
        
        # クライアントIPアドレス取得
        client_ip = self._get_client_ip(request)
        
        # リクエストデータを取得（ボディやヘッダ、クエリ等）
        request_data = await self._get_request_data(request)
        
        # リクエストログ記録
        api_logger.log_request(
            method=request.method,
            path=str(request.url.path),
            client_ip=client_ip,
            request_data=request_data,
            request_id=request_id
        )
        
        try:
            # 次のミドルウェア/エンドポイントを実行
            response = await call_next(request)
            
            # 処理時間計算
            processing_time_ms = (time.time() - start_time) * 1000
            
            # レスポンスデータを取得（ヘッダー情報のみ）
            response_data = {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "content_type": response.headers.get("content-type", ""),
                "note": "Response body will be logged by endpoint if applicable"
            }
            
            # レスポンスログ記録
            api_logger.log_response(
                method=request.method,
                path=str(request.url.path),
                status_code=response.status_code,
                response_data=response_data,
                processing_time_ms=processing_time_ms,
                request_id=request_id
            )
            
            return response
            
        except Exception as e:
            # 処理時間計算
            processing_time_ms = (time.time() - start_time) * 1000
            
            # エラーログ記録
            api_logger.log_error(
                method=request.method,
                path=str(request.url.path),
                error_message=str(e),
                status_code=500,
                error_details={
                    "exception_type": type(e).__name__,
                    "processing_time_ms": processing_time_ms
                },
                request_id=request_id
            )
            
            # エラーを再発生
            raise
    
    def _get_client_ip(self, request: Request) -> str:
        """
        クライアントIPアドレスを取得
        
        Args:
            request: HTTPリクエスト
            
        Returns:
            str: クライアントIPアドレス
        """
        # プロキシ経由の場合のヘッダーをチェック
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        # 直接接続の場合
        return str(request.client.host) if request.client else "unknown"
    
    async def _get_request_data(self, request: Request) -> dict:
        """
        リクエストデータを取得
        
        Args:
            request: HTTPリクエスト
            
        Returns:
            dict: リクエストデータ
        """
        try:
            data = {
                "query_params": dict(request.query_params),
                "headers": dict(request.headers),
                "path_params": request.path_params
            }
            
            # リクエストボディがある場合は取得
            if request.method in ["POST", "PUT", "PATCH"]:
                content_type = request.headers.get("content-type", "")
                
                if "application/json" in content_type:
                    # JSONボディを取得
                    body = await request.body()
                    if body:
                        try:
                            data["body"] = json.loads(body.decode("utf-8"))
                        except json.JSONDecodeError:
                            data["body"] = {"raw": body.decode("utf-8", errors="ignore")}
                elif "application/x-www-form-urlencoded" in content_type:
                    # フォームデータを取得
                    form = await request.form()
                    data["body"] = dict(form)
                else:
                    # その他のコンテンツタイプ
                    body = await request.body()
                    if body:
                        data["body"] = {"raw": body.decode("utf-8", errors="ignore")[:1000]}  # 最初の1000文字のみ
            
            # センシティブな情報をマスク
            data = self._mask_sensitive_data(data)
            
            return data
            
        except Exception as e:
            return {"error": f"Failed to parse request data: {str(e)}"}
    

    
    def _mask_sensitive_data(self, data: dict) -> dict:
        """
        センシティブなデータをマスク
        
        Args:
            data: 元のデータ
            
        Returns:
            dict: マスク済みデータ
        """
        try:
            # ディープコピーを作成してマスク処理
            masked_data = copy.deepcopy(data)
            
            # センシティブなキーのリスト
            sensitive_keys = [
                "api_key", "apikey", "api-key",
                "password", "passwd", "pwd",
                "token", "authorization",
                "secret", "private_key", "private-key"
            ]
            
            def mask_dict(d):
                if isinstance(d, dict):
                    for key, value in d.items():
                        if isinstance(key, str) and any(sensitive in key.lower() for sensitive in sensitive_keys):
                            d[key] = "***MASKED***"
                        elif isinstance(value, (dict, list)):
                            mask_dict(value)
                elif isinstance(d, list):
                    for item in d:
                        mask_dict(item)
            
            mask_dict(masked_data)
            return masked_data
            
        except Exception:
            # マスク処理でエラーが発生した場合は安全な情報のみ返す
            return {"error": "Failed to mask sensitive data"}