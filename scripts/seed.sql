-- Seed data for Life OS — enough to verify every view
-- Replace 'USER_ID_HERE' with your actual Supabase auth.uid()
-- Run: psql $DATABASE_URL -f scripts/seed.sql

-- Use a variable for the user ID (set this before running)
\set uid '''00000000-0000-0000-0000-000000000001'''

-- =============================================================================
-- Projects (2)
-- =============================================================================

insert into projects (id, user_id, name, description, status, priority, area, target_date, current_status, next_steps, outcome, success_check) values
  ('11111111-0000-0000-0000-000000000001', :uid, 'Life OS Build', 'Build the personal operating system replacing Notion', 'active', 'high', 'growth', '2026-12-31', 'Phase 0 scaffolding complete', 'Write migrations, build UI', 'Fully functional PWA replacing Notion', 'Daily-driving the app for 2 weeks without touching Notion'),
  ('11111111-0000-0000-0000-000000000002', :uid, 'Portuguese Residency Setup', 'Complete all admin for PT residency', 'active', 'high', 'environment', '2026-10-31', 'NIF obtained, awaiting SEF appointment', 'Book SEF, register health centre', 'All legal/admin requirements met', 'Can access public health, bank, and tax system without issues');

-- =============================================================================
-- Tasks (5)
-- =============================================================================

insert into tasks (id, user_id, project_id, title, status, area, priority, deadline) values
  ('22222222-0000-0000-0000-000000000001', :uid, '11111111-0000-0000-0000-000000000001', 'Write migration 001', 'done', 'growth', 'high', '2026-08-18'),
  ('22222222-0000-0000-0000-000000000002', :uid, '11111111-0000-0000-0000-000000000001', 'Write migration 002', 'done', 'growth', 'high', '2026-08-18'),
  ('22222222-0000-0000-0000-000000000003', :uid, '11111111-0000-0000-0000-000000000001', 'Build projects list UI', 'next_action', 'growth', 'high', '2026-09-01'),
  ('22222222-0000-0000-0000-000000000004', :uid, '11111111-0000-0000-0000-000000000002', 'Book SEF appointment', 'waiting_for', 'environment', 'high', '2026-09-15'),
  ('22222222-0000-0000-0000-000000000005', :uid, null, 'Buy new running shoes', 'inbox', 'health', 'low', null);

-- Mark completed tasks
update tasks set completed_at = '2026-08-18T14:00:00Z' where id in (
  '22222222-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000002'
);

-- =============================================================================
-- Goal (1) with key result
-- =============================================================================

insert into goals (id, user_id, title, kind, area, horizon, status, target_value, current_value, unit, progress_mode) values
  ('33333333-0000-0000-0000-000000000001', :uid, 'Ship Life OS v1', 'goal', 'growth', 'annual', 'in_progress', null, null, null, 'from_tasks'),
  ('33333333-0000-0000-0000-000000000002', :uid, 'Complete Phase 0-2 by end of Q3', 'key_result', 'growth', 'q3', 'in_progress', 3, 1, 'phases', 'manual');

-- Link KR to parent goal
update goals set parent_goal_id = '33333333-0000-0000-0000-000000000001' where id = '33333333-0000-0000-0000-000000000002';

-- Link project → goal (contributes_to)
insert into links (user_id, src_type, src_id, dst_type, dst_id, relation, created_by) values
  (:uid, 'project', '11111111-0000-0000-0000-000000000001', 'goal', '33333333-0000-0000-0000-000000000001', 'contributes_to', 'agent');

-- =============================================================================
-- Habits (2) with logs
-- =============================================================================

insert into habits (id, user_id, name, polarity, schedule, metric_type, target_value) values
  ('44444444-0000-0000-0000-000000000001', :uid, 'Morning pages', 'build', '{"type":"daily"}', 'boolean', null),
  ('44444444-0000-0000-0000-000000000002', :uid, 'Gym', 'build', '{"type":"per_week","count":3}', 'boolean', null);

-- Habit logs: morning pages for the last 5 days, gym 3 of last 7
insert into habit_logs (user_id, habit_id, logged_at, value) values
  (:uid, '44444444-0000-0000-0000-000000000001', current_date - interval '0 days', 1),
  (:uid, '44444444-0000-0000-0000-000000000001', current_date - interval '1 day', 1),
  (:uid, '44444444-0000-0000-0000-000000000001', current_date - interval '2 days', 1),
  (:uid, '44444444-0000-0000-0000-000000000001', current_date - interval '3 days', 1),
  (:uid, '44444444-0000-0000-0000-000000000001', current_date - interval '4 days', 1),
  (:uid, '44444444-0000-0000-0000-000000000002', current_date - interval '1 day', 1),
  (:uid, '44444444-0000-0000-0000-000000000002', current_date - interval '3 days', 1),
  (:uid, '44444444-0000-0000-0000-000000000002', current_date - interval '5 days', 1);

-- =============================================================================
-- Location + Equipment + Exercises (§4.3)
-- =============================================================================

-- 1 location
insert into locations (id, user_id, name, kind) values
  ('55555555-0000-0000-0000-000000000001', :uid, 'Primary gym', 'gym');

-- Equipment at Primary gym
insert into equipment (user_id, location_id, name) values
  (:uid, '55555555-0000-0000-0000-000000000001', 'barbell'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'squat rack'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'bench'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'dumbbells'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'cable machine'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'pull-up bar'),
  (:uid, '55555555-0000-0000-0000-000000000001', 'leg press');

-- 10 catalogue exercises
insert into exercises (id, user_id, name, muscle_groups, required_equipment) values
  ('66666666-0000-0000-0000-000000000001', :uid, 'Barbell Back Squat', '{quads,glutes,hamstrings}', '{barbell,squat rack}'),
  ('66666666-0000-0000-0000-000000000002', :uid, 'Bench Press', '{chest,triceps,shoulders}', '{barbell,bench}'),
  ('66666666-0000-0000-0000-000000000003', :uid, 'Deadlift', '{hamstrings,glutes,back}', '{barbell}'),
  ('66666666-0000-0000-0000-000000000004', :uid, 'Overhead Press', '{shoulders,triceps}', '{barbell}'),
  ('66666666-0000-0000-0000-000000000005', :uid, 'Pull-ups', '{back,biceps}', '{pull-up bar}'),
  ('66666666-0000-0000-0000-000000000006', :uid, 'Dumbbell Rows', '{back,biceps}', '{dumbbells}'),
  ('66666666-0000-0000-0000-000000000007', :uid, 'Leg Press', '{quads,glutes}', '{leg press}'),
  ('66666666-0000-0000-0000-000000000008', :uid, 'Cable Flyes', '{chest}', '{cable machine}'),
  ('66666666-0000-0000-0000-000000000009', :uid, 'Push-ups', '{chest,triceps,shoulders}', '{}'),
  ('66666666-0000-0000-0000-000000000010', :uid, 'Plank', '{core}', '{}');

-- =============================================================================
-- Sample activity log with workout sets
-- =============================================================================

insert into activity_logs (id, user_id, activity_type, occurred_at, duration_min, location_id, note) values
  ('77777777-0000-0000-0000-000000000001', :uid, 'gym', current_date - interval '1 day', 75, '55555555-0000-0000-0000-000000000001', 'Upper body day');

insert into workout_sets (user_id, activity_log_id, exercise_id, exercise, set_number, reps, weight_kg, rpe) values
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002', 'Bench Press', 1, 8, 70, 7),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002', 'Bench Press', 2, 8, 70, 8),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002', 'Bench Press', 3, 6, 70, 9),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000005', 'Pull-ups', 1, 10, 0, 6),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000005', 'Pull-ups', 2, 8, 0, 7),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000008', 'Cable Flyes', 1, 12, 15, 7),
  (:uid, '77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000008', 'Cable Flyes', 2, 12, 15, 8);
