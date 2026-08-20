import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import './supabase.js'; // Triggers startup validation

import { registerTaskTools } from './tools/tasks.js';

import { registerProjectTools } from './tools/projects.js';

import { registerGoalTools } from './tools/goals.js';

import { registerHabitTools } from './tools/habits.js';

import { registerNoteTools } from './tools/notes.js';

import { registerContactTools } from './tools/contacts.js';

import { registerInteractionTools } from './tools/interactions.js';

import { registerListTools } from './tools/lists.js';

import { registerActivityTools } from './tools/activities.js';

import { registerLinkTools } from './tools/links.js';

import { registerViewTools } from './tools/views.js';

const server = new McpServer({
  name: 'lifeos',
  version: '0.1.0',
});

// Tool registrations
registerTaskTools(server);
registerProjectTools(server);
registerGoalTools(server);
registerHabitTools(server);
registerNoteTools(server);
registerContactTools(server);
registerInteractionTools(server);
registerListTools(server);
registerActivityTools(server);
registerLinkTools(server);
registerViewTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('LifeOS MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
