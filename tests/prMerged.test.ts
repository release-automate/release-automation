import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/jira.js', () => ({
  extractTicketIds: vi.fn(),
  transitionTicket: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/config.js', () => ({
  config: { JIRA_PROJECT_KEY: 'PROJ', DRY_RUN: false },
}));

import { handlePRMerged }                       from '../src/handlers/prMerged.js';
import { extractTicketIds, transitionTicket } from '../src/services/jira.js';

const mockExtract    = vi.mocked(extractTicketIds);
const mockTransition = vi.mocked(transitionTicket);

const basePR = {
  prNumber: 42, prTitle: '[PROJ-10] Login screen', prBody: '', merged: true,
  baseBranch: 'main', repo: 'org/repo',
};

beforeEach(() => vi.clearAllMocks());

describe('handlePRMerged', () => {
  it('skips unmerged PRs', async () => {
    await handlePRMerged({ ...basePR, merged: false });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips PRs not targeting main', async () => {
    await handlePRMerged({ ...basePR, baseBranch: 'develop' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips PRs with no ticket IDs', async () => {
    mockExtract.mockReturnValue([]);
    await handlePRMerged(basePR);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('transitions ticket to Ready for Testing', async () => {
    mockExtract.mockReturnValue(['PROJ-10']);
    await handlePRMerged(basePR);
    expect(mockTransition).toHaveBeenCalledWith('PROJ-10', 'Ready for Testing');
  });
});
