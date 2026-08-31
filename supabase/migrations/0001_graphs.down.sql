-- Undoes 0001_graphs.sql. This destroys every saved graph in the project.
drop trigger if exists graphs_touch_updated_at on public.graphs;
drop function if exists public.touch_graphs_updated_at();
drop table if exists public.graphs;
