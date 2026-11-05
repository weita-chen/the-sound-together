import { createFileRoute } from "@tanstack/react-router";

function disposition(fileName: string, download: boolean): string {
  const ascii = fileName.replace(/[^\w.\-]+/g, "_") || "file";
  const utf = encodeURIComponent(fileName);
  const kind = download ? "attachment" : "inline";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf}`;
}

export const Route = createFileRoute("/api/media/$attachmentId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { readMedia } = await import("@/lib/sound/store.server");
        const url = new URL(request.url);
        const token = request.headers.get("x-edit-token") || url.searchParams.get("k");
        const file = await readMedia(params.attachmentId, request.headers.get("cookie"), token);
        if (!file) return new Response("找不到檔案。", { status: 404 });
        return new Response(Buffer.from(file.bytes), {
          status: 200,
          headers: {
            "content-type": file.mimeType,
            "content-length": String(file.bytes.byteLength),
            "content-disposition": disposition(file.fileName, url.searchParams.get("download") === "1"),
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
