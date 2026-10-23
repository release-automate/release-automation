import { getLastMergedPR }            from '../services/github';
import { extractTicketIds, transitionTicket } from '../services/jira';

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

  if (!branch.startsWith('release.')) {
    console.log(`Branch "${branch}" is not a release branch. Skipping.`);
    return;
  }

  console.log(`[Flow 3] Release deploy detected: ${branch} in ${repo}`);

  // Get the last merged PR into this release branch
  const lastPR = await getLastMergedPR(repo, branch);

  if (!lastPR) {
    console.log('No merged PRs found in this release branch.');
    return;
  }
  const ticketIds =  extractTicketIds(`${lastPR.title} ${lastPR.body}`);

  if (ticketIds.length === 0) {
    console.log('  No JIRA ticket IDs found in commit messages. Nothing to transition.');
    return;
  }

  console.log(`  Tickets to accept: ${ticketIds.join(', ')}`);

  // Transition all found tickets to "Accepted"
  const acceptResults = await Promise.allSettled(
    ticketIds.map(id => transitionTicket(id, 'Accepted'))
  );
  
  acceptResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`${ticketIds[index]} → Accepted`);
    } else {
      console.error(`Failed to transition ${ticketIds[index]}: ${result.reason?.message ?? result.reason}`);
    }
  });
}
