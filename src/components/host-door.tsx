import { useEffect, useRef, useState, type FormEvent } from "react";
import { enterStudio, setupStudio, studioGate } from "@/lib/sound/fns";
import { appPath } from "@/lib/sound/paths";

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "剛剛沒有完成。";
}

export function HostDoor() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openDoor() {
    setNote(null);
    try {
      const gate = await studioGate();
      if (gate.authed) {
        window.location.assign(appPath("/studio"));
        return;
      }
      setNeedsSetup(gate.needsSetup);
    } catch {
      setNeedsSetup(false);
    }
    setOpen(true);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const pass = password.trim();
    if (!pass) {
      setNote(how.trim() ? "這句話先停在門口。門沒有為它打開。" : "留一句，或留下口令。");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      if (needsSetup) await setupStudio({ data: { password: pass, confirm } });
      else await enterStudio({ data: { password: pass } });
      window.location.assign(appPath("/studio"));
    } catch (err) {
      const msg = messageOf(err);
      if (msg === "口令不對。") setNote("這句口令沒有打開門。");
      else setNote(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="host-mark no-print" aria-label="一處不起眼的記號" onClick={() => void openDoor()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        className="host-dialog"
        onClose={() => {
          setOpen(false);
          setHow("");
          setPassword("");
          setConfirm("");
          setNote(null);
        }}
      >
        {open && (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <h2 className="serif text-3xl">你是怎麼找到這裡的？</h2>
          <p className="text-sm">隨便留下一句也無妨。若你是主辦人，下面可以輸入口令。</p>
          <label className="sr-only" htmlFor="how-found">
            你是怎麼找到這裡的
          </label>
          <input
            id="how-found"
            className="field"
            value={how}
            autoComplete="off"
            placeholder="你的回答"
            onChange={(e) => setHow(e.target.value)}
          />
          <label className="text-sm" htmlFor="host-pass">
            {needsSetup ? "設一道口令" : "口令"}
          </label>
          <input
            id="host-pass"
            className="field"
            type="password"
            autoComplete={needsSetup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needsSetup && (
            <>
              <p className="text-sm">這裡還沒有口令。若你是要把故事留下的人，設一道 8 個字以上、只有你知道的。</p>
              <label className="text-sm" htmlFor="host-confirm">
                再輸入一次
              </label>
              <input
                id="host-confirm"
                className="field"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          )}
          {note && <p className="text-sm">{note}</p>}
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {password.trim() ? (needsSetup ? "設定並進入" : "進入") : "留下這句"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={close}>
              先離開
            </button>
          </div>
        </form>
        )}
      </dialog>
    </>
  );
}
