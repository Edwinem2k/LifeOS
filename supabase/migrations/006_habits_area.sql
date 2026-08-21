-- 006_habits_area.sql
-- Adds `area` to habits, matching tasks.area, so habits can be
-- grouped and filtered by life area like every other entity.
--
-- No other schema change is needed for the Habits page:
--   - links.src_type / dst_type are plain text, so 'habit' already works
--   - schedule is already jsonb, so per-week schedules need no migration
--   - migrations 004/005 already exclude habits by construction
--
-- Forward-only, applied by hand through the Supabase SQL editor, matching
-- 001-005 and 007. To reverse: alter table habits drop column area;

alter table habits add column area life_area;
