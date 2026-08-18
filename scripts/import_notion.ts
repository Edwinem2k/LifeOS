/**
 * import_notion.ts — Import Notion CSV exports into Life OS Supabase database
 *
 * Usage:
 *   npx tsx scripts/import_notion.ts <csv_dir>
 *
 * Expects CSV files in <csv_dir> named:
 *   - Tasks_Projects.csv       → projects + tasks
 *   - Goals.csv                → goals
 *   - Habits.csv               → habits
 *   - Habit_Log.csv            → habit_logs
 *   - Workout_Log.csv          → activity_logs + workout_sets
 *   - Contacts.csv             → contacts
 *   - Travel.csv, Movies.csv, TV.csv, Books.csv, Games.csv, Shopping.csv → lists + list_items
 *   - Key_Information.csv      → key_info
 *   - Key_Documents.csv        → documents
 *   - Equipment.csv            → equipment (under seeded "Primary gym" location)
 *
 * Mapping rules (from schema workbook "Notion mapping" tab):
 *   - Statuses, areas, horizons carry over 1:1
 *   - Blocked By / Blocking → links with relation='blocks'
 *   - Goals' Projects/Habits relations → links with relation='contributes_to'
 *   - Equipment DB → equipment under a seeded "Primary gym" location
 *   - Piglet Work stays in Notion (filtered out)
 *
 * Environment variables (or .env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIFE_OS_USER_ID
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = process.env.LIFE_OS_USER_ID!;

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and LIFE_OS_USER_ID"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const csvDir = process.argv[2] || "./notion_exports";

function readCsv(filename: string): Record<string, string>[] {
  const path = join(csvDir, filename);
  if (!existsSync(path)) {
    console.warn(`  Skipping ${filename} (not found)`);
    return [];
  }
  const content = readFileSync(path, "utf-8");
  return parse(content, { columns: true, skip_empty_lines: true });
}

function normaliseStatus(s: string): string {
  return s?.toLowerCase().replace(/\s+/g, "_").trim() || "inbox";
}

function normaliseArea(a: string): string | null {
  const map: Record<string, string> = {
    money: "money",
    health: "health",
    growth: "growth",
    work: "work",
    relationships: "relationships",
    play: "play",
    environment: "environment",
  };
  return map[a?.toLowerCase().trim()] || null;
}

// Track Notion name → Supabase UUID for linking
const notionIdMap: Record<string, Record<string, string>> = {
  project: {},
  task: {},
  goal: {},
  habit: {},
  contact: {},
};

async function upsert(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const withUser = rows.map((r) => ({ ...r, user_id: USER_ID }));
  const { error } = await supabase.from(table).insert(withUser);
  if (error) {
    console.error(`  Error inserting into ${table}:`, error.message);
    // Try one by one to identify the bad row
    for (const row of withUser) {
      const { error: e2 } = await supabase.from(table).insert(row);
      if (e2) console.error(`    Row error:`, e2.message, JSON.stringify(row).slice(0, 200));
    }
  }
}

async function createLink(
  srcType: string,
  srcId: string,
  dstType: string,
  dstId: string,
  relation: string
) {
  await supabase.from("links").upsert(
    {
      user_id: USER_ID,
      src_type: srcType,
      src_id: srcId,
      dst_type: dstType,
      dst_id: dstId,
      relation,
      created_by: "agent",
    },
    { onConflict: "src_type,src_id,dst_type,dst_id,relation" }
  );
}

// ─── Projects & Tasks ────────────────────────────────────────────────

async function importTasksProjects() {
  console.log("Importing Tasks & Projects...");
  const rows = readCsv("Tasks_Projects.csv");
  if (!rows.length) return;

  // Split by Type column
  const projectRows = rows.filter(
    (r) => r.Type?.toLowerCase() === "project" && r.Area?.toLowerCase() !== "piglet work"
  );
  const taskRows = rows.filter(
    (r) => r.Type?.toLowerCase() !== "project" && r.Area?.toLowerCase() !== "piglet work"
  );

  // Projects
  const projects: Record<string, unknown>[] = [];
  for (const r of projectRows) {
    const id = crypto.randomUUID();
    notionIdMap.project[r.Name || r.Title || ""] = id;
    projects.push({
      id,
      name: r.Name || r.Title,
      description: r.Description || null,
      status: normaliseStatus(r.Status) || "idea",
      priority: r.Priority?.toLowerCase() || null,
      area: normaliseArea(r.Area) || "work",
      target_date: r["Target Date"] || r.Deadline || null,
      current_status: r["Current Status"] || null,
      next_steps: r["Next Steps"] || null,
      notes: r.Notes || null,
    });
  }
  await upsert("projects", projects);
  console.log(`  ${projects.length} projects`);

  // Tasks
  const tasks: Record<string, unknown>[] = [];
  for (const r of taskRows) {
    const id = crypto.randomUUID();
    const name = r.Name || r.Title || "";
    notionIdMap.task[name] = id;

    const projectName = r.Project || r["Parent Project"] || "";
    const projectId = notionIdMap.project[projectName] || null;

    tasks.push({
      id,
      project_id: projectId,
      title: name,
      notes: r.Notes || null,
      status: normaliseStatus(r.Status),
      area: normaliseArea(r.Area),
      priority: r.Priority?.toLowerCase() || null,
      deadline: r.Deadline || r["Due Date"] || null,
      completed_at: r.Status?.toLowerCase() === "done" ? r["Completed At"] || new Date().toISOString() : null,
    });
  }
  await upsert("tasks", tasks);
  console.log(`  ${tasks.length} tasks`);

  // Blocked By / Blocking → links (relation='blocks')
  for (const r of taskRows) {
    const name = r.Name || r.Title || "";
    const srcId = notionIdMap.task[name];
    if (!srcId) continue;

    // "Blocking" means this task blocks others
    const blocking = (r.Blocking || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    for (const target of blocking) {
      const dstId = notionIdMap.task[target];
      if (dstId) await createLink("task", srcId, "task", dstId, "blocks");
    }

    // "Blocked By" means this task is blocked by others
    const blockedBy = (r["Blocked By"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    for (const blocker of blockedBy) {
      const blockerId = notionIdMap.task[blocker];
      if (blockerId) await createLink("task", blockerId, "task", srcId, "blocks");
    }
  }
}

// ─── Goals ───────────────────────────────────────────────────────────

async function importGoals() {
  console.log("Importing Goals...");
  const rows = readCsv("Goals.csv");
  if (!rows.length) return;

  // First pass: create goals
  const goals: Record<string, unknown>[] = [];
  for (const r of rows) {
    const id = crypto.randomUUID();
    notionIdMap.goal[r.Name || r.Title || ""] = id;
    goals.push({
      id,
      title: r.Name || r.Title,
      kind: r.Type?.toLowerCase() === "key_result" || r.Type?.toLowerCase() === "key result"
        ? "key_result" : "goal",
      area: normaliseArea(r.Area) || "growth",
      horizon: r.Horizon?.toLowerCase().replace(" ", "") || null,
      status: normaliseStatus(r.Status) || "not_started",
      target_value: r["Target Value"] ? parseFloat(r["Target Value"]) : null,
      current_value: r["Current Value"] ? parseFloat(r["Current Value"]) : null,
      unit: r.Unit || null,
      progress_mode: r["Progress Mode"]?.toLowerCase() || "manual",
      due_date: r["Due Date"] || null,
      notes: r.Notes || null,
    });
  }
  await upsert("goals", goals);
  console.log(`  ${goals.length} goals`);

  // Second pass: set parent_goal_id for key results
  for (const r of rows) {
    const parentName = r["Parent Goal"] || "";
    const childId = notionIdMap.goal[r.Name || r.Title || ""];
    const parentId = notionIdMap.goal[parentName];
    if (childId && parentId) {
      await supabase
        .from("goals")
        .update({ parent_goal_id: parentId })
        .eq("id", childId);
    }
  }

  // Goals' Projects/Habits relations → links(contributes_to)
  for (const r of rows) {
    const goalId = notionIdMap.goal[r.Name || r.Title || ""];
    if (!goalId) continue;

    const linkedProjects = (r.Projects || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    for (const pName of linkedProjects) {
      const pId = notionIdMap.project[pName];
      if (pId) await createLink("project", pId, "goal", goalId, "contributes_to");
    }

    const linkedHabits = (r.Habits || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    for (const hName of linkedHabits) {
      const hId = notionIdMap.habit[hName];
      if (hId) await createLink("habit", hId, "goal", goalId, "contributes_to");
    }
  }
}

// ─── Habits ──────────────────────────────────────────────────────────

async function importHabits() {
  console.log("Importing Habits...");
  const rows = readCsv("Habits.csv");
  if (!rows.length) return;

  const habits: Record<string, unknown>[] = [];
  for (const r of rows) {
    const id = crypto.randomUUID();
    notionIdMap.habit[r.Name || r.Title || ""] = id;

    let schedule: Record<string, unknown> = { type: "daily" };
    if (r.Schedule) {
      try { schedule = JSON.parse(r.Schedule); } catch { /* keep default */ }
    } else if (r.Frequency) {
      const freq = r.Frequency.toLowerCase();
      if (freq.includes("week")) {
        const match = freq.match(/(\d+)/);
        schedule = { type: "per_week", count: match ? parseInt(match[1]) : 3 };
      }
    }

    habits.push({
      id,
      name: r.Name || r.Title,
      polarity: r.Polarity?.toLowerCase() === "break" ? "break" : "build",
      schedule,
      metric_type: r["Metric Type"]?.toLowerCase() || "boolean",
      target_value: r["Target Value"] ? parseFloat(r["Target Value"]) : null,
      active: r.Active?.toLowerCase() !== "false",
    });
  }
  await upsert("habits", habits);
  console.log(`  ${habits.length} habits`);
}

// ─── Habit Logs ──────────────────────────────────────────────────────

async function importHabitLogs() {
  console.log("Importing Habit Logs...");
  const rows = readCsv("Habit_Log.csv");
  if (!rows.length) return;

  const logs: Record<string, unknown>[] = [];
  for (const r of rows) {
    const habitName = r.Habit || r.Name || "";
    const habitId = notionIdMap.habit[habitName];
    if (!habitId) {
      console.warn(`    Habit not found: "${habitName}"`);
      continue;
    }
    logs.push({
      habit_id: habitId,
      logged_at: r.Date || r["Logged At"] || new Date().toISOString(),
      value: r.Value ? parseFloat(r.Value) : 1,
      note: r.Note || null,
    });
  }
  await upsert("habit_logs", logs);
  console.log(`  ${logs.length} habit logs`);
}

// ─── Workout Log ─────────────────────────────────────────────────────

async function importWorkoutLog() {
  console.log("Importing Workout Log...");
  const rows = readCsv("Workout_Log.csv");
  if (!rows.length) return;

  // Group by date to create one activity_log per session
  const sessions = new Map<string, typeof rows>();
  for (const r of rows) {
    const date = r.Date || r["Workout Date"] || "";
    if (!sessions.has(date)) sessions.set(date, []);
    sessions.get(date)!.push(r);
  }

  for (const [date, sets] of sessions) {
    const logId = crypto.randomUUID();
    await upsert("activity_logs", [
      {
        id: logId,
        activity_type: "gym",
        occurred_at: date || new Date().toISOString(),
        duration_min: null,
        note: null,
      },
    ]);

    const workoutSets: Record<string, unknown>[] = [];
    for (let i = 0; i < sets.length; i++) {
      const r = sets[i];
      workoutSets.push({
        activity_log_id: logId,
        exercise: r.Exercise || r.Name || "unknown",
        set_number: r["Set Number"] ? parseInt(r["Set Number"]) : i + 1,
        reps: r.Reps ? parseInt(r.Reps) : null,
        weight_kg: r.Weight || r["Weight (kg)"] ? parseFloat(r.Weight || r["Weight (kg)"]) : null,
        rpe: r.RPE ? parseFloat(r.RPE) : null,
        note: r.Note || null,
      });
    }
    await upsert("workout_sets", workoutSets);
  }
  console.log(`  ${sessions.size} sessions, ${rows.length} sets`);
}

// ─── Contacts ────────────────────────────────────────────────────────

async function importContacts() {
  console.log("Importing Contacts...");
  const rows = readCsv("Contacts.csv");
  if (!rows.length) return;

  const contacts: Record<string, unknown>[] = [];
  for (const r of rows) {
    const id = crypto.randomUUID();
    const name = r.Name || r["Full Name"] || "";
    notionIdMap.contact[name] = id;
    contacts.push({
      id,
      full_name: name,
      nickname: r.Nickname || null,
      relationship: r.Relationship || null,
      company: r.Company || null,
      location: r.Location || r.City || null,
      emails: r.Email ? [r.Email] : [],
      phones: r.Phone ? [r.Phone] : [],
      birthday: r.Birthday || null,
      how_met: r["How Met"] || r["How We Met"] || null,
      follow_up_interval_days: r["Follow Up Days"] ? parseInt(r["Follow Up Days"]) : null,
      notes: r.Notes || null,
    });
  }
  await upsert("contacts", contacts);
  console.log(`  ${contacts.length} contacts`);
}

// ─── Lists ───────────────────────────────────────────────────────────

const LIST_SCHEMAS: Record<string, { kind: string; item_schema: object[] }> = {
  Books: {
    kind: "books",
    item_schema: [
      { key: "author", label: "Author", type: "text" },
      { key: "recommended_by", label: "Recommended by", type: "text" },
      { key: "year", label: "Year", type: "number" },
    ],
  },
  Movies: {
    kind: "movies",
    item_schema: [
      { key: "year", label: "Year", type: "number" },
      { key: "where_to_watch", label: "Where to watch", type: "text" },
    ],
  },
  TV: {
    kind: "tv",
    item_schema: [
      { key: "year", label: "Year", type: "number" },
      { key: "where_to_watch", label: "Where to watch", type: "text" },
    ],
  },
  Travel: {
    kind: "travel",
    item_schema: [
      { key: "country", label: "Country", type: "text" },
      { key: "season", label: "Best season", type: "text" },
    ],
  },
  Shopping: {
    kind: "shopping",
    item_schema: [
      { key: "qty", label: "Qty", type: "number" },
      { key: "urgency", label: "Urgency", type: "text" },
    ],
  },
  Games: {
    kind: "games",
    item_schema: [
      { key: "platform", label: "Platform", type: "text" },
    ],
  },
};

async function importLists() {
  console.log("Importing Lists...");

  for (const [listName, config] of Object.entries(LIST_SCHEMAS)) {
    const rows = readCsv(`${listName}.csv`);
    if (!rows.length) continue;

    const listId = crypto.randomUUID();
    await upsert("lists", [
      {
        id: listId,
        name: listName,
        kind: config.kind,
        item_schema: config.item_schema,
      },
    ]);

    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const metadata: Record<string, unknown> = {};
      for (const field of config.item_schema) {
        const key = (field as { key: string }).key;
        const label = (field as { label: string }).label;
        const val = r[label] || r[key] || r[key.charAt(0).toUpperCase() + key.slice(1)];
        if (val) metadata[key] = val;
      }
      items.push({
        list_id: listId,
        title: r.Name || r.Title || "",
        status: r.Status?.toLowerCase() === "done" ? "done" : "open",
        metadata,
        sort_order: i,
      });
    }
    await upsert("list_items", items);
    console.log(`  ${listName}: ${items.length} items`);
  }
}

// ─── Key Information ─────────────────────────────────────────────────

async function importKeyInfo() {
  console.log("Importing Key Information...");
  const rows = readCsv("Key_Information.csv");
  if (!rows.length) return;

  const items: Record<string, unknown>[] = [];
  for (const r of rows) {
    items.push({
      label: r.Name || r.Label || r.Title || "",
      value: r.Value || r.Info || "",
      category: r.Category || r.Type || null,
    });
  }
  await upsert("key_info", items);
  console.log(`  ${items.length} items`);
}

// ─── Key Documents ───────────────────────────────────────────────────

async function importKeyDocuments() {
  console.log("Importing Key Documents...");
  const rows = readCsv("Key_Documents.csv");
  if (!rows.length) return;

  const docs: Record<string, unknown>[] = [];
  for (const r of rows) {
    const url = r.URL || r.Link || r["Drive Link"] || "";
    // Extract Drive file ID from URL
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    docs.push({
      drive_file_id: match ? match[1] : r["File ID"] || url,
      title: r.Name || r.Title || "",
      mime_type: r["MIME Type"] || r.Type || null,
      url: url || null,
    });
  }
  await upsert("documents", docs);
  console.log(`  ${docs.length} documents`);
}

// ─── Equipment → equipment table under "Primary gym" location ────────

async function importEquipment() {
  console.log("Importing Equipment...");
  const rows = readCsv("Equipment.csv");
  if (!rows.length) return;

  // Seed the "Primary gym" location
  const locationId = crypto.randomUUID();
  await upsert("locations", [
    { id: locationId, name: "Primary gym", kind: "gym" },
  ]);

  const equipment: Record<string, unknown>[] = [];
  for (const r of rows) {
    equipment.push({
      location_id: locationId,
      name: r.Name || r.Equipment || r.Title || "",
      notes: r.Notes || null,
    });
  }
  await upsert("equipment", equipment);
  console.log(`  ${equipment.length} equipment items at Primary gym`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nLife OS Notion Import`);
  console.log(`CSV directory: ${csvDir}`);
  console.log(`Target: ${SUPABASE_URL}\n`);

  // Order matters: projects before tasks, habits before goals (for linking)
  await importHabits();
  await importTasksProjects();
  await importGoals();
  await importHabitLogs();
  await importWorkoutLog();
  await importContacts();
  await importLists();
  await importKeyInfo();
  await importKeyDocuments();
  await importEquipment();

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
