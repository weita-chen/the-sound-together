create table if not exists organizer_auth (
  id integer primary key,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists organizer_sessions (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id text primary key,
  display_name text not null,
  edit_token_hash text not null unique,
  status text not null default 'draft',
  closing_message text,
  closing_hash text,
  production_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists answers (
  id text primary key,
  submission_id text not null references submissions (id) on delete cascade,
  question_id text not null,
  text_response text not null default '',
  ai_feedback text,
  feedback_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index if not exists answers_submission_idx on answers (submission_id);

create table if not exists attachments (
  id text primary key,
  answer_id text not null references answers (id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  byte_size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists attachments_answer_idx on attachments (answer_id);

create table if not exists organizer_notes (
  submission_id text primary key references submissions (id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now()
);
