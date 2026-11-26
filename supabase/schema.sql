-- FP3級 学習アプリ 保管庫の初期設定
-- Supabase の「SQL Editor」にこのファイルの中身を全部貼り付けて「Run」を押します。
-- 何度実行しても大丈夫なように書いています。
--
-- すべての表は「ログインした本人のデータだけ」読み書きできます（RLS）。

-- ===== 教材 =====
create table if not exists public.materials (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  field text not null,
  sort int not null,
  title text not null,
  content_html text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ===== ○×問題 =====
create table if not exists public.questions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  material_id text not null,
  sort int not null,
  text text not null,
  answer boolean not null,
  explanation text not null default '',
  primary key (user_id, id)
);

-- ===== アップロードしたファイル（音声・動画・スライド） =====
create table if not exists public.media (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  material_id text not null,
  kind text not null check (kind in ('audio', 'video', 'slides')),
  storage_path text not null,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id, kind)
);

-- ===== 進み具合（聞いた・見た・読んだ、再生位置） =====
create table if not exists public.progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  material_id text not null,
  kind text not null check (kind in ('audio', 'video', 'slides', 'text')),
  done boolean not null default false,
  position_sec real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id, kind)
);

-- ===== ○×問題の解答の記録 =====
create table if not exists public.quiz_attempts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  question_id text not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ===== 勉強時間の記録 =====
create table if not exists public.study_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  day date not null,
  seconds int not null check (seconds >= 0),
  source text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ===== 設定（試験日など） =====
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  exam_date date not null default '2027-01-31',
  updated_at timestamptz not null default now()
);

-- ===== 鍵（RLS）と権限 =====
do $$
declare t text;
begin
  foreach t in array array['materials','questions','media','progress','quiz_attempts','study_logs','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ===== ファイル置き場（非公開、1ファイル50MBまで） =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "media own files read" on storage.objects;
drop policy if exists "media own files insert" on storage.objects;
drop policy if exists "media own files update" on storage.objects;
drop policy if exists "media own files delete" on storage.objects;

create policy "media own files read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media own files update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
