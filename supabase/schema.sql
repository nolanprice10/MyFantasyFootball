create extension if not exists pgcrypto;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sport text not null default 'Flag Football',
  season text not null default extract(year from now())::text,
  scoring jsonb not null default '{"passYd":0.04,"passTd":4,"int":-2,"rushYd":0.1,"rushTd":6,"rec":1,"recYd":0.1,"recTd":6,"fumLost":-2,"twoPt":2}'::jsonb,
  default_sort text not null default 'points',
  logo text,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now()
);

alter table public.leagues add column if not exists visibility text not null default 'public' check (visibility in ('public', 'private'));

alter table public.leagues drop column if exists invite_code;

create table if not exists public.league_invites (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  invite_code text not null unique default gen_random_uuid()::text,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  abbr text not null,
  color text not null default '#c8102e',
  logo text
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  position text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  number text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  photo text,
  bio text not null default ''
);

create table if not exists public.stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  week integer not null check (week between 1 and 99),
  opponent text not null default '',
  pass_att numeric not null default 0,
  pass_cmp numeric not null default 0,
  pass_yd numeric not null default 0,
  pass_td numeric not null default 0,
  int numeric not null default 0,
  rush_att numeric not null default 0,
  rush_yd numeric not null default 0,
  rush_td numeric not null default 0,
  tgt numeric not null default 0,
  rec numeric not null default 0,
  rec_yd numeric not null default 0,
  rec_td numeric not null default 0,
  fum_lost numeric not null default 0,
  two_pt numeric not null default 0,
  unique (player_id, week)
);

create or replace function public.is_league_member(target_league uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.leagues l where l.id = target_league and l.owner_id = auth.uid()
    union all
    select 1 from public.league_members m where m.league_id = target_league and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_league_owner(target_league uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.leagues l where l.id = target_league and l.owner_id = auth.uid());
$$;

create or replace function public.can_view_league(target_league uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.leagues l where l.id = target_league and (l.visibility = 'public' or l.owner_id = auth.uid()))
    or public.is_league_member(target_league);
$$;

create or replace function public.join_league(invite text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare joined_league uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select league_id into joined_league from public.league_invites where invite_code = invite;
  if joined_league is null then raise exception 'Invite link is invalid or expired'; end if;
  if not public.is_league_owner(joined_league) then
    insert into public.league_members (league_id, user_id) values (joined_league, auth.uid()) on conflict do nothing;
  end if;
  return joined_league;
end;
$$;

create or replace function public.rotate_league_invite(target_league uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare new_code text;
begin
  if not public.is_league_owner(target_league) then raise exception 'Only the league owner can manage invites'; end if;
  new_code := gen_random_uuid()::text;
  insert into public.league_invites (league_id, invite_code, updated_at)
  values (target_league, new_code, now())
  on conflict (league_id) do update set invite_code = excluded.invite_code, updated_at = excluded.updated_at;
  return new_code;
end;
$$;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_invites enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.stats enable row level security;

drop policy if exists "members can read leagues" on public.leagues;
drop policy if exists "signed in users read leagues" on public.leagues;
drop policy if exists "readable leagues" on public.leagues;
create policy "readable leagues" on public.leagues for select to authenticated using (visibility = 'public' or owner_id = auth.uid() or public.is_league_member(id));
drop policy if exists "users create owned leagues" on public.leagues;
create policy "users create owned leagues" on public.leagues for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "owners update leagues" on public.leagues;
create policy "owners update leagues" on public.leagues for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owners delete leagues" on public.leagues;
create policy "owners delete leagues" on public.leagues for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members and owners read memberships" on public.league_members;
create policy "members and owners read memberships" on public.league_members for select to authenticated using (user_id = auth.uid() or public.is_league_owner(league_id));
drop policy if exists "owners remove members" on public.league_members;
create policy "owners remove members" on public.league_members for delete to authenticated using (public.is_league_owner(league_id));

drop policy if exists "owners read invite codes" on public.league_invites;
create policy "owners read invite codes" on public.league_invites for select to authenticated using (public.is_league_owner(league_id));

drop policy if exists "members read teams" on public.teams;
drop policy if exists "signed in users read teams" on public.teams;
drop policy if exists "readable teams" on public.teams;
create policy "readable teams" on public.teams for select to authenticated using (public.can_view_league(league_id));
drop policy if exists "owners manage teams" on public.teams;
create policy "owners manage teams" on public.teams for all to authenticated using (public.is_league_owner(league_id)) with check (public.is_league_owner(league_id));

drop policy if exists "members read players" on public.players;
drop policy if exists "signed in users read players" on public.players;
drop policy if exists "readable players" on public.players;
create policy "readable players" on public.players for select to authenticated using (public.can_view_league(league_id));
drop policy if exists "owners manage players" on public.players;
create policy "owners manage players" on public.players for all to authenticated using (public.is_league_owner(league_id)) with check (public.is_league_owner(league_id));

drop policy if exists "members read stats" on public.stats;
drop policy if exists "signed in users read stats" on public.stats;
drop policy if exists "readable stats" on public.stats;
create policy "readable stats" on public.stats for select to authenticated using (
  exists (select 1 from public.players p where p.id = player_id and public.can_view_league(p.league_id))
);
drop policy if exists "owners manage stats" on public.stats;
create policy "owners manage stats" on public.stats for all to authenticated using (
  exists (select 1 from public.players p where p.id = player_id and public.is_league_owner(p.league_id))
) with check (
  exists (select 1 from public.players p where p.id = player_id and public.is_league_owner(p.league_id))
);

create or replace function public.follow_league(target_league uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if not public.can_view_league(target_league) then raise exception 'League not found'; end if;
  if not public.is_league_owner(target_league) then
    insert into public.league_members (league_id, user_id) values (target_league, auth.uid()) on conflict do nothing;
  end if;
end;
$$;

drop policy if exists "members leave leagues" on public.league_members;
create policy "members leave leagues" on public.league_members for delete to authenticated using (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.leagues, public.teams, public.players, public.stats to authenticated;
grant select, delete on public.league_members to authenticated;
grant select on public.league_invites to authenticated;
grant execute on function public.is_league_member(uuid), public.is_league_owner(uuid), public.join_league(text), public.rotate_league_invite(uuid), public.follow_league(uuid), public.can_view_league(uuid) to authenticated;
