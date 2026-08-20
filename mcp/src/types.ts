import { z } from 'zod';

// --- Enums matching LifeOS Supabase schema (001_core_tables.sql) ---

export const lifeAreaSchema = z.enum([
  'money', 'health', 'growth', 'work', 'relationships', 'play', 'environment',
]);
export type LifeArea = z.infer<typeof lifeAreaSchema>;

export const projectStatusSchema = z.enum(['idea', 'active', 'paused', 'done']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const taskStatusSchema = z.enum([
  'inbox', 'next_action', 'in_progress', 'waiting_for', 'blocked', 'someday', 'done',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const goalKindSchema = z.enum(['goal', 'key_result']);
export const goalStatusSchema = z.enum([
  'not_started', 'in_progress', 'on_track', 'at_risk', 'done',
]);
export const goalHorizonSchema = z.enum(['annual', 'q1', 'q2', 'q3', 'q4']);

export const habitPolaritySchema = z.enum(['build', 'break']);
export const habitMetricTypeSchema = z.enum(['boolean', 'count', 'duration', 'value']);

export const activityTypeSchema = z.enum([
  'gym', 'yoga', 'kitesurf', 'run', 'walk', 'other',
]);

export const interactionKindSchema = z.enum(['call', 'meeting', 'message', 'note']);
export const interactionSourceSchema = z.enum(['manual', 'transcriber', 'agent']);

export const noteKindSchema = z.enum([
  'morning_pages', 'note', 'meeting', 'journal', 'napkin',
]);

export const listKindSchema = z.enum([
  'travel', 'movies', 'tv', 'books', 'games', 'shopping', 'custom',
]);
export const listItemStatusSchema = z.enum(['open', 'done']);

export const linkRelationSchema = z.enum([
  'related', 'blocks', 'mentions', 'contributes_to', 'attended', 'about',
]);

export const priorityLevelSchema = z.enum(['high', 'medium', 'low']);

export const entityTypeSchema = z.enum([
  'task', 'project', 'goal', 'habit', 'contact', 'note',
  'list', 'list_item', 'event', 'document', 'activity_log',
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

// --- Tool registration helper ---

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (params: unknown) => Promise<unknown>;
}

// --- Shared error shape returned by handlers ---

export interface ToolError {
  ok?: false;
  error: 'not_found' | 'ambiguous' | 'validation_error' | 'db_error';
  message: string;
  candidates?: Record<string, unknown>[];
}
