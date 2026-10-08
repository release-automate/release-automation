/**
 * Entry point for Flow 1 — called by GitHub Actions on `create` event.
 *
 * Required env vars (injected by the workflow):
 *   BRANCH_NAME   github.ref_name
 *   REF_TYPE      github.event.ref_type  ("branch" or "tag")
 *   REPO          github.repository
 *
 * Plus all service credentials from GitHub Org Secrets.
 */

import '../src/config.js';   // validates env vars early — fails fast if any are missing
import { handleBranchCreated } from '../src/handlers/branchCreated.js';

const input = {
  branchName: process.env.BRANCH_NAME ?? '',
  refType:    process.env.REF_TYPE    ?? '',
  repo:       process.env.REPO        ?? '',
};

if (!input.branchName || !input.refType) {
  console.error('Missing required env vars: BRANCH_NAME, REF_TYPE');
  process.exit(1);
}

handleBranchCreated(input)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
