-- FP3級 学習アプリ 追加の設定（三択問題と模擬試験の結果）
-- Supabase の「SQL Editor」にこのファイルの中身を全部貼り付けて「Run」を押します。
-- schema.sql を実行したあとに、1回だけ実行してください（何度実行しても大丈夫です）。

-- ===== 三択問題に対応する =====
alter table public.questions add column if not exists kind text not null default 'ox';
alter table public.questions add column if not exists choices jsonb;
alter table public.questions add column if not exists answer_index int;
alter table public.questions alter column answer drop not null;
alter table public.questions drop constraint if exists questions_kind_check;
alter table public.questions add constraint questions_kind_check check (kind in ('ox', 'choice'));

-- ===== 模擬試験の結果 =====
create table if not exists public.exam_results (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  mode text not null,
  total int not null,
  correct int not null,
  passed boolean not null,
  by_field jsonb not null default '{}'::jsonb,
  duration_sec int not null default 0,
  finished_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 試験の種類：本番形式・ミニ模試・実技模試
alter table public.exam_results drop constraint if exists exam_results_mode_check;
alter table public.exam_results add constraint exam_results_mode_check check (mode in ('full', 'mini', 'jitsugi'));

alter table public.exam_results enable row level security;
drop policy if exists "own rows" on public.exam_results;
create policy "own rows" on public.exam_results for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.exam_results from anon;
grant select, insert, update, delete on public.exam_results to authenticated;
