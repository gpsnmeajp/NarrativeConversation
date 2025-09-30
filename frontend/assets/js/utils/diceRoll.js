/**
 * ダイスロール関連のユーティリティ関数
 */

/**
 * ダイス記法の入力を正規化する
 * @param {string} diceNotation - 入力されたダイス記法
 * @returns {string} 正規化されたダイス記法
 */
function normalizeDiceNotation(diceNotation) {
  // 入力を正規化（全角→半角変換、不完全な記法を補完）
  let normalizedNotation = diceNotation.trim()
    // 全角数字を半角に変換
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    // 全角dを半角に変換
    .replace(/[ｄＤ]/g, 'd');
  
  // "d100" -> "1d100"
  if (/^d\d+$/i.test(normalizedNotation)) {
    normalizedNotation = '1' + normalizedNotation;
  }
  // "100" -> "1d100"
  else if (/^\d+$/.test(normalizedNotation)) {
    normalizedNotation = '1d' + normalizedNotation;
  }

  return normalizedNotation;
}

/**
 * ndm形式のダイス記法をパースして出目を生成する
 * @param {string} diceNotation - ダイス記法（例: "1d6", "2d10", "3d20"）
 * @returns {Object} { dice: string, results: number[], total: number, error?: string }
 */
export function rollDice(diceNotation) {
  // 空文字や無効な入力のチェック
  if (!diceNotation || typeof diceNotation !== 'string') {
    return { 
      dice: diceNotation || '', 
      results: [], 
      total: 0, 
      error: 'ダイス記法を入力してください' 
    };
  }

  // 入力を正規化
  const normalizedNotation = normalizeDiceNotation(diceNotation);

  // ダイス記法の正規表現（ndm形式）
  const dicePattern = /^(\d+)d(\d+)$/i;
  const match = normalizedNotation.match(dicePattern);

  if (!match) {
    return { 
      dice: diceNotation, 
      results: [], 
      total: 0, 
      error: '無効なダイス記法です（例: 1d6, 2d10, d20, 100）' 
    };
  }

  const numDice = parseInt(match[1], 10);
  const numSides = parseInt(match[2], 10);

  // 妥当性チェック
  if (numDice <= 0 || numDice > 100) {
    return { 
      dice: diceNotation, 
      results: [], 
      total: 0, 
      error: 'ダイス数は1〜100の間で指定してください' 
    };
  }

  if (numSides <= 1 || numSides > 1000) {
    return { 
      dice: diceNotation, 
      results: [], 
      total: 0, 
      error: 'ダイス面数は2〜1000の間で指定してください' 
    };
  }

  // ダイスロール実行
  const results = [];
  for (let i = 0; i < numDice; i++) {
    results.push(Math.floor(Math.random() * numSides) + 1);
  }

  const total = results.reduce((sum, value) => sum + value, 0);

  return {
    dice: normalizedNotation,
    results,
    total,
    error: null
  };
}

/**
 * ダイスロール結果をテキスト形式でフォーマットする
 * @param {Object} rollResult - rollDice関数の戻り値
 * @returns {string} フォーマットされたテキスト
 */
export function formatDiceRoll(rollResult) {
  if (rollResult.error) {
    return `エラー: ${rollResult.error}`;
  }

  if (rollResult.results.length === 0) {
    return '';
  }

  if (rollResult.results.length === 1) {
    return `${rollResult.dice} → ${rollResult.results[0]}`;
  }

  return `${rollResult.dice} → [${rollResult.results.join(', ')}] = ${rollResult.total}`;
}

/**
 * ダイス記法が有効かどうかを検証する
 * @param {string} diceNotation - ダイス記法
 * @returns {boolean} 有効な場合true
 */
export function isValidDiceNotation(diceNotation) {
  if (!diceNotation || typeof diceNotation !== 'string') {
    return false;
  }

  // 入力を正規化
  const normalizedNotation = normalizeDiceNotation(diceNotation);

  const dicePattern = /^(\d+)d(\d+)$/i;
  const match = normalizedNotation.match(dicePattern);

  if (!match) {
    return false;
  }

  const numDice = parseInt(match[1], 10);
  const numSides = parseInt(match[2], 10);

  return numDice > 0 && numDice <= 100 && numSides > 1 && numSides <= 1000;
}