/**
 * Flow 1 — Branch created → JIRA "In Progress"
 *
 * Triggered by: GitHub Actions `create` event
 * Entry point:  scripts/branchCreated.ts  (reads env vars injected by Actions)
 */

import { extractTicketIds, transitionTicket } from '../services/jira.js';

export interface BranchCreatedInput {
  branchName: string;   // e.g. "feature/PROJ-123-login-screen"
  refType:    string;   // "branch" | "tag" — only act on branches
  repo:       string;   // "your-org/repo-name"
}

export async function handleBranchCreated(input: BranchCreatedInput): Promise<void> {
  const { branchName, refType } = input;

  // Ignore tag creation events
  if (refType !== 'branch') {
    console.log(`Skipping — ref type is "${refType}", not "branch".`);
    return;
  }

  // Only act on feature/* and defect/* branches
  if (!/^(feature|defect)\//i.test(branchName)) {
    console.log(`Skipping — branch "${branchName}" is not a feature or defect branch.`);
    return;
  }

  const ticketIds = extractTicketIds(branchName);

  if (ticketIds.length === 0) {
    console.log(`No JIRA ticket IDs found in branch name "${branchName}".`);
    return;
  }

  console.log(`Branch "${branchName}" → tickets: ${ticketIds.join(', ')}`);

  // Transition every found ticket to "In Progress"
  await Promise.all(
    ticketIds.map(id =>
      transitionTicket(id, 'In Progress').catch(err =>
        console.error(`Failed to transition ${id}: ${err.message}`)
      )
    )
  );
}
