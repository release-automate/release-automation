import { Octokit } from '@octokit/rest';
import { config }  from '../config';

export const octokit = new Octokit({ auth: config.GH_TOKEN });

// ── Types ──────────────────────────────────────────────────────

export interface PullRequest {
  number:    number;
  title:     string;
  body:      string;
  author:    string;
  mergedAt:  string;
  url:       string;
  repo:      string;
  diff:      string;   // raw unified diff text
  filesChanged: number;
  additions: number;
  deletions: number;
}

// ── Helpers ────────────────────────────────────────────────────

/** Fetch the raw unified diff for a single PR. */
async function getPRDiff(owner: string, repo: string, pull_number: number): Promise<string> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner,
    repo,
    pull_number,
    headers: { Accept: 'application/vnd.github.diff' },
  });
  // Response data is the diff text when Accept header is set
  return (res.data as unknown as string) ?? '';
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Fetch all merged PRs for a repo whose title or body mention at least one
 * of the given ticket IDs.
 */
export async function findPRsForTickets(
  repo:      string,
  ticketIds: string[],
  baseBranch: string
): Promise<PullRequest[]> {
  const [owner, repoName] = repo.includes('/')
    ? repo.split('/', 2) as [string, string]
    : [config.GH_ORG, repo];

  // Fetch the last 100 merged PRs against the base branch
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo:      repoName,
    state:     'closed',
    base:      baseBranch,
    per_page:  100,
    sort:      'updated',
    direction: 'desc',
  });

  const merged = prs.filter(pr => pr.merged_at != null);
  const ticketSet = new Set(ticketIds.map(t => t.toUpperCase()));

  // Keep PRs that reference any of our ticket IDs in title or body
  const matched = merged.filter(pr => {
    const text = `${pr.title} ${pr.body ?? ''}`.toUpperCase();
    return [...ticketSet].some(id => text.includes(id));
  });

  // Fetch diff for each matched PR in parallel (cap at 10 to avoid rate limits)
  const diffResults = await Promise.allSettled(
    matched.slice(0, 10).map(async pr => {
      const diff = await getPRDiff(owner, repoName, pr.number);
      return {
        number:       pr.number,
        title:        pr.title,
        body:         pr.body         ?? '',
        author:       pr.user?.login  ?? 'unknown',
        mergedAt:     pr.merged_at    ?? '',
        url:          pr.html_url,
        repo:         `${owner}/${repoName}`,
        diff:         diff.slice(0, 8000),
        filesChanged: pr.changed_files ?? 0,
        additions:    pr.additions     ?? 0,
        deletions:    pr.deletions     ?? 0,
      } satisfies PullRequest;
    })
  );
  
  const results: PullRequest[] = [];
  
  diffResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      console.error(
        `Failed to fetch diff for PR #${matched[index]?.number}: ${result.reason?.message ?? result.reason}`
      );
    }
  });
  
  return results;
}

/**
 * Search across all repos in the org for PRs linked to ticket IDs.
 * Used in Flow 3 when a release may span multiple repos.
 */
export async function findPRsAcrossOrg(
  ticketIds: string[],
  repos:     string[],
  baseBranch: string
): Promise<PullRequest[]> {
  const repoResults = await Promise.allSettled(
    repos.map(repo => findPRsForTickets(repo, ticketIds, baseBranch))
  );
  
  const allPRs: PullRequest[] = [];
  
  repoResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ ${repos[index]} — found ${result.value.length} PR(s)`);
      allPRs.push(...result.value);
    } else {
      console.error(
        `Failed to fetch PRs from ${repos[index]}: ${result.reason?.message ?? result.reason}`
      );
    }
  });
  
  return allPRs.flat();
}

/**
 * Return the list of commit SHAs on a branch that are not yet on main.
 * Used in Flow 4 to find which tickets belong to this release.
 */
export async function getCommitsOnBranch(
  repo:   string,
  branch: string,
  base: string
): Promise<{ sha: string; message: string }[]> {
  const [owner, repoName] = repo.includes('/')
    ? repo.split('/', 2) as [string, string]
    : [config.GH_ORG, repo];

  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner,
    repo:     repoName,
    basehead: `${base}...${branch}`,
  });

  return (data.commits ?? []).map(c => ({
    sha:     c.sha,
    message: c.commit.message,
  }));
}

// Post a comment on a GitHub PR
export async function addGitHubPRComment(
  repo:      string,
  prNumber:  number,
  body:      string,
): Promise<void> {
  const [owner, repoName] = repo.includes('/')
    ? repo.split('/', 2) as [string, string]
    : [config.GH_ORG, repo];

  await octokit.issues.createComment({
    owner,
    repo:     repoName,
    issue_number: prNumber,
    body,
  });
  console.log(`💬 Posted validation failure comment on PR #${prNumber}`);
}

export async function deleteBranch(
  repo:       string,
  branchName: string,
): Promise<void> {
  const [owner, repoName] = repo.includes('/')
    ? repo.split('/', 2) as [string, string]
    : [config.GH_ORG, repo];

  try {
    await octokit.git.deleteRef({
      owner,
      repo:  repoName,
      ref:   `heads/${branchName}`,  // e.g. heads/feature/PROJ-123-login
    });
    console.log(`🗑️  Deleted branch: ${branchName}`);
  } catch (err: any) {
    if (err.status === 404) {
      console.log(`Branch "${branchName}" already deleted — skipping.`);
      return;
    }
    console.error(`Failed to delete branch "${branchName}": ${err.message}`);
  }
}

/**
 * Get the last merged PR into a branch.
 * Used during release deployment to find the latest PR description.
 */
export async function getLastMergedPR(
  repo:   string,
  branch: string,
): Promise<{ title: string; body: string; number: number; author: string; mergedAt: string } | null> {
  const [owner, repoName] = repo.includes('/')
    ? repo.split('/', 2) as [string, string]
    : [config.GH_ORG, repo];

  console.log(`[GitHub] Fetching last merged PR into "${branch}" in ${owner}/${repoName}`);

  // Fetch closed PRs targeting this branch, sorted by most recently updated
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo:      repoName,
    state:     'closed',
    base:      branch,          // PRs merged INTO this branch
    per_page:  1,               // only need the last one
    sort:      'updated',
    direction: 'desc',
  });

  // Filter to only merged PRs (closed includes both merged and unmerged)
  const merged = prs.filter(pr => pr.merged_at);

  if (merged.length === 0) {
    console.log(`[GitHub] No merged PRs found for branch "${branch}"`);
    return null;
  }

  const last = merged[0]!;

  console.log(`[GitHub] Last merged PR: #${last.number} — "${last.title}"`);

  return {
    number:   last.number,
    title:    last.title,
    body:     last.body     ?? '',
    author:   last.user?.login ?? 'unknown',
    mergedAt: last.merged_at  ?? '',
  };
}
