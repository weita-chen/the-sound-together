import type { ProductionStatus, SubmissionStatus } from "./questions";

export type AttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
};

export type AnswerView = {
  questionId: string;
  text: string;
  feedback: string | null;
  attachments: AttachmentMeta[];
};

export type SubmissionView = {
  id: string;
  displayName: string;
  status: SubmissionStatus;
  productionStatus: ProductionStatus;
  closingMessage: string | null;
  createdAt: string;
  updatedAt: string;
  answers: AnswerView[];
  note: string;
};

export type StudioListItem = {
  id: string;
  displayName: string;
  status: SubmissionStatus;
  productionStatus: ProductionStatus;
  createdAt: string;
  updatedAt: string;
  answered: number;
  files: number;
};

export type StudioGate = {
  authed: boolean;
  needsSetup: boolean;
  provider: "gemini" | "grok" | "none";
};

export type AiProvider = StudioGate["provider"];
