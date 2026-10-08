import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the JIRA service before importing the handler
vi.mock('../src/services/jira.js', () => ({
  extractTicketIds:  vi.fn(),
  transitionTicket:  vi.fn().mockResolvedValue(undefined),
}));

// Mock config so we don't need real env vars in tests
vi.mock('../src/config.js', () => ({
  config: {
    JIRA_PROJECT_KEY: 'PROJ',
    DRY_RUN: false,
  },
}));

import { handleBranchCreated }             from '../src/handlers/branchCreated.js';
import { extractTicketIds, transitionTicket } from '../src/services/jira.js';

const mockExtract    = vi.mocked(extractTicketIds);
const mockTransition = vi.mocked(transitionTicket);

beforeEach(() => vi.clearAllMocks());

describe('handleBranchCreated', () => {
  it('skips tag creation events', async () => {
    await handleBranchCreated({ branchName: 'v1.0.0', refType: 'tag', repo: 'org/repo' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips branches that do not start with feature/ or defect/', async () => {
    await handleBranchCreated({ branchName: 'main', refType: 'branch', repo: 'org/repo' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('skips feature branches with no ticket ID', async () => {
    mockExtract.mockReturnValue([]);
    await handleBranchCreated({ branchName: 'feature/no-ticket', refType: 'branch', repo: 'org/repo' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('transitions a single ticket to In Progress', async () => {
    mockExtract.mockReturnValue(['PROJ-123']);
    await handleBranchCreated({ branchName: 'feature/PROJ-123-login', refType: 'branch', repo: 'org/repo' });
    expect(mockTransition).toHaveBeenCalledOnce();
    expect(mockTransition).toHaveBeenCalledWith('PROJ-123', 'In Progress');
  });

  it('transitions multiple tickets found in a branch name', async () => {
    mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
    await handleBranchCreated({ branchName: 'feature/PROJ-1-and-PROJ-2', refType: 'branch', repo: 'org/repo' });
    expect(mockTransition).toHaveBeenCalledTimes(2);
  });

  it('continues if one ticket transition fails', async () => {
    mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
    mockTransition
      .mockRejectedValueOnce(new Error('JIRA error'))
      .mockResolvedValueOnce(undefined);
    await expect(
      handleBranchCreated({ branchName: 'feature/PROJ-1-PROJ-2', refType: 'branch', repo: 'org/repo' })
    ).resolves.not.toThrow();
    expect(mockTransition).toHaveBeenCalledTimes(2);
  });
});
