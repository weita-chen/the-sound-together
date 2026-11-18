import { createServerFn } from "@tanstack/react-start";
import { LIMITS } from "./questions";
import type { StudioGate, StudioListItem, SubmissionView } from "./types";

type Store = typeof import("./store.server");

async function store(): Promise<Store> {
  return import("./store.server");
}

async function cookieHeader(): Promise<string | null> {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  return getRequestHeader("cookie") ?? null;
}

async function run<T>(work: (mod: Store) => Promise<T>): Promise<T> {
  const mod = await store();
  try {
    return await work(mod);
  } catch (err) {
    if (err instanceof mod.SoundError) throw new Error(err.message);
    console.error(err);
    throw new Error("剛剛沒有完成，請再試一次。");
  }
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
    secure,
  };
}

async function writeSession(token: string) {
  const { setCookie, getRequestProtocol } = await import("@tanstack/react-start/server");
  setCookie("st_studio", token, cookieOptions(getRequestProtocol() === "https"));
}

export const studioGate = createServerFn({ method: "GET" }).handler(async (): Promise<StudioGate> => {
  return run(async (mod) => mod.gateStatus(await cookieHeader()));
});

export const setupStudio = createServerFn({ method: "POST" })
  .validator((data: { password: string; confirm: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.setupPassword(data.password, data.confirm);
      await writeSession(await mod.createSession());
      return { ok: true as const };
    });
  });

export const enterStudio = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.checkOrganizerPassword(data.password);
      await writeSession(await mod.createSession());
      return { ok: true as const };
    });
  });

export const leaveStudio = createServerFn({ method: "POST" }).handler(async () => {
  return run(async (mod) => {
    await mod.destroySession(await cookieHeader());
    const { deleteCookie, getRequestProtocol } = await import("@tanstack/react-start/server");
    deleteCookie("st_studio", cookieOptions(getRequestProtocol() === "https"));
    return { ok: true as const };
  });
});

export const welcomeLine = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => {
    const name = data.name.trim();
    if (!name || name.length > LIMITS.maxName) throw new Error("先留下一個稱呼。");
    return { name };
  })
  .handler(async ({ data }) => {
    const { poeticWelcome } = await import("./ai.server");
    return { line: await poeticWelcome(data.name) };
  });

export const createSubmission = createServerFn({ method: "POST" })
  .validator((data: { displayName: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => mod.createSubmission(data.displayName));
  });

export const renameSubmission = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string; displayName: string }) => data)
  .handler(async ({ data }) => {
    return run((mod) => mod.renameSubmission(data.id, data.token, data.displayName));
  });

export const resumeSubmission = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run((mod) => mod.resumeSubmission(data.id, data.token));
  });

export const resumeByToken = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run((mod) => mod.resumeByToken(data.token));
  });

export const saveAnswer = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string; questionId: string; text: string }) => {
    if (typeof data.text !== "string" || data.text.length > LIMITS.maxText + 200) {
      throw new Error("這段文字太長了。");
    }
    return data;
  })
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.saveAnswer(data.id, data.token, data.questionId, data.text);
      return { ok: true as const };
    });
  });

export const removeOwnAttachment = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string; attachmentId: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.removeAttachment(data.id, data.token, data.attachmentId);
      return { ok: true as const };
    });
  });

export const makeFeedback = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string; questionId: string }) => data)
  .handler(async ({ data }) => {
    return run((mod) => mod.makeFeedback(data.id, data.token, data.questionId));
  });

export const saveTonePrompt = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string; prompt: string }) => {
    if (typeof data.prompt !== "string" || data.prompt.length > LIMITS.maxText + 200) {
      throw new Error("這段文字太長了。");
    }
    return data;
  })
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.saveTonePrompt(data.id, data.token, data.prompt);
      return { ok: true as const };
    });
  });

export const submitJourney = createServerFn({ method: "POST" })
  .validator((data: { id: string; token: string }) => data)
  .handler(async ({ data }) => {
    return run((mod) => mod.submitJourney(data.id, data.token));
  });

export const listStudio = createServerFn({ method: "GET" }).handler(async () => {
  return run(async (mod) => mod.listStudio(await cookieHeader()));
});

export const readStudioSubmission = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run(async (mod) => mod.readStudio(await cookieHeader(), data.id));
  });

export const saveStudioNote = createServerFn({ method: "POST" })
  .validator((data: { id: string; note: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.saveNote(await cookieHeader(), data.id, data.note);
      return { ok: true as const };
    });
  });

export const saveStudioStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string; status: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.saveProduction(await cookieHeader(), data.id, data.status);
      return { ok: true as const };
    });
  });

export const saveStudioAnswer = createServerFn({ method: "POST" })
  .validator((data: { id: string; questionId: string; text: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run(async (mod) =>
      mod.saveAnswerOrganizer(await cookieHeader(), data.id, data.questionId, data.text),
    );
  });

export const saveStudioName = createServerFn({ method: "POST" })
  .validator((data: { id: string; displayName: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run(async (mod) => mod.saveNameOrganizer(await cookieHeader(), data.id, data.displayName));
  });

export const removeStudioFile = createServerFn({ method: "POST" })
  .validator((data: { id: string; attachmentId: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.removeAttachmentOrganizer(await cookieHeader(), data.id, data.attachmentId);
      return { ok: true as const };
    });
  });

export const removeStudioSubmission = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    return run(async (mod) => {
      await mod.removeSubmission(await cookieHeader(), data.id);
      return { ok: true as const };
    });
  });

export const rewriteLine = createServerFn({ method: "POST" })
  .validator((data: { id: string; questionId: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run(async (mod) => mod.regenerateLine(await cookieHeader(), data.id, data.questionId));
  });

export const rewriteClosing = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SubmissionView> => {
    return run(async (mod) => mod.regenerateClosing(await cookieHeader(), data.id));
  });

export type { StudioListItem };
