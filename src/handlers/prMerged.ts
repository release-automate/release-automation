/**
 * Flow 2 — PR merged to main → JIRA "Ready for Testing"
 *
 * Triggered by: GitHub Actions `pull_request` event (closed + merged)
 * Entry point:  scripts/prMerged.ts
 */

import { deleteBranch } from '../services/github';
import { extractTicketIds, transitionTicket } from '../services/jira';

export interface PRMergedInput {
  prNumber:  number;
  prTitle:   string;
  prBody:    string;
  merged:    boolean;
  baseBranch: string;  // must be "main" to trigger
  repo:      string;
  headBranch: string; 
}

export async function handlePRMerged(input: PRMergedInput): Promise<void> {
  const { prNumber, prTitle, prBody, merged, baseBranch, repo, headBranch } = input;

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

  const transitionResults = await Promise.allSettled(
    ticketIds.map(id => transitionTicket(id, 'Ready for Testing'))
  );
  
  transitionResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ ${ticketIds[index]} → Ready for Testing`);
    } else {
      console.error(`❌ Failed to transition ${ticketIds[index]}: ${result.reason?.message ?? result.reason}`);
    }
  });
  // 2. Delete the merged branch (only feature/* and defect/*)
  const shouldDelete = /^(feature|defect)\//i.test(headBranch);

  if (shouldDelete) {
    await deleteBranch(repo, headBranch);
  } else {
    console.log(`Skipping branch deletion for "${headBranch}" — not a feature or defect branch.`);
  }
}
