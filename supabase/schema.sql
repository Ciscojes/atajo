-- Ejecuta este archivo una sola vez en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  url text not null check (url ~ '^https?://'),
  category text not null default 'Sin categoría' check (char_length(category) between 1 and 40),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_favorite boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists links_user_id_idx on public.links(user_id);
create index if not exists links_user_favorite_idx on public.links(user_id, is_favorite desc);

alter table public.links enable row level security;

drop policy if exists "Users can view their links" on public.links;
create policy "Users can view their links"
  on public.links for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their links" on public.links;
create policy "Users can create their links"
  on public.links for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their links" on public.links;
create policy "Users can update their links"
  on public.links for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their links" on public.links;
create policy "Users can delete their links"
  on public.links for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists links_set_updated_at on public.links;
create trigger links_set_updated_at
  before update on public.links
  for each row execute function public.set_updated_at();
