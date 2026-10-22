create table if not exists public.game_scores (
  id uuid primary key,
  player_name text not null check (char_length(player_name) between 1 and 24),
  score integer not null check (score >= 0),
  coins integer not null check (coins >= 0),
  played_at timestamptz not null default now()
);

alter table public.game_scores enable row level security;

grant select, insert on table public.game_scores to anon;

drop policy if exists "Anyone can view game scores" on public.game_scores;
create policy "Anyone can view game scores"
  on public.game_scores for select
  to anon
  using (true);

drop policy if exists "Anyone can submit game scores" on public.game_scores;
create policy "Anyone can submit game scores"
  on public.game_scores for insert
  to anon
  with check (
    char_length(player_name) between 1 and 24
    and score >= 0
    and coins >= 0
  );
