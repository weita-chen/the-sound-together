import type { ErrorComponentProps } from "@tanstack/react-router";

const FALLBACK_MESSAGE = "發生了一點意外。重新整理後可以再試一次。";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="shell">
      <div className="column rise flex flex-1 flex-col items-start justify-center gap-4">
        <p className="eyebrow">The Sound Together</p>
        <h1 className="serif text-3xl">這裡停了一下</h1>
        <p className="max-w-md text-dim break-words">{errorMessage(error)}</p>
      </div>
    </main>
  );
}
