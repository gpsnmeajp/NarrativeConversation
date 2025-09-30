/**
 * 物語競合確認モーダル
 */

import { showModal, closeModal } from './modal.js';

/**
 * 全体データの変更検知時に確認モーダルを表示
 * @param {Object} changes - 変更検知結果
 * @returns {Promise<boolean>} ユーザーが継続を選択した場合true
 */
export function showConflictConfirmModal(changes) {
  return new Promise((resolve) => {
    const modalContent = createConflictModalContent(changes, resolve);
    const title = changes.storyChanges ? '⚠️ 他の端末からの変更を検知' : '⚠️ 設定の変更を検知';
    showModal({
      title: title,
      content: modalContent,
      showCloseButton: false // Xボタンを非表示（明示的な選択を強制）
    });
  });
}

/**
 * 競合確認モーダルの内容を作成
 * @param {Object} changes - 変更検知結果
 * @param {Function} resolve - Promise解決関数
 * @returns {HTMLElement} モーダル内容
 */
function createConflictModalContent(changes, resolve) {
  const container = document.createElement('div');
  container.className = 'conflict-modal-content';
  
  const message = document.createElement('div');
  message.className = 'conflict-message';
  
  let changesHtml = '<p>他の端末で以下の変更が加えられています：</p><ul class="conflict-changes">';
  
  // 物語エントリの変更
  if (changes.storyChanges) {
    const story = changes.storyChanges;
    if (story.added.length > 0) {
      changesHtml += `<li>📝 ${story.added.length}件の新しいエントリが追加されました</li>`;
    }
    if (story.modified.length > 0) {
      changesHtml += `<li>✏️ ${story.modified.length}件のエントリが変更されました</li>`;
    }
    if (story.deleted.length > 0) {
      changesHtml += `<li>🗑️ ${story.deleted.length}件のエントリが削除されました</li>`;
    }
  }
  
  // その他の変更
  if (changes.worldViewChanged) {
    changesHtml += '<li>🌍 世界観設定が変更されました</li>';
  }
  if (changes.charactersChanged) {
    changesHtml += '<li>👥 キャラクター設定が変更されました</li>';
  }
  if (changes.settingsChanged) {
    changesHtml += '<li>⚙️ 全体設定が変更されました</li>';
  }
  
  changesHtml += '</ul>';
  changesHtml += `<p class="conflict-warning">
    <strong>続行すると、他の端末での変更を上書きする可能性があります。</strong>
  </p>`;
  
  message.innerHTML = changesHtml;
  
  const actions = document.createElement('div');
  actions.className = 'conflict-actions';
  
  const reloadButton = document.createElement('button');
  reloadButton.className = 'btn btn-primary';
  reloadButton.textContent = '最新版を読み込み直す（推奨）';
  reloadButton.onclick = () => {
    // ボタンを無効化して重複クリックを防止
    reloadButton.disabled = true;
    continueButton.disabled = true;
    reloadButton.textContent = '読み込み中...';
    
    closeModal(); // モーダルを閉じる
    resolve(false); // 処理を中断して再読み込み
  };
  
  const continueButton = document.createElement('button');
  continueButton.className = 'btn btn-danger';
  continueButton.textContent = '変更を上書きして続行';
  continueButton.onclick = () => {
    // ボタンを無効化して重複クリックを防止
    reloadButton.disabled = true;
    continueButton.disabled = true;
    continueButton.textContent = '続行中...';
    
    closeModal(); // モーダルを閉じる
    resolve(true); // 処理を続行
  };
  
  actions.appendChild(reloadButton);
  actions.appendChild(continueButton);
  
  container.appendChild(message);
  container.appendChild(actions);
  
  return container;
}

/**
 * 変更詳細を表示するモーダル
 * @param {Object} changes - 変更検知結果
 */
export function showChangesDetailModal(changes) {
  const modalContent = createChangesDetailContent(changes);
  showModal({
    title: '他端末からの変更詳細',
    content: modalContent
  });
}

/**
 * 変更詳細の内容を作成
 * @param {Object} changes - 変更検知結果
 * @returns {HTMLElement} 詳細内容
 */
function createChangesDetailContent(changes) {
  const container = document.createElement('div');
  container.className = 'changes-detail-content';
  
  if (changes.added.length > 0) {
    const addedSection = document.createElement('div');
    addedSection.className = 'changes-section';
    addedSection.innerHTML = `
      <h4>📝 追加されたエントリ (${changes.added.length}件)</h4>
      <div class="changes-list">
        ${changes.added.map(entry => `
          <div class="change-item">
            <strong>${entry.name || '（名前なし）'}</strong>
            <span class="change-type">[${entry.type}]</span>
            <div class="change-content">${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}</div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(addedSection);
  }
  
  if (changes.modified.length > 0) {
    const modifiedSection = document.createElement('div');
    modifiedSection.className = 'changes-section';
    modifiedSection.innerHTML = `
      <h4>✏️ 変更されたエントリ (${changes.modified.length}件)</h4>
      <div class="changes-list">
        ${changes.modified.map(({ current, remote }) => `
          <div class="change-item modified">
            <strong>${remote.name || '（名前なし）'}</strong>
            <span class="change-type">[${remote.type}]</span>
            <div class="change-diff">
              <div class="change-before">変更前: ${current.content.substring(0, 80)}${current.content.length > 80 ? '...' : ''}</div>
              <div class="change-after">変更後: ${remote.content.substring(0, 80)}${remote.content.length > 80 ? '...' : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(modifiedSection);
  }
  
  if (changes.deleted.length > 0) {
    const deletedSection = document.createElement('div');
    deletedSection.className = 'changes-section';
    deletedSection.innerHTML = `
      <h4>🗑️ 削除されたエントリ (${changes.deleted.length}件)</h4>
      <div class="changes-list">
        ${changes.deleted.map(entry => `
          <div class="change-item deleted">
            <strong>${entry.name || '（名前なし）'}</strong>
            <span class="change-type">[${entry.type}]</span>
            <div class="change-content">${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}</div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(deletedSection);
  }
  
  return container;
}