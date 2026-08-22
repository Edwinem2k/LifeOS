-- 010_habits_description.sql
--
-- RENUMBERED 009 -> 010 on 22 Aug. It was WRITTEN AND APPLIED to the live
-- database as 009, before we saw that the parallel Lists branch had also
-- claimed 009 (008_lists_pinned_notes.sql, itself already applied — different
-- tables, so no schema conflict, only a duplicated file number). We renumbered
-- rather than the Lists branch because that work was mid-flight with uncommitted
-- changes and this was finished. Both are live; the number is ordering
-- documentation only, and this file's relative order is unchanged.
--
-- Adds a free-text `description` to habits: the name stays a short label
-- ("Gym"), the description carries the definition ("at least 3x per week,
-- counts only if it's a full session, not a swim").
--
-- This REVERSES a deliberate design decision. Spec decision B during the
-- Habits brainstorm was "No per-habit notes — migration 006 is `area
-- life_area` ONLY. Notes block cut from the flyout." Axel asked for it back
-- on 22 Aug after using the page: without it, habit names end up carrying the
-- definition themselves ("Go to the gym at least 3x per week"), which makes
-- rows unreadable and duplicates what the schedule already encodes.
--
-- Nullable, no default, no backfill — every existing habit simply has none.
-- `habit_logs.note` is unaffected; that is a per-LOG note, this is per-HABIT.
--
-- Forward-only, applied by hand through the Supabase SQL editor, matching
-- 001-008. To reverse: alter table habits drop column description;

alter table habits add column description text;

comment on column habits.description is
  'Optional free text defining what the habit actually means. The name is the short label.';
