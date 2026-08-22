-- 008: Lists module — pinned lists, per-item notes, and the four seeded pinned lists.

alter table lists      add column pinned    boolean not null default false;
alter table lists      add column pin_order integer;
alter table list_items add column notes     text;

comment on column lists.pinned is
  'Pinned lists appear in the Lists nav dropdown, ordered by pin_order. Everything else lives under "All lists".';
comment on column lists.pin_order is
  'Position among pinned lists, ascending. Nulls sort last.';
comment on column list_items.notes is
  'Freeform user prose. Deliberately a real column, not an item_schema field, so it is never schema-validated.';

-- Pinned lists ship seeded. There is no schema editor in v1 (spec §4.2);
-- new pinned lists are created by an agent via update_list, or by a later migration.
-- Icons are Lucide component names, not emoji (spec §5.5).

insert into lists (user_id, name, kind, icon, pinned, pin_order, description, item_schema) values
('633325fe-9ccd-4e75-a1e7-0df043b70e5a', 'Books', 'books', 'BookOpen', true, 1,
 'Reading list — what to read next, and what I made of it.',
 '[
   {"key":"author","label":"Author","type":"text","table":true},
   {"key":"reading_status","label":"Status","type":"select","table":true,"strict":true,
    "options":["to read","reading","finished","abandoned"]},
   {"key":"summary","label":"Summary","type":"text","multiline":true,
    "description":"Spoiler-free, 2-3 sentences. Never reveal plot turns or endings."},
   {"key":"form","label":"Form","type":"select","strict":true,"options":["Fiction","Non-fiction"]},
   {"key":"genre","label":"Genre","type":"select"},
   {"key":"recommended_by","label":"Recommended by","type":"text"},
   {"key":"rating","label":"Rating","type":"number"},
   {"key":"url","label":"Link","type":"url"}
 ]'::jsonb),

('633325fe-9ccd-4e75-a1e7-0df043b70e5a', 'TV & Movies', 'movies', 'Clapperboard', true, 2,
 'One queue for films and series.',
 '[
   {"key":"format","label":"Format","type":"select","table":true,"strict":true,
    "options":["Film","Series"]},
   {"key":"where_to_watch","label":"Where","type":"select","table":true},
   {"key":"summary","label":"Premise","type":"text","multiline":true,
    "description":"Spoiler-free premise. Never reveal plot turns or endings."},
   {"key":"director","label":"Director","type":"text"},
   {"key":"year","label":"Year","type":"number"},
   {"key":"genre","label":"Genre","type":"select"},
   {"key":"recommended_by","label":"Recommended by","type":"text"},
   {"key":"url","label":"Link","type":"url"}
 ]'::jsonb),

('633325fe-9ccd-4e75-a1e7-0df043b70e5a', 'Wishlist', 'custom', 'ShoppingBag', true, 3,
 'Considered purchases — things worth buying eventually, reviewed when browsing.',
 '[
   {"key":"buy_from","label":"Buy from","type":"select","table":true},
   {"key":"price","label":"Price","type":"number","table":true},
   {"key":"url","label":"Link","type":"url"},
   {"key":"priority","label":"Priority","type":"select","strict":true,
    "options":["now","soon","someday"]},
   {"key":"category","label":"Category","type":"select"}
 ]'::jsonb),

('633325fe-9ccd-4e75-a1e7-0df043b70e5a', 'Business ideas', 'custom', 'Lightbulb', true, 4,
 'Idea capture. Committing to one means creating a project by hand (v2 automates it).',
 '[
   {"key":"one_liner","label":"One-liner","type":"text","table":true},
   {"key":"conviction","label":"Conviction","type":"number","table":true},
   {"key":"category","label":"Category","type":"text"},
   {"key":"next_step","label":"Next step","type":"text"}
 ]'::jsonb);
