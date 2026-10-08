/**
 * Entry point for Flow 2 — called by GitHub Actions on `pull_request` closed event.
 *
 * Required env vars:
 *   PR_NUMBER     github.event.pull_request.number
 *   PR_TITLE      github.event.pull_request.title
 *   PR_BODY       github.event.pull_request.body
 *   PR_MERGED     github.event.pull_request.merged  ("true" / "false")
 *   BASE_BRANCH   github.event.pull_request.base.ref
 *   REPO          github.repository
 */

import '../src/config.js';
import { handlePRMerged } from '../src/handlers/prMerged.js';

const input = {
  prNumber:   parseInt(process.env.PR_NUMBER  ?? '0', 10),
  prTitle:    process.env.PR_TITLE            ?? '',
  prBody:     process.env.PR_BODY             ?? '',
  merged:     process.env.PR_MERGED           === 'true',
  baseBranch: process.env.BASE_BRANCH         ?? '',
  repo:       process.env.REPO                ?? '',
};

if (!input.prNumber || !input.prTitle) {
  console.error('Missing required env vars: PR_NUMBER, PR_TITLE');
  process.exit(1);
}

handlePRMerged(input)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
