-- E2EE Case Transfer Schema (Zero-Knowledge)
-- Supabase acts only as key directory + ciphertext courier.

create extension if not exists pgcrypto;

-- ============================================================
-- Types
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'key_algorithm') then
    create type public.key_algorithm as enum ('x25519');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_status') then
    create type public.case_status as enum ('sent', 'received', 'failed');
  end if;
end $$;

-- ============================================================
-- Helper
-- ============================================================
create or replace function public.auth_uid()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- user_keys: public key directory + encrypted private key backup
-- ============================================================
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  algorithm public.key_algorithm not null default 'x25519',
  public_key text not null,
  encrypted_private_key text not null,
  private_key_mac_base64 text not null default '',
  kdf_algorithm text not null default 'argon2id',
  kdf_salt_base64 text not null,
  kdf_params jsonb not null default '{"memoryKib":65536,"iterations":3,"parallelism":1}'::jsonb,
  private_key_nonce_base64 text not null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_keys_touch
before update on public.user_keys
for each row execute function public.touch_updated_at();

alter table public.user_keys enable row level security;

-- Anyone can read public key directory. Encrypted private key is also ciphertext.
create policy user_keys_select_all
on public.user_keys
for select
to authenticated
using (true);

-- User can insert their own key row once.
create policy user_keys_insert_self
on public.user_keys
for insert
to authenticated
with check (user_id = public.auth_uid());

-- User can rotate/update only their own key row.
create policy user_keys_update_self
on public.user_keys
for update
to authenticated
using (user_id = public.auth_uid())
with check (user_id = public.auth_uid());

-- User can delete only their own key row.
create policy user_keys_delete_self
on public.user_keys
for delete
to authenticated
using (user_id = public.auth_uid());

-- ============================================================
-- cases: encrypted envelope metadata + encrypted file key
-- ============================================================
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  key_version int not null default 1,
  encrypted_metadata jsonb not null,
  encrypted_file_key jsonb not null, -- ECIES wrapped AES key envelope
  storage_bucket text not null default 'encrypted-cases',
  storage_object_path text not null, -- sender_id/receiver_id/case_id/payload.enc
  file_sha256 text,                  -- sha256 of encrypted payload
  file_size_bytes bigint,
  status public.case_status not null default 'sent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_sender_receiver_diff check (sender_id <> receiver_id)
);

create index if not exists idx_cases_sender_id on public.cases(sender_id);
create index if not exists idx_cases_receiver_id on public.cases(receiver_id);
create index if not exists idx_cases_created_at on public.cases(created_at desc);

create trigger trg_cases_touch
before update on public.cases
for each row execute function public.touch_updated_at();

alter table public.cases enable row level security;

-- Sender/receiver can read their own envelopes.
create policy cases_select_participants
on public.cases
for select
to authenticated
using (
  sender_id = public.auth_uid()
  or receiver_id = public.auth_uid()
);

-- Sender creates case only as themselves.
create policy cases_insert_sender
on public.cases
for insert
to authenticated
with check (
  sender_id = public.auth_uid()
  and receiver_id is not null
  and storage_bucket = 'encrypted-cases'
);

-- Sender or receiver can update status / storage path only.
-- Crypto fields are protected by a trigger (RLS cannot reference OLD in WITH CHECK).
create policy cases_update_participants
on public.cases
for update
to authenticated
using (
  sender_id = public.auth_uid()
  or receiver_id = public.auth_uid()
)
with check (
  sender_id = public.auth_uid()
  or receiver_id = public.auth_uid()
);

create or replace function public.cases_protect_crypto_fields()
returns trigger
language plpgsql
as $$
begin
  if new.encrypted_metadata is distinct from old.encrypted_metadata
     or new.encrypted_file_key is distinct from old.encrypted_file_key
     or new.sender_id is distinct from old.sender_id
     or new.receiver_id is distinct from old.receiver_id then
    raise exception 'Crypto and participant fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cases_protect_crypto on public.cases;
create trigger trg_cases_protect_crypto
before update on public.cases
for each row execute function public.cases_protect_crypto_fields();

-- Optional: sender can delete before receiver processes.
create policy cases_delete_sender
on public.cases
for delete
to authenticated
using (sender_id = public.auth_uid());

-- ============================================================
-- Storage RLS for encrypted payload bucket
-- Path convention: {sender_id}/{receiver_id}/{case_id}/payload.enc
-- ============================================================
insert into storage.buckets (id, name, public)
values ('encrypted-cases', 'encrypted-cases', false)
on conflict (id) do nothing;

create or replace function public.path_part(path text, idx int)
returns text
language sql
immutable
as $$
  select split_part(path, '/', idx);
$$;

-- Read only if user is sender or receiver encoded in object path.
create policy storage_encrypted_cases_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'encrypted-cases'
  and (
    public.path_part(name, 1)::uuid = public.auth_uid()
    or public.path_part(name, 2)::uuid = public.auth_uid()
  )
);

-- Insert only for sender into first path segment.
create policy storage_encrypted_cases_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'encrypted-cases'
  and public.path_part(name, 1)::uuid = public.auth_uid()
);

-- Update/delete only by sender.
create policy storage_encrypted_cases_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'encrypted-cases'
  and public.path_part(name, 1)::uuid = public.auth_uid()
)
with check (
  bucket_id = 'encrypted-cases'
  and public.path_part(name, 1)::uuid = public.auth_uid()
);

create policy storage_encrypted_cases_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'encrypted-cases'
  and public.path_part(name, 1)::uuid = public.auth_uid()
);
