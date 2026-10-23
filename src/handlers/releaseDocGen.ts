/**
 * Flow 3 — JIRA "Ready to Accept" → GenAI → Confluence page
 *
 * This handler is called by the Express server (src/server.ts) when JIRA
 * fires a webhook as a ticket transitions to "Ready to Accept".
 *
 * For the POC with GitHub Actions only, this file is STUBBED.
 * To activate: run `pnpm dev` and point a JIRA webhook at your public URL.
 */

import { getTickets, addComment }         from '../services/jira';
import { findPRsAcrossOrg }               from '../services/github';
import { generateReleaseDoc }             from '../services/openai';
import { createReleasePage }              from '../services/confluence';
import { config }                         from '../config';

export interface ReleaseDocGenInput {
  ticketIds: string[];   // tickets that have just moved to "Ready to Accept"
  version:   string;     // e.g. "v2.4.0" — passed in the JIRA webhook payload or derived
  repos:     string[];   // list of repo names to search for linked PRs
  releaseBranch: string;
}

export async function handleReleaseDocGen(input: ReleaseDocGenInput): Promise<string> {
  const { ticketIds, version, repos, releaseBranch  } = input;

  console.log(`[Flow 3] Generating release doc for ${version} — tickets: ${ticketIds.join(', ')}`);

  // 1. Fetch full ticket data from JIRA
  const tickets = await getTickets(ticketIds);
  console.log(`Fetched ${tickets.length} JIRA tickets`);

  // 2. Find all PRs across all repos that mention these ticket IDs
  const prs = await findPRsAcrossOrg(ticketIds, repos, releaseBranch);
  console.log(`Found ${prs.length} linked PRs across ${repos.length} repos`);

  // 3. Generate the release doc via OpenAI
  const doc = await generateReleaseDoc(tickets, prs, version);
  console.log(`Release doc generated — ${doc.risks.length} risks identified`);

  // 4. Create the Confluence page
  const page = await createReleasePage(doc, tickets, prs);
  console.log(`Confluence page: ${page.webUrl}`);

  // 5. Post the page URL as a comment on each JIRA ticket
  const commentResults = await Promise.allSettled(
    tickets.map(t => addComment(t.key, `Release document created: ${page.webUrl}`))
  );
  
  commentResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`Comment posted on ${tickets[index].key}`);
    } else {
      console.error(`Failed to comment on ${tickets[index].key}: ${result.reason?.message ?? result.reason}`);
    }
  });
  console.log(`  ✓ Commented Confluence URL on ${tickets.length} JIRA tickets`);

  return page.webUrl;
}