/**
 * Flow 2 — PR merged to main → JIRA "Ready for Testing"
 *
 * Triggered by: GitHub Actions `pull_request` event (closed + merged)
 * Entry point:  scripts/prMerged.ts
 */

import { extractTicketIds, transitionTicket } from '../services/jira.js';

export interface PRMergedInput {
  prNumber:  number;
  prTitle:   string;
  prBody:    string;
  merged:    boolean;
  baseBranch: string;  // must be "main" to trigger
  repo:      string;
}

export async function handlePRMerged(input: PRMergedInput): Promise<void> {
  const { prNumber, prTitle, prBody, merged, baseBranch } = input;

  if (!merged) {
    console.log(`PR #${prNumber} was closed but NOT merged. Skipping.`);
    return;
  }

  if (baseBranch !== 'main') {
    console.log(`PR #${prNumber} merges into "${baseBranch}", not "main". Skipping.`);
    return;
  }

  // Extract ticket IDs from title + body combined
  const combinedText = `${prTitle} ${prBody}`;
  const ticketIds    = extractTicketIds(combinedText);

  if (ticketIds.length === 0) {
    console.log(`PR #${prNumber} — no JIRA ticket IDs found in title or body.`);
    return;
  }

  console.log(`PR #${prNumber} merged → tickets: ${ticketIds.join(', ')}`);

  await Promise.all(
    ticketIds.map(id =>
      transitionTicket(id, 'Ready for Testing').catch(err =>
        console.error(`Failed to transition ${id}: ${err.message}`)
      )
    )
  );
}
