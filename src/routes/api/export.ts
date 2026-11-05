import { createFileRoute } from "@tanstack/react-router";

function disposition(fileName: string): string {
  const ascii = fileName.replace(/[^\w.\-]+/g, "_") || "export";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { exportCsv, exportText, exportZip, SoundError } = await import("@/lib/sound/store.server");
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const id = url.searchParams.get("id") ?? "";
        const cookie = request.headers.get("cookie");
        try {
          if (kind === "csv") {
            const body = await exportCsv(cookie);
            return new Response(body, {
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": disposition("sound-together.csv"),
              },
            });
          }
          if (kind === "text") {
            const file = await exportText(cookie, id);
            return new Response(file.body, {
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "content-disposition": disposition(`${file.name}.txt`),
              },
            });
          }
          if (kind === "zip") {
            const file = await exportZip(cookie, id);
            return new Response(Buffer.from(file.bytes), {
              headers: {
                "content-type": "application/zip",
                "content-disposition": disposition(file.name),
              },
            });
          }
          return new Response("不支援的匯出。", { status: 400 });
        } catch (err) {
          if (err instanceof SoundError) return new Response(err.message, { status: 401 });
          console.error(err);
          return new Response("匯出沒有完成。", { status: 500 });
        }
      },
    },
  },
});
