# Life OS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Life OS web app with Projects, Tasks, Goals, and Today views — replacing Notion as the daily driver.

**Architecture:** Next.js 15 App Router with Tailwind 4, shadcn/ui, TanStack Query, and a thin Supabase service layer. Components never import Supabase directly — they call hooks, which call services. OVER1 UI patterns (table scroller, fly-out panel, toast, inline editing) are ported and restyled.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, supabase-js, Lucide React

**Spec:** `docs/superpowers/specs/2026-08-18-phase1-design.md`

---

## Chunk 1: Scaffold, Design System, Auth, App Shell

### Task 1: Initialize Next.js project

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `package.json`, `tsconfig.json`, `next.config.ts`

The Next.js app lives inside `C:\dev\LifeOS` alongside the existing `supabase/` and `scripts/` directories. The existing `package.json` (with `pg` dep) will be replaced by the Next.js one.

- [ ] **Step 1: Create Next.js app**

```bash
cd C:/dev/LifeOS
# Back up existing package.json (only has pg)
mv package.json package.json.bak
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --skip-install
```

Accept defaults. The `.` installs into the existing directory. When prompted for import alias, accept the default `@/*`.

- [ ] **Step 2: Verify tsconfig has path alias**

Open `tsconfig.json` and confirm it contains:
```json
"paths": { "@/*": ["./src/*"] }
```
If missing, add it under `compilerOptions`.

- [ ] **Step 3: Install all dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr @tanstack/react-query lucide-react
npm install -D @types/node
```

- [ ] **Step 4: Restore pg as a dev dependency for scripts**

```bash
npm install -D pg
rm package.json.bak
```

- [ ] **Step 5: Update .gitignore**

Append to existing `.gitignore` (`.next/` is already present from create-next-app):
```
.superpowers/
.env.local
```

- [ ] **Step 6: Verify dev server starts**

```bash
npm run dev
```

Expected: Next.js dev server at localhost:3000, default page renders.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 15 app with dependencies"
```

---

### Task 2: Design tokens and Tailwind configuration

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Important:** Tailwind CSS 4 does NOT use `tailwind.config.ts`. All theme configuration is done via `@theme` directives in CSS.

- [ ] **Step 1: Create design tokens CSS file**

Create `src/styles/tokens.css`:

```css
@import "tailwindcss";

@theme {
  /* Page colours */
  --color-page: #faf8f4;
  --color-card: #f2ede5;
  --color-elevated: #ffffff;
  --color-border-default: #e8e2d8;
  --color-text-primary: #2c2520;
  --color-text-secondary: #a0958a;
  --color-text-muted: #c4b8a8;

  /* Accent colours */
  --color-accent-primary: #c4785a;
  --color-accent-success: #6b9e6e;
  --color-accent-warning: #c49a5a;
  --color-accent-danger: #d4493a;
  --color-accent-info: #7a8f9e;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  /* Status colours */
  --color-status-inbox: #a0958a;
  --color-status-next-action: #7a8f9e;
  --color-status-in-progress: #c49a5a;
  --color-status-waiting-for: #a0958a;
  --color-status-blocked: #d4493a;
  --color-status-someday: #c4b8a8;
  --color-status-done: #6b9e6e;

  /* Area colours */
  --color-area-money: #c49a5a;
  --color-area-health: #6b9e6e;
  --color-area-growth: #7a8f9e;
  --color-area-work: #c4785a;
  --color-area-relationships: #b07aa0;
  --color-area-play: #5a9ec4;
  --color-area-environment: #8a9e6b;

  /* Font */
  --font-family-sans: "Inter", system-ui, sans-serif;
}
```

In Tailwind v4, `--color-*` theme variables automatically become utility classes (e.g., `bg-page`, `text-accent-primary`, `border-border-default`). The `--radius-*` variables map to `rounded-sm`, `rounded-md`, `rounded-lg`.

- [ ] **Step 2: Update globals.css**

Replace `src/app/globals.css` with:

```css
@import "../styles/tokens.css";

body {
  background-color: var(--color-page);
  color: var(--color-text-primary);
}
```

Do NOT use the Tailwind v3 directives (`@tailwind base/components/utilities`) — the `@import "tailwindcss"` in `tokens.css` handles this in v4.

- [ ] **Step 3: Update root layout with Inter font**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Life OS",
  description: "Personal operating system",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Verify tokens work**

Update `src/app/page.tsx` to render a simple div:

```tsx
export default function Home() {
  return (
    <div className="bg-card text-text-primary p-8 rounded-md border border-border-default m-8">
      <h1 className="text-2xl font-semibold">Life OS</h1>
      <p className="text-text-secondary mt-2">Tokens are working.</p>
    </div>
  );
}
```

Visit localhost:3000 — should see parchment-coloured card with terracotta-free text on cream background.

- [ ] **Step 5: Delete tailwind.config.ts if it exists**

`create-next-app` with Tailwind v4 should not create this file. If it does exist, delete it — Tailwind v4 uses `@theme` in CSS instead.

```bash
rm -f tailwind.config.ts tailwind.config.js postcss.config.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css src/app/globals.css src/app/layout.tsx src/app/page.tsx
git commit -m "feat: add Parchment & Terracotta design tokens (Tailwind v4)"
```

---

### Task 3: Supabase client and type generation

**Files:**
- Create: `src/lib/supabase-client.ts`
- Create: `src/lib/supabase-server.ts`
- Create: `src/lib/types.ts`
- Create: `.env.local`

- [ ] **Step 1: Create .env.local**

```
NEXT_PUBLIC_SUPABASE_URL=https://nhqxhntueexrzpyldvee.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_kneXXc29u1nzOV90Zbk2iw_oeZgsVuk
```

- [ ] **Step 2: Create browser Supabase client**

Create `src/lib/supabase-client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Create server Supabase client**

Create `src/lib/supabase-server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // In Server Components, cookies are read-only.
            // The middleware handles session refresh instead.
          }
        },
      },
    }
  );
}
```

The `try/catch` in `setAll` is required because `cookies()` is read-only in Server Components. Supabase SSR calls `setAll` to refresh session tokens — the middleware (Task 5) handles this for real, so silently catching here is correct.

- [ ] **Step 4: Generate TypeScript types from Supabase**

```bash
npx supabase gen types typescript --project-id nhqxhntueexrzpyldvee > src/lib/types.ts
```

If this fails due to auth, create a minimal placeholder `src/lib/types.ts`:
```ts
export type Database = any;
```
And regenerate later with `npx supabase login` first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase-client.ts src/lib/supabase-server.ts src/lib/types.ts
git commit -m "feat: add Supabase client and DB types"
```

---

### Task 4: TanStack Query provider

**Files:**
- Create: `src/lib/query-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create query provider**

Create `src/lib/query-provider.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: true,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

- [ ] **Step 2: Wrap app in QueryProvider**

In `src/app/layout.tsx`, import `QueryProvider` and wrap `{children}`:

```tsx
import { QueryProvider } from "@/lib/query-provider";
// ... existing imports ...

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-provider.tsx src/app/layout.tsx
git commit -m "feat: add TanStack Query provider"
```

---

### Task 5: Auth middleware and login page

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create auth middleware**

Create `src/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Create login page**

Create `src/app/login/page.tsx`:

```tsx
"use client";

import { createClient } from "@/lib/supabase-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createClient();

    const { error: authError } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="bg-elevated border border-border-default rounded-lg p-8 w-full max-w-sm shadow-sm">
        <h1 className="text-2xl font-semibold text-text-primary mb-6">
          Life OS
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-border-default rounded-sm px-3 py-2 bg-card text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-border-default rounded-sm px-3 py-2 bg-card text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            required
          />
          {error && (
            <p className="text-accent-danger text-sm">{error}</p>
          )}
          <button
            type="submit"
            className="bg-accent-primary text-white rounded-sm px-4 py-2 font-medium hover:opacity-90 transition-opacity"
          >
            {isSignUp ? "Sign Up" : "Sign In"}
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-text-secondary text-sm hover:text-text-primary"
          >
            {isSignUp
              ? "Already have an account? Sign in"
              : "First time? Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify auth flow**

1. Visit localhost:3000 — should redirect to /login
2. Create account via the sign-up form (or via Supabase dashboard)
3. Login — should redirect to /

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts src/app/login/page.tsx
git commit -m "feat: add auth middleware and login page"
```

---

### Task 6: App shell and navigation

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/app/AppNav.tsx`
- Delete: `src/app/page.tsx`
- Create: `src/app/(app)/page.tsx`
- Create: `src/app/(app)/projects/page.tsx`
- Create: `src/app/(app)/tasks/page.tsx`
- Create: `src/app/(app)/goals/page.tsx`

- [ ] **Step 1: Create AppNav component**

Create `src/components/app/AppNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderKanban, CheckSquare, Target, MoreHorizontal } from "lucide-react";

const navItems = [
  { href: "/", label: "Today", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/goals", label: "Goals", icon: Target },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border-default bg-elevated px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex items-center h-14">
        <Link href="/" className="text-lg font-semibold text-text-primary mr-8">
          Life OS
        </Link>
        <div className="flex items-center gap-1 ml-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
                  isActive
                    ? "text-accent-primary border-b-2 border-accent-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          <button className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
            <MoreHorizontal size={16} />
            <span className="hidden sm:inline">More</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Delete src/app/page.tsx**

The root `src/app/page.tsx` must be removed so it doesn't conflict with `src/app/(app)/page.tsx`. Both would handle the `/` route.

```bash
rm src/app/page.tsx
```

- [ ] **Step 3: Create authenticated layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import { AppNav } from "@/components/app/AppNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder pages**

Create `src/app/(app)/page.tsx`:
```tsx
export default function TodayPage() {
  return <h1 className="text-2xl font-semibold">Good morning, Axel</h1>;
}
```

Create `src/app/(app)/projects/page.tsx`:
```tsx
export default function ProjectsPage() {
  return <h1 className="text-2xl font-semibold">Projects</h1>;
}
```

Create `src/app/(app)/tasks/page.tsx`:
```tsx
export default function TasksPage() {
  return <h1 className="text-2xl font-semibold">Tasks</h1>;
}
```

Create `src/app/(app)/goals/page.tsx`:
```tsx
export default function GoalsPage() {
  return <h1 className="text-2xl font-semibold">Goals</h1>;
}
```

- [ ] **Step 5: Verify navigation works**

Click through all nav links. Active state should show terracotta underline. Pages should render with their title.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/" src/components/app/AppNav.tsx
git commit -m "feat: add app shell with navigation"
```

---

### Task 7: Constants and enum mappings

**Files:**
- Create: `src/lib/constants.ts`

- [ ] **Step 1: Create constants file**

Create `src/lib/constants.ts`:

```ts
// --- Status definitions ---

export const TASK_STATUSES = [
  { value: "inbox", label: "Inbox", color: "var(--color-status-inbox)" },
  { value: "next_action", label: "Next Action", color: "var(--color-status-next-action)" },
  { value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
  { value: "waiting_for", label: "Waiting For", color: "var(--color-status-waiting-for)" },
  { value: "blocked", label: "Blocked", color: "var(--color-status-blocked)" },
  { value: "someday", label: "Someday", color: "var(--color-status-someday)" },
  { value: "done", label: "Done", color: "var(--color-status-done)" },
  { value: "overdue", label: "Overdue", color: "var(--color-accent-danger)" },
] as const;

export const PROJECT_STATUSES = [
  { value: "active", label: "Active", color: "var(--color-accent-success)" },
  { value: "on_hold", label: "On Hold", color: "var(--color-accent-warning)" },
  { value: "completed", label: "Completed", color: "var(--color-status-done)" },
  { value: "dropped", label: "Dropped", color: "var(--color-text-muted)" },
] as const;

export const GOAL_STATUSES = [
  { value: "not_started", label: "Not Started", color: "var(--color-status-inbox)" },
  { value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
  { value: "achieved", label: "Achieved", color: "var(--color-status-done)" },
  { value: "abandoned", label: "Abandoned", color: "var(--color-text-muted)" },
] as const;

export const PRIORITIES = [
  { value: "critical", label: "Critical", color: "var(--color-accent-danger)" },
  { value: "high", label: "High", color: "var(--color-accent-warning)" },
  { value: "medium", label: "Medium", color: "var(--color-accent-info)" },
  { value: "low", label: "Low", color: "var(--color-text-muted)" },
  { value: "none", label: "None", color: "var(--color-text-muted)" },
] as const;

export const LIFE_AREAS = [
  { value: "money", label: "Money", color: "var(--color-area-money)" },
  { value: "health", label: "Health", color: "var(--color-area-health)" },
  { value: "growth", label: "Growth", color: "var(--color-area-growth)" },
  { value: "work", label: "Work", color: "var(--color-area-work)" },
  { value: "relationships", label: "Relationships", color: "var(--color-area-relationships)" },
  { value: "play", label: "Play", color: "var(--color-area-play)" },
  { value: "environment", label: "Environment", color: "var(--color-area-environment)" },
] as const;

// --- Kanban column mapping ---
// 7 task statuses -> 4 kanban columns. Someday is excluded from kanban.

export const KANBAN_COLUMNS = [
  { id: "todo", label: "To Do", statuses: ["inbox", "next_action"], defaultWriteStatus: "next_action" },
  { id: "in_progress", label: "In Progress", statuses: ["in_progress", "waiting_for"], defaultWriteStatus: "in_progress" },
  { id: "blocked", label: "Blocked", statuses: ["blocked"], defaultWriteStatus: "blocked" },
  { id: "done", label: "Done", statuses: ["done"], defaultWriteStatus: "done" },
] as const;

// --- Helper functions ---

const STATUS_MAP = Object.fromEntries([
  ...TASK_STATUSES.map((s) => [`task:${s.value}`, s]),
  ...PROJECT_STATUSES.map((s) => [`project:${s.value}`, s]),
  ...GOAL_STATUSES.map((s) => [`goal:${s.value}`, s]),
]);

const AREA_MAP = Object.fromEntries(LIFE_AREAS.map((a) => [a.value, a]));
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map((p) => [p.value, p]));

export function getStatusColor(status: string, type: "task" | "project" | "goal" = "task"): string {
  return STATUS_MAP[`${type}:${status}`]?.color ?? "var(--color-text-muted)";
}

export function getStatusLabel(status: string, type: "task" | "project" | "goal" = "task"): string {
  return STATUS_MAP[`${type}:${status}`]?.label ?? status;
}

export function getAreaColor(area: string): string {
  return AREA_MAP[area]?.color ?? "var(--color-text-muted)";
}

export function getAreaLabel(area: string): string {
  return AREA_MAP[area]?.label ?? area;
}

export function getPriorityColor(priority: string): string {
  return PRIORITY_MAP[priority]?.color ?? "var(--color-text-muted)";
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_MAP[priority]?.label ?? priority;
}

export function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getPillColor(value: string, type: "status" | "area" | "priority"): string {
  if (type === "area") return getAreaColor(value);
  if (type === "priority") return getPriorityColor(value);
  return getStatusColor(value);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat: add enum constants and status/area colour mappings"
```

---

## Chunk 2: Data Layer (Services + Hooks)

### Task 8: Service layer — projects

**Files:**
- Create: `src/services/projects.ts`

- [ ] **Step 1: Create projects service**

Create `src/services/projects.ts`:

```ts
import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

export async function getProjects(filters?: {
  status?: string;
  area?: string;
}): Promise<Project[]> {
  const supabase = createClient();
  let query = supabase
    .from("projects")
    .select("*")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.area) query = query.eq("area", filters.area);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getProject(id: string): Promise<Project> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .single();
  if (error) throw error;
  return data;
}

export async function createProject(data: ProjectInsert): Promise<Project> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("projects")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateProject(
  id: string,
  data: ProjectUpdate
): Promise<Project> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("projects")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/services/projects.ts
git commit -m "feat: add projects service layer"
```

---

### Task 9: Service layer — tasks

**Files:**
- Create: `src/services/tasks.ts`

- [ ] **Step 1: Create tasks service**

Create `src/services/tasks.ts`:

```ts
import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

export type TaskWithProject = Task & {
  projects: { name: string } | null;
};

export async function getTasks(filters?: {
  status?: string;
  area?: string;
  priority?: string;
  project_id?: string;
}): Promise<TaskWithProject[]> {
  const supabase = createClient();
  let query = supabase
    .from("tasks")
    .select("*, projects(name)")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.area) query = query.eq("area", filters.area);
  if (filters?.priority) query = query.eq("priority", filters.priority);
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);

  const { data, error } = await query;
  if (error) throw error;
  return data as TaskWithProject[];
}

export async function getTask(id: string): Promise<TaskWithProject> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, projects(name)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as TaskWithProject;
}

export async function createTask(data: TaskInsert): Promise<Task> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("tasks")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateTask(
  id: string,
  data: TaskUpdate
): Promise<Task> {
  const supabase = createClient();
  // If marking as done, set completed_at (use spread to avoid mutating caller's object)
  if (data.status === "done") {
    data = { ...data, completed_at: new Date().toISOString() };
  }
  const { data: updated, error } = await supabase
    .from("tasks")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveTask(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/tasks.ts
git commit -m "feat: add tasks service layer"
```

---

### Task 10: Service layer — goals, links, views

**Files:**
- Create: `src/services/goals.ts`
- Create: `src/services/links.ts`
- Create: `src/services/views.ts`

- [ ] **Step 1: Create goals service**

Create `src/services/goals.ts`:

```ts
import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Goal = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];

export async function getGoals(): Promise<Goal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
}

export async function getGoal(id: string): Promise<Goal> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createGoal(data: GoalInsert): Promise<Goal> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("goals")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateGoal(id: string, data: GoalUpdate): Promise<Goal> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("goals")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveGoal(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("goals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Create links service**

Create `src/services/links.ts`:

```ts
import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Link = Database["public"]["Tables"]["links"]["Row"];
type LinkInsert = Database["public"]["Tables"]["links"]["Insert"];

export async function getLinksFor(
  entityType: string,
  entityId: string
): Promise<Link[]> {
  const supabase = createClient();
  // Find links where this entity is either the source or destination
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .or(
      `and(src_type.eq.${entityType},src_id.eq.${entityId}),and(dst_type.eq.${entityType},dst_id.eq.${entityId})`
    );
  if (error) throw error;
  return data;
}

export async function createLink(data: LinkInsert): Promise<Link> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("links")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function deleteLink(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("links").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 3: Create views service**

Create `src/services/views.ts`:

```ts
import { createClient } from "@/lib/supabase-client";

export async function getProjectProgress() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getGoalProgress() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goal_progress")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getTodayAgenda() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("today_agenda")
    .select("*");
  if (error) throw error;
  return data;
}
```

Note: `habit_stats` view exists in the DB and is used by `today_agenda` internally. We don't need a separate service function — the Today page reads habits from `today_agenda` where `item_type='habit'`, which includes streak data in `item_details`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/goals.ts src/services/links.ts src/services/views.ts
git commit -m "feat: add goals, links, and views service layers"
```

---

### Task 11: Service layer — habits (minimal, for Today view)

**Files:**
- Create: `src/services/habits.ts`

- [ ] **Step 1: Create habits service**

Create `src/services/habits.ts`:

```ts
import { createClient } from "@/lib/supabase-client";

export async function logHabit(habitId: string): Promise<void> {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const { error } = await supabase
    .from("habit_logs")
    .insert({
      habit_id: habitId,
      logged_date: today,
      value: 1,
    });
  if (error) throw error;
}

export async function unlogHabit(
  habitId: string,
  date?: string
): Promise<void> {
  const supabase = createClient();
  const targetDate = date ?? new Date().toISOString().split("T")[0];
  const { error } = await supabase
    .from("habit_logs")
    .delete()
    .eq("habit_id", habitId)
    .eq("logged_date", targetDate);
  if (error) throw error;
}
```

Full habits CRUD is deferred to Phase 2.

- [ ] **Step 2: Commit**

```bash
git add src/services/habits.ts
git commit -m "feat: add minimal habits service for Today view"
```

---

### Task 12: TanStack Query hooks

**Files:**
- Create: `src/hooks/use-projects.ts`
- Create: `src/hooks/use-tasks.ts`
- Create: `src/hooks/use-goals.ts`
- Create: `src/hooks/use-today.ts`
- Create: `src/hooks/use-links.ts`
- Create: `src/hooks/use-habits.ts`
- Create: `src/hooks/use-project-progress.ts`
- Create: `src/hooks/use-goal-progress.ts`

- [ ] **Step 1: Create project hooks**

Create `src/hooks/use-projects.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getProjects,
  getProject,
  createProject,
  updateProject,
  archiveProject,
} from "@/services/projects";

export function useProjects(filters?: { status?: string; area?: string }) {
  return useQuery({
    queryKey: ["projects", filters],
    queryFn: () => getProjects(filters),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => getProject(id),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateProject>[1] }) =>
      updateProject(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

- [ ] **Step 2: Create task hooks**

Create `src/hooks/use-tasks.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  archiveTask,
} from "@/services/tasks";

export function useTasks(filters?: {
  status?: string;
  area?: string;
  priority?: string;
  project_id?: string;
}) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => getTasks(filters),
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => getTask(id),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateTask>[1] }) =>
      updateTask(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      updateTask(id, { status: "done", completed_at: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useArchiveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveTask,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
    },
  });
}
```

- [ ] **Step 3: Create goal hooks**

Create `src/hooks/use-goals.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGoals,
  getGoal,
  createGoal,
  updateGoal,
  archiveGoal,
} from "@/services/goals";

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: getGoals,
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: ["goals", id],
    queryFn: () => getGoal(id),
    enabled: !!id,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createGoal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
    },
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateGoal>[1] }) =>
      updateGoal(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
    },
  });
}

export function useArchiveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveGoal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
```

- [ ] **Step 4: Create view hooks**

Create `src/hooks/use-project-progress.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getProjectProgress } from "@/services/views";

export function useProjectProgress() {
  return useQuery({
    queryKey: ["project-progress"],
    queryFn: getProjectProgress,
  });
}
```

Create `src/hooks/use-goal-progress.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getGoalProgress } from "@/services/views";

export function useGoalProgress() {
  return useQuery({
    queryKey: ["goal-progress"],
    queryFn: getGoalProgress,
  });
}
```

Create `src/hooks/use-today.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getTodayAgenda } from "@/services/views";

export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: getTodayAgenda,
  });
}
```

- [ ] **Step 5: Create links hook**

Create `src/hooks/use-links.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getLinksFor } from "@/services/links";

export function useLinks(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["links", entityType, entityId],
    queryFn: () => getLinksFor(entityType, entityId),
    enabled: !!entityId,
  });
}
```

- [ ] **Step 6: Create habit hooks**

Create `src/hooks/use-habits.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logHabit, unlogHabit } from "@/services/habits";

export function useLogHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logHabit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useUnlogHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ habitId, date }: { habitId: string; date?: string }) =>
      unlogHabit(habitId, date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. All hooks should resolve their service imports.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/
git commit -m "feat: add TanStack Query hooks for all entities"
```

---

## Chunk 3: Shared Components

### Task 13: Toast component

**Files:**
- Create: `src/components/app/Toast.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Port Toast from OVER1**

Port `Getover1/over1-master/src/components/Toast.tsx` to `src/components/app/Toast.tsx`. Source is ~30 lines with a singleton pattern.

Changes from OVER1:
- Restyle: `bg-elevated text-text-primary border border-border-default rounded-md shadow-lg px-4 py-2`
- Add variant support (success gets green left border, error gets red):

```tsx
"use client";

import { useEffect, useState } from "react";

type Variant = "default" | "success" | "error";
type ToastData = { message: string; variant: Variant };

let showToastGlobal: (message: string, variant?: Variant) => void = () => {};

export function toast(message: string, variant: Variant = "default") {
  showToastGlobal(message, variant);
}

const variantBorder: Record<Variant, string> = {
  default: "border-border-default",
  success: "border-l-4 border-l-accent-success border-border-default",
  error: "border-l-4 border-l-accent-danger border-border-default",
};

export function Toast() {
  const [data, setData] = useState<ToastData | null>(null);

  useEffect(() => {
    showToastGlobal = (message, variant = "default") => {
      setData({ message, variant });
      setTimeout(() => setData(null), 2500);
    };
  }, []);

  if (!data) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 bg-elevated text-text-primary rounded-md shadow-lg px-4 py-3 text-sm border ${variantBorder[data.variant]} animate-in slide-in-from-bottom-2`}
    >
      {data.message}
    </div>
  );
}
```

- [ ] **Step 2: Mount Toast in app layout**

In `src/app/(app)/layout.tsx`, add `<Toast />` as a sibling of `<main>`, inside the root `<div>`:

```tsx
import { AppNav } from "@/components/app/AppNav";
import { Toast } from "@/components/app/Toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
      <Toast />
    </div>
  );
}
```

- [ ] **Step 3: Verify toast works**

Add a temporary button to the Today page that calls `toast("Hello")`. Click it, see toast appear bottom-right for ~2.5 seconds.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/Toast.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: add Toast notification component"
```

---

### Task 14: StatusPill and ProgressRing

**Files:**
- Create: `src/components/app/StatusPill.tsx`
- Create: `src/components/app/ProgressRing.tsx`

- [ ] **Step 1: Create StatusPill**

Create `src/components/app/StatusPill.tsx`:

```tsx
import { getPillColor, formatLabel } from "@/lib/constants";

type Props = {
  value: string;
  type: "status" | "area" | "priority";
};

export function StatusPill({ value, type }: Props) {
  const color = getPillColor(value, type);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {formatLabel(value)}
    </span>
  );
}
```

Note: `color-mix` creates a 15% tint of the status colour for the background. If browser support is a concern, fall back to a hex-based approach, but for a personal app this is fine.

- [ ] **Step 2: Create ProgressRing**

Create `src/components/app/ProgressRing.tsx`. Extract the SVG donut pattern from `Getover1/over1-master/src/desktop/pages/DashboardPage.tsx` (lines 48-64) and restyle:

```tsx
type Props = {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
};

export function ProgressRing({
  value,
  size = 40,
  strokeWidth = 3.5,
  color = "var(--color-accent-success)",
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(circumference * value) / 100} ${circumference}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border-default)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Centre text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[10px] font-semibold fill-text-primary"
      >
        {Math.round(value)}%
      </text>
    </svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/app/StatusPill.tsx src/components/app/ProgressRing.tsx
git commit -m "feat: add StatusPill and ProgressRing components"
```

---

### Task 15: EditableCell (decoupled)

**Files:**
- Create: `src/components/app/EditableCell.tsx`

- [ ] **Step 1: Port and decouple EditableCell**

Port from `Getover1/over1-master/src/components/EditableCell.tsx` (~141 lines).

**Imports to remove:** `createClient` from `@supabase/supabase-js`, `toast` from `./Toast`, and all direct DB calls (`saveCell`, `supabase.from()`).

**Key changes:**
- Replace direct Supabase save with `onSave: (newValue: string) => Promise<void>` callback prop
- The component calls `onSave`, catches errors, and calls `toast` from the Life OS Toast (import from `@/components/app/Toast`)
- Keep the `editing` → focus → blur → save flow
- Keep `type` support: `"text" | "textarea" | "select" | "date" | "number"`
- For badge display: add a `displayAs?: "pill"` prop. When set, render a `StatusPill` instead of plain text in read mode. The `pillType` prop (`"status" | "area" | "priority"`) determines how to look up the colour.

Create `src/components/app/EditableCell.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "@/components/app/Toast";
import { StatusPill } from "@/components/app/StatusPill";

type Props = {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "textarea" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  displayAs?: "pill";
  pillType?: "status" | "area" | "priority";
  placeholder?: string;
  className?: string;
};

export function EditableCell({
  value,
  onSave,
  type = "text",
  options,
  displayAs,
  pillType,
  placeholder = "—",
  className = "",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  async function handleSave() {
    setEditing(false);
    if (current === value) return;
    setSaving(true);
    try {
      await onSave(current);
      toast("Saved", "success");
    } catch {
      setCurrent(value);
      toast("Error saving", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div
        className={`cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors ${className}`}
        onClick={() => setEditing(true)}
      >
        {saving ? (
          <span className="text-text-muted text-xs">Saving...</span>
        ) : displayAs === "pill" && pillType && current ? (
          <StatusPill value={current} type={pillType} />
        ) : current ? (
          <span>{current}</span>
        ) : (
          <span className="text-text-muted">{placeholder}</span>
        )}
      </div>
    );
  }

  if (type === "select" && options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={current}
        onChange={(e) => {
          setCurrent(e.target.value);
          setEditing(false);
          // Save on change for selects
          const newVal = e.target.value;
          setCurrent(newVal);
          setSaving(true);
          onSave(newVal)
            .then(() => toast("Saved", "success"))
            .catch(() => {
              setCurrent(value);
              toast("Error saving", "error");
            })
            .finally(() => setSaving(false));
        }}
        onBlur={() => setEditing(false)}
        className="border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        onBlur={handleSave}
        rows={3}
        className="w-full border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y"
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type}
      value={current}
      onChange={(e) => setCurrent(e.target.value)}
      onBlur={handleSave}
      onKeyDown={(e) => e.key === "Enter" && handleSave()}
      className="border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app/EditableCell.tsx
git commit -m "feat: add EditableCell component (decoupled from Supabase)"
```

---

### Task 16: FlyoutPanel (generic)

**Files:**
- Create: `src/components/app/FlyoutPanel.tsx`

- [ ] **Step 1: Port and genericise FlyoutPanel**

Port from `Getover1/over1-master/src/desktop/components/ProjectPanel.tsx` (~250 lines).

**Imports to remove:** `saveCell` from `@/lib/helpers`, `createClient`, `toast` from OVER1's Toast, and all OVER1-specific field definitions (infrastructure, growth_plan, claude_advice).

**Key design decisions:**
- Title is edited via the same `onSave("name", value)` callback as any other field — callers handle cascading if needed
- No `onRename` prop (OVER1-specific)
- `FieldConfig.type` includes `"number"` for completeness

Create `src/components/app/FlyoutPanel.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { EditableCell } from "./EditableCell";

export type FieldConfig = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  section?: string;
  placeholder?: string;
  displayAs?: "pill";
  pillType?: "status" | "area" | "priority";
};

type Props = {
  title: string;
  fields: FieldConfig[];
  data: Record<string, any>;
  stats?: { label: string; value: string | number }[];
  onSave: (field: string, value: string) => Promise<void>;
  onClose: () => void;
};

export function FlyoutPanel({ title, fields, data, stats, onSave, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Group fields by section
  const sections = new Map<string, FieldConfig[]>();
  for (const field of fields) {
    const section = field.section ?? "";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(field);
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-elevated border-l border-border-default z-50 overflow-y-auto shadow-xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <EditableCell
            value={title}
            onSave={(v) => onSave("name", v)}
            className="text-lg font-semibold"
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-card text-text-secondary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stats bar */}
        {stats && stats.length > 0 && (
          <div className="flex gap-4 px-4 py-3 border-b border-border-default bg-card">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-lg font-semibold text-text-primary">
                  {stat.value}
                </div>
                <div className="text-xs text-text-secondary">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Fields grouped by section */}
        <div className="p-4 space-y-6">
          {Array.from(sections.entries()).map(([sectionName, sectionFields]) => (
            <div key={sectionName}>
              {sectionName && (
                <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                  {sectionName}
                </h3>
              )}
              <div className="space-y-3">
                {sectionFields.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs text-text-secondary mb-1 block">
                      {field.label}
                    </label>
                    <EditableCell
                      value={data[field.key]?.toString() ?? ""}
                      onSave={(v) => onSave(field.key, v)}
                      type={field.type}
                      options={field.options}
                      displayAs={field.displayAs}
                      pillType={field.pillType}
                      placeholder={field.placeholder ?? "—"}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app/FlyoutPanel.tsx
git commit -m "feat: add generic FlyoutPanel component"
```

---

### Task 17: DataTable (frozen-column scrollable table)

**Files:**
- Create: `src/components/app/DataTable.tsx`

- [ ] **Step 1: Port and genericise DataTable**

Port from `Getover1/over1-master/src/desktop/components/TableScroller.tsx` (~121 lines). The TableScroller is the outer shell (scroll + slider). Combine with a generic column-config-driven table.

**OVER1 CSS classes to port:** The OVER1 `TableScroller` relies on CSS classes (`tl-scroller`, `tl-card`, `tl-scroll-hide`, `tl-slider-wrap`, `tl-slider-track`, `tl-slider-thumb`, `tl-pin`, `tl-pin-edge`). These structural styles must be included inline or as a `<style>` block within the component, since Life OS does not have a global CSS file for these.

Create `src/components/app/DataTable.tsx`:

```tsx
"use client";

import { useRef, useEffect, useState } from "react";

export type Column<T> = {
  key: string;
  header: string;
  width?: string;
  render?: (row: T) => React.ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  frozenFirstColumn?: boolean;
  loading?: boolean;
  emptyMessage?: string;
};

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  onRowClick,
  frozenFirstColumn = true,
  loading = false,
  emptyMessage = "No items",
}: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollLeft > 0);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 bg-card rounded-sm animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        {emptyMessage}
      </div>
    );
  }

  const frozenCol = frozenFirstColumn ? columns[0] : null;
  const scrollCols = frozenFirstColumn ? columns.slice(1) : columns;

  return (
    <div className="border border-border-default rounded-md overflow-hidden bg-elevated">
      <div className="flex">
        {/* Frozen column */}
        {frozenCol && (
          <div
            className={`shrink-0 border-r border-border-default bg-elevated z-10 ${
              scrolled ? "shadow-[2px_0_4px_rgba(0,0,0,0.06)]" : ""
            }`}
            style={{ width: frozenCol.width ?? "240px" }}
          >
            {/* Header */}
            <div className="h-10 flex items-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border-default bg-card">
              {frozenCol.header}
            </div>
            {/* Rows */}
            {data.map((row, i) => (
              <div
                key={(row as any).id ?? i}
                className="h-10 flex items-center px-3 text-sm border-b border-border-default hover:bg-page cursor-pointer"
                onClick={() => onRowClick?.(row)}
              >
                {frozenCol.render
                  ? frozenCol.render(row)
                  : String((row as any)[frozenCol.key] ?? "")}
              </div>
            ))}
          </div>
        )}

        {/* Scrollable columns */}
        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <div className="min-w-max">
            {/* Header row */}
            <div className="flex h-10 border-b border-border-default bg-card">
              {scrollCols.map((col) => (
                <div
                  key={col.key}
                  className="flex items-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide"
                  style={{ width: col.width ?? "150px" }}
                >
                  {col.header}
                </div>
              ))}
            </div>
            {/* Data rows */}
            {data.map((row, i) => (
              <div
                key={(row as any).id ?? i}
                className="flex h-10 border-b border-border-default hover:bg-page cursor-pointer"
                onClick={() => onRowClick?.(row)}
              >
                {scrollCols.map((col) => (
                  <div
                    key={col.key}
                    className="flex items-center px-3 text-sm"
                    style={{ width: col.width ?? "150px" }}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as any)[col.key] ?? "")}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

This implementation uses Tailwind classes instead of porting the OVER1 CSS classes directly. The frozen column is achieved with `shrink-0` + `z-10` on the left pane and `overflow-x-auto` on the right. The shadow on scroll (`scrolled` state) replaces the OVER1 `tl-pin-edge` class. The Monday-style slider thumb is omitted — the native scrollbar is sufficient for a personal app and can be styled later if desired.

- [ ] **Step 2: Commit**

```bash
git add src/components/app/DataTable.tsx
git commit -m "feat: add DataTable with frozen column and scroll"
```

---

### Task 18: FilterBar

**Files:**
- Create: `src/components/app/FilterBar.tsx`

- [ ] **Step 1: Port and restyle FilterBar**

Port `SearchPill` and `FilterPill` from `Getover1/over1-master/src/desktop/components/TableControls.tsx` (~240 lines).

**Changes from OVER1:**
- Replace custom SVG icons with Lucide (`Search`, `ChevronDown`, `Check`)
- Restyle with tokens: `bg-card border-border-default text-text-primary` for pills, `bg-elevated` for dropdown menus
- Active pill gets `border-accent-primary` highlight
- `FilterButton` (advanced multi-group popover) is intentionally NOT ported in Phase 1 — four `FilterPill` components cover the needed filter dimensions
- `onDeleteOption` and `footerAction` props are dropped — not needed for a personal app

Create `src/components/app/FilterBar.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check } from "lucide-react";

// --- SearchPill ---
export function SearchPill({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2 border border-border-default rounded-sm px-3 py-1.5 bg-card">
      <Search size={14} className="text-text-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none w-32 focus:w-48 transition-all"
      />
    </div>
  );
}

// --- FilterPill ---
export function FilterPill({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = selected !== null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 border rounded-sm px-3 py-1.5 text-sm transition-colors ${
          isActive
            ? "border-accent-primary text-accent-primary bg-card"
            : "border-border-default text-text-secondary bg-card hover:text-text-primary"
        }`}
      >
        {label}
        {selected && (
          <span className="text-xs font-medium">
            : {options.find((o) => o.value === selected)?.label}
          </span>
        )}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-elevated border border-border-default rounded-md shadow-lg z-30 min-w-[160px]">
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-card ${
              !selected ? "text-accent-primary" : "text-text-secondary"
            }`}
          >
            All
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-card flex items-center justify-between text-text-primary"
            >
              {opt.label}
              {selected === opt.value && (
                <Check size={14} className="text-accent-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- FilterBar wrapper ---
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">{children}</div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app/FilterBar.tsx
git commit -m "feat: add FilterBar with search and filter pills"
```

---

### Task 19: QuickAdd row

**Files:**
- Create: `src/components/app/QuickAdd.tsx`

- [ ] **Step 1: Create QuickAdd**

Create `src/components/app/QuickAdd.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

type Props = {
  onAdd: (title: string) => void;
  placeholder?: string;
};

export function QuickAdd({ onAdd, placeholder = "Add task..." }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  }

  return (
    <div className="flex items-center gap-2 border-t border-dashed border-border-default px-3 py-2 bg-page">
      <Plus size={16} className="text-text-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") setValue("");
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
      />
    </div>
  );
}
```

Callers wire `onAdd` to the relevant `useCreate*` mutation. For example, the Tasks page passes:
```tsx
<QuickAdd onAdd={(title) => createTask.mutate({ title, status: "inbox" })} />
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app/QuickAdd.tsx
git commit -m "feat: add QuickAdd inline row component"
```

---

## Chunk 4: Pages

**Important:** Before building each page, show the user a visual mockup in the browser companion for layout approval. Use the brainstorming visual companion server. If the server is not running, describe the layout in terminal and proceed.

### Task 20: Today page

**Files:**
- Modify: `src/app/(app)/page.tsx` (replace placeholder)

- [ ] **Step 1: Show visual mockup to user**

Create an HTML mockup of the Today page layout using the visual companion, populated with seed data. Get user approval before building.

- [ ] **Step 2: Build Today page**

Replace `src/app/(app)/page.tsx`:

```tsx
"use client";

import { useToday } from "@/hooks/use-today";
import { useCompleteTask } from "@/hooks/use-tasks";
import { useLogHabit } from "@/hooks/use-habits";
import { StatusPill } from "@/components/app/StatusPill";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function TodayPage() {
  const { data: agenda, isLoading } = useToday();
  const completeTask = useCompleteTask();
  const logHabit = useLogHabit();

  const tasks = agenda?.filter((item: any) => item.item_type === "task") ?? [];
  const habits = agenda?.filter((item: any) => item.item_type === "habit") ?? [];
  const events = agenda?.filter((item: any) => item.item_type === "event") ?? [];
  // Filter out follow_up items — deferred to Phase 3 (CRM)

  const tasksDue = tasks.length;
  const habitsRemaining = habits.filter(
    (h: any) => !h.item_details?.logged_today
  ).length;

  return (
    <div className="max-w-2xl">
      {/* Greeting */}
      <h1 className="text-2xl font-semibold text-text-primary">
        {getGreeting()}, Axel
      </h1>
      <p className="text-text-secondary text-sm mt-1">
        {formatDate()} — {tasksDue} task{tasksDue !== 1 ? "s" : ""} due
        {habitsRemaining > 0 && `, ${habitsRemaining} habit${habitsRemaining !== 1 ? "s" : ""} to go`}
      </p>

      {isLoading ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-card rounded-sm animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {/* Tasks */}
          {tasks.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Due Today
              </h2>
              <div className="space-y-1">
                {tasks.map((task: any) => (
                  <div
                    key={task.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card group"
                  >
                    <input
                      type="checkbox"
                      checked={task.item_details?.status === "done"}
                      onChange={() => completeTask.mutate(task.item_id)}
                      className="w-4 h-4 rounded border-2 border-border-default accent-accent-primary cursor-pointer"
                    />
                    <span className="text-sm text-text-primary flex-1">
                      {task.item_title}
                    </span>
                    {task.item_details?.project_name && (
                      <span className="text-xs bg-card text-text-secondary px-2 py-0.5 rounded-sm">
                        {task.item_details.project_name}
                      </span>
                    )}
                    {task.item_details?.overdue && (
                      <StatusPill value="overdue" type="status" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Habits */}
          {habits.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Habits
              </h2>
              <div className="space-y-1">
                {habits.map((habit: any) => (
                  <div
                    key={habit.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card"
                  >
                    <button
                      onClick={() => logHabit.mutate(habit.item_id)}
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-colors ${
                        habit.item_details?.logged_today
                          ? "border-accent-success bg-accent-success text-white"
                          : "border-border-default text-text-muted hover:border-accent-success"
                      }`}
                    >
                      {habit.item_details?.logged_today ? "✓" : "—"}
                    </button>
                    <span className="text-sm text-text-primary flex-1">
                      {habit.item_title}
                    </span>
                    {habit.item_details?.streak > 0 && (
                      <span className="text-xs text-accent-success font-medium">
                        {habit.item_details.streak}-day streak
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Events */}
          {events.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Events
              </h2>
              <div className="space-y-1">
                {events.map((event: any) => (
                  <div
                    key={event.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card"
                  >
                    <span className="text-xs text-text-secondary w-14">
                      {event.item_details?.time ?? "—"}
                    </span>
                    <span className="text-sm text-text-primary flex-1">
                      {event.item_title}
                    </span>
                    {event.item_details?.category && (
                      <StatusPill value={event.item_details.category} type="status" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify with seed data**

Login, see greeting with today's date. Seed tasks should appear (overdue ones marked). Morning pages and Gym habits should show. No events expected (none seeded for today).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "feat: build Today page with tasks, habits, events"
```

---

### Task 21: Projects page

**Files:**
- Modify: `src/app/(app)/projects/page.tsx` (replace placeholder)

- [ ] **Step 1: Show visual mockup to user**

Mockup the projects list view with fly-out panel.

- [ ] **Step 2: Build Projects page**

Replace `src/app/(app)/projects/page.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { useProjects, useUpdateProject } from "@/hooks/use-projects";
import { useProjectProgress } from "@/hooks/use-project-progress";
import { DataTable, type Column } from "@/components/app/DataTable";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { ProgressRing } from "@/components/app/ProgressRing";
import { PROJECT_STATUSES, LIFE_AREAS, PRIORITIES } from "@/lib/constants";

const PROJECT_FIELDS: FieldConfig[] = [
  { key: "outcome", label: "Outcome", type: "textarea", section: "Contract" },
  { key: "target_date", label: "Target Date", type: "date", section: "Contract" },
  { key: "success_check", label: "Success Check", type: "textarea", section: "Contract" },
  { key: "current_status", label: "Current Status", type: "textarea", section: "Now" },
  { key: "next_steps", label: "Next Steps", type: "textarea", section: "Now" },
  { key: "description", label: "Description", type: "textarea", section: "Details" },
  {
    key: "status", label: "Status", type: "select", section: "Details",
    options: PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    displayAs: "pill", pillType: "status",
  },
  {
    key: "priority", label: "Priority", type: "select", section: "Details",
    options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
    displayAs: "pill", pillType: "priority",
  },
  {
    key: "area", label: "Area", type: "select", section: "Details",
    options: LIFE_AREAS.map((a) => ({ value: a.value, label: a.label })),
    displayAs: "pill", pillType: "area",
  },
  { key: "colour", label: "Colour", type: "text", section: "Details" },
  { key: "notes", label: "Notes", type: "textarea", section: "Details" },
];

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: projects, isLoading } = useProjects();
  const { data: progress } = useProjectProgress();
  const updateProject = useUpdateProject();

  // Merge progress data with projects
  const progressMap = useMemo(
    () => Object.fromEntries((progress ?? []).map((p: any) => [p.project_id, p])),
    [progress]
  );

  const filtered = useMemo(() => {
    let list = projects ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name?.toLowerCase().includes(q));
    }
    if (statusFilter) list = list.filter((p: any) => p.status === statusFilter);
    if (areaFilter) list = list.filter((p: any) => p.area === areaFilter);
    return list;
  }, [projects, search, statusFilter, areaFilter]);

  const selected = filtered.find((p: any) => p.id === selectedId);
  const selectedProgress = selectedId ? progressMap[selectedId] : null;

  const columns: Column<any>[] = [
    { key: "name", header: "Name", width: "240px" },
    {
      key: "status", header: "Status", width: "120px",
      render: (row) => row.status ? <StatusPill value={row.status} type="status" /> : "—",
    },
    {
      key: "area", header: "Area", width: "120px",
      render: (row) => row.area ? <StatusPill value={row.area} type="area" /> : "—",
    },
    {
      key: "priority", header: "Priority", width: "100px",
      render: (row) => row.priority ? <StatusPill value={row.priority} type="priority" /> : "—",
    },
    {
      key: "progress", header: "Progress", width: "120px",
      render: (row) => {
        const prog = progressMap[row.id];
        const pct = prog ? Math.round((prog.done_tasks / Math.max(prog.total_tasks, 1)) * 100) : 0;
        return (
          <div className="flex items-center gap-2">
            <ProgressRing value={pct} size={28} strokeWidth={3} />
          </div>
        );
      },
    },
    {
      key: "target_date", header: "Target Date", width: "120px",
      render: (row) => row.target_date
        ? new Date(row.target_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "—",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Projects</h1>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search projects..." />
        <FilterPill
          label="Status"
          options={PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterPill
          label="Area"
          options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))}
          selected={areaFilter}
          onChange={setAreaFilter}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        loading={isLoading}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage="No projects found"
      />

      {selected && (
        <FlyoutPanel
          title={selected.name}
          fields={PROJECT_FIELDS}
          data={selected}
          stats={
            selectedProgress
              ? [
                  { label: "Total", value: selectedProgress.total_tasks ?? 0 },
                  { label: "Done", value: selectedProgress.done_tasks ?? 0 },
                  { label: "Blocked", value: selectedProgress.blocked_tasks ?? 0 },
                  { label: "Overdue", value: selectedProgress.overdue_tasks ?? 0 },
                ]
              : undefined
          }
          onSave={async (field, value) => {
            await updateProject.mutateAsync({
              id: selected.id,
              data: { [field]: value || null },
            });
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify with seed data**

See "Life OS Build" (67%, 2/3 done) and "Portuguese Residency Setup" (0%, 0/1). Click Life OS Build → fly-out shows current_status, next_steps, outcome, success_check. Edit a field, blur → saves, toast confirms.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/projects/page.tsx"
git commit -m "feat: build Projects page with list view and fly-out panel"
```

---

### Task 22: Tasks page — table view

**Files:**
- Modify: `src/app/(app)/tasks/page.tsx` (replace placeholder)

- [ ] **Step 1: Show visual mockup to user**

Mockup the tasks table with filters and quick-add.

- [ ] **Step 2: Build Tasks table view**

Replace `src/app/(app)/tasks/page.tsx`. This is the most complex page — it needs a tree builder for subtasks and a recursive row renderer.

**Tree-building utility** (put at top of file or in a shared util):

```ts
type TaskNode = any & { children: TaskNode[]; depth: number };

function buildTree(tasks: any[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];

  // Create nodes
  for (const t of tasks) {
    map.set(t.id, { ...t, children: [], depth: 0 });
  }

  // Link parents
  for (const node of map.values()) {
    if (node.parent_task_id && map.has(node.parent_task_id)) {
      const parent = map.get(node.parent_task_id)!;
      node.depth = Math.min(parent.depth + 1, 3); // Max 3 levels
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
```

**Full page code:**

```tsx
"use client";

import { useState, useMemo } from "react";
import { useTasks, useCreateTask, useUpdateTask, useCompleteTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { QuickAdd } from "@/components/app/QuickAdd";
import { TASK_STATUSES, LIFE_AREAS, PRIORITIES, KANBAN_COLUMNS } from "@/lib/constants";
import { ChevronRight, ChevronDown, List, LayoutGrid } from "lucide-react";

// ... buildTree function from above ...

type ViewMode = "table" | "kanban";

export default function TasksPage() {
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: tasks, isLoading } = useTasks();
  const { data: projects } = useProjects();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();

  // Apply filters
  const filtered = useMemo(() => {
    let list = tasks ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t: any) => t.title?.toLowerCase().includes(q));
    }
    if (statusFilter) list = list.filter((t: any) => t.status === statusFilter);
    if (areaFilter) list = list.filter((t: any) => t.area === areaFilter);
    if (priorityFilter) list = list.filter((t: any) => t.priority === priorityFilter);
    if (projectFilter) list = list.filter((t: any) => t.project_id === projectFilter);
    return list;
  }, [tasks, search, statusFilter, areaFilter, priorityFilter, projectFilter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const selected = (tasks ?? []).find((t: any) => t.id === selectedId);

  const projectOptions = (projects ?? []).map((p: any) => ({
    value: p.id, label: p.name,
  }));

  const taskFields: FieldConfig[] = [
    { key: "title", label: "Title", type: "text" },
    { key: "notes", label: "Notes", type: "textarea" },
    {
      key: "status", label: "Status", type: "select",
      options: TASK_STATUSES.filter(s => s.value !== "overdue").map(s => ({ value: s.value, label: s.label })),
      displayAs: "pill", pillType: "status",
    },
    {
      key: "priority", label: "Priority", type: "select",
      options: PRIORITIES.map(p => ({ value: p.value, label: p.label })),
      displayAs: "pill", pillType: "priority",
    },
    {
      key: "area", label: "Area", type: "select",
      options: LIFE_AREAS.map(a => ({ value: a.value, label: a.label })),
      displayAs: "pill", pillType: "area",
    },
    {
      key: "project_id", label: "Project", type: "select",
      options: [{ value: "", label: "None" }, ...projectOptions],
    },
    { key: "deadline", label: "Deadline", type: "date" },
  ];

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Recursive row renderer for table view
  function renderRows(nodes: any[]): React.ReactNode[] {
    return nodes.flatMap((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const isOverdue = node.deadline && new Date(node.deadline) < new Date() && node.status !== "done";
      const indent = node.depth * 24;

      const row = (
        <div
          key={node.id}
          className="flex items-center h-10 border-b border-border-default hover:bg-page text-sm"
        >
          {/* Title (frozen-style) */}
          <div className="w-[280px] shrink-0 flex items-center px-3 gap-1" style={{ paddingLeft: `${12 + indent}px` }}>
            {hasChildren ? (
              <button onClick={() => toggleCollapse(node.id)} className="p-0.5 text-text-muted hover:text-text-primary">
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <input
              type="checkbox"
              checked={node.status === "done"}
              onChange={() => completeTask.mutate(node.id)}
              className="w-3.5 h-3.5 rounded border-border-default accent-accent-primary cursor-pointer mr-1"
            />
            <span
              className="truncate cursor-pointer hover:text-accent-primary"
              onClick={() => setSelectedId(node.id)}
            >
              {node.title}
            </span>
          </div>
          <div className="w-[110px] px-3">
            {node.status && <StatusPill value={node.status} type="status" />}
          </div>
          <div className="w-[100px] px-3">
            {node.priority && <StatusPill value={node.priority} type="priority" />}
          </div>
          <div className="w-[140px] px-3 text-text-secondary truncate">
            {node.projects?.name ?? "—"}
          </div>
          <div className="w-[110px] px-3">
            {node.area && <StatusPill value={node.area} type="area" />}
          </div>
          <div className={`w-[110px] px-3 ${isOverdue ? "text-accent-danger font-medium" : "text-text-secondary"}`}>
            {node.deadline
              ? new Date(node.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
              : "—"}
          </div>
        </div>
      );

      if (hasChildren && !isCollapsed) {
        return [row, ...renderRows(node.children)];
      }
      return [row];
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-1 border border-border-default rounded-sm">
          <button
            onClick={() => setView("table")}
            className={`p-1.5 ${view === "table" ? "bg-card text-text-primary" : "text-text-muted"}`}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setView("kanban")}
            className={`p-1.5 ${view === "kanban" ? "bg-card text-text-primary" : "text-text-muted"}`}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search tasks..." />
        <FilterPill label="Status" options={TASK_STATUSES.filter(s => s.value !== "overdue").map(s => ({ value: s.value, label: s.label }))} selected={statusFilter} onChange={setStatusFilter} />
        <FilterPill label="Area" options={LIFE_AREAS.map(a => ({ value: a.value, label: a.label }))} selected={areaFilter} onChange={setAreaFilter} />
        <FilterPill label="Priority" options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} selected={priorityFilter} onChange={setPriorityFilter} />
        {projectOptions.length > 0 && (
          <FilterPill label="Project" options={projectOptions} selected={projectFilter} onChange={setProjectFilter} />
        )}
      </FilterBar>

      {view === "table" ? (
        <div className="border border-border-default rounded-md overflow-hidden bg-elevated">
          {/* Header */}
          <div className="flex h-10 border-b border-border-default bg-card text-xs font-medium text-text-secondary uppercase tracking-wide">
            <div className="w-[280px] shrink-0 px-3 flex items-center">Title</div>
            <div className="w-[110px] px-3 flex items-center">Status</div>
            <div className="w-[100px] px-3 flex items-center">Priority</div>
            <div className="w-[140px] px-3 flex items-center">Project</div>
            <div className="w-[110px] px-3 flex items-center">Area</div>
            <div className="w-[110px] px-3 flex items-center">Deadline</div>
          </div>

          {isLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-card animate-pulse border-b border-border-default" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">No tasks found</div>
          ) : (
            renderRows(tree)
          )}

          <QuickAdd
            onAdd={(title) => createTask.mutate({ title, status: "inbox" } as any)}
            placeholder="Add task..."
          />
        </div>
      ) : (
        /* Kanban view — implemented in Task 23 */
        <div className="text-text-secondary text-center py-12">Kanban view (Task 23)</div>
      )}

      {selected && (
        <FlyoutPanel
          title={selected.title}
          fields={taskFields}
          data={selected}
          onSave={async (field, value) => {
            await updateTask.mutateAsync({
              id: selected.id,
              data: { [field]: value || null },
            });
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
```

The kanban placeholder div will be replaced in Task 23.

- [ ] **Step 3: Verify with seed data**

See 5 seed tasks. Filter by project "Life OS Build" → see 3 tasks. Quick-add a task → appears in list. Click a task → edit in fly-out.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/tasks/page.tsx"
git commit -m "feat: build Tasks page with table view, filters, quick-add"
```

---

### Task 23: Tasks page — kanban view

**Files:**
- Modify: `src/app/(app)/tasks/page.tsx`

- [ ] **Step 1: Add view toggle**

Add a toggle button group (Table | Kanban) at the top right of the tasks page. Use Lucide icons: `List`, `LayoutGrid`.

- [ ] **Step 2: Build Kanban board**

- 4 columns using `KANBAN_COLUMNS` from constants: To Do (inbox + next_action), In Progress (in_progress + waiting_for), Blocked (blocked), Done (done)
- Someday tasks excluded from kanban
- Each card: title, project pill, priority indicator, deadline if set
- Drag and drop between columns using HTML5 drag API:
  - `draggable` on cards
  - `onDragOver`/`onDrop` on columns
  - On drop: set status to the column's `defaultWriteStatus` (e.g., dropping into "In Progress" sets status to `in_progress`, not `waiting_for`). Call `useUpdateTask`.
- Column headers show count

- [ ] **Step 3: Verify with seed data**

Toggle to Kanban. See tasks distributed across columns. Drag "Build projects list UI" from To Do to In Progress → status updates, task moves.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/tasks/page.tsx"
git commit -m "feat: add Kanban view to Tasks page with drag-and-drop"
```

---

### Task 24: Goals page

**Files:**
- Modify: `src/app/(app)/goals/page.tsx` (replace placeholder)

- [ ] **Step 1: Show visual mockup to user**

Mockup the goals tree view.

- [ ] **Step 2: Build Goals page**

Replace `src/app/(app)/goals/page.tsx`:

- Use `useGoalProgress()` to get goals with progress data
- Tree structure: top-level goals (parent_goal_id is null) listed with:
  - ProgressRing showing `direct_pct` or `linked_tasks_pct`
  - Title
  - Area badge (StatusPill)
  - Horizon badge
  - Status badge
- Expand goal → child goals/key results (kind='key_result') with their progress
- Expand key result → linked projects and tasks. Query `links` where `dst_type='goal'` and `dst_id=kr.id`, `relation='contributes_to'`. Key results are rows in the `goals` table with `kind='key_result'` — same `dst_type='goal'` value covers both goals and KRs.
- All collapsed by default
- Click goal title → FlyoutPanel with: title (text), kind (display only — text), area (select), horizon (select), status (select), target_value (number), current_value (number), unit (text), progress_mode (select), due_date (date), notes (textarea)

- [ ] **Step 3: Verify with seed data**

See "Ship Life OS v1" goal. Expand → see "Complete Phase 0-2 by end of Q3" key result (1/3 phases, 33%). Expand KR → see linked "Life OS Build" project.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/goals/page.tsx"
git commit -m "feat: build Goals page with tree view and progress rings"
```

---

### Task 25: shadcn/ui setup and polish

**Files:**
- Create: `src/components/ui/` (generated by shadcn)
- Create: `components.json` (at repo root)
- Modify: multiple component files (FlyoutPanel, FilterBar, EditableCell, page files)

**Note:** This task retrofits shadcn/ui into components built in Tasks 13-24. Expect to touch FlyoutPanel, FilterBar, EditableCell, and all four page files to replace raw HTML `<select>`, `<button>`, and dropdowns with shadcn equivalents.

- [ ] **Step 1: Install shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted, configure to use the existing Tailwind CSS and tokens path. Add needed components:

```bash
npx shadcn@latest add button dropdown-menu select popover dialog
```

- [ ] **Step 2: Resolve token conflicts**

After `shadcn init`, check `src/app/globals.css` and `tailwind.config.ts` (if recreated). shadcn injects its own CSS variables (`--primary`, `--background`, `--foreground`, etc.) which may overwrite the Life OS tokens.

**Resolution:** The shadcn CSS variables can coexist with the Life OS `--color-*` tokens. If shadcn has added a `:root` block to `globals.css`, keep it but ensure the Life OS `@import "../styles/tokens.css"` remains at the top. Map shadcn's `--primary` to `var(--color-accent-primary)`, `--background` to `var(--color-page)`, etc. in the shadcn `:root` block.

- [ ] **Step 3: Restyle shadcn components with tokens**

Update the generated `src/components/ui/` files to use Life OS token colours where they reference shadcn variables.

- [ ] **Step 4: Replace raw HTML selects/buttons in components**

Replace `<select>` with shadcn `<Select>`, `<button>` with shadcn `<Button>`, dropdowns with `<DropdownMenu>` in FlyoutPanel, FilterBar, EditableCell, and page files. This gets keyboard navigation and accessibility for free.

**Important for EditableCell:** The native `<select>` uses `onChange` and `ref`. shadcn's `<Select>` (Radix-based) uses `onValueChange` instead and does not accept a native ref. Update the select branch in EditableCell:

```tsx
// Replace the native <select> branch with:
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

// In the select rendering:
<Select value={current} onValueChange={(newVal) => {
  setCurrent(newVal);
  setSaving(true);
  onSave(newVal)
    .then(() => toast("Saved", "success"))
    .catch(() => { setCurrent(value); toast("Error saving", "error"); })
    .finally(() => { setSaving(false); setEditing(false); });
}}>
  <SelectTrigger className="border-border-default bg-card text-text-primary">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {options?.map((opt) => (
      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 5: Verify all pages still work with shadcn components**

Click through Today, Projects, Tasks, Goals. All interactions should work.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ components.json src/app/globals.css src/components/app/ "src/app/(app)/"
git commit -m "feat: integrate shadcn/ui components with Life OS tokens"
```

---

### Task 26: Final integration and smoke test

**Files:**
- No new files

- [ ] **Step 1: End-to-end smoke test**

1. Login
2. Today: see tasks + habits, complete a task (checkbox), log a habit
3. Projects: see list with progress, click → fly-out, edit current_status → saves
4. Tasks: see table, filter by project, quick-add a task, switch to kanban, drag a task
5. Goals: see tree, expand goal → KR → linked project

- [ ] **Step 2: Test agent parity**

In Claude Desktop (with MCP configured), ask:
- "Create a new project called 'Test Project' in the work area"
- Refresh the Projects page (F5 or navigate away and back — `refetchOnWindowFocus` triggers a re-fetch; Realtime is not required) → new project appears
- "Add a task 'Write tests' to Test Project"
- Refresh Tasks page → new task appears

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration polish from smoke test"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Life OS Phase 1 complete — Projects, Tasks, Goals, Today view"
```

---

## Summary

| Chunk | Tasks | What it produces |
|---|---|---|
| 1: Scaffold | 1-7 | Working Next.js app with auth, nav, design tokens |
| 2: Data Layer | 8-12 | Service + hook layer for all entities |
| 3: Components | 13-19 | All shared UI components ported and restyled |
| 4: Pages | 20-26 | Today, Projects, Tasks (table+kanban), Goals + final integration |

Each chunk produces working, testable software. Chunk 1 gives you a navigable app shell. Chunk 2 adds live data. Chunk 3 gives you the building blocks. Chunk 4 assembles the pages.
