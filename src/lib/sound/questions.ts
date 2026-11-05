export type MediaKind = "none" | "image" | "audio";

export type Question = {
  id: string;
  title: string;
  prompt: string;
  media: MediaKind;
};

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    title: "此刻的顏色",
    prompt:
      "如果把你現在的世界，用一種顏色、一個畫面，或一種氣氛來形容，它會是什麼樣子？說說光、顏色、質地，或任何浮上心頭的東西。",
    media: "image",
  },
  {
    id: "q2",
    title: "想再回去的片刻",
    prompt:
      "想一個你願意再回到一次的時刻。不必盛大。也許是一個安靜的下午、童年的夏天，或與某個人在一起的片刻。你記得最清楚的是什麼？",
    media: "image",
  },
  {
    id: "q3",
    title: "熟悉的地方",
    prompt:
      "有沒有一個地方，讓你特別自在、懷念，或覺得被接住？可以是一座城市、一條街、一個房間、一間咖啡店，或大自然裡的某處。在那裡是什麼感覺？",
    media: "image",
  },
  {
    id: "q4",
    title: "記得的旋律",
    prompt:
      "有沒有一段旋律、一首歌，或一種聲音，在你心裡停留了很久？不必記得名字。你可以哼出來、上傳一段錄音，或描述它為什麼特別。",
    media: "audio",
  },
  {
    id: "q5",
    title: "說不出名字的感覺",
    prompt:
      "如果最近的心情是一種聲音，它會是什麼聲音？平靜、躁動、遙遠、帶著希望、溫暖，或難以形容？",
    media: "none",
  },
  {
    id: "q6",
    title: "心裡的天氣",
    prompt:
      "如果現在的心境是一種天氣，它會是什麼？清晨的微風、陰天的午後、夏日的驟雨，或完全不同的什麼？",
    media: "none",
  },
  {
    id: "q7",
    title: "周遭的聲音",
    prompt:
      "想想你熟悉的環境裡那些聲音。窗上的雨、舊街上的腳步、海浪、鳥、熱鬧的市場，或房間裡安靜的低鳴。你想再聽見哪些聲音？",
    media: "audio",
  },
  {
    id: "q8",
    title: "人生的片頭曲",
    prompt:
      "如果人生是一部電影，開場時會響起什麼樣的音樂？電影感的、親密的、頑皮的、神秘的、懷舊的，或出乎意料的？",
    media: "none",
  },
  {
    id: "q9",
    title: "只存在於想像的世界",
    prompt:
      "想像一個只存在於你心裡的世界。可以是沒去過的地方、做過的夢，或想經歷的未來。那裡看起來、聽起來是什麼樣子？",
    media: "image",
  },
  {
    id: "q10",
    title: "還想說的",
    prompt: "還有什麼想讓我知道的，好讓我更靠近屬於你的那種音樂？",
    media: "none",
  },
];

export const LIMITS = {
  imageBytes: 4 * 1024 * 1024,
  audioBytes: 6 * 1024 * 1024,
  maxImages: 8,
  maxAudio: 3,
  maxText: 8000,
  maxName: 40,
  maxNote: 4000,
  maxRecordSec: 120,
} as const;

export type ProductionStatus = "pending" | "in_progress" | "completed";
export type SubmissionStatus = "draft" | "submitted";

export const PRODUCTION_LABEL: Record<ProductionStatus, string> = {
  pending: "未開始",
  in_progress: "製作中",
  completed: "已完成",
};

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: "撰寫中",
  submitted: "已送出",
};

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const CLOSING_FALLBACK =
  "你的世界裡，好像有一點溫暖停在安靜與遠方之間。那首屬於你的旋律，也許一直都在那裡，慢慢展開。";

export const EMPTY_FALLBACK =
  "你留下了名字，也留下了一點安靜。音樂有時就是從那裡開始的。";
