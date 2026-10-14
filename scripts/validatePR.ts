import '../src/config';
import { handlePRValidation } from '../src/handlers/validatePR';

const input = {
  prNumber:   parseInt(process.env.PR_NUMBER  ?? '0', 10),
  prTitle:    process.env.PR_TITLE            ?? '',
  prBody:     process.env.PR_BODY             ?? '',
  repo:       process.env.REPO                ?? '',
};

if (!input.prNumber || !input.prTitle) {
  console.error('Missing required env vars: PR_NUMBER, PR_TITLE');
  process.exit(1);
}

handlePRValidation(input)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });