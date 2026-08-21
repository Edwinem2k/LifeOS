import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the mcp/ directory (not cwd — important when spawned by Hermes/Claude)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), quiet: true });

// --- Startup validation ---

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LIFEOS_USER_ID',
  'LIFEOS_ACTOR',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
}

export const SUPABASE_URL = process.env.SUPABASE_URL!;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const USER_ID = process.env.LIFEOS_USER_ID!;
export const ACTOR = process.env.LIFEOS_ACTOR!;

// --- Supabase client (service role — bypasses RLS) ---

let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// --- Audit helper ---

export async function audit(
  action: 'insert' | 'update' | 'delete',
  tableName: string,
  recordId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  const client = getClient();
  await client.from('agent_actions').insert({
    user_id: USER_ID,
    actor: ACTOR,
    action,
    table_name: tableName,
    record_id: recordId,
    details,
  });
}
