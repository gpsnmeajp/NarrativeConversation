"""
ログ設定モジュール

バックエンドの全てのAPIリクエスト・レスポンスを日付別のログファイルに記録します。
"""

import logging
from datetime import datetime
from pathlib import Path
import json
from typing import Any, Dict, Optional
from logging.handlers import TimedRotatingFileHandler
from .path_utils import get_logs_directory

class APILogger:
    """
    API要求・応答ログクラス
    
    全てのAPIエンドポイントの要求と応答を日付別のログファイルに記録します。
    """
    
    def __init__(self):
        """
        APILoggerの初期化
        
        PyInstaller実行時とソースコード実行時の両方に対応したパス解決を使用
        """
        # PyInstaller対応のパス解決を使用
        self.log_dir = get_logs_directory()
        
        # API専用ロガーの設定
        self.api_logger = logging.getLogger("api_requests")
        self.api_logger.setLevel(logging.INFO)
        
        # 既存のハンドラーをクリア
        self.api_logger.handlers.clear()
        
        # 日付別ローテートファイルハンドラーの設定
        log_file = self.log_dir / "api_requests.log"
        file_handler = TimedRotatingFileHandler(
            filename=str(log_file),
            when='midnight',
            interval=1,
            backupCount=3,  # 3日分保持
            encoding='utf-8'
        )
        
        # ログフォーマット設定
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(formatter)
        
        # ハンドラーを追加
        self.api_logger.addHandler(file_handler)
        
        # プロパゲートを無効にして重複を防ぐ
        self.api_logger.propagate = False
        
        print(f"API Logger initialized - Log directory: {self.log_dir}")
    
    def log_request(
        self,
        method: str,
        path: str,
        client_ip: str,
        request_data: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None
    ) -> None:
        """
        APIリクエストをログに記録
        
        Args:
            method: HTTPメソッド
            path: リクエストパス
            client_ip: クライアントIPアドレス
            request_data: リクエストデータ（辞書形式）
            request_id: リクエストID
        """
        try:
            # GET メソッドは記録しない（ログ削減）
            if isinstance(method, str) and method.upper() == "GET":
                return
            # ログに記録するためのエントリを組み立てる。
            # type フィールドでリクエスト/レスポンス/エラー等を区別する。
            log_entry = {
                "type": "REQUEST",
                "request_id": request_id,
                "method": method,
                "path": path,
                "client_ip": client_ip,
                "timestamp": datetime.now().isoformat(),
                "data": request_data
            }
            
            # JSON として整形してログ出力（ensure_ascii=False により日本語も可）
            log_message = json.dumps(log_entry, ensure_ascii=False, separators=(',', ':'))
            self.api_logger.info(log_message)
            
        except Exception as e:
            # ログ記録エラーは標準ログに出力
            logging.error(f"Failed to log request: {str(e)}")
    
    def log_response(
        self,
        method: str,
        path: str,
        status_code: int,
        response_data: Optional[Dict[str, Any]] = None,
        processing_time_ms: Optional[float] = None,
        request_id: Optional[str] = None
    ) -> None:
        """
        APIレスポンスをログに記録
        
        Args:
            method: HTTPメソッド
            path: リクエストパス
            status_code: HTTPステータスコード
            response_data: レスポンスデータ（辞書形式）
            processing_time_ms: 処理時間（ミリ秒）
            request_id: リクエストID
        """
        try:
            # GET メソッドは記録しない（ログ削減）
            if isinstance(method, str) and method.upper() == "GET":
                return
            # レスポンスに関する情報をログエントリにまとめる
            log_entry = {
                "type": "RESPONSE",
                "request_id": request_id,
                "method": method,
                "path": path,
                "status_code": status_code,
                "processing_time_ms": processing_time_ms,
                "timestamp": datetime.now().isoformat(),
                "data": response_data
            }
            
            # JSONとして整形してログ出力
            log_message = json.dumps(log_entry, ensure_ascii=False, separators=(',', ':'))
            self.api_logger.info(log_message)
            
        except Exception as e:
            # ログ記録エラーは標準ログに出力
            logging.error(f"Failed to log response: {str(e)}")
    
    def log_error(
        self,
        method: str,
        path: str,
        error_message: str,
        status_code: int = 500,
        error_details: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None
    ) -> None:
        """
        APIエラーをログに記録
        
        Args:
            method: HTTPメソッド
            path: リクエストパス
            error_message: エラーメッセージ
            status_code: HTTPステータスコード
            error_details: エラー詳細情報
            request_id: リクエストID
        """
        try:
            # エラー情報をまとめてログ出力
            log_entry = {
                "type": "ERROR",
                "request_id": request_id,
                "method": method,
                "path": path,
                "status_code": status_code,
                "error_message": error_message,
                "error_details": error_details,
                "timestamp": datetime.now().isoformat()
            }
            
            # JSONとして整形してログ出力
            log_message = json.dumps(log_entry, ensure_ascii=False, separators=(',', ':'))
            self.api_logger.error(log_message)
            
        except Exception as e:
            # ログ記録エラーは標準ログに出力
            logging.error(f"Failed to log error: {str(e)}")
    
    def log_response_body(
        self,
        method: str,
        path: str,
        response_body: Any,
        request_id: Optional[str] = None
    ) -> None:
        """
        レスポンスボディを詳細ログに記録
        
        Args:
            method: HTTPメソッド
            path: リクエストパス
            response_body: レスポンスボディデータ
            request_id: リクエストID
        """
        try:
            # GET メソッドは記録しない（ログ削減）
            if isinstance(method, str) and method.upper() == "GET":
                return
            # レスポンスボディをログに記録するためのエントリを作成
            # 大きなボディは出力量に注意が必要だが、デバッグ用途で有益
            log_entry = {
                "type": "RESPONSE_BODY",
                "request_id": request_id,
                "method": method,
                "path": path,
                "timestamp": datetime.now().isoformat(),
                "body": response_body
            }
            
            # JSONとして整形してログ出力
            log_message = json.dumps(log_entry, ensure_ascii=False, separators=(',', ':'))
            self.api_logger.info(log_message)
            
        except Exception as e:
            # ログ記録エラーは標準ログに出力
            logging.error(f"Failed to log response body: {str(e)}")

# グローバルなAPIロガーインスタンス
api_logger = APILogger()