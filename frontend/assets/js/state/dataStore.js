// dataStore.js
// フロントエンドの永続データ読み書きを担うモジュール。
// - `FILE_PATHS` によって扱うファイルのパスを統一する。
// - ファイルの読み込みは backend 側の API を介して行う（`apiClient` 経由）。
// - 読み込み失敗時は既定値にフォールバックし、必要に応じてファイルを初期化する。
// すべての関数は UI の state 管理 (`appState`) と連携して状態を更新する。
import { readFile, writeFile, deleteFile } from "../services/apiClient.js";
import { addNotification, defaults, getState, setState, updateState } from "./appState.js";
import { generateUUID } from "../utils/uuid.js";

export const FILE_PATHS = {
  settings: "settings.json",
  worldView: "world_view.txt",
  command: "command.txt",
  characters: "characters.json",
  storyIndex: "stories/index.json",
  history: "history.json",
  entrySettings: "entry_settings.json",
};

// アプリ起動時に最低限必要なデフォルトの物語オブジェクト。
// ストーリーファイルは JSONL 形式（1行ごとに JSON オブジェクト）で保存する想定。
const DEFAULT_STORY = {
  id: "main",
  title: "メインストーリー",
  filePath: "stories/story_main.jsonl",
  description: "メインとなる物語タイムライン",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * loadSettings()
 * - `settings.json` を読み込み、JSON を解析して設定オブジェクトを返します。
 * - ファイルが存在しない、もしくは読み込み/パースに失敗した場合は `defaults.settings` のクローンを返します。
 * - 戻り値はアプリで利用する設定オブジェクト（defaults とマージ済み）です。
 * @returns {Promise<Object>} 設定オブジェクト
 */
async function loadSettings() {
  const content = await readFile(FILE_PATHS.settings).catch(() => null);
  if (!content) return structuredClone(defaults.settings);
  try {
    const parsed = JSON.parse(content);
    // defaults に存在しないキーがあってもマージして扱う
    return {
      ...defaults.settings,
      ...parsed,
    };
  } catch (error) {
    // JSON パースに失敗した場合はユーザーに通知してデフォルトを返す
    console.error("Failed to parse settings.json", error);
    addNotification({ variant: "error", message: "settings.json の読み込みに失敗しました。初期値を使用します。" });
    return structuredClone(defaults.settings);
  }
}

/**
 * loadWorldView()
 * - `world_view.txt` を読み込み、そのプレーンテキストを返します。
 * - ファイルが存在しない場合は空文字列を返します。
 * @returns {Promise<string>}
 */
export async function loadWorldView() {
  return (await readFile(FILE_PATHS.worldView).catch(() => "")) ?? "";
}

/**
 * loadCommand()
 * - `command.txt` からコマンド文字列を読み込みます。
 * - ファイルが存在しない場合は `defaults.command` を返します。
 * @returns {Promise<string>}
 */
async function loadCommand() {
  const content = await readFile(FILE_PATHS.command).catch(() => null);
  if (content == null) return defaults.command;
  return content;
}

/**
 * loadEntrySettings()
 * - メイン画面の入力UIに関する設定を entry_settings.json から読み込みます。
 * - ファイルが存在しない/破損している場合はデフォルト値を返します。
 * @returns {Promise<{ type:string, character:string|null, autoGenerate:boolean, diceNotation:string }>}
 */
export async function loadEntrySettings() {
  const defaults = {
    type: "character",
    character: null,
    autoGenerate: false,
    diceNotation: "1d6",
  };
  const content = await readFile(FILE_PATHS.entrySettings).catch(() => null);
  if (!content) return defaults;
  try {
    const parsed = JSON.parse(content);
    const allowedTypes = ["character", "narration", "dice_direction", "direction"];
    const type = allowedTypes.includes(parsed.type) ? parsed.type : defaults.type;
    const autoGenerate = typeof parsed.autoGenerate === "boolean" ? parsed.autoGenerate : defaults.autoGenerate;
    const diceNotation = typeof parsed.diceNotation === "string" && parsed.diceNotation.trim() ? parsed.diceNotation : defaults.diceNotation;
    const character = typeof parsed.character === "string" && parsed.character.trim() ? parsed.character : null;
    return { type, character, autoGenerate, diceNotation };
  } catch (error) {
    console.error("Failed to parse entry_settings.json", error);
    return defaults;
  }
}

/**
 * saveEntrySettings(settings)
 * - entry_settings.json に UI 状態を保存します。
 * @param {{ type:string, character:string|null, autoGenerate:boolean, diceNotation:string }} settings
 */
export async function saveEntrySettings(settings) {
  // 保存時も最低限の整形・安全化
  const payload = {
    type: typeof settings.type === "string" ? settings.type : "character",
    character: typeof settings.character === "string" && settings.character.trim() ? settings.character : null,
    autoGenerate: Boolean(settings.autoGenerate),
    diceNotation: typeof settings.diceNotation === "string" && settings.diceNotation.trim() ? settings.diceNotation : "1d6",
  };
  await writeFile(FILE_PATHS.entrySettings, JSON.stringify(payload, null, 2));
}

/**
 * loadCharacters()
 * - `characters.json` を読み込み、キャラクター配列を返します。
 * - 受け入れる形式は配列そのもの、または { characters: [...] } の両方に対応します。
 * - パースに失敗した場合は通知を行い空配列を返します。
 * @returns {Promise<Array>} キャラクター配列
 */
export async function loadCharacters() {
  const content = await readFile(FILE_PATHS.characters).catch(() => null);
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.characters)) return parsed.characters;
    return [];
  } catch (error) {
    // パース失敗時は通知して空リストを返す
    console.error("Failed to parse characters", error);
    addNotification({ variant: "error", message: "characters.json の読み込みに失敗しました。" });
    return [];
  }
}

/**
 * loadStoryIndex()
 * - `stories/index.json` を読み込み、物語のインデックス情報を返します。
 * - ファイルが存在しない場合はデフォルトの index を作成して返します。
 * - パースエラーが発生した場合もフォールバックを作成し、ユーザーに通知します。
 * @returns {Promise<{stories: Array, activeStoryId: string}>}
 */
export async function loadStoryIndex() {
  const content = await readFile(FILE_PATHS.storyIndex).catch(() => null);
  if (!content) {
    await writeFile(
      FILE_PATHS.storyIndex,
      JSON.stringify({ stories: [DEFAULT_STORY], activeStoryId: DEFAULT_STORY.id }, null, 2)
    );
    return { stories: [DEFAULT_STORY], activeStoryId: DEFAULT_STORY.id };
  }
  try {
    const parsed = JSON.parse(content);
    // stories 配列が空の場合は fallback を書き込んで返す
    if (!parsed.stories || !parsed.stories.length) {
      const fallback = { stories: [DEFAULT_STORY], activeStoryId: DEFAULT_STORY.id };
      await writeFile(FILE_PATHS.storyIndex, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return parsed;
  } catch (error) {
    // パースエラー時はファイルを初期化してユーザーに通知する
    console.error("Failed to parse story index", error);
    const fallback = { stories: [DEFAULT_STORY], activeStoryId: DEFAULT_STORY.id };
    await writeFile(FILE_PATHS.storyIndex, JSON.stringify(fallback, null, 2));
    addNotification({ variant: "error", message: "stories/index.json が破損していたため初期化しました。" });
    return fallback;
  }
}

/**
 * ensureStoryIndex()
 * - stories/index.json の存在と整合性を保証する簡易ラッパー。
 * - 現状は loadStoryIndex を呼び出すのみで、将来的な拡張ポイントです。
 */
async function ensureStoryIndex() {
  return await loadStoryIndex();
}

/**
 * parseStoryLines(content)
 * - JSONL 形式（1行に1つの JSON）で保存された文字列をパースして配列を返します。
 * - 不正な行はログに出力され無視されます。
 * @returns {Array}
 */
function parseStoryLines(content) {
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error("Failed to parse story line", line, error);
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * serializeStory(entries)
 * - 物語エントリ配列を JSONL 形式の文字列にシリアライズします。
 */
function serializeStory(entries) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * loadStoryEntries(story)
 * - 指定した story オブジェクトの filePath から JSONL を読み込み、エントリ配列を返します。
 * - 読み込み失敗時は空配列を返します。
 */
async function loadStoryEntries(story) {
  const content = await readFile(story.filePath).catch(() => null);
  if (!content) return [];
  return parseStoryLines(content);
}

/**
 * loadInitialData()
 * - アプリ起動時に呼び出して各種データを並列に読み込み、`appState` を初期化します。
 * - 設定、世界観、司令、キャラクター、ストーリーインデックスを読み込み、
 *   現在アクティブなストーリーのエントリも読み込んで state にセットします。
 */
export async function loadInitialData() {
  setState({ loading: true });
  try {
    const [settings, worldView, command, characters, storyIndex] = await Promise.all([
      loadSettings(),
      loadWorldView(),
      loadCommand(),
      loadCharacters(),
      ensureStoryIndex(),
    ]);
    // storyIndex を id をキーとするマップに変換し、現在選択中のストーリーのエントリを読み込む
    const storyMap = Object.fromEntries(storyIndex.stories.map((story) => [story.id, story]));
    const activeStoryId = storyIndex.activeStoryId ?? storyIndex.stories[0]?.id ?? DEFAULT_STORY.id;
    const entries = await loadStoryEntries(storyMap[activeStoryId]);

    setState({
      settings,
      worldView,
      command,
      characters,
      storyIndex: storyIndex.stories,
      storyFileMap: storyMap,
      currentStoryId: activeStoryId,
      storyEntries: entries,
      loading: false,
      error: null,
    });
  } catch (error) {
    // 初期化に失敗した場合はエラーメッセージを state に格納し、ユーザーに通知する
    console.error("Failed to load initial data", error);
    setState({ loading: false, error: error.message ?? String(error) });
    addNotification({ variant: "error", message: "初期データの読み込みに失敗しました。" });
  }
}

/**
 * saveSettings(settings)
 * - settings オブジェクトを `settings.json` に保存します（整形 JSON）。
 */
export async function saveSettings(settings) {
  await writeFile(FILE_PATHS.settings, JSON.stringify(settings, null, 2));
}

/**
 * saveWorldView(text)
 * - `world_view.txt` にプレーンテキストを保存します。
 */
export async function saveWorldView(text) {
  await writeFile(FILE_PATHS.worldView, text ?? "");
}

/**
 * saveCommand(text)
 * - `command.txt` にコマンド文字列を保存します。
 */
export async function saveCommand(text) {
  await writeFile(FILE_PATHS.command, text ?? "");
}

/**
 * saveCharacters(characters)
 * - `characters.json` にキャラクター配列を保存します（整形 JSON）。
 */
export async function saveCharacters(characters) {
  await writeFile(FILE_PATHS.characters, JSON.stringify(characters, null, 2));
}

/**
 * saveStory(entries, storyId)
 * - 指定された storyId（省略時は現在の active story）に対して
 *   entries を JSONL 形式で書き込みます。
 * - 書き込み後に storyIndex / storyFileMap の updatedAt を更新します。
 */
export async function saveStory(entries, storyId) {
  const state = getState();
  const targetId = storyId ?? state.currentStoryId;
  const story = state.storyFileMap[targetId];
  if (!story) throw new Error("ストーリーファイルが見つかりません");

  const serialized = serializeStory(entries);
  await writeFile(story.filePath, serialized);

  const now = new Date().toISOString();
  updateState("storyFileMap", (map) => {
    map[targetId] = { ...map[targetId], updatedAt: now };
    return map;
  });
  updateState("storyIndex", (index) =>
    index.map((item) => (item.id === targetId ? { ...item, updatedAt: now } : item))
  );
}

/**
 * 指定されたファイルパスから物語エントリを読み込む
 * @param {string} filePath - 物語ファイルのパス
 * @returns {Promise<Array>} エントリ配列
 */
export async function getStoryEntries(filePath) {
  try {
    const content = await readFile(filePath);
    if (!content) return [];
    return parseStoryLines(content);
  } catch (error) {
    console.error('物語エントリの読み込みに失敗:', error);
    return [];
  }
}

/**
 * 全体設定を読み込む（外部アクセス用）
 * @returns {Promise<Object>} 設定オブジェクト
 */
export async function loadSettingsFromFile() {
  try {
    const content = await readFile(FILE_PATHS.settings);
    if (!content) return structuredClone(defaults.settings);
    const parsed = JSON.parse(content);
    return {
      ...defaults.settings,
      ...parsed,
    };
  } catch (error) {
    console.error('設定の読み込みに失敗:', error);
    return structuredClone(defaults.settings);
  }
}

export async function createStory({ title, description }) {
  const id = generateUUID();
  const filePath = `stories/story_${id}.jsonl`;
  const now = new Date().toISOString();
  const story = { id, title, description, filePath, createdAt: now, updatedAt: now };
  await writeFile(filePath, "");
  const indexState = getState();
  const nextStories = [...indexState.storyIndex, story];
  await writeFile(
    FILE_PATHS.storyIndex,
    JSON.stringify({ stories: nextStories, activeStoryId: id }, null, 2)
  );
  setState({
    storyIndex: nextStories,
    storyFileMap: { ...indexState.storyFileMap, [id]: story },
    currentStoryId: id,
    storyEntries: [],
  });
  return story;
}

export async function switchStory(storyId) {
  const { storyFileMap } = getState();
  const story = storyFileMap[storyId];
  if (!story) throw new Error("指定の物語が見つかりません");
  const entries = await loadStoryEntries(story);
  setState({ currentStoryId: storyId, storyEntries: entries });
  const indexState = getState();
  await writeFile(
    FILE_PATHS.storyIndex,
    JSON.stringify({ stories: indexState.storyIndex, activeStoryId: storyId }, null, 2)
  );
}

export async function renameStory(storyId, newTitle, newDescription) {
  const state = getState();
  const story = state.storyFileMap[storyId];
  if (!story) throw new Error("指定された物語が見つかりません");

  const updatedStory = {
    ...story,
    title: newTitle.trim(),
    description: newDescription.trim(),
    updatedAt: new Date().toISOString(),
  };

  const updatedStories = state.storyIndex.map((item) => 
    item.id === storyId ? updatedStory : item
  );

  await writeFile(
    FILE_PATHS.storyIndex,
    JSON.stringify({ stories: updatedStories, activeStoryId: state.currentStoryId }, null, 2)
  );

  setState({
    storyIndex: updatedStories,
    storyFileMap: Object.fromEntries(updatedStories.map((item) => [item.id, item])),
  });
}

export async function deleteStory(storyId) {
  const state = getState();
  if (state.storyIndex.length <= 1) throw new Error("物語は最低1つ必要です");
  const story = state.storyFileMap[storyId];
  if (!story) return;
  await deleteFile(story.filePath);
  const remainingStories = state.storyIndex.filter((item) => item.id !== storyId);
  const nextActive = remainingStories[0].id;
  await writeFile(
    FILE_PATHS.storyIndex,
    JSON.stringify({ stories: remainingStories, activeStoryId: nextActive }, null, 2)
  );
  const entries = await loadStoryEntries(state.storyFileMap[nextActive]);
  setState({
    storyIndex: remainingStories,
    storyFileMap: Object.fromEntries(remainingStories.map((item) => [item.id, item])),
    currentStoryId: nextActive,
    storyEntries: entries,
  });
}
