import '../src/config';
import { handleJiraPoll } from '../src/handlers/pollJira';

const input = {
  repos:   (process.env.GH_REPOS        ?? '').split(',').filter(Boolean),
  version:    process.env.RELEASE_VERSION  ?? 'TBD',
  releaseBranch: process.env.BASE_BRANCH ?? 'release.2026.10.01'
};

handleJiraPoll(input)
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });