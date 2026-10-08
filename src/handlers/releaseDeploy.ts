/**
 * Flow 4 — Release branch deployed → JIRA "Accepted"
 *
 * Triggered by: GitHub Actions `push` event on release/* branches,
 *               after the deploy step completes successfully.
 * Entry point:  scripts/releaseDeploy.ts
 */

import { getCommitsOnBranch }            from '../services/github.js';
import { extractTicketIds, transitionTicket } from '../services/jira.js';

export interface ReleaseDeployInput {
  ref:  string;   // "refs/heads/release/v2.4.0"
  repo: string;   // "your-org/repo-name"
}

function parseBranchFromRef(ref: string): string {
  // "refs/heads/release/v2.4.0" → "release/v2.4.0"
  return ref.replace(/^refs\/heads\//, '');
}

export async function handleReleaseDeploy(input: ReleaseDeployInput): Promise<void> {
  const { ref, repo } = input;
  const branch = parseBranchFromRef(ref);

  if (!branch.startsWith('release/')) {
    console.log(`Branch "${branch}" is not a release branch. Skipping.`);
    return;
  }

  console.log(`[Flow 4] Release deploy detected: ${branch} in ${repo}`);

  // Fetch all commits on this branch that are not yet on main
  const commits = await getCommitsOnBranch(repo, branch);
  console.log(`  Found ${commits.length} commits on ${branch}`);

  // Extract all unique ticket IDs from every commit message
  const allText  = commits.map(c => c.message).join('\n');
  const ticketIds = extractTicketIds(allText);

  if (ticketIds.length === 0) {
    console.log('  No JIRA ticket IDs found in commit messages. Nothing to transition.');
    return;
  }

  console.log(`  Tickets to accept: ${ticketIds.join(', ')}`);

  // Transition all found tickets to "Accepted"
  await Promise.all(
    ticketIds.map(id =>
      transitionTicket(id, 'Accepted').catch(err =>
        console.error(`  Failed to transition ${id}: ${err.message}`)
      )
    )
  );
}
