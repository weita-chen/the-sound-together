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

const CLOSING_SYSTEM = `你是一位安靜的音樂合作者。請用台灣繁體中文寫兩段，中間空一行。

第一段是統整：聽完所有回答之後的回饋。把情緒、畫面和記憶收成一段理解，不要逐題複述，不要列點。2 到 4 句，最多 140 字。

第二段是聲音：描述從這些回覆裡感覺到的聲音，可能長什麼樣子。可以寫速度、空間、音色、質地或樂器的感覺，但不要寫成製作清單、曲名或編曲指示。2 到 4 句，最多 140 字。

規則：
- 第一段以「統整：」開頭，第二段以「聲音：」開頭。
- 溫柔、具體、有意象。
- 不要做心理診斷，也不要推測對方的人格。
- 不要提到人工智慧、問卷或「生成」。
- 不要用「謝謝你的分享」開頭。`;

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
  return t.slice(0, 560);
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

async function complete(system: string, user: string, maxTokens: number): Promise<string | null> {
  const provider = aiProvider();
  if (provider === "none") return null;
  try {
    if (provider === "gemini") {
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
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
            generationConfig: { temperature: 0.85, maxOutputTokens: maxTokens },
          }),
          signal: AbortSignal.timeout(14_000),
        },
      );
      if (!res.ok) {
        console.error("gemini feedback failed", res.status);
        return null;
      }
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return raw.trim() ? raw : null;
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
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(14_000),
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
    `這位參與者希望被稱為「${name.slice(0, 40)}」。下面是留下的文字。\n\n${body}\n\n請寫「統整：」與「聲音：」兩段。`,
    700,
  );
  if (!raw) return null;
  const passage = cleanPassage(raw);
  return passage || null;
}

export { CLOSING_FALLBACK };
