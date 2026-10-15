import { config } from '../config';

const BASE   = config.JIRA_BASE_URL;
const auth   = Buffer.from(`${config.JIRA_EMAIL}:${config.JIRA_API_TOKEN}`).toString('base64');
const HEADERS = {
  Authorization: `Basic ${auth}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// ── Types ──────────────────────────────────────────────────────

export interface JiraTicket {
  id:      string;   // internal numeric id, e.g. "10042"
  key:     string;   // e.g. "PROJ-123"
  summary: string;
  type:    string;   // "Story" | "Bug" | "Task" …
  status:  string;
  owner:   string;
  points:  number | null;
  url:     string;
  description:        string | null;
  acceptanceCriteria: string | null;
  epicLink:           string | null;
  priority:           string | null;
  fixVersion:         string | null;
}

interface JiraTransition {
  id:   string;
  name: string;
}

// ── Helpers ────────────────────────────────────────────────────

async function jiraFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/rest/api/3${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JIRA ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Public API ─────────────────────────────────────────────────

/** Fetch a single ticket and return a normalised JiraTicket. */
export async function getTicket(ticketId: string): Promise<JiraTicket> {
  const data = await jiraFetch(
    `/issue/${ticketId}?fields=summary,issuetype,status,assignee,` +
    `customfield_10016,description,customfield_10045,` +  
    `parent,priority,fixVersions`              
  );
  return {
    id:                 data.id,
    key:                data.key,
    summary:            data.fields.summary,
    type:               data.fields.issuetype.name,
    status:             data.fields.status.name,
    owner:              data.fields.assignee?.displayName ?? 'Unassigned',
    points:             data.fields.customfield_10016 ?? null,
    url:                `${BASE}/browse/${data.key}`,
    description:        data.fields.description?.content?.[0]?.content?.[0]?.text ?? null,
    acceptanceCriteria: data.fields.customfield_10045?.content?.[0]?.content?.[0]?.text ?? null,
    epicLink:           data.fields.parent?.key ?? null,
    priority:           data.fields.priority?.name ?? null,
    fixVersion:         data.fields.fixVersions?.[0]?.name ?? null,
  };
}

/**
 * Search for tickets by status using JIRA Query Language (JQL).
 * Used by the poller to find "Ready to Accept" tickets.
 */
export async function searchTicketsByStatus(status: string): Promise<JiraTicket[]> {
  const jql = `project = ${config.JIRA_PROJECT_KEY} AND status = "${status}" ORDER BY updated DESC`;

  const data = await jiraFetch(
    `/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,issuetype,status,assignee,customfield_10016,customfield_10068,customfield_10014,description,priority,fixVersions&maxResults=50`
  );

  return (data.issues as any[]).map(issue => ({
    id:                 issue.id,
    key:                issue.key,
    summary:            issue.fields.summary,
    type:               issue.fields.issuetype.name,
    status:             issue.fields.status.name,
    owner:              issue.fields.assignee?.displayName ?? 'Unassigned',
    points:             issue.fields.customfield_10016     ?? null,
    url:                `${config.JIRA_BASE_URL}/browse/${issue.key}`,
    description:        data.fields.description?.content?.[0]?.content?.[0]?.text ?? null,
    acceptanceCriteria: data.fields.customfield_10045?.content?.[0]?.content?.[0]?.text ?? null,
    epicLink:           data.fields.parent?.key ?? null,
    priority:           issue.fields.priority?.name        ?? null,
    fixVersion:         issue.fields.fixVersions?.[0]?.name ?? null,
  }));
}

/** Fetch multiple tickets in parallel. */
export async function getTickets(ticketIds: string[]): Promise<JiraTicket[]> {
  return Promise.all(ticketIds.map(getTicket));
}

/** List all available transitions for a ticket. */
export async function listTransitions(ticketId: string): Promise<JiraTransition[]> {
  const data = await jiraFetch(`/issue/${ticketId}/transitions`);
  return data.transitions as JiraTransition[];
}

/**
 * Transition a ticket to the given status name.
 * Throws if the transition is not available on this ticket.
 */
export async function transitionTicket(ticketId: string, targetStatus: string): Promise<void> {
  if (config.DRY_RUN) {
    console.log(`[DRY RUN] Would transition ${ticketId} → "${targetStatus}"`);
    return;
  }

  const transitions = await listTransitions(ticketId);
  const transition  = transitions.find(t => t.name.toLowerCase() === targetStatus.toLowerCase());

  if (!transition) {
    const available = transitions.map(t => t.name).join(', ');
    throw new Error(`Transition "${targetStatus}" not found for ${ticketId}. Available: ${available}`);
  }

  await jiraFetch(`/issue/${ticketId}/transitions`, {
    method: 'POST',
    body:   JSON.stringify({ transition: { id: transition.id } }),
  });

  console.log(`✅ ${ticketId} → "${targetStatus}"`);
}

/** Post a comment on a ticket (used to link the Confluence page). */
export async function addComment(ticketId: string, bodyText: string): Promise<void> {
  if (config.DRY_RUN) {
    console.log(`[DRY RUN] Would comment on ${ticketId}: ${bodyText}`);
    return;
  }

  await jiraFetch(`/issue/${ticketId}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type:    'doc',
        version: 1,
        content: [{
          type:    'paragraph',
          content: [{ type: 'text', text: bodyText }],
        }],
      },
    }),
  });
}

/**
 * Extract all ticket IDs matching the project key from a string
 * (branch name, PR title, PR body, commit message, etc.)
 *
 * e.g. "feature/PROJ-123-login" → ["PROJ-123"]
 */
export function extractTicketIds(text: string): string[] {
  const pattern = new RegExp(`${config.JIRA_PROJECT_KEY}-\\d+`, 'gi');
  const matches = text.match(pattern) ?? [];
  // Deduplicate and normalise to upper-case
  return [...new Set(matches.map(m => m.toUpperCase()))];
}
