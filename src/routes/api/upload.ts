import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > 8 * 1024 * 1024) return json({ error: "檔案太大。" }, 413);
          const form = await request.formData();
          const file = form.get("file");
          const submissionId = String(form.get("submissionId") ?? "");
          const token = String(form.get("token") ?? "");
          const questionId = String(form.get("questionId") ?? "");
          if (!(file instanceof File)) return json({ error: "沒有收到檔案。" }, 400);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { addAttachment, SoundError } = await import("@/lib/sound/store.server");
          try {
            const meta = await addAttachment({
              submissionId,
              token,
              questionId,
              fileName: file.name || "file",
              mimeType: file.type || "",
              bytes,
            });
            return json(meta);
          } catch (err) {
            if (err instanceof SoundError) return json({ error: err.message }, 400);
            console.error(err);
            return json({ error: "檔案沒有放進去。" }, 500);
          }
        } catch (err) {
          console.error(err);
          return json({ error: "檔案沒有放進去。" }, 500);
        }
      },
    },
  },
});
