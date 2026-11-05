import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import { LIMITS } from "@/lib/sound/questions";
import { appPath } from "@/lib/sound/paths";
import type { AttachmentMeta } from "@/lib/sound/types";

export function useBlobUrls(ids: string[], token?: string): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = ids.join("|");
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    if (!ids.length) {
      setUrls({});
      return;
    }
    void (async () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        try {
          const res = await fetch(appPath(`/api/media/${id}`), {
            credentials: "same-origin",
            headers: token ? { "x-edit-token": token } : {},
          });
          if (!res.ok) continue;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          created.push(url);
          next[id] = url;
        } catch {
          /* leave a missing preview rather than breaking the page */
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // ids identity changes every render; key captures the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);
  return urls;
}

function formatClock(total: number): string {
  const s = Math.min(LIMITS.maxRecordSec, Math.max(0, Math.floor(total)));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ImageWell({
  files,
  urls,
  busy,
  onAdd,
  onRemove,
}: {
  files: AttachmentMeta[];
  urls: Record<string, string>;
  busy: boolean;
  onAdd: (list: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const full = files.length >= LIMITS.maxImages;

  function take(list: FileList | null) {
    if (!list?.length) return;
    onAdd(Array.from(list));
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" disabled={busy || full} onClick={() => libraryRef.current?.click()}>
          <ImagePlus size={18} aria-hidden="true" />
          加入照片
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy || full} onClick={() => cameraRef.current?.click()}>
          <Camera size={18} aria-hidden="true" />
          拍照
        </button>
        <input
          ref={libraryRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-sm text-faint">JPG、PNG 或 WebP，每張 4 MB 以內。可以不放。</p>
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-3">
          {files.map((file) => (
            <li key={file.id} className="thumb">
              {urls[file.id] ? (
                <img src={urls[file.id]} alt={file.fileName} loading="lazy" />
              ) : (
                <span className="absolute inset-0" />
              )}
              <button
                type="button"
                className="btn btn-primary absolute right-2 bottom-2 min-h-10 px-3"
                aria-label={`移除 ${file.fileName}`}
                onClick={() => onRemove(file.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SoundDesk({
  clips,
  urls,
  busy,
  live,
  onLive,
  onUpload,
  onRemove,
}: {
  clips: AttachmentMeta[];
  urls: Record<string, string>;
  busy: boolean;
  live: boolean;
  onLive: (live: boolean) => void;
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "paused">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const acc = useRef(0);
  const started = useRef(0);
  const raf = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const full = clips.length >= LIMITS.maxAudio;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtx.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const timer = window.setInterval(() => {
      const extra = phaseRef.current === "recording" ? (performance.now() - started.current) / 1000 : 0;
      const next = acc.current + extra;
      setSeconds(next);
      if (next >= LIMITS.maxRecordSec && recRef.current?.state === "recording") {
        recRef.current.stop();
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  function paint() {
    const node = analyser.current;
    if (!node || phaseRef.current !== "recording") return;
    const data = new Uint8Array(node.frequencyBinCount);
    node.getByteFrequencyData(data);
    bars.current.forEach((bar, i) => {
      if (!bar) return;
      const value = data[Math.floor((i / bars.current.length) * data.length)] ?? 0;
      bar.style.height = `${18 + (value / 255) * 82}%`;
    });
    raf.current = requestAnimationFrame(paint);
  }

  async function start() {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("這個瀏覽器不能直接錄音。可以改上傳聲音檔，或用文字描述。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        cancelAnimationFrame(raf.current);
        stream.getTracks().forEach((track) => track.stop());
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        const ext = type.includes("mp4") ? "m4a" : "webm";
        onLive(false);
        setPhase("idle");
        acc.current = 0;
        setSeconds(0);
        if (blob.size > 0) onUpload(new File([blob], `recording.${ext}`, { type }));
      };
      recRef.current = recorder;
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      source.connect(node);
      analyser.current = node;
      acc.current = 0;
      started.current = performance.now();
      recorder.start();
      setPhase("recording");
      onLive(true);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) raf.current = requestAnimationFrame(paint);
    } catch {
      setError("沒有麥克風的權限。你可以改成描述，或上傳一段聲音。");
      onLive(false);
    }
  }

  function togglePause() {
    const recorder = recRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      acc.current += (performance.now() - started.current) / 1000;
      setPhase("paused");
      cancelAnimationFrame(raf.current);
      return;
    }
    if (recorder.state === "paused") {
      started.current = performance.now();
      recorder.resume();
      setPhase("recording");
      raf.current = requestAnimationFrame(paint);
    }
  }

  function stop() {
    recRef.current?.stop();
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-raised p-4">
        <div className="wave" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} ref={(el) => { bars.current[i] = el; }} />
          ))}
        </div>
        <p className="mt-3 font-sans text-sm text-dim tabular-nums">
          {formatClock(seconds)} / {formatClock(LIMITS.maxRecordSec)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {phase === "idle" ? (
            <button type="button" className="btn btn-primary" disabled={busy || full || live} onClick={() => void start()}>
              <Mic size={18} aria-hidden="true" />
              開始錄製
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={togglePause}>
                {phase === "paused" ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
                {phase === "paused" ? "繼續" : "暫停"}
              </button>
              <button type="button" className="btn btn-primary" onClick={stop}>
                <Square size={16} aria-hidden="true" />
                停止
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" disabled={busy || full || phase !== "idle"} onClick={() => fileRef.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            上傳聲音
          </button>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > LIMITS.audioBytes) {
                setError("聲音檔請小於 6 MB。");
                return;
              }
              setError(null);
              onUpload(file);
            }}
          />
        </div>
        {error && <p className="alert mt-3">{error}</p>}
      </div>
      {clips.length > 0 && (
        <ul className="flex flex-col gap-3">
          {clips.map((clip) => (
            <li key={clip.id} className="flex flex-col gap-2 border-b border-line pb-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm text-dim">{clip.fileName}</p>
                <button type="button" className="btn btn-quiet" onClick={() => onRemove(clip.id)}>
                  移除
                </button>
              </div>
              {urls[clip.id] && <audio className="w-full" controls src={urls[clip.id]} preload="none" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
