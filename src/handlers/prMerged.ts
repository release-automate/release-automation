import { extractTicketIds, transitionTicket } from "../services/jira";
import { deleteBranch, getCommitsOnBranch } from "../services/github";

export interface PRMergedInput {
  prNumber: number;
  prTitle: string;
  prBody: string;
  merged: boolean;
  baseBranch: string; 
  headBranch: string;
  repo: string;
}

export async function handlePRMerged(input: PRMergedInput): Promise<void> {
  const { prNumber, prTitle, prBody, merged, baseBranch, headBranch, repo } =
    input;

  if (!merged) {
    console.log(`PR #${prNumber} was closed but NOT merged. Skipping.`);
    return;
  }

  // ── Case 1: feature/defect → release branch ──────────────────────────────
  // Transition ticket to "Ready for Testing"
  if (baseBranch.startsWith("release.")) {
    console.log(
      `[Flow 2] PR #${prNumber} merged into release branch "${baseBranch}"`
    );
    await handleFeatureToRelease({
      prNumber,
      prTitle,
      prBody,
      headBranch,
      repo,
    });
    return;
  }

  // ── Case 2: release → main ────────────────────────────────────────────────
  // Transition all tickets in the release to "Accepted"
  if (baseBranch === "main" && headBranch.startsWith("release.")) {
    console.log(`[Flow 4] Release branch "${headBranch}" merged into main`);
    await handleReleaseToMain({ prNumber, prTitle, prBody, headBranch, repo });
    return;
  }

  console.log(
    `PR #${prNumber}: base="${baseBranch}" head="${headBranch}" — no matching flow. Skipping.`
  );
}

// ── Flow 2: feature/defect merged → release ───────────────────────────────

async function handleFeatureToRelease(input: {
  prNumber: number;
  prTitle: string;
  prBody: string;
  headBranch: string;
  repo: string;
}): Promise<void> {
  const { prNumber, prTitle, prBody, headBranch, repo } = input;

  const ticketIds = extractTicketIds(`${prTitle} ${prBody}`);

  if (ticketIds.length === 0) {
    console.log(`PR #${prNumber} — no JIRA ticket IDs found in title or body.`);
    return;
  }

  console.log(`PR #${prNumber} → tickets: ${ticketIds.join(", ")}`);

  // Transition to Ready for Testing
  const transitionResults = await Promise.allSettled(
    ticketIds.map((id) => transitionTicket(id, "Ready for Testing"))
  );

  transitionResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(`${ticketIds[index]} → Ready for Testing`);
    } else {
      console.error(
        `Failed to transition ${ticketIds[index]}: ${
          result.reason?.message ?? result.reason
        }`
      );
    }
  });

  // Delete the feature/defect branch after merge
  const shouldDelete = /^(feature|defect)\//i.test(headBranch);
  if (shouldDelete) {
    await deleteBranch(repo, headBranch);
  }
}

// ── Flow 4: release merged → main ────────────────────────────────────────

async function handleReleaseToMain(input: {
  prNumber: number;
  prTitle: string;
  prBody: string;
  headBranch: string;
  repo: string;
}): Promise<void> {
  const { prTitle, prBody, headBranch, repo } = input;

  const commits = await getCommitsOnBranch(repo, headBranch, 'main');
  console.log(`  Found ${commits.length} commits on ${headBranch}`);

  // Extract all unique ticket IDs from every commit message
  const allText  = commits.map(c => c.message).join('\n');

  // Extract ticket IDs from PR title + body
  // The release PR body should list all tickets included in the release
  const ticketIds = extractTicketIds(allText);

  if (ticketIds.length === 0) {
    console.log(
      `Release PR has no ticket IDs — nothing to transition to Accepted.`
    );
    console.log(
      `Tip: list all ticket IDs in the release PR body e.g. "Includes: PROJ-1, PROJ-2"`
    );
    return;
  }

  console.log(
    `Release "${headBranch}" → accepting tickets: ${ticketIds.join(", ")}`
  );

  const acceptResults = await Promise.allSettled(
    ticketIds.map((id) => transitionTicket(id, "Accepted"))
  );

  acceptResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(`${ticketIds[index]} → Accepted`);
    } else {
      console.error(
        `Failed to accept ${ticketIds[index]}: ${
          result.reason?.message ?? result.reason
        }`
      );
    }
  });
}
