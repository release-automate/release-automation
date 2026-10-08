import { Octokit } from '@octokit/rest';
import { config }  from '../config.js';

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
  baseBranch = 'main',
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
  const results = await Promise.all(
    matched.slice(0, 10).map(async pr => {
      const diff = await getPRDiff(owner, repoName, pr.number);
      return {
        number:       pr.number,
        title:        pr.title,
        body:         pr.body ?? '',
        author:       pr.user?.login ?? 'unknown',
        mergedAt:     pr.merged_at ?? '',
        url:          pr.html_url,
        repo:         `${owner}/${repoName}`,
        diff:         diff.slice(0, 8000),  // cap diff size sent to LLM
        filesChanged: pr.changed_files ?? 0,
        additions:    pr.additions ?? 0,
        deletions:    pr.deletions ?? 0,
      } satisfies PullRequest;
    })
  );

  return results;
}

/**
 * Search across all repos in the org for PRs linked to ticket IDs.
 * Used in Flow 3 when a release may span multiple repos.
 */
export async function findPRsAcrossOrg(
  ticketIds: string[],
  repos:     string[],
): Promise<PullRequest[]> {
  const allPRs = await Promise.all(
    repos.map(repo => findPRsForTickets(repo, ticketIds).catch(() => [] as PullRequest[]))
  );
  return allPRs.flat();
}

/**
 * Return the list of commit SHAs on a branch that are not yet on main.
 * Used in Flow 4 to find which tickets belong to this release.
 */
export async function getCommitsOnBranch(
  repo:   string,
  branch: string,
  base =  'main',
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
