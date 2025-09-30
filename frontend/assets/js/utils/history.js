// utils/history.js
// rolePrompt/command/worldview の履歴を data/history.json に保存・取得するユーティリティ

import { readFile, writeFile } from "../services/apiClient.js";
import { FILE_PATHS } from "../state/dataStore.js";

// 履歴の最大件数
const MAX_ITEMS = 50;

// 型キーの正規化
const TYPE_KEYS = {
  rolePrompt: "rolePrompts",
  command: "commands",
  worldview: "worldviews",
};

function nowIso() {
  return new Date().toISOString();
}

function emptyHistory() {
  return { rolePrompts: [], commands: [], worldviews: [] };
}

async function loadRaw() {
  const text = await readFile(FILE_PATHS.history).catch(() => null);
  if (!text) return emptyHistory();
  try {
    const parsed = JSON.parse(text);
    return {
      rolePrompts: Array.isArray(parsed.rolePrompts) ? parsed.rolePrompts : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      worldviews: Array.isArray(parsed.worldviews) ? parsed.worldviews : [],
    };
  } catch {
    // 壊れていた場合は初期化
    return emptyHistory();
  }
}

async function saveRaw(data) {
  const normalized = {
    rolePrompts: Array.isArray(data.rolePrompts) ? data.rolePrompts : [],
    commands: Array.isArray(data.commands) ? data.commands : [],
    worldviews: Array.isArray(data.worldviews) ? data.worldviews : [],
  };
  await writeFile(FILE_PATHS.history, JSON.stringify(normalized, null, 2));
}

// --- 書き込みの直列化ロックと単一コミット更新 ---
let writeQueue = Promise.resolve();

function withWriteLock(task) {
  const p = writeQueue.then(task);
  // 失敗してもチェーンを維持するためにキャッチして無視（エラーは呼び出し側に返す）
  writeQueue = p.catch(() => {});
  return p;
}

/**
 * 最新のhistory.jsonを読み直してから、mutatorで更新し1回の書き込みで反映する
 * @param {(current:Object)=>Object|Promise<Object>} mutator
 */
async function commit(mutator) {
  return withWriteLock(async () => {
    const current = await loadRaw(); // 直前再読込
    const updated = await mutator({ ...current });
    await saveRaw(updated);
    return updated;
  });
}

/**
 * 指定タイプの履歴一覧を取得
 * @param {"rolePrompt"|"command"|"worldview"} type
 * @returns {Promise<Array<{text:string, updatedAt:string, count?:number}>>}
 */
export async function getHistory(type) {
  const key = TYPE_KEYS[type];
  if (!key) return [];
  const data = await loadRaw();
  return data[key] ?? [];
}

/**
 * 履歴へ追加（同一テキストは先頭に昇格）。最大50件を保持。
 * @param {"rolePrompt"|"command"|"worldview"} type
 * @param {string} text
 */
export async function upsertHistory(type, text) {
  if (!text || typeof text !== "string") return;
  const key = TYPE_KEYS[type];
  if (!key) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  await commit((data) => {
    const list = Array.isArray(data[key]) ? [...data[key]] : [];
    const idx = list.findIndex((item) => item?.text === trimmed);
    if (idx >= 0) {
      const existing = list.splice(idx, 1)[0];
      const count = typeof existing.count === "number" ? existing.count + 1 : 1;
      list.unshift({ text: trimmed, updatedAt: nowIso(), count });
    } else {
      list.unshift({ text: trimmed, updatedAt: nowIso(), count: 1 });
    }
    data[key] = list.slice(0, MAX_ITEMS);
    return data;
  });
}

/**
 * 指定テキストを履歴から削除
 * @param {"rolePrompt"|"command"|"worldview"} type
 * @param {string} text
 */
export async function deleteHistory(type, text) {
  const key = TYPE_KEYS[type];
  if (!key) return;
  const trimmed = (text ?? "").trim();
  await commit((data) => {
    const list = Array.isArray(data[key]) ? data[key] : [];
    data[key] = list.filter((item) => item?.text !== trimmed);
    return data;
  });
}

/**
 * 3種類をまとめて先頭昇格・追加し、1回の読み書きで反映
 * @param {{rolePrompt?:string, command?:string, worldview?:string}} payload
 */
export async function upsertHistoryBulk(payload) {
  const rp = (payload.rolePrompt ?? "").trim();
  const cmd = (payload.command ?? "").trim();
  const wv = (payload.worldview ?? "").trim();
  if (!rp && !cmd && !wv) return;

  await commit((data) => {
    const apply = (keyName, value) => {
      if (!value) return;
      const key = TYPE_KEYS[keyName];
      const list = Array.isArray(data[key]) ? [...data[key]] : [];
      const idx = list.findIndex((item) => item?.text === value);
      if (idx >= 0) {
        const existing = list.splice(idx, 1)[0];
        const count = typeof existing.count === "number" ? existing.count + 1 : 1;
        list.unshift({ text: value, updatedAt: nowIso(), count });
      } else {
        list.unshift({ text: value, updatedAt: nowIso(), count: 1 });
      }
      data[key] = list.slice(0, MAX_ITEMS);
    };

    apply('rolePrompt', rp);
    apply('command', cmd);
    apply('worldview', wv);
    return data;
  });
}
