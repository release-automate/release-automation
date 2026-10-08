import { z } from 'zod';

const EnvSchema = z.object({
  // JIRA
  JIRA_BASE_URL:      z.string().url(),
  JIRA_EMAIL:         z.string().email(),
  JIRA_API_TOKEN:     z.string().min(1),
  JIRA_PROJECT_KEY:   z.string().min(1),

  // Confluence
  CONFLUENCE_BASE_URL:       z.string().url(),
  CONFLUENCE_EMAIL:          z.string().email(),
  CONFLUENCE_API_TOKEN:      z.string().min(1),
  CONFLUENCE_SPACE_KEY:      z.string().min(1),
  CONFLUENCE_PARENT_PAGE_ID: z.string().min(1),

  // GitHub
  GH_TOKEN: z.string().min(1),
  GH_ORG:   z.string().min(1),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL:   z.string().default('gpt-4o'),

  // Express
  PORT:           z.coerce.number().default(3000),
  WEBHOOK_SECRET: z.string().default(''),

  // Behaviour
  DRY_RUN: z.string().transform(v => v === 'true').default('false'),
});

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}\nSee .env.example for reference.`);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
