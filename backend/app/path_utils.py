"""
パス解決ユーティリティ

PyInstaller実行時とソースコード実行時の両方に対応したパス解決を提供します。
"""

import sys
from pathlib import Path

def get_app_directory() -> Path:
    """
    アプリケーションのベースディレクトリを取得
    
    PyInstaller実行時: exeファイルがある場所
    ソースコード実行時: プロジェクトルート
    
    Returns:
        Path: アプリケーションのベースディレクトリ
    """
    if getattr(sys, 'frozen', False):
        # PyInstallerで実行ファイル化されている場合
        # sys.executable は exe ファイルのパスを返す
        return Path(sys.executable).parent
    else:
        # 通常のPython実行の場合（開発時）
        # このファイルの位置から相対的にプロジェクトルートを計算
        return Path(__file__).parent.parent.parent

def get_data_directory() -> Path:
    """
    データディレクトリのパスを取得
    
    Returns:
        Path: データディレクトリのパス
    """
    app_dir = get_app_directory()
    data_dir = app_dir / "data"
    data_dir.mkdir(exist_ok=True)
    return data_dir

def get_logs_directory() -> Path:
    """
    ログディレクトリのパスを取得
    
    Returns:
        Path: ログディレクトリのパス
    """
    app_dir = get_app_directory()
    logs_dir = app_dir / "logs"
    logs_dir.mkdir(exist_ok=True)
    return logs_dir

def get_backup_directory() -> Path:
    """
    バックアップディレクトリのパスを取得

    Returns:
        Path: バックアップディレクトリのパス（app_dir/backups）
    """
    app_dir = get_app_directory()
    backup_dir = app_dir / "backups"
    backup_dir.mkdir(exist_ok=True)
    return backup_dir