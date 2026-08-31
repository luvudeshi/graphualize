-- Graphualize: saved graphs, owned by an account.
--
-- One table. A saved graph is a whole document as jsonb — small, self-contained
-- and versioned by the app's own serialiser, so there is nothing to normalise.
--
-- Run once against your project, either by pasting this into the SQL editor at
--   https://supabase.com/dashboard/project/_/sql
-- or with `supabase db push` if you have linked the project.

create table if not exists public.graphs (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  name          text        not null check (char_length(name) between 1 and 200),
  document      jsonb       not null,
  vertex_count  integer     not null default 0 check (vertex_count >= 0),
  edge_count    integer     not null default 0 check (edge_count >= 0),

  -- Bumped by the client on every write. Two devices disagreeing about the
  -- time is normal, so ordering never trusts a wall clock.
  version       integer     not null default 1 check (version > 0),
  origin_device text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A tombstone rather than a real delete: without it, deleting on one device
  -- just means the other device helpfully uploads the graph again.
  deleted_at    timestamptz,

  -- A generated graph can reach a few thousand elements. This keeps one
  -- runaway document from consuming the row limit; ~2 MB of JSON is far larger
  -- than anything the editor produces in practice.
  constraint graphs_document_size check (pg_column_size(document) < 2 * 1024 * 1024)
);

-- The only query the client makes: this user's graphs, newest first.
create index if not exists graphs_user_updated_idx
  on public.graphs (user_id, updated_at desc);

-- updated_at is maintained by the database so a client cannot forget to.
create or replace function public.touch_graphs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists graphs_touch_updated_at on public.graphs;
create trigger graphs_touch_updated_at
  before update on public.graphs
  for each row execute function public.touch_graphs_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security. This is the boundary that stops one account reading
-- another's graphs. With RLS enabled and no policy matching, a query returns
-- zero rows rather than an error — which is why the isolation check looks for
-- an empty result, not a refusal.
-- ---------------------------------------------------------------------------

alter table public.graphs enable row level security;

drop policy if exists "read own graphs"   on public.graphs;
drop policy if exists "insert own graphs" on public.graphs;
drop policy if exists "update own graphs" on public.graphs;
drop policy if exists "delete own graphs" on public.graphs;

create policy "read own graphs"
  on public.graphs for select
  using (auth.uid() = user_id);

create policy "insert own graphs"
  on public.graphs for insert
  with check (auth.uid() = user_id);

create policy "update own graphs"
  on public.graphs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own graphs"
  on public.graphs for delete
  using (auth.uid() = user_id);
