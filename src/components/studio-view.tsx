import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AmbientField } from "@/components/ambient-field";
import { useBlobUrls } from "@/components/media-fields";
import {
  enterStudio,
  leaveStudio,
  listStudio,
  readStudioSubmission,
  removeStudioFile,
  removeStudioSubmission,
  rewriteClosing,
  rewriteLine,
  saveStudioAnswer,
  saveStudioName,
  saveStudioNote,
  saveStudioStatus,
  setupStudio,
  studioGate,
} from "@/lib/sound/fns";
import { appPath } from "@/lib/sound/paths";
import {
  LIMITS,
  PRODUCTION_LABEL,
  QUESTIONS,
  STATUS_LABEL,
  formatWhen,
  readClosing,
  type ProductionStatus,
} from "@/lib/sound/questions";
import type { StudioGate, StudioListItem, SubmissionView } from "@/lib/sound/types";

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "剛剛沒有完成，請再試一次。";
}

function providerLine(provider: StudioGate["provider"]): string {
  if (provider === "gemini") return "詩句由 Gemini 寫下。";
  if (provider === "grok") return "尚未設定 Gemini，詩句先由 Grok 寫下。";
  return "還沒接上寫詩的服務。回答仍會留下。";
}

async function downloadExport(path: string, fallback: string) {
  const res = await fetch(appPath(path), { credentials: "same-origin" });
  if (!res.ok) throw new Error("下載沒有完成。");
  const blob = await res.blob();
  const header = res.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(header);
  const name = match ? decodeURIComponent(match[1]) : fallback;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function StudioShell({ children }: { children: () => ReactNode }) {
  const [gate, setGate] = useState<StudioGate | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const next = await studioGate();
    setGate(next);
    return next;
  }

  useEffect(() => {
    void refresh().catch((err) => setError(messageOf(err)));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!gate) return;
    setBusy(true);
    setError(null);
    try {
      if (gate.needsSetup) await setupStudio({ data: { password, confirm } });
      else await enterStudio({ data: { password } });
      setPassword("");
      setConfirm("");
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AmbientField />
      <main className="shell">
        {!gate || !gate.authed ? (
          <section className="column rise flex flex-1 flex-col justify-center gap-6">
            <p className="eyebrow">The Sound Together</p>
            <h1 className="serif text-4xl">{gate?.needsSetup ? "設定主辦口令" : "主辦入口"}</h1>
            <p className="text-dim">
              {gate?.needsSetup
                ? "第一次進來，請設定只有你知道的口令。參與者看不到這裡的故事、照片和聲音。"
                : "這裡只有主辦人進得來。"}
            </p>
            <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
              <label className="text-sm text-faint" htmlFor="studio-pass">
                口令
              </label>
              <input
                id="studio-pass"
                className="field"
                type="password"
                autoComplete={gate?.needsSetup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {gate?.needsSetup && (
                <>
                  <label className="text-sm text-faint" htmlFor="studio-confirm">
                    再輸入一次
                  </label>
                  <input
                    id="studio-confirm"
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </>
              )}
              {error && <p className="alert">{error}</p>}
              <button type="submit" className="btn btn-primary self-start" disabled={busy || !gate}>
                {gate?.needsSetup ? "設定並進入" : "進入"}
              </button>
            </form>
            <Link to="/" className="text-sm text-faint no-underline">
              回到邀請
            </Link>
          </section>
        ) : (
          <div className="column-wide flex flex-1 flex-col gap-8 py-4">
            <p className="text-sm text-faint">{providerLine(gate.provider)}</p>
            {children()}
          </div>
        )}
      </main>
    </>
  );
}

export function StudioList() {
  const [items, setItems] = useState<StudioListItem[] | null>(null);
  const [counts, setCounts] = useState({ participants: 0, submitted: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listStudio()
      .then((result) => {
        setItems(result.items);
        setCounts({ participants: result.participants, submitted: result.submitted });
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  async function exit() {
    await leaveStudio();
    window.location.assign(appPath("/studio"));
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The Sound Together</p>
          <h1 className="serif mt-2 text-4xl">主辦</h1>
          <p className="mt-2 text-dim tabular-nums">
            參與者 {counts.participants} · 已送出 {counts.submitted}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void downloadExport("/api/export?kind=csv", "sound-together.csv").catch((err) => setError(messageOf(err)))}
          >
            匯出 CSV
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void exit()}>
            離開
          </button>
        </div>
      </header>
      {error && <p className="alert">{error}</p>}
      {!items && !error && <p className="text-dim">正在打開名冊。</p>}
      {items && items.length === 0 && <p className="text-dim">還沒有人走進來。把網址交給讀書會的成員就好。</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id} className="border-t border-line">
              <Link
                to="/studio/$submissionId"
                params={{ submissionId: item.id }}
                className="flex flex-col gap-1 py-5 text-inherit no-underline sm:flex-row sm:items-baseline sm:justify-between"
              >
                <span className="serif text-2xl">{item.displayName}</span>
                <span className="text-sm text-faint">
                  {STATUS_LABEL[item.status]} · {PRODUCTION_LABEL[item.productionStatus]} · {item.answered} 題有文字 · {item.files} 個檔案
                  <span className="mt-1 block sm:mt-0 sm:ml-3 sm:inline">{formatWhen(item.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function StudioProfile({ id }: { id: string }) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<SubmissionView | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const ids = view?.answers.flatMap((answer) => answer.attachments.map((file) => file.id)) ?? [];
  const urls = useBlobUrls(ids);

  useEffect(() => {
    let cancel = false;
    void readStudioSubmission({ data: { id } })
      .then((next) => {
        if (cancel) return;
        setView(next);
        setName(next.displayName);
        setNote(next.note);
        setDrafts(Object.fromEntries(next.answers.map((answer) => [answer.questionId, answer.text])));
      })
      .catch((err) => {
        if (!cancel) setError(messageOf(err));
      });
    return () => {
      cancel = true;
    };
  }, [id]);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: ProductionStatus) {
    await run("status", async () => {
      await saveStudioStatus({ data: { id, status } });
      setView((prev) => (prev ? { ...prev, productionStatus: status } : prev));
    });
  }

  if (!view && !error) {
    return <p className="text-dim">正在打開這份故事。</p>;
  }
  if (!view) return <p className="alert">{error}</p>;

  return (
    <article className="flex flex-col gap-10">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link to="/studio" className="text-sm text-faint no-underline">
          回到名冊
        </Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void downloadExport(`/api/export?kind=text&id=${id}`, "story.txt")}>
            下載文字
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
            列印或存成 PDF
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void downloadExport(`/api/export?kind=zip&id=${id}`, "files.zip")}>
            下載全部檔案
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <p className="eyebrow">
          {STATUS_LABEL[view.status]} · {formatWhen(view.createdAt)} 建立 · {formatWhen(view.updatedAt)} 更新
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="studio-name">
            名字
          </label>
          <input id="studio-name" className="field" value={name} maxLength={LIMITS.maxName} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy === "name"}
            onClick={() =>
              void run("name", async () => {
                const next = await saveStudioName({ data: { id, displayName: name } });
                setView(next);
                setName(next.displayName);
              })
            }
          >
            儲存名字
          </button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="製作狀態">
          {(Object.keys(PRODUCTION_LABEL) as ProductionStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={view.productionStatus === status ? "btn btn-primary" : "btn btn-ghost"}
              aria-pressed={view.productionStatus === status}
              onClick={() => void setStatus(status)}
            >
              {PRODUCTION_LABEL[status]}
            </button>
          ))}
        </div>
      </div>

      {view.closingMessage && (
        <div className="flex flex-col gap-8 border-l border-line pl-5">
          <div>
            <p className="eyebrow">統整</p>
            <p className="serif mt-4 text-2xl leading-relaxed">{readClosing(view.closingMessage).reflection || view.closingMessage}</p>
          </div>
          {readClosing(view.closingMessage).sound && (
            <div>
              <p className="eyebrow">聲音</p>
              <p className="mt-4 text-sm leading-loose">{readClosing(view.closingMessage).sound}</p>
            </div>
          )}
          <div className="no-print">
            <button type="button" className="btn btn-quiet px-0" disabled={busy === "closing"} onClick={() => void run("closing", async () => setView(await rewriteClosing({ data: { id } })))}>
              重寫結尾
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-line pt-8">
        <p className="eyebrow">聲音質感</p>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-loose">
          {view.tonePrompt.trim() || "沒有貼上 ToneLab prompt。"}
        </p>
      </div>

      <div className="flex flex-col gap-12">
        {view.answers.map((answer, index) => {
          const q = QUESTIONS[index];
          return (
            <section key={answer.questionId} className="print-block flex flex-col gap-3 border-t border-line pt-8">
              <p className="eyebrow tabular-nums">{String(index + 1).padStart(2, "0")}</p>
              <h2 className="serif text-3xl">{q.title}</h2>
              <p className="text-dim">{q.prompt}</p>
              <label className="sr-only" htmlFor={`edit-${q.id}`}>
                {q.title}的文字
              </label>
              <textarea
                id={`edit-${q.id}`}
                className="write"
                value={drafts[q.id] ?? ""}
                maxLength={LIMITS.maxText}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
              />
              <div className="no-print flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy === q.id}
                  onClick={() =>
                    void run(q.id, async () => {
                      const next = await saveStudioAnswer({ data: { id, questionId: q.id, text: drafts[q.id] ?? "" } });
                      setView(next);
                    })
                  }
                >
                  儲存文字
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy === `${q.id}-line` || !(drafts[q.id] ?? "").trim()}
                  onClick={() => void run(`${q.id}-line`, async () => setView(await rewriteLine({ data: { id, questionId: q.id } })))}
                >
                  重寫一句
                </button>
              </div>
              {answer.feedback && <p className="serif text-xl text-dim">{answer.feedback}</p>}
              {answer.attachments.length > 0 && (
                <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {answer.attachments.map((file) => (
                    <li key={file.id} className="flex flex-col gap-2">
                      {file.mimeType.startsWith("image/") && urls[file.id] ? (
                        <button type="button" className="thumb" onClick={() => setPreview({ url: urls[file.id], name: file.fileName })}>
                          <img src={urls[file.id]} alt={file.fileName} loading="lazy" />
                        </button>
                      ) : (
                        urls[file.id] && <audio className="w-full" controls src={urls[file.id]} preload="none" />
                      )}
                      <div className="no-print flex items-center justify-between gap-2">
                        {urls[file.id] ? (
                          <a className="truncate text-sm text-dim" href={urls[file.id]} download={file.fileName}>
                            {file.fileName}
                          </a>
                        ) : (
                          <span className="truncate text-sm text-dim">{file.fileName}</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() =>
                            void run(file.id, async () => {
                              await removeStudioFile({ data: { id, attachmentId: file.id } });
                              const next = await readStudioSubmission({ data: { id } });
                              setView(next);
                            })
                          }
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="serif text-2xl">只有你看得到的筆記</h2>
        <textarea className="write" value={note} maxLength={LIMITS.maxNote} onChange={(e) => setNote(e.target.value)} />
        <button
          type="button"
          className="btn btn-ghost self-start no-print"
          disabled={busy === "note"}
          onClick={() =>
            void run("note", async () => {
              await saveStudioNote({ data: { id, note } });
            })
          }
        >
          儲存筆記
        </button>
      </section>

      {error && <p className="alert">{error}</p>}

      <div className="no-print">
        <button type="button" className="btn btn-danger" onClick={() => dialogRef.current?.showModal()}>
          刪除這份回答
        </button>
        <dialog ref={dialogRef}>
          <p className="serif text-2xl">刪除 {view.displayName} 的故事？</p>
          <p className="mt-3 text-dim">文字、照片和聲音都會消失，無法復原。</p>
          <div className="mt-6 flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => dialogRef.current?.close()}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                void run("delete", async () => {
                  await removeStudioSubmission({ data: { id } });
                  void navigate({ to: "/studio" });
                })
              }
            >
              刪除
            </button>
          </div>
        </dialog>
      </div>

      {preview && (
        <button
          type="button"
          className="fixed inset-0 z-20 flex items-center justify-center bg-bg/90 p-6"
          onClick={() => setPreview(null)}
          aria-label="關閉預覽"
        >
          <img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </article>
  );
}
