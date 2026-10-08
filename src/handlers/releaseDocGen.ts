/**
 * Flow 3 — JIRA "Ready to Accept" → GenAI → Confluence page
 *
 * This handler is called by the Express server (src/server.ts) when JIRA
 * fires a webhook as a ticket transitions to "Ready to Accept".
 *
 * For the POC with GitHub Actions only, this file is STUBBED.
 * To activate: run `pnpm dev` and point a JIRA webhook at your public URL.
 */

import { getTickets, addComment }         from '../services/jira.js';
import { findPRsAcrossOrg }               from '../services/github.js';
import { generateReleaseDoc }             from '../services/openai.js';
import { createReleasePage }              from '../services/confluence.js';
import { config }                         from '../config.js';

export interface ReleaseDocGenInput {
  ticketIds: string[];   // tickets that have just moved to "Ready to Accept"
  version:   string;     // e.g. "v2.4.0" — passed in the JIRA webhook payload or derived
  repos:     string[];   // list of repo names to search for linked PRs
}

export async function handleReleaseDocGen(input: ReleaseDocGenInput): Promise<string> {
  const { ticketIds, version, repos } = input;

  console.log(`[Flow 3] Generating release doc for ${version} — tickets: ${ticketIds.join(', ')}`);

  // 1. Fetch full ticket data from JIRA
  const tickets = await getTickets(ticketIds);
  console.log(`  ✓ Fetched ${tickets.length} JIRA tickets`);

  // 2. Find all PRs across all repos that mention these ticket IDs
  const prs = await findPRsAcrossOrg(ticketIds, repos);
  console.log(`  ✓ Found ${prs.length} linked PRs across ${repos.length} repos`);

  // 3. Generate the release doc via OpenAI
  const doc = await generateReleaseDoc(tickets, prs, version);
  console.log(`  ✓ Release doc generated — ${doc.risks.length} risks identified`);

  // 4. Create the Confluence page
  const page = await createReleasePage(doc, tickets, prs);
  console.log(`  ✓ Confluence page: ${page.webUrl}`);

  // 5. Post the page URL as a comment on each JIRA ticket
  await Promise.all(
    tickets.map(t =>
      addComment(t.key, `Release document created: ${page.webUrl}`).catch(err =>
        console.error(`Failed to comment on ${t.key}: ${err.message}`)
      )
    )
  );
  console.log(`  ✓ Commented Confluence URL on ${tickets.length} JIRA tickets`);

  return page.webUrl;
}

// ── Stub runner for manual testing ────────────────────────────
// Run:  TICKET_IDS=PROJ-1,PROJ-2 VERSION=v1.0.0 REPOS=org/repo1,org/repo2 \
//       pnpm tsx src/handlers/releaseDocGen.ts
if (process.argv[1]?.endsWith('releaseDocGen.ts')) {
  const ticketIds = (process.env.TICKET_IDS ?? '').split(',').filter(Boolean);
  const version   = process.env.VERSION ?? 'v0.0.0-test';
  const repos     = (process.env.REPOS ?? '').split(',').filter(Boolean);

  if (!ticketIds.length || !repos.length) {
    console.error('Usage: TICKET_IDS=PROJ-1,PROJ-2 VERSION=v1.0.0 REPOS=org/repo pnpm tsx src/handlers/releaseDocGen.ts');
    process.exit(1);
  }

  handleReleaseDocGen({ ticketIds, version, repos })
    .then(url => { console.log(`Done. Page: ${url}`); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}
