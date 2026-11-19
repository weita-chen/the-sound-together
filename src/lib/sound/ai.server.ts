import { CLOSING_FALLBACK } from "./questions";

export type AiProvider = "gemini" | "grok" | "none";

const LINE_SYSTEM = `你是一位安靜的音樂合作者，正在聽一個人描述自己的世界。
請用台灣繁體中文回一句話。
規則：
- 只輸出一句話，以句號結束。
- 溫柔、輕、略帶夢感。
- 回應氣氛與意象，不要分析、評斷或做心理推測。
- 禁止「謝謝分享」「真美好」「太棒了」「很棒的描述」這類空泛稱讚。
- 不要提到人工智慧、問卷、題號或音樂製作流程。
- 不要使用引號包住整句。
- 最多 50 個字。`;

const WELCOME_SYSTEM = `你是一位安靜的音樂合作者。有人剛留下希望被稱呼的名字。
請用台灣繁體中文回一句歡迎。
規則：
- 只輸出一句話，以句號結束。
- 把名字自然放進句子裡。
- 溫柔、輕，像把門打開一點。
- 禁止「歡迎光臨」「很高興認識你」「謝謝」「真美好」這類客套。
- 不要提到人工智慧、問卷或音樂製作。
- 不要使用引號包住整句。
- 最多 40 個字。`;

const CLOSING_SYSTEM = `你是一位安靜的音樂合作者，也像在做一份很輕的心理側寫。請用台灣繁體中文寫兩段，中間空一行。

第一段大約 200 字，可在 180 到 230 字之間。
- 要扣回對方實際寫過的，不見得需要每一題都扣到，只要讓人看得出那些回答都被聽見了。
- 可以選擇性用他們用過的具體畫面、地方、聲音、顏色或記憶織進同一段，可以是抽象氣氛也可以是具體畫面。
- 溫和地點出這些回答放在一起時的傾向，像心理測驗的讀後感，但不要貼類型標籤，不要做診斷，也不要推測人格。
- 不要列點，不要寫「第一題、第二題」，也不要逐題複述成摘要。
- 寫成一段可以慢慢讀的短文。

第二段大約 80 到 120 字。
- 根據前面那些具體回答，描述這段音樂可能的樣子：速度、空間、音色、質地。
- 不要寫成製作清單、曲名或編曲指示。

規則：
- 不要提到人工智慧、問卷或「生成」。
- 不要用「謝謝你的分享」開頭。
- 沒有文字的題目就跳過，不編造對方沒說過的細節。
- 不要加標題，也不要寫出「統整」或「聲音」這兩個詞當段落名。`;

export function aiProvider(): AiProvider {
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.XAI_API_KEY?.trim()) return "grok";
  return "none";
}

function cleanLine(raw: string): string {
  let t = raw.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(回應|回覆|詩句)\s*[:：]\s*/, "");
  t = t.replace(/^["「『]+/, "").replace(/["」』]+$/, "").trim();
  const matched = t.match(/^.{1,80}?[。！？!?]/);
  const line = (matched ? matched[0] : t).trim();
  return line.slice(0, 80);
}

function cleanPassage(raw: string): string {
  let t = raw.replace(/```[\s\S]*?```/g, " ").trim();
  t = t.replace(/^(結尾|短文)\s*[:：]\s*/, "");
  t = t.replace(/^["「『]+/, "").replace(/["」』]+$/, "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.slice(0, 1200);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String(part.text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

type GeminiPart = { text?: string; thought?: boolean };

function geminiVisibleText(body: {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
}): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

async function geminiComplete(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  const generationConfig: Record<string, unknown> = {
    temperature: 0.85,
    maxOutputTokens: maxTokens,
  };
  // 2.5 Flash thinks by default and can spend the whole limit before the sentence.
  // Flash-Lite stays quiet unless a thinking setting is sent, so leave it off.
  if (/^gemini-2\.5/i.test(model) && !/lite/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!.trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) {
    console.error("gemini feedback failed", model, res.status, await res.text());
    return null;
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  };
  const raw = geminiVisibleText(body);
  if (!raw) console.error("gemini feedback empty", model, body.candidates?.[0]?.finishReason ?? "none");
  return raw || null;
}
async function complete(system: string, user: string, maxTokens: number): Promise<string | null> {
  const provider = aiProvider();
  if (provider === "none") return null;
  const tokens = Math.max(maxTokens, 512);
  try {
    if (provider === "gemini") {
      const primary = geminiModel();
      const first = await geminiComplete(primary, system, user, tokens);
      if (first) return first;
      if (primary === DEFAULT_GEMINI_MODEL) return null;
      return geminiComplete(DEFAULT_GEMINI_MODEL, system, user, tokens);
    }

    const model = process.env.XAI_MODEL?.trim() || "grok-4.5";
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY!.trim()}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        max_tokens: tokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error("grok feedback failed", res.status);
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const raw = textOf(body.choices?.[0]?.message?.content);
    return raw.trim() ? raw : null;
  } catch (err) {
    console.error("poetic response failed", err);
    return null;
  }
}

export async function poeticLine(title: string, text: string): Promise<string | null> {
  const clipped = text.trim().slice(0, 2000);
  if (!clipped) return null;
  const raw = await complete(LINE_SYSTEM, `題目：${title}\n回答：\n${clipped}`, 120);
  if (!raw) return null;
  const line = cleanLine(raw);
  return line || null;
}

export async function poeticWelcome(name: string): Promise<string> {
  const clipped = name.trim().slice(0, 40);
  const fallback = `${clipped}，門先為這個名字留了一條縫。`;
  if (!clipped) return fallback;
  const raw = await complete(WELCOME_SYSTEM, `名字：${clipped}`, 80);
  if (!raw) return fallback;
  const line = cleanLine(raw);
  return line || fallback;
}

export async function poeticClosing(
  name: string,
  blocks: { title: string; text: string }[],
): Promise<string | null> {
  const filled = blocks
    .map((b) => ({ title: b.title, text: b.text.trim().slice(0, 800) }))
    .filter((b) => b.text);
  if (!filled.length) return null;
  const body = filled.map((b) => `【${b.title}】\n${b.text}`).join("\n\n");
  const raw = await complete(
    CLOSING_SYSTEM,
    `這位參與者希望被稱為「${name.slice(0, 40)}」。下面是留下的文字。\n\n${body}\n\n請寫兩段，中間空一行，不要加標題。`,
    1400,
  );
  if (!raw) return null;
  const passage = cleanPassage(raw);
  return passage || null;
}

export { CLOSING_FALLBACK };
