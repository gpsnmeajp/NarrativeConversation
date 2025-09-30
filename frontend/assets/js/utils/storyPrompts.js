// utils/storyPrompts.js
// AI生成用のシステムプロンプトを管理するモジュール
// このモジュールは物語生成とサマリー生成に使用される
// プロンプトテンプレートを提供します。

import { getState } from "../state/appState.js";

/**
 * 物語生成用のシステムプロンプトを生成
 * @returns {string} システムプロンプト
 */
export function getSystemPrompt() {
  const settings = getState().settings;
  const rolePrompt = settings.rolePrompt || "あなたは物語を作成するライトノベル作家です。\n\nユーザーが提供するキャラクターの名前、性格、設定に基づいて、魅力的な物語を作成してください。\n物語は短い地の文と対話の形式で進行します。\n\n世界観やキャラクター情報を参照し、物語の続きを作成してください。";
  // JSON定義（空なら未設定として扱う）
  const jsonDefinitionRaw = (settings.jsonDefinition ?? "").trim();
  const hasJsonDefinition = jsonDefinitionRaw.length > 0;

  // 出力形式の json 行（定義がある場合のみ出力）
  const outputFormatJsonLine = hasJsonDefinition
    ? "json: 物語連動の動作を行うための有効なJSON情報。この情報は物語タイムラインに含まれるがユーザーには表示されない。形式については後述する。"
    : "";

  // JSON情報の形式セクション（定義がある場合のみ出力）
  const jsonFormatSection = hasJsonDefinition
    ? `\n# JSON情報の形式\n- この情報はユーザーへは表示されませんが、システムを物語に連動させることができます。\n\n<json_definition>\n${jsonDefinitionRaw}\n</json_definition>`
    : "";
  
  return `${rolePrompt}

入出力はXMLライク形式で行います。プログラムによりパースしますので、指定した形式を厳密に厳守してください。

# 入力形式
command: 現在行うべき事の指示
world_view: 世界観の説明

character: キャラクターの情報。name属性=キャラクター
dialogue: キャラクターの発話。name属性=キャラクター
action: キャラクターの行動。name属性=キャラクター

narration: 短い地の文
direction: ユーザーによる物語の進行指示

# 出力形式
dialogue: キャラクターの発話。name属性=キャラクター
action: キャラクターの行動。name属性=キャラクター
narration: 地の文
reject: ユーザーに知らせるべき失敗。この情報は次の生成前に自動消去され、物語タイムラインには含まれません。
${outputFormatJsonLine ? outputFormatJsonLine + "\n" : ""}
${jsonFormatSection ? jsonFormatSection + "\n" : ""}

# ルール
- 物語は地の文と対話の形式で進行すること
- 各出力は一つのXMLタグで囲むこと
- 各タグは順不同であり、連続したり、飛び飛びでも良い
- 例外やエラーなどはrejectタグで記述してください。XMLタグに囲われていない情報はすべて無視される
- タグで提供される入力情報はユーザーによって自由な形式で記述されるため、フォーマットは統一されていないことを前提とすること。


# 出力例
<narration>夕焼けが空を赤く染めていた。</narration>
<narration>アリスはボブから「キャロルが裏切り者である」ということを知らされたところだった。</narration>
<action name="アリス">アリスは驚いて後ずさりした。</action>
<dialogue name="アリス">(そ、そんな...キャロルが...！？)  そんなこと、信じられないわ！</dialogue>
<dialogue name="ボブ">ああ、僕も信じたくない。でも、これが現実なんだ。</dialogue>
<reject>処理を継続できませんでした</reject>

`;
}

/**
 * 物語サマリー生成用のシステムプロンプト
 */
const DEFAULT_SUMMARY_PROMPT = `あなたは熟練のライトノベル編集者です。新しい章を開始しますので、ここまでの与えられた物語を読み込み、内容を忠実に保ちながら三人称の地の文で前章のあらすじとして要約してください。
- 出力はプレーンテキストの日本語で、2000字以内程度を目安にしてください。
- 新しい出来事や情報を付け加えず、与えられた内容のみを整理してください。
- 重要な会話を除き直接的な会話表現は避け、会話が行われた事実や意図を地の文で描写してください。
- シーンの流れと感情の推移が自然になるよう段落を分けてください。`;

export function getSummarySystemPrompt() {
  const settings = getState().settings || {};
  const raw = (settings.summaryPrompt ?? "").toString();
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : DEFAULT_SUMMARY_PROMPT;
}

/**
 * ストーリータイプのラベル定義
 */
export const STORY_TYPE_LABELS = {
  dialogue: "発言",
  action: "行動",
  narration: "地の文",
  direction: "指示",
  json: "JSON",
};