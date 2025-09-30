"""
ファイルアクセス機能モジュール

このモジュールは、plain textファイルの読み書き機能を提供します。
アーキテクチャに従い、バックエンドはplain textファイルの
読み書きのみを担当し、JSONパースやフォーマット処理は
フロントエンドが行います。
"""

import aiofiles
from anyio import to_thread
import os
import tempfile
import portalocker
from pathlib import Path
from typing import Optional
import logging
from .path_utils import get_data_directory, get_backup_directory

# ログ設定
logger = logging.getLogger(__name__)

class FileManager:
    """
    ファイル管理クラス
    
    plain textファイルの安全な読み書きを行います。
    データディレクトリ配下のファイルのみ操作可能です。
    """
    
    def __init__(self):
        """
        FileManagerの初期化
        
        PyInstaller実行時とソースコード実行時の両方に対応したパス解決を使用
        """
        # PyInstaller対応のパス解決を使用
        self.data_dir = get_data_directory()
        self.backup_dir = get_backup_directory()
        
        # 初期化時にデータディレクトリの場所をログに記録
        # 実行環境によっては PyInstaller のバンドル内のパスになることがあるため情報を残す
        logger.info(f"FileManager initialized with data_dir: {self.data_dir}")
        print(f"Data directory: {self.data_dir}")
    
    def _validate_file_path(self, file_path: str) -> Path:
        """
        ファイルパスの妥当性を検証
        
        Args:
            file_path: 検証するファイルパス
            
        Returns:
            Path: 検証済みの絶対パス
            
        Raises:
            ValueError: パスが安全でない場合、または許可されていない拡張子の場合
        """
    # 許可された拡張子のチェック
        allowed_extensions = {'.txt', '.json', '.jsonl'}
        file_extension = Path(file_path).suffix.lower()
        
        if file_extension not in allowed_extensions:
            # 許可されていない拡張子であれば ValueError を発生させ、呼び出し元が 400 を返せるようにする
            raise ValueError(f"File extension '{file_extension}' is not allowed. Allowed extensions: {', '.join(allowed_extensions)}")
        
        # 相対パスをデータディレクトリ配下の絶対パスに変換して返す
        # resolve() を使うことでシンボリックリンクや .. を正規化する
        full_path = (self.data_dir / file_path).resolve()
        
        # データディレクトリ配下にあることを確認（セキュリティ対策）
        # Windows の大文字小文字差異等を考慮し、Path の機能で判定する
        data_root = self.data_dir.resolve()
        # データディレクトリ外へのアクセスを禁止（ディレクトリトラバーサル保護）
        if not full_path.is_relative_to(data_root):
            raise ValueError(f"File path must be within data directory: {file_path}")
        
        return full_path
    
    async def read_file(self, file_path: str) -> Optional[str]:
        """
        ファイルの内容を読み取り
        
        Args:
            file_path: 読み取るファイルのパス（データディレクトリからの相対パス）
            
        Returns:
            str: ファイルの内容（UTF-8）。ファイルが存在しない場合はNone
        """
        try:
            # 入力パスの検証とデータディレクトリへの解決
            full_path = self._validate_file_path(file_path)
            
            # ファイルが存在しない場合はNoneを返す
            # ファイルが存在しない場合は None を返す（フロントが null を期待するため）
            if not full_path.exists():
                logger.info(f"File not found: {file_path}")
                return None
            
            # ファイル読み取り（UTF-8エンコーディング）
            # 非同期ファイル I/O で内容を読み取る。UTF-8 で読み取り。
            async with aiofiles.open(full_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                logger.info(f"Successfully read file: {file_path} ({len(content)} chars)")
                return content
                
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {str(e)}")
            raise
    
    async def write_file(self, file_path: str, content: str) -> bool:
        """
        ファイルに内容を書き込み
        
        Args:
            file_path: 書き込むファイルのパス（データディレクトリからの相対パス）
            content: 書き込む内容
            
        Returns:
            bool: 書き込み成功時はTrue
        """
        try:
            # 書き込み時もパス検証を行い、データディレクトリ配下に限定する
            full_path = self._validate_file_path(file_path)

            # ディレクトリが存在しない場合は作成
            full_path.parent.mkdir(parents=True, exist_ok=True)

            # UTF-8 としてエンコード可能か事前チェック（無効なサロゲート等を検出）
            try:
                data: bytes = content.encode('utf-8', errors='strict')
            except UnicodeEncodeError as ue:
                raise ValueError(f"Content is not valid UTF-8: {ue}") from ue

            # 排他ロック＋テンポラリ書き込み後にアトミック置換
            # - ロックファイル: <path>.lock を使用（同時書き込み防止）
            # - 書き込み: 同一ディレクトリに一時ファイルを作成し、fsync後に os.replace()
            lock_path = str(full_path) + '.lock'

            # バックアップの保存先（元の相対パスのディレクトリ構造を維持）
            rel_path = full_path.relative_to(self.data_dir)
            backup_base_dir = (self.backup_dir / rel_path.parent).resolve()
            backup_base_dir.mkdir(parents=True, exist_ok=True)

            def _write_locked():
                # タイムアウトを設けた排他ロック（10秒）
                with portalocker.Lock(lock_path, mode='w', timeout=10):
                    # 書き換え前に既存ファイルをバックアップ
                    # 既存がある場合のみバックアップを作成
                    if os.path.exists(full_path):
                        try:
                            # タイムスタンプ + 連番のファイル名
                            # 例: original.json -> original.2025-09-28T12-34-56.789Z.json.bak
                            from datetime import datetime, timezone
                            ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S.%fZ')
                            stem = full_path.stem
                            suffix = full_path.suffix or ''
                            backup_name = f"{stem}.{ts}{suffix}.bak"
                            backup_path = backup_base_dir / backup_name
                            # バイナリで安全にコピー（メタデータは不要）
                            with open(full_path, 'rb') as src, open(backup_path, 'wb') as dst:
                                while True:
                                    chunk = src.read(1024 * 1024)
                                    if not chunk:
                                        break
                                    dst.write(chunk)
                            # 回転: 30世代を超えた古いバックアップを削除
                            try:
                                prefix = f"{stem}."
                                suffix_match = f"{suffix}.bak"
                                candidates = [p for p in backup_base_dir.iterdir() if p.is_file() and p.name.startswith(prefix) and p.name.endswith(suffix_match)]
                                # 新しい順にソート（名前にUTCタイムスタンプを含むため辞書順でOK）
                                candidates.sort(reverse=True)
                                for old in candidates[30:]:
                                    try:
                                        old.unlink()
                                    except Exception:
                                        pass
                            except Exception:
                                # 回転失敗は致命的ではないので無視
                                pass
                        except Exception:
                            # バックアップ失敗も致命的ではない（書き込みは継続）
                            pass
                    fd, tmp_path = tempfile.mkstemp(
                        dir=str(full_path.parent),
                        prefix=full_path.name + '.',
                        suffix='.tmp'
                    )
                    try:
                        with os.fdopen(fd, 'wb') as tmpf:
                            tmpf.write(data)
                            tmpf.flush()
                            os.fsync(tmpf.fileno())
                        # アトミックに入れ替え
                        os.replace(tmp_path, full_path)
                    finally:
                        # 念のため一時ファイルの残骸をクリーンアップ
                        try:
                            if os.path.exists(tmp_path):
                                os.remove(tmp_path)
                        except Exception:
                            pass

            # ブロッキングI/Oはスレッドで実行
            await to_thread.run_sync(_write_locked)

            logger.info(f"Successfully wrote file: {file_path} ({len(content)} chars)")
            return True

        except Exception as e:
            logger.error(f"Error writing file {file_path}: {str(e)}")
            raise
    
    async def delete_file(self, file_path: str) -> bool:
        """
        ファイルを削除
        
        Args:
            file_path: 削除するファイルのパス（データディレクトリからの相対パス）
            
        Returns:
            bool: 削除成功時はTrue、ファイルが存在しない場合もTrue
        """
        try:
            # 削除対象パスの検証
            full_path = self._validate_file_path(file_path)
            
            # 存在していればファイルを削除、存在しなくても成功として扱う
            if full_path.exists():
                full_path.unlink()
                logger.info(f"Successfully deleted file: {file_path}")
            else:
                logger.info(f"File already does not exist: {file_path}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error deleting file {file_path}: {str(e)}")
            raise
    
