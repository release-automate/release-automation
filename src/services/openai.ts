import OpenAI          from 'openai';
import { z }           from 'zod';
import { config }      from '../config.js';
import type { JiraTicket }   from './jira.js';
import type { PullRequest }  from './github.js';

export const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// ── Output schema (validated with Zod after parsing) ──────────

export const ReleaseDocSchema = z.object({
  version:    z.string(),
  date:       z.string(),
  summary:    z.string().describe('2-4 sentence plain-English description of all changes'),
  risks:      z.array(z.string()).describe('Bullet list of identified risks from PR diffs'),
  impact:     z.string().describe('Which downstream services / areas are affected'),
  checklist:  z.array(z.string()).describe('QA / sign-off checklist items'),
  highlights: z.array(z.string()).describe('Up to 5 key changes worth calling out'),
});

export type ReleaseDoc = z.infer<typeof ReleaseDocSchema>;

// ── Prompt builder ─────────────────────────────────────────────

function buildPrompt(tickets: JiraTicket[], prs: PullRequest[], version: string): string {
  const ticketBlock = tickets.map(t =>
    `[${t.key}] (${t.type}) ${t.summary}\n  Owner: ${t.owner} | Points: ${t.points ?? 'N/A'}`
  ).join('\n');

  const prBlock = prs.map(pr =>
    `PR #${pr.number} — ${pr.title} (@${pr.author}, ${pr.repo})\n` +
    `  +${pr.additions}/-${pr.deletions} lines across ${pr.filesChanged} files\n` +
    `  Diff (truncated):\n${pr.diff.split('\n').slice(0, 60).join('\n')}`
  ).join('\n\n---\n\n');

  return `You are a senior release engineer. Analyse the following JIRA tickets and GitHub PR diffs for release ${version}.

=== JIRA TICKETS ===
${ticketBlock}

=== PULL REQUESTS & DIFFS ===
${prBlock}

Based on the above, produce a JSON object (no markdown fences, pure JSON) matching exactly this shape:
{
  "version":   "<release version string>",
  "date":      "<today's ISO date>",
  "summary":   "<2-4 sentences describing what this release delivers>",
  "risks":     ["<risk 1>", "<risk 2>", ...],
  "impact":    "<which services, APIs, or user flows are affected>",
  "checklist": ["<QA item 1>", "<QA item 2>", ...],
  "highlights":["<key change 1>", ...]
}

Risk detection guidance — flag any PR diff that contains:
- Database schema changes (CREATE TABLE, ALTER TABLE, migrations)
- Authentication or authorisation logic changes
- Environment variable or configuration changes
- External API contract changes (new/removed fields, endpoint changes)
- Dependency major version bumps
- Changes to shared libraries used by multiple services

Be concise and factual. Do not hallucinate details not present in the input.`;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Generate a structured release document from tickets and PRs.
 * Returns a validated ReleaseDoc object.
 */
export async function generateReleaseDoc(
  tickets: JiraTicket[],
  prs:     PullRequest[],
  version: string,
): Promise<ReleaseDoc> {
  const prompt = buildPrompt(tickets, prs, version);

  const response = await openai.chat.completions.create({
    model:       config.OPENAI_MODEL,
    temperature: 0.2,    // low temperature for factual, consistent output
    messages: [
      { role: 'system', content: 'You are a precise release engineer. Output only valid JSON, no markdown.' },
      { role: 'user',   content: prompt },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';

  let parsed: unknown;
  try {
    // Strip any accidental markdown fences if the model adds them
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`OpenAI returned invalid JSON:\n${raw}`);
  }

  const result = ReleaseDocSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`OpenAI response failed validation: ${result.error.message}`);
  }

  return result.data;
}
