#!/usr/bin/env python3
"""
NARRATIVE_CONVERSATION バックエンドサーバー起動スクリプト

このスクリプトは開発・本番環境でバックエンドサーバーを起動します。
環境変数または引数でポート番号を指定できます。
"""

import uvicorn
import argparse
import os
import sys

# PyInstallerでの実行を考慮してappモジュールを直接インポート
try:
    from app.main import app
except ImportError:
    # 通常の実行環境での後方互換性
    app = None

def is_pyinstaller():
    """PyInstallerでの実行かどうかを判定"""
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')

def main():
    """
    サーバー起動のメイン関数
    """
    # 引数パーサー設定
    parser = argparse.ArgumentParser(description="NARRATIVE_CONVERSATION Backend Server")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host address to bind (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port number to bind (default: 8000)"
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development (default: False)"
    )
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["critical", "error", "warning", "info", "debug"],
        help="Log level (default: info)"
    )
    parser.add_argument(
        "--no-access-log",
        action="store_true",
        help="Disable Uvicorn access log (default: False)"
    )
    
    args = parser.parse_args()
    
    # 環境変数から設定を取得（引数で上書き可能）
    host = os.getenv("HOST", args.host)
    port = int(os.getenv("PORT", str(args.port)))
    log_level = os.getenv("LOG_LEVEL", args.log_level)
    
    # 開発環境の判定
    is_development = args.reload or os.getenv("ENVIRONMENT") == "development"
    
    print(f"Starting NARRATIVE_CONVERSATION Backend Server...")
    print(f"Host: {host}")
    print(f"Port: {port}")
    print(f"Log Level: {log_level}")
    print(f"Reload: {is_development}")
    print(f"Access Log: {not args.no_access_log}")
    print("-" * 50)
    
    # サーバー起動
    try:
        if is_pyinstaller():
            # PyInstallerでの実行時は直接appオブジェクトを渡す
            print("Running with embedded app instance (PyInstaller)")
            if app is None:
                print("Error: App instance not available in PyInstaller mode")
                sys.exit(1)
            uvicorn.run(
                app,
                host=host,
                port=port,
                reload=is_development,
                log_level=log_level,
                access_log=not args.no_access_log
            )
        else:
            # 通常の実行環境では文字列指定
            print("Running in normal mode")
            uvicorn.run(
                "app.main:app",
                host=host,
                port=port,
                reload=is_development,
                log_level=log_level,
                access_log=not args.no_access_log
            )
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()