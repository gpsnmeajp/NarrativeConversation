// constants/entryActions.js
// エントリー操作メニューのアクション定義を一元管理

/**
 * アクションの配列（キーとラベル）
 * 他のモジュール（storyEntry.js, entryHandlers.js）から参照されます。
 */
export const entryActions = [
  { key: 'edit', label: '編集' },
  { key: 'insertBefore', label: '前に挿入' },
  { key: 'insertAfter', label: '後に挿入' },
  { key: 'delete', label: '削除' },
  { key: 'deleteAllAfter', label: 'これより後の項目をすべて削除' },
  { key: 'branchFromHere', label: 'ここから分岐して別の物語ファイルにブランチを作成' },
  { key: 'animateFromHere', label: 'ここからアニメーションを開始' },
];
