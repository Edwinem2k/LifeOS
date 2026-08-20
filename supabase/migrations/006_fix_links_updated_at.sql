-- 006_fix_links_updated_at.sql
-- Fixes a latent runtime error on the links table.
--
-- Migration 001 creates trg_links_updated_at: its DO block loops over a list of
-- "mutable tables" that includes 'links' and attaches set_updated_at() to each.
-- But the links table (001) was defined with created_at only — no updated_at.
-- set_updated_at() does `new.updated_at = now()`, so ANY update to a links row
-- aborts with:
--     record "new" has no field "updated_at"
--
-- Creating the trigger succeeded, so the schema looks healthy; the failure only
-- surfaces on the first UPDATE. Nothing has hit it yet because links have only
-- ever been inserted. It goes live the moment the `suggested` flag is flipped
-- (pipeline proposes a link -> user confirms it), which is exactly what that
-- column exists for.
--
-- Fix: give links the standard updated_at column. CLAUDE.md defines updated_at
-- as a standard column on every table, so this makes links conform rather than
-- carving out an exception, and the existing trigger becomes correct as written.

-- Order matters. The trigger is dropped FIRST because it is a BEFORE UPDATE
-- trigger that assigns new.updated_at = now(): left in place it fires on the
-- backfill below and overwrites every row with this migration's run time,
-- destroying the created_at history we are trying to preserve.
drop trigger if exists trg_links_updated_at on links;

-- Added nullable first so the backfill can distinguish "never updated" from now().
alter table links add column if not exists updated_at timestamptz;

-- Existing rows have never been updated — seed from created_at, not now(),
-- so the column tells the truth about them.
update links set updated_at = created_at where updated_at is null;

alter table links alter column updated_at set default now();
alter table links alter column updated_at set not null;

create trigger trg_links_updated_at
  before update on links
  for each row execute function set_updated_at();

comment on column links.updated_at is
  'Trigger-maintained by set_updated_at(). Added in 006 — 001 attached the trigger without the column.';
