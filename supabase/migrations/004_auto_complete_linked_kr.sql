-- 004_auto_complete_linked_kr.sql
-- When a linked project or task is marked done/complete,
-- automatically mark the corresponding KR as done.

create or replace function auto_complete_linked_kr()
returns trigger as $$
begin
  -- Only fire when status changes to a "done" state
  if NEW.status in ('done', 'complete', 'completed') and
     (OLD.status is null or OLD.status not in ('done', 'complete', 'completed')) then

    -- Determine entity type from table name
    update goals
    set status = 'done', updated_at = now()
    where id in (
      select l.src_id
      from links l
      where l.src_type = 'key_result'
        and l.dst_type = TG_ARGV[0]
        and l.dst_id = NEW.id
        and l.relation = 'contributes_to'
    )
    and kind = 'key_result'
    and status != 'done';
  end if;

  return NEW;
end;
$$ language plpgsql;

-- Trigger on projects
drop trigger if exists trg_project_done_complete_kr on projects;
create trigger trg_project_done_complete_kr
  after update of status on projects
  for each row
  execute function auto_complete_linked_kr('project');

-- Trigger on tasks
drop trigger if exists trg_task_done_complete_kr on tasks;
create trigger trg_task_done_complete_kr
  after update of status on tasks
  for each row
  execute function auto_complete_linked_kr('task');
