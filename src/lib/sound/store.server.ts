import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getSql, type Sql } from "@/lib/db";
import {
  CLOSING_FALLBACK,
  EMPTY_FALLBACK,
  LIMITS,
  QUESTIONS,
  questionById,
  type ProductionStatus,
  type SubmissionStatus,
} from "./questions";
import type { AnswerView, AttachmentMeta, StudioGate, StudioListItem, SubmissionView } from "./types";
import { aiProvider, poeticClosing, poeticLine } from "./ai.server";
import { buildZip } from "./zip";

const scryptAsync = promisify(scrypt);
export const STUDIO_COOKIE = "st_studio";

export class SoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoundError";
  }
}

type AnswerRow = {
  id: string;
  question_id: string;
  text_response: string;
  ai_feedback: string | null;
  feedback_hash: string | null;
};

type AttachmentRow = {
  id: string;
  answer_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: unknown;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function asStatus(value: string): SubmissionStatus {
  return value === "submitted" ? "submitted" : "draft";
}

function asProduction(value: string): ProductionStatus {
  if (value === "in_progress" || value === "completed") return value;
  return "pending";
}

function cleanName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (name.length < 1 || name.length > LIMITS.maxName) {
    throw new SoundError("請留下一個名字，40 字以內。");
  }
  return name;
}

function cleanText(raw: string): string {
  return raw.replace(/\u0000/g, "").slice(0, LIMITS.maxText);
}

function assertToken(token: string): string {
  const value = token.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new SoundError("這組代碼不正確。");
  return value;
}

function assertQuestion(id: string) {
  const q = questionById(id);
  if (!q) throw new SoundError("找不到這一題。");
  return q;
}

function contentHash(name: string, answers: { questionId: string; text: string }[]): string {
  return sha256(`${name}\n${answers.map((a) => `${a.questionId}:${a.text.trim()}`).join("\n")}`);
}

let failWindow = 0;
let failCount = 0;

function noteFail() {
  const now = Date.now();
  if (now - failWindow > 10 * 60 * 1000) {
    failWindow = now;
    failCount = 0;
  }
  failCount += 1;
  if (failCount > 12) throw new SoundError("試太多次了，請稍後再來。");
}

function noteOk() {
  failCount = 0;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  const key = (await scryptAsync(password, salt, expected.length)) as Buffer;
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

function envPassword(): string | null {
  const value = process.env.ORGANIZER_PASSWORD?.trim();
  return value ? value : null;
}

function passwordOkShape(password: string): string {
  const value = password.trim();
  if (value.length < 8 || value.length > 72) {
    throw new SoundError("口令請介於 8 到 72 個字。");
  }
  return value;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

async function sessionValid(sql: Sql, token: string | null): Promise<boolean> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const rows = await sql<{ ok: number }>`
    select 1 as ok from organizer_sessions
    where token_hash = ${sha256(token)} and expires_at > now()
  `;
  return rows.length > 0;
}

export async function isAdminCookie(cookieHeader: string | null): Promise<boolean> {
  const sql = await getSql();
  return sessionValid(sql, readCookie(cookieHeader, STUDIO_COOKIE));
}

async function requireAdmin(cookieHeader: string | null): Promise<Sql> {
  const sql = await getSql();
  const ok = await sessionValid(sql, readCookie(cookieHeader, STUDIO_COOKIE));
  if (!ok) throw new SoundError("請先進入主辦入口。");
  return sql;
}

export async function createSession(): Promise<string> {
  const sql = await getSql();
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await sql`
    insert into organizer_sessions (token_hash, expires_at)
    values (${sha256(token)}, ${expires})
  `;
  await sql`delete from organizer_sessions where expires_at < now()`;
  return token;
}

export async function destroySession(cookieHeader: string | null): Promise<void> {
  const token = readCookie(cookieHeader, STUDIO_COOKIE);
  if (!token) return;
  const sql = await getSql();
  await sql`delete from organizer_sessions where token_hash = ${sha256(token)}`;
}

export async function gateStatus(cookieHeader: string | null): Promise<StudioGate> {
  const sql = await getSql();
  const rows = await sql<{ id: number }>`select id from organizer_auth where id = 1`;
  return {
    authed: await sessionValid(sql, readCookie(cookieHeader, STUDIO_COOKIE)),
    needsSetup: !envPassword() && rows.length === 0,
    provider: aiProvider(),
  };
}

export async function setupPassword(password: string, confirm: string): Promise<void> {
  if (envPassword()) throw new SoundError("口令已由發布設定決定，直接進入即可。");
  const primary = passwordOkShape(password);
  if (primary !== confirm.trim()) throw new SoundError("兩次輸入的口令不一樣。");
  const sql = await getSql();
  const existing = await sql`select id from organizer_auth where id = 1`;
  if (existing.length) throw new SoundError("口令已經設定過了。");
  const passwordHash = await hashPassword(primary);
  try {
    await sql`
      insert into organizer_auth (id, password_hash) values (1, ${passwordHash})
    `;
  } catch {
    throw new SoundError("口令已經設定過了。");
  }
}

export async function checkOrganizerPassword(password: string): Promise<void> {
  noteFail();
  const candidate = password.trim();
  const fromEnv = envPassword();
  if (fromEnv) {
    const a = sha256(candidate);
    const b = sha256(fromEnv);
    const ok = timingSafeEqual(Buffer.from(a), Buffer.from(b));
    if (!ok) throw new SoundError("口令不對。");
    noteOk();
    return;
  }
  const sql = await getSql();
  const rows = await sql<{ password_hash: string }>`
    select password_hash from organizer_auth where id = 1
  `;
  if (!rows.length) throw new SoundError("請先設定口令。");
  const ok = await checkPassword(candidate, rows[0].password_hash);
  if (!ok) throw new SoundError("口令不對。");
  noteOk();
}

async function owns(sql: Sql, id: string, token: string): Promise<void> {
  const hash = sha256(assertToken(token));
  const rows = await sql<{ id: string }>`
    select id from submissions where id = ${id} and edit_token_hash = ${hash}
  `;
  if (!rows.length) throw new SoundError("找不到這份回答，或代碼不對。");
}

async function touch(sql: Sql, id: string) {
  await sql`update submissions set updated_at = now() where id = ${id}`;
}

async function attachmentsFor(sql: Sql, answerIds: string[]): Promise<Map<string, AttachmentMeta[]>> {
  const map = new Map<string, AttachmentMeta[]>();
  if (!answerIds.length) return map;
  const placeholders = answerIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await sql.query<AttachmentRow>(
    `select id, answer_id, file_name, mime_type, byte_size, created_at
     from attachments where answer_id in (${placeholders}) order by created_at`,
    answerIds,
  );
  for (const row of rows) {
    const list = map.get(row.answer_id) ?? [];
    list.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      createdAt: iso(row.created_at),
    });
    map.set(row.answer_id, list);
  }
  return map;
}

async function ensureToneColumn(sql: Sql): Promise<void> {
  const g = globalThis as typeof globalThis & { __toneCol__?: Promise<void> };
  g.__toneCol__ ??= sql
    .query(`alter table submissions add column if not exists tonelab_prompt text not null default ''`)
    .then(() => undefined)
    .catch((err) => {
      g.__toneCol__ = undefined;
      throw err;
    });
  await g.__toneCol__;
}

async function loadView(sql: Sql, id: string): Promise<SubmissionView> {
  await ensureToneColumn(sql);
  const subs = await sql<{
    id: string;
    display_name: string;
    status: string;
    production_status: string;
    closing_message: string | null;
    tonelab_prompt: string | null;
    created_at: unknown;
    updated_at: unknown;
  }>`
    select id, display_name, status, production_status, closing_message, tonelab_prompt, created_at, updated_at
    from submissions where id = ${id}
  `;
  const sub = subs[0];
  if (!sub) throw new SoundError("找不到這份回答。");
  const answers = await sql<AnswerRow>`
    select id, question_id, text_response, ai_feedback, feedback_hash
    from answers where submission_id = ${id}
  `;
  const files = await attachmentsFor(
    sql,
    answers.map((a) => a.id),
  );
  const notes = await sql<{ note: string }>`
    select note from organizer_notes where submission_id = ${id}
  `;
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  return {
    id: sub.id,
    displayName: sub.display_name,
    status: asStatus(sub.status),
    productionStatus: asProduction(sub.production_status),
    closingMessage: sub.closing_message,
    tonePrompt: sub.tonelab_prompt ?? "",
    createdAt: iso(sub.created_at),
    updatedAt: iso(sub.updated_at),
    note: notes[0]?.note ?? "",
    answers: QUESTIONS.map((q) => {
      const row = byQuestion.get(q.id);
      return {
        questionId: q.id,
        text: row?.text_response ?? "",
        feedback: row?.ai_feedback ?? null,
        attachments: row ? (files.get(row.id) ?? []) : [],
      };
    }),
  };
}

export async function createSubmission(displayName: string): Promise<{ id: string; token: string; view: SubmissionView }> {
  const name = cleanName(displayName);
  const sql = await getSql();
  const id = crypto.randomUUID();
  const token = randomBytes(32).toString("hex");
  await sql`
    insert into submissions (id, display_name, edit_token_hash)
    values (${id}, ${name}, ${sha256(token)})
  `;
  const view = await loadView(sql, id);
  return { id, token, view };
}

export async function renameSubmission(id: string, token: string, displayName: string): Promise<SubmissionView> {
  const name = cleanName(displayName);
  const sql = await getSql();
  await owns(sql, id, token);
  await sql`
    update submissions
    set display_name = ${name}, updated_at = now(), closing_message = null, closing_hash = null
    where id = ${id}
  `;
  return loadView(sql, id);
}

export async function resumeSubmission(id: string, token: string): Promise<SubmissionView> {
  const sql = await getSql();
  await owns(sql, id, token);
  return loadView(sql, id);
}

export async function resumeByToken(token: string): Promise<SubmissionView> {
  const sql = await getSql();
  const hash = sha256(assertToken(token));
  const rows = await sql<{ id: string }>`select id from submissions where edit_token_hash = ${hash}`;
  if (!rows.length) throw new SoundError("找不到這組代碼。");
  return loadView(sql, rows[0].id);
}

export async function saveAnswer(id: string, token: string, questionId: string, text: string): Promise<void> {
  assertQuestion(questionId);
  const value = cleanText(text);
  const hash = sha256(value.trim());
  const sql = await getSql();
  await owns(sql, id, token);
  const existing = await sql<{ text_response: string }>`
    select text_response from answers where submission_id = ${id} and question_id = ${questionId}
  `;
  if (!existing.length && !value.trim()) return;
  if (existing.length && existing[0].text_response === value) return;
  await sql`
    insert into answers (id, submission_id, question_id, text_response, feedback_hash)
    values (${crypto.randomUUID()}, ${id}, ${questionId}, ${value}, ${hash})
    on conflict (submission_id, question_id) do update
    set text_response = excluded.text_response,
        updated_at = now(),
        ai_feedback = case when answers.feedback_hash = ${hash} then answers.ai_feedback else null end,
        feedback_hash = case when answers.feedback_hash = ${hash} then answers.feedback_hash else null end
  `;
  await sql`
    update submissions
    set updated_at = now(), closing_message = null, closing_hash = null
    where id = ${id}
  `;
}

async function ensureAnswer(sql: Sql, submissionId: string, questionId: string): Promise<string> {
  const id = crypto.randomUUID();
  const rows = await sql<{ id: string }>`
    insert into answers (id, submission_id, question_id, text_response)
    values (${id}, ${submissionId}, ${questionId}, '')
    on conflict (submission_id, question_id) do update set updated_at = answers.updated_at
    returning id
  `;
  return rows[0].id;
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function looksLikeAudio(bytes: Uint8Array, mime: string, ext: string): boolean {
  const head = bytes.subarray(0, 16);
  const ebml = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  const riff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  const ogg = head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53;
  const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
  const mp3 = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  const ftyp = bytes.length > 11 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (ebml || ogg || id3 || mp3 || ftyp) return true;
  if (riff && bytes.length > 11) {
    const wave = bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    if (wave) return true;
  }
  const allowedExt = ["mp3", "wav", "m4a", "webm", "ogg", "aac", "mp4"];
  const allowedMime = ["audio/webm", "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/ogg"];
  return allowedExt.includes(ext) && (allowedMime.includes(mime) || mime === "" || mime === "application/octet-stream");
}

function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\-\u3400-\u9fff ()\[\]]+/g, "_").slice(0, 80);
  return cleaned || "file";
}

export async function addAttachment(input: {
  submissionId: string;
  token: string;
  questionId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<AttachmentMeta> {
  const question = assertQuestion(input.questionId);
  if (question.media === "none") throw new SoundError("這一題不用附檔案。");
  const sql = await getSql();
  await owns(sql, input.submissionId, input.token);
  const ext = (input.fileName.split(".").pop() ?? "").toLowerCase();
  let mime = input.mimeType.toLowerCase().split(";")[0].trim();
  if (question.media === "image") {
    const sniffed = sniffImage(input.bytes);
    if (!sniffed) throw new SoundError("只接受 JPG、PNG 或 WebP。");
    if (input.bytes.length > LIMITS.imageBytes) throw new SoundError("照片請小於 4 MB。");
    mime = sniffed;
  } else {
    if (input.bytes.length > LIMITS.audioBytes) throw new SoundError("聲音檔請小於 6 MB。");
    if (!looksLikeAudio(input.bytes, mime, ext)) throw new SoundError("這個聲音格式目前讀不了。請用 MP3、WAV、M4A 或 WebM。");
    if (mime === "audio/mp3") mime = "audio/mpeg";
    if (!mime.startsWith("audio/")) mime = ext === "wav" ? "audio/wav" : ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : "audio/webm";
  }
  const answerId = await ensureAnswer(sql, input.submissionId, input.questionId);
  const existing = await sql<{ n: number; kind: string }>`
    select count(*)::int as n from attachments where answer_id = ${answerId}
  `;
  const count = Number(existing[0]?.n ?? 0);
  const cap = question.media === "image" ? LIMITS.maxImages : LIMITS.maxAudio;
  if (count >= cap) throw new SoundError(question.media === "image" ? "照片已到上限。" : "聲音已到上限。");
  const total = await sql<{ n: number }>`
    select count(*)::int as n
    from attachments t
    join answers a on a.id = t.answer_id
    where a.submission_id = ${input.submissionId}
  `;
  if (Number(total[0]?.n ?? 0) >= 40) throw new SoundError("檔案已到上限。");
  const id = crypto.randomUUID();
  const fileName = safeFileName(input.fileName);
  await sql.query(
    `insert into attachments (id, answer_id, file_name, mime_type, byte_size, data)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, answerId, fileName, mime, input.bytes.length, Buffer.from(input.bytes)],
  );
  await touch(sql, input.submissionId);
  return {
    id,
    fileName,
    mimeType: mime,
    byteSize: input.bytes.length,
    createdAt: new Date().toISOString(),
  };
}

export async function removeAttachment(submissionId: string, token: string, attachmentId: string): Promise<void> {
  const sql = await getSql();
  await owns(sql, submissionId, token);
  await sql.query(
    `delete from attachments t
     using answers a
     where t.id = $1 and t.answer_id = a.id and a.submission_id = $2`,
    [attachmentId, submissionId],
  );
  await touch(sql, submissionId);
}

export async function makeFeedback(
  id: string,
  token: string,
  questionId: string,
): Promise<{ feedback: string | null }> {
  const question = assertQuestion(questionId);
  const sql = await getSql();
  await owns(sql, id, token);
  const rows = await sql<AnswerRow>`
    select id, question_id, text_response, ai_feedback, feedback_hash
    from answers where submission_id = ${id} and question_id = ${questionId}
  `;
  const text = rows[0]?.text_response?.trim() ?? "";
  if (!text) return { feedback: null };
  const hash = sha256(text);
  if (rows[0]?.ai_feedback && rows[0].feedback_hash === hash) {
    return { feedback: rows[0].ai_feedback };
  }
  const line = await poeticLine(question.title, text);
  if (!line) return { feedback: null };
  await sql`
    update answers
    set ai_feedback = ${line}, feedback_hash = ${hash}, updated_at = now()
    where submission_id = ${id} and question_id = ${questionId}
  `;
  return { feedback: line };
}

export async function submitJourney(id: string, token: string): Promise<{ closing: string }> {
  const sql = await getSql();
  await owns(sql, id, token);
  const view = await loadView(sql, id);
  const hash = contentHash(view.displayName, view.answers);
  const cached = await sql<{ closing_message: string | null; closing_hash: string | null }>`
    select closing_message, closing_hash from submissions where id = ${id}
  `;
  if (cached[0]?.closing_message && cached[0].closing_hash === hash) {
    await sql`update submissions set status = 'submitted', updated_at = now() where id = ${id}`;
    return { closing: cached[0].closing_message };
  }
  const blocks = view.answers.flatMap((a) => {
    const q = questionById(a.questionId);
    if (!q || !a.text.trim()) return [];
    return [{ title: q.title, text: a.text }];
  });
  let closing: string;
  if (!blocks.length) closing = EMPTY_FALLBACK;
  else closing = (await poeticClosing(view.displayName, blocks)) ?? CLOSING_FALLBACK;
  await sql`
    update submissions
    set status = 'submitted', closing_message = ${closing}, closing_hash = ${hash}, updated_at = now()
    where id = ${id}
  `;
  return { closing };
}

export async function saveTonePrompt(id: string, token: string, prompt: string): Promise<void> {
  const text = prompt.replace(/\u0000/g, "").slice(0, 8000);
  const sql = await getSql();
  await ensureToneColumn(sql);
  await owns(sql, id, token);
  await sql`
    update submissions
    set tonelab_prompt = ${text}, updated_at = now()
    where id = ${id}
  `;
}

export async function listStudio(cookieHeader: string | null): Promise<{
  items: StudioListItem[];
  participants: number;
  submitted: number;
}> {
  const sql = await requireAdmin(cookieHeader);
  const rows = await sql<{
    id: string;
    display_name: string;
    status: string;
    production_status: string;
    created_at: unknown;
    updated_at: unknown;
    answered: number;
    files: number;
  }>`
    select s.id, s.display_name, s.status, s.production_status, s.created_at, s.updated_at,
      (select count(*)::int from answers a
        where a.submission_id = s.id and length(trim(a.text_response)) > 0) as answered,
      (select count(*)::int from attachments t
        join answers a on a.id = t.answer_id
        where a.submission_id = s.id) as files
    from submissions s
    order by s.updated_at desc
  `;
  const items: StudioListItem[] = rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    status: asStatus(row.status),
    productionStatus: asProduction(row.production_status),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    answered: Number(row.answered),
    files: Number(row.files),
  }));
  return {
    items,
    participants: items.length,
    submitted: items.filter((i) => i.status === "submitted").length,
  };
}

export async function readStudio(cookieHeader: string | null, id: string): Promise<SubmissionView> {
  const sql = await requireAdmin(cookieHeader);
  return loadView(sql, id);
}

export async function saveNote(cookieHeader: string | null, id: string, note: string): Promise<void> {
  const sql = await requireAdmin(cookieHeader);
  const value = note.replace(/\u0000/g, "").slice(0, LIMITS.maxNote);
  const found = await sql`select id from submissions where id = ${id}`;
  if (!found.length) throw new SoundError("找不到這份回答。");
  await sql`
    insert into organizer_notes (submission_id, note)
    values (${id}, ${value})
    on conflict (submission_id) do update set note = excluded.note, updated_at = now()
  `;
}

export async function saveProduction(cookieHeader: string | null, id: string, status: string): Promise<void> {
  const sql = await requireAdmin(cookieHeader);
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    throw new SoundError("狀態不正確。");
  }
  const rows = await sql`update submissions set production_status = ${status}, updated_at = now() where id = ${id} returning id`;
  if (!rows.length) throw new SoundError("找不到這份回答。");
}

export async function saveAnswerOrganizer(
  cookieHeader: string | null,
  id: string,
  questionId: string,
  text: string,
): Promise<SubmissionView> {
  assertQuestion(questionId);
  const sql = await requireAdmin(cookieHeader);
  const value = cleanText(text);
  const hash = sha256(value.trim());
  const found = await sql`select id from submissions where id = ${id}`;
  if (!found.length) throw new SoundError("找不到這份回答。");
  await sql`
    insert into answers (id, submission_id, question_id, text_response)
    values (${crypto.randomUUID()}, ${id}, ${questionId}, ${value})
    on conflict (submission_id, question_id) do update
    set text_response = excluded.text_response,
        updated_at = now(),
        ai_feedback = case when answers.feedback_hash = ${hash} then answers.ai_feedback else null end,
        feedback_hash = case when answers.feedback_hash = ${hash} then answers.feedback_hash else null end
  `;
  await sql`update submissions set closing_hash = null, updated_at = now() where id = ${id}`;
  return loadView(sql, id);
}

export async function saveNameOrganizer(cookieHeader: string | null, id: string, displayName: string): Promise<SubmissionView> {
  const name = cleanName(displayName);
  const sql = await requireAdmin(cookieHeader);
  const rows = await sql`
    update submissions set display_name = ${name}, closing_hash = null, updated_at = now()
    where id = ${id} returning id
  `;
  if (!rows.length) throw new SoundError("找不到這份回答。");
  return loadView(sql, id);
}

export async function removeAttachmentOrganizer(
  cookieHeader: string | null,
  submissionId: string,
  attachmentId: string,
): Promise<void> {
  const sql = await requireAdmin(cookieHeader);
  await sql.query(
    `delete from attachments t
     using answers a
     where t.id = $1 and t.answer_id = a.id and a.submission_id = $2`,
    [attachmentId, submissionId],
  );
  await touch(sql, submissionId);
}

export async function removeSubmission(cookieHeader: string | null, id: string): Promise<void> {
  const sql = await requireAdmin(cookieHeader);
  const rows = await sql`delete from submissions where id = ${id} returning id`;
  if (!rows.length) throw new SoundError("找不到這份回答。");
}

export async function regenerateLine(cookieHeader: string | null, id: string, questionId: string): Promise<SubmissionView> {
  const question = assertQuestion(questionId);
  const sql = await requireAdmin(cookieHeader);
  const rows = await sql<{ text_response: string }>`
    select text_response from answers where submission_id = ${id} and question_id = ${questionId}
  `;
  const text = rows[0]?.text_response?.trim() ?? "";
  if (!text) throw new SoundError("這一題沒有文字，所以沒有句子。");
  const line = await poeticLine(question.title, text);
  if (!line) throw new SoundError("這次沒有寫成，請稍後再試。");
  await sql`
    update answers set ai_feedback = ${line}, feedback_hash = ${sha256(text)}, updated_at = now()
    where submission_id = ${id} and question_id = ${questionId}
  `;
  return loadView(sql, id);
}

export async function regenerateClosing(cookieHeader: string | null, id: string): Promise<SubmissionView> {
  const sql = await requireAdmin(cookieHeader);
  const view = await loadView(sql, id);
  const blocks = view.answers.flatMap((a) => {
    const q = questionById(a.questionId);
    if (!q || !a.text.trim()) return [];
    return [{ title: q.title, text: a.text }];
  });
  if (!blocks.length) throw new SoundError("還沒有文字可以寫結尾。");
  const closing = await poeticClosing(view.displayName, blocks);
  if (!closing) throw new SoundError("這次沒有寫成，請稍後再試。");
  const hash = contentHash(view.displayName, view.answers);
  await sql`
    update submissions set closing_message = ${closing}, closing_hash = ${hash}, updated_at = now()
    where id = ${id}
  `;
  return loadView(sql, id);
}

function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") {
    if (data.startsWith("\\x")) return Uint8Array.from(Buffer.from(data.slice(2), "hex"));
    return Uint8Array.from(Buffer.from(data, "base64"));
  }
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    return Uint8Array.from((data as { data: number[] }).data);
  }
  throw new SoundError("檔案讀不出來。");
}

export async function readMedia(
  attachmentId: string,
  cookieHeader: string | null,
  editToken: string | null,
): Promise<{ fileName: string; mimeType: string; bytes: Uint8Array } | null> {
  const sql = await getSql();
  const meta = await sql<{ edit_token_hash: string }>`
    select s.edit_token_hash
    from attachments t
    join answers a on a.id = t.answer_id
    join submissions s on s.id = a.submission_id
    where t.id = ${attachmentId}
  `;
  if (!meta.length) return null;
  const admin = await sessionValid(sql, readCookie(cookieHeader, STUDIO_COOKIE));
  let allowed = admin;
  if (!allowed && editToken && /^[a-f0-9]{64}$/.test(editToken.trim().toLowerCase())) {
    allowed = sha256(editToken.trim().toLowerCase()) === meta[0].edit_token_hash;
  }
  if (!allowed) return null;
  const rows = await sql.query<{ file_name: string; mime_type: string; data: unknown }>(
    "select file_name, mime_type, data from attachments where id = $1",
    [attachmentId],
  );
  if (!rows.length) return null;
  return { fileName: rows[0].file_name, mimeType: rows[0].mime_type, bytes: asBytes(rows[0].data) };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function exportCsv(cookieHeader: string | null): Promise<string> {
  const sql = await requireAdmin(cookieHeader);
  const ids = await sql<{ id: string }>`select id from submissions order by created_at`;
  const views: SubmissionView[] = [];
  for (const row of ids) views.push(await loadView(sql, row.id));
  const headers = [
    "名字",
    "狀態",
    "製作狀態",
    "建立時間",
    "更新時間",
    "結尾",
    "聲音質感",
    "主辦筆記",
    ...QUESTIONS.flatMap((q) => [`${q.title}・文字`, `${q.title}・回應`, `${q.title}・檔案`]),
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const view of views) {
    const cells = [
      view.displayName,
      view.status,
      view.productionStatus,
      view.createdAt,
      view.updatedAt,
      view.closingMessage ?? "",
      view.tonePrompt,
      view.note,
      ...view.answers.flatMap((a) => [
        a.text,
        a.feedback ?? "",
        a.attachments.map((f) => f.fileName).join(" | "),
      ]),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function renderText(view: SubmissionView): string {
  const lines: string[] = [
    "The Sound Together",
    view.displayName,
    "",
    `狀態：${view.status === "submitted" ? "已送出" : "撰寫中"}`,
    `製作：${view.productionStatus === "completed" ? "已完成" : view.productionStatus === "in_progress" ? "製作中" : "未開始"}`,
    `建立：${view.createdAt}`,
    `更新：${view.updatedAt}`,
    "",
    "主辦筆記",
    view.note.trim() || "（無）",
    "",
  ];
  view.answers.forEach((a, index) => {
    const q = QUESTIONS[index];
    lines.push(`${String(index + 1).padStart(2, "0")} ${q.title}`);
    lines.push(q.prompt);
    lines.push("");
    lines.push(a.text.trim() || "（未填）");
    if (a.feedback) {
      lines.push("");
      lines.push(a.feedback);
    }
    if (a.attachments.length) {
      lines.push("");
      lines.push(`檔案：${a.attachments.map((f) => f.fileName).join("、")}`);
    }
    lines.push("");
  });
  lines.push("結尾");
  lines.push(view.closingMessage?.trim() || "（尚未寫下）");
  lines.push("");
  lines.push("聲音質感（ToneLab）");
  lines.push(view.tonePrompt.trim() || "（沒有貼上）");
  lines.push("");
  return lines.join("\n");
}

export async function exportText(cookieHeader: string | null, id: string): Promise<{ name: string; body: string }> {
  const view = await readStudio(cookieHeader, id);
  return { name: view.displayName, body: renderText(view) };
}

export async function exportZip(cookieHeader: string | null, id: string): Promise<{ name: string; bytes: Uint8Array }> {
  const sql = await requireAdmin(cookieHeader);
  const view = await loadView(sql, id);
  const files: { name: string; data: Uint8Array }[] = [
    { name: "responses.txt", data: new TextEncoder().encode(renderText(view)) },
  ];
  const answerIds = await sql<{ id: string; question_id: string }>`
    select id, question_id from answers where submission_id = ${id}
  `;
  for (const answer of answerIds) {
    const index = QUESTIONS.findIndex((q) => q.id === answer.question_id);
    const prefix = `${String(index + 1).padStart(2, "0")}`;
    const blobs = await sql.query<{ file_name: string; data: unknown }>(
      "select file_name, data from attachments where answer_id = $1 order by created_at",
      [answer.id],
    );
    blobs.forEach((blob, i) => {
      files.push({
        name: `${prefix}-${i + 1}-${blob.file_name}`,
        data: asBytes(blob.data),
      });
    });
  }
  const safe = view.displayName.replace(/[^\w\u3400-\u9fff\- ]+/g, "").trim().slice(0, 40) || "participant";
  return { name: `${safe}.zip`, bytes: buildZip(files) };
}
