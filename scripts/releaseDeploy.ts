/**
 * Entry point for Flow 4 — called by GitHub Actions on push to release/* branches.
 *
 * Required env vars:
 *   GITHUB_REF    github.ref  e.g. "refs/heads/release/v2.4.0"
 *   REPO          github.repository
 */

import '../src/config.js';
import { handleReleaseDeploy } from '../src/handlers/releaseDeploy.js';

const input = {
  ref:  process.env.GITHUB_REF ?? '',
  repo: process.env.REPO       ?? '',
};

if (!input.ref || !input.repo) {
  console.error('Missing required env vars: GITHUB_REF, REPO');
  process.exit(1);
}

handleReleaseDeploy(input)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
