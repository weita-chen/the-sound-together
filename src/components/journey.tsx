import { useEffect, useState } from "react";
import { AmbientField } from "@/components/ambient-field";
import { HostDoor } from "@/components/host-door";
import { ImageWell, SoundDesk, useBlobUrls } from "@/components/media-fields";
import {
  createSubmission,
  makeFeedback,
  removeOwnAttachment,
  renameSubmission,
  resumeByToken,
  resumeSubmission,
  saveAnswer,
  saveTonePrompt,
  submitJourney,
  welcomeLine,
} from "@/lib/sound/fns";
import { appPath } from "@/lib/sound/paths";
import { LIMITS, QUESTIONS, readClosing } from "@/lib/sound/questions";
import type { SubmissionView } from "@/lib/sound/types";

const STORAGE = "sound-together.v1";

type Stage = "landing" | "name" | "welcome" | "question" | "interlude" | "review" | "submitting" | "done";

type LocalSession = {
  id: string;
  token: string;
  stage: Stage;
  questionIndex: number;
};

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "剛剛沒有完成，請再試一次。";
}

function excerpt(text: string, files: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean) return clean.length > 72 ? `${clean.slice(0, 72)}…` : clean;
  if (files) return `附了 ${files} 個檔案`;
  return "尚未填寫";
}

export function Journey() {
  const [booting, setBooting] = useState(true);
  const [stage, setStage] = useState<Stage>("landing");
  const [session, setSession] = useState<{ id: string; token: string } | null>(null);
  const [submission, setSubmission] = useState<SubmissionView | null>(null);
  const [name, setName] = useState("");
  const [qIndex, setQIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState("");
  const [toneNote, setToneNote] = useState("");
  const [line, setLine] = useState("");
  const [welcome, setWelcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const question = QUESTIONS[qIndex];
  const answer = submission?.answers[qIndex];
  const mediaIds = (answer?.attachments ?? []).map((file) => file.id);
  const urls = useBlobUrls(stage === "question" || stage === "review" ? mediaIds : [], session?.token);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (!raw) return;
        const saved = JSON.parse(raw) as LocalSession;
        if (!saved?.id || !/^[a-f0-9]{64}$/.test(saved.token ?? "")) return;
        const view = await resumeSubmission({ data: { id: saved.id, token: saved.token } });
        if (cancel) return;
        const index = Math.min(Math.max(saved.questionIndex ?? 0, 0), QUESTIONS.length - 1);
        setSession({ id: saved.id, token: saved.token });
        setSubmission(view);
        setName(view.displayName);
        setQIndex(index);
        setDraft(view.answers[index]?.text ?? "");
        const next = saved.stage;
        if (next === "landing" || next === "name" || next === "review" || next === "question" || next === "done") {
          setStage(next === "done" && !view.closingMessage && view.status !== "submitted" ? "review" : next);
        }
      } catch (err) {
        const message = messageOf(err);
        if (message.includes("找不到") || message.includes("代碼")) localStorage.removeItem(STORAGE);
      } finally {
        if (!cancel) setBooting(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (booting || !session) return;
    const stored: Stage = stage === "interlude" || stage === "submitting" || stage === "welcome" ? "question" : stage;
    const payload: LocalSession = {
      id: session.id,
      token: session.token,
      stage: stored,
      questionIndex: qIndex,
    };
    localStorage.setItem(STORAGE, JSON.stringify(payload));
  }, [booting, session, stage, qIndex]);

  useEffect(() => {
    if (booting || stage !== "question" || !session || !question) return;
    localStorage.setItem(`${STORAGE}.draft`, JSON.stringify({ questionId: question.id, text: draft }));
    const handle = window.setTimeout(() => {
      void saveAnswer({
        data: { id: session.id, token: session.token, questionId: question.id, text: draft },
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [booting, draft, question, session, stage]);

  useEffect(() => {
    setTone(submission?.tonePrompt ?? "");
    setToneNote("");
  }, [submission?.id]);

  useEffect(() => {
    if (booting || stage !== "done" || !session || !submission) return;
    if (tone === submission.tonePrompt) return;
    setToneNote("正在留下…");
    const sent = tone;
    const handle = window.setTimeout(() => {
      void saveTonePrompt({
        data: { id: session.id, token: session.token, prompt: sent },
      })
        .then(() => {
          setSubmission((prev) => (prev && prev.tonePrompt !== sent ? { ...prev, tonePrompt: sent } : prev));
          setToneNote(sent.trim() ? "已留下。" : "");
        })
        .catch(() => setToneNote("剛剛沒有留下，再貼一次。"));
    }, 700);
    return () => window.clearTimeout(handle);
  }, [booting, session, stage, submission, tone]);

  function patchText(questionId: string, text: string, feedback?: string | null) {
    setSubmission((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: prev.answers.map((item) =>
          item.questionId === questionId
            ? { ...item, text, feedback: feedback === undefined ? item.feedback : feedback }
            : item,
        ),
      };
    });
  }

  function beginNew() {
    localStorage.removeItem(STORAGE);
    setSession(null);
    setSubmission(null);
    setName("");
    setDraft("");
    setQIndex(0);
    setError(null);
    setCode("");
    setStage("name");
  }

  async function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("先留下一個稱呼。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!session) {
        const created = await createSubmission({ data: { displayName: trimmed } });
        setSession({ id: created.id, token: created.token });
        setSubmission(created.view);
        setQIndex(0);
        setDraft("");
      } else {
        const view = await renameSubmission({
          data: { id: session.id, token: session.token, displayName: trimmed },
        });
        setSubmission(view);
        setDraft(view.answers[qIndex]?.text ?? "");
      }
      const greeted = await welcomeLine({ data: { name: trimmed } });
      setWelcome(greeted.line);
      setStage("welcome");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function persist(text: string) {
    if (!session) return;
    await saveAnswer({
      data: { id: session.id, token: session.token, questionId: question.id, text },
    });
    patchText(question.id, text, text.trim() ? undefined : null);
  }

  function goIndex(next: number, textAtNext: string) {
    if (next >= QUESTIONS.length) {
      setStage("review");
      return;
    }
    setQIndex(next);
    setDraft(textAtNext);
    setStage("question");
  }

  async function forward(mode: "continue" | "skip") {
    if (!session || busy || recording) return;
    const text = mode === "skip" ? "" : draft;
    setBusy(true);
    setError(null);
    try {
      await persist(text);
      if (mode === "skip") setDraft("");
      if (mode === "continue" && text.trim()) {
        const result = await makeFeedback({
          data: { id: session.id, token: session.token, questionId: question.id },
        });
        if (result.feedback) {
          patchText(question.id, text, result.feedback);
          setLine(result.feedback);
          setStage("interlude");
          return;
        }
      }
      const nextText = submission?.answers[qIndex + 1]?.text ?? "";
      goIndex(qIndex + 1, nextText);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === "question") await persist(draft);
      if (stage === "review") {
        const prev = QUESTIONS.length - 1;
        setQIndex(prev);
        setDraft(submission?.answers[prev]?.text ?? "");
        setStage("question");
        return;
      }
      if (stage !== "question" || qIndex === 0) {
        setStage("name");
        return;
      }
      const prev = qIndex - 1;
      setQIndex(prev);
      setDraft(submission?.answers[prev]?.text ?? "");
      setStage("question");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function afterInterlude() {
    const nextText = submission?.answers[qIndex + 1]?.text ?? "";
    goIndex(qIndex + 1, nextText);
  }

  async function finish() {
    if (!session || busy) return;
    setBusy(true);
    setStage("submitting");
    setError(null);
    try {
      const result = await submitJourney({ data: { id: session.id, token: session.token } });
      setSubmission((prev) =>
        prev ? { ...prev, status: "submitted", closingMessage: result.closing } : prev,
      );
      setStage("done");
    } catch (err) {
      setError(messageOf(err));
      setStage("review");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const token = code.trim().toLowerCase();
      const view = await resumeByToken({ data: { token } });
      setSession({ id: view.id, token });
      setSubmission(view);
      setName(view.displayName);
      setQIndex(0);
      setDraft(view.answers[0]?.text ?? "");
      setStage(view.status === "submitted" ? "done" : "review");
      setCodeOpen(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!session || !files.length) return;
    const tooBig = files.some((file) => file.size > (question.media === "image" ? LIMITS.imageBytes : LIMITS.audioBytes));
    if (tooBig) {
      setError(question.media === "image" ? "照片請小於 4 MB。" : "聲音檔請小於 6 MB。");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const body = new FormData();
        body.set("submissionId", session.id);
        body.set("token", session.token);
        body.set("questionId", question.id);
        body.set("file", file);
        const res = await fetch(appPath("/api/upload"), { method: "POST", body });
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(payload?.error || "檔案沒有放進去。");
      }
      const view = await resumeSubmission({ data: { id: session.id, token: session.token } });
      setSubmission(view);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(attachmentId: string) {
    if (!session) return;
    setError(null);
    try {
      await removeOwnAttachment({ data: { id: session.id, token: session.token, attachmentId } });
      const view = await resumeSubmission({ data: { id: session.id, token: session.token } });
      setSubmission(view);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function copyCode() {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const progress = stage === "review" || stage === "done" ? 1 : (qIndex + 1) / QUESTIONS.length;
  const closing = readClosing(submission?.closingMessage);

  return (
    <>
      <AmbientField />
      <main className="shell shell-mark">
        {(stage === "question" || stage === "interlude" || stage === "review") && (
          <div className="column">
            <div className="progress" style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
        <div className="column flex flex-1 flex-col justify-center py-12 sm:py-24">
          {stage === "landing" && (
            <section className="rise mx-auto flex w-full max-w-md flex-col items-center gap-12 text-center sm:gap-24">
              <div className="flex flex-col items-center gap-10">
                <p className="eyebrow">A private listening</p>
                <h1 className="serif text-4xl leading-normal sm:text-5xl">The Sound Together</h1>
              </div>
              <div className="verse">
                <p>每一段記憶都有聲音。每一種感受都帶著節奏。</p>
                <p>在去過的地方、活過的片刻，和還記得的旋律之間，有一首配樂正等著被聽見。</p>
                <p>這是一封邀請。分享一小塊你的世界。那些故事會變成原創音樂的靈感——為你，也為我們一起。</p>
              </div>
              <p className="text-xs leading-loose tracking-widest">大約 8–10 分鐘。每一題都可以略過。</p>
              <div className="flex flex-wrap gap-3">
                {session && submission?.status === "submitted" ? (
                  <button type="button" className="btn btn-primary" disabled={booting} onClick={() => setStage("done")}>
                    看結尾
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={booting}
                    onClick={() => (session ? setStage(submission?.status === "draft" ? "question" : "name") : beginNew())}
                  >
                    {session ? "繼續填寫" : "開始"}
                  </button>
                )}
                {session && (
                  <button type="button" className="btn btn-ghost" disabled={booting} onClick={beginNew}>
                    重新開始另一份
                  </button>
                )}
              </div>
              <div className="flex w-full flex-col items-center gap-3">
                <button type="button" className="btn btn-quiet px-0" onClick={() => setCodeOpen((v) => !v)}>
                  我有修改代碼
                </button>
                {codeOpen && (
                  <form
                    className="flex w-full flex-col gap-3 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void redeem();
                    }}
                  >
                    <input
                      className="field"
                      value={code}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="貼上代碼"
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <button type="submit" className="btn btn-ghost" disabled={busy}>
                      找回
                    </button>
                  </form>
                )}
                {error && <p className="alert">{error}</p>}
              </div>
            </section>
          )}

          {stage === "name" && (
            <section className="rise mx-auto flex w-full max-w-md flex-col gap-10">
              <p className="eyebrow">The Sound Together</p>
              <h1 className="serif text-3xl leading-normal sm:text-4xl">怎麼稱呼你？</h1>
              <p className="text-sm leading-loose">可以用名字，或你喜歡的暱稱。不用註冊。</p>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void commitName();
                }}
              >
                <label className="sr-only" htmlFor="display-name">
                  名字或暱稱
                </label>
                <input
                  id="display-name"
                  className="field"
                  maxLength={LIMITS.maxName}
                  value={name}
                  autoFocus
                  placeholder="你的名字"
                  onChange={(e) => setName(e.target.value)}
                />
                {error && <p className="alert">{error}</p>}
                <div className="flex gap-3">
                  <button type="button" className="btn btn-quiet" onClick={() => setStage("landing")}>
                    返回
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? "正在聽…" : "繼續"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {stage === "welcome" && (
            <section className="rise mx-auto flex min-h-[50dvh] w-full max-w-md flex-col justify-center gap-14">
              <p className="serif text-xl leading-loose sm:text-2xl">{welcome}</p>
              <button type="button" className="btn btn-primary self-start" onClick={() => setStage("question")}>
                往下走
              </button>
            </section>
          )}

          {stage === "question" && question && (
            <section className="rise mx-auto flex w-full max-w-md flex-col" key={question.id}>
              <p className="eyebrow tabular-nums">
                {String(qIndex + 1).padStart(2, "0")} / {String(QUESTIONS.length).padStart(2, "0")}
              </p>
              <h1 className="serif mt-8 text-3xl leading-normal">{question.title}</h1>
              <p className="mt-10 text-sm leading-loose tracking-wide">{question.prompt}</p>
              <label className="sr-only" htmlFor="answer">
                {question.title}
              </label>
              <textarea
                id="answer"
                className="write mt-12"
                value={draft}
                maxLength={LIMITS.maxText}
                placeholder="想到什麼就寫。也可以先空著。"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void forward("continue");
                }}
              />
              {question.media === "image" && (
                <ImageWell
                  files={answer?.attachments ?? []}
                  urls={urls}
                  busy={uploading}
                  onAdd={(files) => void uploadFiles(files)}
                  onRemove={(id) => void removeFile(id)}
                />
              )}
              {question.media === "audio" && (
                <SoundDesk
                  clips={answer?.attachments ?? []}
                  urls={urls}
                  busy={uploading}
                  live={recording}
                  onLive={setRecording}
                  onUpload={(file) => void uploadFiles([file])}
                  onRemove={(id) => void removeFile(id)}
                />
              )}
              {recording && <p className="mt-4 text-sm text-faint">先停止錄音，再往下走。</p>}
              {error && <p className="alert mt-4">{error}</p>}
              <div className="mt-12 flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void back()}>
                  返回
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy || recording} onClick={() => void forward("skip")}>
                  略過
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || recording} onClick={() => void forward("continue")}>
                  {busy ? "正在聽…" : "繼續"}
                </button>
              </div>
            </section>
          )}

          {stage === "interlude" && (
            <section className="rise mx-auto flex min-h-[50dvh] w-full max-w-md flex-col justify-center gap-14">
              <p className="serif text-xl leading-loose sm:text-2xl">{line}</p>
              <button type="button" className="btn btn-primary self-start" onClick={afterInterlude}>
                繼續
              </button>
            </section>
          )}

          {stage === "review" && submission && (
            <section className="rise mx-auto flex w-full max-w-md flex-col gap-12">
              <div>
                <p className="eyebrow">{submission.displayName}</p>
                <h1 className="serif mt-8 text-3xl leading-normal">再看一次</h1>
                <p className="mt-6 text-sm leading-loose">可以改任何一題，也可以就這樣交給我。</p>
              </div>
              <ol className="flex flex-col">
                {submission.answers.map((item, index) => {
                  const q = QUESTIONS[index];
                  return (
                    <li key={item.questionId} className="flex items-start justify-between gap-4 border-t border-line py-6">
                      <div>
                        <p className="text-xs tracking-wide text-faint">{q.title}</p>
                        <p className="mt-2 text-sm leading-loose">{excerpt(item.text, item.attachments.length)}</p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-quiet shrink-0"
                        onClick={() => {
                          setQIndex(index);
                          setDraft(item.text);
                          setStage("question");
                        }}
                      >
                        修改
                      </button>
                    </li>
                  );
                })}
              </ol>
              {error && <p className="alert">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-quiet" onClick={() => void back()}>
                  返回
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finish()}>
                  送出
                </button>
              </div>
            </section>
          )}

          {stage === "submitting" && (
            <section className="rise flex min-h-[40dvh] flex-col justify-center">
              <p className="serif text-2xl leading-loose">正在把這些回答收成一段聲音。</p>
            </section>
          )}

          {stage === "done" && (
            <section className="rise mx-auto flex w-full max-w-md flex-col items-start gap-12">
              <svg className="done-ring" viewBox="0 0 80 80" aria-hidden="true">
                <circle cx="40" cy="40" r="28" />
              </svg>
              <div className="flex flex-col gap-6">
                <p className="eyebrow">統整</p>
                <h1 className="serif text-2xl leading-loose">
                  {closing.reflection || "謝謝你把世界的一角留在這裡。"}
                </h1>
              </div>
              {closing.sound && (
                <div className="flex flex-col gap-6">
                  <p className="eyebrow">聲音</p>
                  <p className="text-sm leading-loose tracking-wide">{closing.sound}</p>
                </div>
              )}
              <div className="flex w-full flex-col gap-6 border-t border-line pt-10">
                <p className="eyebrow">可略過</p>
                <h2 className="serif text-2xl leading-normal">為這段聲音加一點質感</h2>
                <p className="text-sm leading-loose">
                  到聲音鍛造實驗室，把音色、空間和質地組好。複製那段 prompt，貼回這裡。沒有也沒關係。
                </p>
                <a
                  className="btn btn-ghost self-start"
                  href="https://weita-chen.github.io/tonelab/"
                  target="_blank"
                  rel="noreferrer"
                >
                  打開 ToneLab
                </a>
                <label className="sr-only" htmlFor="tonelab">
                  ToneLab prompt
                </label>
                <textarea
                  id="tonelab"
                  className="write"
                  value={tone}
                  maxLength={LIMITS.maxText}
                  placeholder="貼上在 ToneLab 複製的 prompt"
                  onChange={(e) => setTone(e.target.value)}
                />
                {toneNote && <p className="text-sm">{toneNote}</p>}
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" onClick={() => setStage("landing")}>
                  回到開頭
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setStage("review")}>
                  修改這份回答
                </button>
              </div>
              {session && (
                <div className="w-full border-t border-line pt-6">
                  <p className="text-sm text-faint">這份回答記在這台瀏覽器。換裝置時，用下面的代碼找回。</p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input className="field" readOnly value={session.token} aria-label="修改代碼" />
                    <button type="button" className="btn btn-ghost" onClick={() => void copyCode()}>
                      {copied ? "已複製" : "複製代碼"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      <HostDoor />
    </>
  );
}
