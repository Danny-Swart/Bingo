-- Run this in the Supabase SQL editor once.

create extension if not exists pgcrypto;

create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  cookie_token text not null unique,
  recovery_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists bingo_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) on delete set null,
  title text not null,
  rows int not null check (rows > 0),
  cols int not null check (cols > 0),
  entries jsonb not null,
  has_free boolean not null default true,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

-- Safe for existing databases created before has_free existed.
alter table bingo_templates
  add column if not exists has_free boolean not null default true;

create table if not exists bingo_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  template_id uuid references bingo_templates(id) on delete set null,
  title text,
  rows int not null check (rows > 0),
  cols int not null check (cols > 0),
  cells jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bingo_templates_public_idx
  on bingo_templates (created_at desc)
  where is_public;

create index if not exists bingo_cards_owner_id_idx
  on bingo_cards (owner_id);

alter table owners enable row level security;
alter table bingo_templates enable row level security;
alter table bingo_cards enable row level security;

-- Lean GitHub Pages access via the anon key.
-- UUIDs act as capability tokens; tighten later if needed.
drop policy if exists owners_anon_all on owners;
create policy owners_anon_all on owners
  for all to anon using (true) with check (true);

drop policy if exists templates_anon_all on bingo_templates;
create policy templates_anon_all on bingo_templates
  for all to anon using (true) with check (true);

drop policy if exists cards_anon_all on bingo_cards;
create policy cards_anon_all on bingo_cards
  for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant all on table owners to anon;
grant all on table bingo_templates to anon;
grant all on table bingo_cards to anon;
