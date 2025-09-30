/**
 * 物語データの競合検知ユーティリティ
 *
 * このファイルはローカルの状態とリモートの状態を比較して、
 * - 追加されたエントリ
 * - 変更されたエントリ
 * - 削除されたエントリ
 * を検出するユーティリティ関数を提供する。
 */

/**
 * 全体データの変更を検知する
 * @param {Object} currentData - 現在のデータ
 * @param {Object} remoteData - リモートから取得したデータ
 * @returns {Object} 変更検知結果
 */
export function detectAllDataChanges(currentData, remoteData) {
  console.log('detectAllDataChanges: 開始', { currentData, remoteData });
  const result = {
    hasChanges: false,
    storyChanges: null,
    worldViewChanged: false,
    charactersChanged: false,
    settingsChanged: false,
    summary: ''
  };

  const parts = [];

  // 物語エントリの変更を検知（物語の差分は detectStoryChanges に委譲）
  if (currentData.storyEntries && remoteData.storyEntries) {
    console.log('detectAllDataChanges: 物語エントリを比較中');
    const storyChanges = detectStoryChanges(currentData.storyEntries, remoteData.storyEntries);
    console.log('detectAllDataChanges: 物語変更検知結果', storyChanges);
    if (storyChanges.hasChanges) {
      result.storyChanges = storyChanges;
      result.hasChanges = true;
      parts.push(`物語: ${storyChanges.summary}`);
    }
  }

  // 世界観（プレーンテキスト）の変更
  if (currentData.worldView !== remoteData.worldView) {
    result.worldViewChanged = true;
    result.hasChanges = true;
    parts.push('世界観設定');
  }

  // キャラクター配列の比較（簡易比較：JSON 化して比較）
  if (JSON.stringify(currentData.characters) !== JSON.stringify(remoteData.characters)) {
    result.charactersChanged = true;
    result.hasChanges = true;
    parts.push('キャラクター設定');
  }

  // 全体設定の比較
  if (JSON.stringify(currentData.settings) !== JSON.stringify(remoteData.settings)) {
    result.settingsChanged = true;
    result.hasChanges = true;
    parts.push('全体設定');
  }

  if (result.hasChanges) {
    result.summary = parts.join('、');
  }

  console.log('detectAllDataChanges: 最終結果', result);
  return result;
}

/**
 * 物語エントリの変更を検知する
 * @param {Array} currentEntries - 現在のエントリ配列
 * @param {Array} remoteEntries - リモートから取得したエントリ配列
 * @returns {Object} 変更検知結果
 */
export function detectStoryChanges(currentEntries, remoteEntries) {
  const result = {
    hasChanges: false,
    added: [],
    modified: [],
    deleted: [],
    summary: ''
  };

  // 配列を ID をキーにした Map に変換して差分計算を行う
  const currentMap = new Map(currentEntries.map(entry => [entry.id, entry]));
  const remoteMap = new Map(remoteEntries.map(entry => [entry.id, entry]));

  // 追加されたエントリを検出
  for (const [id, entry] of remoteMap) {
    if (!currentMap.has(id)) {
      result.added.push(entry);
      result.hasChanges = true;
    }
  }

  // 削除されたエントリを検出
  for (const [id, entry] of currentMap) {
    if (!remoteMap.has(id)) {
      result.deleted.push(entry);
      result.hasChanges = true;
    }
  }

  // 変更されたエントリを検出
  for (const [id, remoteEntry] of remoteMap) {
    const currentEntry = currentMap.get(id);
    if (currentEntry && isEntryModified(currentEntry, remoteEntry)) {
      result.modified.push({ current: currentEntry, remote: remoteEntry });
      result.hasChanges = true;
    }
  }

  // 人間向けのサマリーを作る
  if (result.hasChanges) {
    const parts = [];
    if (result.added.length > 0) {
      parts.push(`${result.added.length}件の新しいエントリ`);
    }
    if (result.modified.length > 0) {
      parts.push(`${result.modified.length}件の変更されたエントリ`);
    }
    if (result.deleted.length > 0) {
      parts.push(`${result.deleted.length}件の削除されたエントリ`);
    }
    result.summary = parts.join('、');
  }

  return result;
}

/**
 * エントリが変更されているかチェック
 * @param {Object} current - 現在のエントリ
 * @param {Object} remote - リモートのエントリ
 * @returns {boolean} 変更されている場合true
 */
function isEntryModified(current, remote) {
  // 代表的なフィールドの差分をチェックする
  if (current.content !== remote.content) return true;
  if (current.name !== remote.name) return true;
  if (current.type !== remote.type) return true;
  
  // 更新日時があれば比較する（タイムスタンプの変化で検知）
  if (current.updatedAt && remote.updatedAt && current.updatedAt !== remote.updatedAt) {
    return true;
  }
  
  return false;
}

/**
 * 物語の最終更新時刻を計算
 * @param {Array} entries - エントリ配列
 * @returns {string} ISO形式の最終更新時刻
 */
export function getStoryLastModified(entries) {
  if (!entries || entries.length === 0) {
    return new Date(0).toISOString();
  }

  const timestamps = entries
    .map(entry => entry.updatedAt || entry.createdAt)
    .filter(Boolean)
    .map(ts => new Date(ts).getTime());

  if (timestamps.length === 0) {
    return new Date(0).toISOString();
  }

  return new Date(Math.max(...timestamps)).toISOString();
}