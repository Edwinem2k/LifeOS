-- 005_auto_complete_linked_entity.sql
-- When a KR is marked done, automatically mark any linked project/task as done.
-- (Reverse of 004: KR done → project/task done)

create or replace function auto_complete_linked_entity()
returns trigger as $$
begin
  -- Only fire when a key_result's status changes to done
  if NEW.kind = 'key_result'
     and NEW.status = 'done'
     and (OLD.status is null or OLD.status != 'done') then

    -- Mark linked projects as done
    update projects
    set status = 'done', updated_at = now()
    where id in (
      select l.dst_id
      from links l
      where l.src_type = 'key_result'
        and l.src_id = NEW.id
        and l.dst_type = 'project'
        and l.relation = 'contributes_to'
    )
    and status != 'done';

    -- Mark linked tasks as done
    update tasks
    set status = 'done', updated_at = now()
    where id in (
      select l.dst_id
      from links l
      where l.src_type = 'key_result'
        and l.src_id = NEW.id
        and l.dst_type = 'task'
        and l.relation = 'contributes_to'
    )
    and status != 'done';
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_kr_done_complete_entity on goals;
create trigger trg_kr_done_complete_entity
  after update of status on goals
  for each row
  execute function auto_complete_linked_entity();
