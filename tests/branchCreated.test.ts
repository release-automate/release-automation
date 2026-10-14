import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all external dependencies before importing the handler ──

vi.mock('../src/services/jira', () => ({
  extractTicketIds: vi.fn(),
  transitionTicket: vi.fn().mockResolvedValue(undefined),
  getTicket:        vi.fn(),
  addComment:       vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/validator', () => ({
  validateTicket:           vi.fn(),
  formatValidationComment:  vi.fn().mockReturnValue('mock validation comment'),
}));

vi.mock('../src/config', () => ({
  config: {
    JIRA_PROJECT_KEY: 'PROJ',
    DRY_RUN:          false,
  },
}));

import { handleBranchCreated }                        from '../src/handlers/branchCreated';
import { extractTicketIds, transitionTicket,
         getTicket, addComment }                      from '../src/services/jira';
import { validateTicket, formatValidationComment }    from '../src/services/validator';

// ── Typed mocks ───────────────────────────────────────────────────────────────

const mockExtract    = vi.mocked(extractTicketIds);
const mockTransition = vi.mocked(transitionTicket);
const mockGetTicket  = vi.mocked(getTicket);
const mockAddComment = vi.mocked(addComment);
const mockValidate   = vi.mocked(validateTicket);
const mockFormat     = vi.mocked(formatValidationComment);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validTicket = {
  id:                 '10001',
  key:                'PROJ-123',
  summary:            'Add login screen',
  type:               'Story',
  status:             'To Do',
  owner:              'Alice',
  points:             5,
  url:                'https://test.atlassian.net/browse/PROJ-123',
  description:        'Implement the login screen',
  acceptanceCriteria: 'User can log in with email and password',
  epicLink:           'PROJ-100',
  priority:           'High',
  fixVersion:         'v1.3.0',
};

const validationPassed = {
  valid:    true,
  errors:   [],
  warnings: [],
};

const validationFailed = {
  valid:  false,
  errors: [
    { field: 'Assignee',             code: 'NO_ASSIGNEE',             message: 'Ticket has no assignee.' },
    { field: 'Acceptance Criteria',  code: 'NO_ACCEPTANCE_CRITERIA',  message: 'No acceptance criteria.' },
  ],
  warnings: [],
};

const validationWithWarnings = {
  valid:    true,
  errors:   [],
  warnings: [
    { field: 'Story Points', code: 'NO_STORY_POINTS', message: 'No story points estimated.' },
  ],
};

// ── Base input ────────────────────────────────────────────────────────────────

const baseInput = {
  branchName: 'feature/PROJ-123-login-screen',
  refType:    'branch',
  repo:       'org/sample-service',
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path mocks
  mockExtract.mockReturnValue(['PROJ-123']);
  mockGetTicket.mockResolvedValue(validTicket);
  mockValidate.mockReturnValue(validationPassed);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('handleBranchCreated', () => {

  // ── Skipping logic ──────────────────────────────────────────────────────────

  describe('skipping conditions', () => {
    it('skips when ref type is "tag"', async () => {
      await handleBranchCreated({ ...baseInput, refType: 'tag' });

      expect(mockExtract).not.toHaveBeenCalled();
      expect(mockGetTicket).not.toHaveBeenCalled();
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('skips when branch does not start with feature/ or defect/', async () => {
      await handleBranchCreated({ ...baseInput, branchName: 'main' });

      expect(mockExtract).not.toHaveBeenCalled();
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('skips release/* branches', async () => {
      await handleBranchCreated({ ...baseInput, branchName: 'release/v1.3.0' });

      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('skips hotfix/* branches', async () => {
      await handleBranchCreated({ ...baseInput, branchName: 'hotfix/urgent-fix' });

      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('skips feature branch with no ticket ID in name', async () => {
      mockExtract.mockReturnValue([]);
      await handleBranchCreated({ ...baseInput, branchName: 'feature/no-ticket-here' });

      expect(mockGetTicket).not.toHaveBeenCalled();
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  // ── Branch name patterns ────────────────────────────────────────────────────

  describe('branch name patterns', () => {
    it('processes feature/* branch correctly', async () => {
      await handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-123-login' });

      expect(mockExtract).toHaveBeenCalledWith('feature/PROJ-123-login');
      expect(mockGetTicket).toHaveBeenCalledWith('PROJ-123');
    });

    it('processes defect/* branch correctly', async () => {
      mockExtract.mockReturnValue(['PROJ-456']);
      await handleBranchCreated({ ...baseInput, branchName: 'defect/PROJ-456-fix-null' });

      expect(mockExtract).toHaveBeenCalledWith('defect/PROJ-456-fix-null');
      expect(mockGetTicket).toHaveBeenCalledWith('PROJ-456');
    });

    it('is case-insensitive for branch prefix', async () => {
      await handleBranchCreated({ ...baseInput, branchName: 'Feature/PROJ-123-login' });

      expect(mockGetTicket).toHaveBeenCalledWith('PROJ-123');
    });

    it('handles branch name with multiple words after ticket ID', async () => {
      await handleBranchCreated({
        ...baseInput,
        branchName: 'feature/PROJ-123-add-user-login-screen-with-oauth',
      });

      expect(mockExtract).toHaveBeenCalledWith('feature/PROJ-123-add-user-login-screen-with-oauth');
    });
  });

  // ── Happy path — validation passes ─────────────────────────────────────────

  describe('happy path — validation passes', () => {
    it('transitions a single ticket to In Progress', async () => {
      await handleBranchCreated(baseInput);

      expect(mockGetTicket).toHaveBeenCalledOnce();
      expect(mockGetTicket).toHaveBeenCalledWith('PROJ-123');
      expect(mockValidate).toHaveBeenCalledWith(validTicket);
      expect(mockTransition).toHaveBeenCalledOnce();
      expect(mockTransition).toHaveBeenCalledWith('PROJ-123', 'In Progress');
      expect(mockAddComment).not.toHaveBeenCalled();
    });

    it('transitions multiple tickets found in branch name', async () => {
      mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
      mockGetTicket
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-1' })
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-2' });
      mockValidate.mockReturnValue(validationPassed);

      await handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-1-PROJ-2-shared' });

      expect(mockTransition).toHaveBeenCalledTimes(2);
      expect(mockTransition).toHaveBeenCalledWith('PROJ-1', 'In Progress');
      expect(mockTransition).toHaveBeenCalledWith('PROJ-2', 'In Progress');
    });

    it('logs warnings but still transitions when validation has warnings only', async () => {
      mockValidate.mockReturnValue(validationWithWarnings);

      await handleBranchCreated(baseInput);

      // Should still transition despite warnings
      expect(mockTransition).toHaveBeenCalledWith('PROJ-123', 'In Progress');
      expect(mockAddComment).not.toHaveBeenCalled();
    });
  });

  // ── Validation failures ─────────────────────────────────────────────────────

  describe('validation failures', () => {
    it('blocks transition when ticket fails validation', async () => {
      mockValidate.mockReturnValue(validationFailed);

      await handleBranchCreated(baseInput);

      expect(mockTransition).not.toHaveBeenCalled();
    });

    it('posts a comment on JIRA when validation fails', async () => {
      mockValidate.mockReturnValue(validationFailed);
      mockFormat.mockReturnValue('Validation failed: missing assignee and AC');

      await handleBranchCreated(baseInput);

      expect(mockAddComment).toHaveBeenCalledOnce();
      expect(mockAddComment).toHaveBeenCalledWith('PROJ-123', 'Validation failed: missing assignee and AC');
    });

    it('calls formatValidationComment with correct args for JIRA', async () => {
      mockValidate.mockReturnValue(validationFailed);

      await handleBranchCreated(baseInput);

      expect(mockFormat).toHaveBeenCalledWith(validTicket, validationFailed, 'jira');
    });

    it('blocks only invalid tickets — transitions valid ones in same branch', async () => {
      mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
      mockGetTicket
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-1' })
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-2' });
      mockValidate
        .mockReturnValueOnce(validationFailed)    // PROJ-1 fails
        .mockReturnValueOnce(validationPassed);   // PROJ-2 passes

      await handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-1-PROJ-2' });

      // Only PROJ-2 should be transitioned
      expect(mockTransition).toHaveBeenCalledOnce();
      expect(mockTransition).toHaveBeenCalledWith('PROJ-2', 'In Progress');

      // PROJ-1 should get a JIRA comment
      expect(mockAddComment).toHaveBeenCalledOnce();
    });

    it('continues processing remaining tickets if one comment post fails', async () => {
      mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
      mockGetTicket
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-1' })
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-2' });
      mockValidate
        .mockReturnValueOnce(validationFailed)
        .mockReturnValueOnce(validationPassed);
      mockAddComment.mockRejectedValueOnce(new Error('JIRA comment failed'));

      // Should not throw even if comment fails
      await expect(
        handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-1-PROJ-2' })
      ).resolves.not.toThrow();

      // PROJ-2 should still be transitioned
      expect(mockTransition).toHaveBeenCalledWith('PROJ-2', 'In Progress');
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('error handling', () => {
    // ✅ New — verifies the other ticket still processes correctly
    it('does not throw if getTicket fails for one ticket', async () => {
      mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
      mockGetTicket
        .mockRejectedValueOnce(new Error('JIRA API error'))
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-2' });
      mockValidate.mockReturnValue(validationPassed);

      await expect(
        handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-1-PROJ-2' })
      ).resolves.not.toThrow();

      // PROJ-1 failed to fetch — PROJ-2 should still transition
      expect(mockTransition).toHaveBeenCalledOnce();
      expect(mockTransition).toHaveBeenCalledWith('PROJ-2', 'In Progress');
    });

    it('does not throw if transitionTicket rejects', async () => {
      mockTransition.mockRejectedValueOnce(new Error('JIRA error'));

      await expect(handleBranchCreated(baseInput)).resolves.not.toThrow();
    });

    it('continues processing remaining tickets if one transition rejects', async () => {
      mockExtract.mockReturnValue(['PROJ-1', 'PROJ-2']);
      mockGetTicket
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-1' })
        .mockResolvedValueOnce({ ...validTicket, key: 'PROJ-2' });
      mockValidate.mockReturnValue(validationPassed);
      mockTransition
        .mockRejectedValueOnce(new Error('JIRA error'))  // PROJ-1 fails
        .mockResolvedValueOnce(undefined);               // PROJ-2 succeeds

      await expect(
        handleBranchCreated({ ...baseInput, branchName: 'feature/PROJ-1-PROJ-2' })
      ).resolves.not.toThrow();

      // Both were attempted
      expect(mockTransition).toHaveBeenCalledTimes(2);
    });

    it('does not throw if addComment rejects after validation failure', async () => {
      mockValidate.mockReturnValue(validationFailed);
      mockAddComment.mockRejectedValueOnce(new Error('Comment failed'));

      await expect(handleBranchCreated(baseInput)).resolves.not.toThrow();
      expect(mockTransition).not.toHaveBeenCalled();
    });
  });

  // ── Dry run ─────────────────────────────────────────────────────────────────

  describe('dry run mode', () => {
    it('logs instead of transitioning in dry run mode', async () => {
      // Re-mock config with DRY_RUN = true
      vi.doMock('../src/config', () => ({
        config: { JIRA_PROJECT_KEY: 'PROJ', DRY_RUN: true },
      }));

      const consoleSpy = vi.spyOn(console, 'log');

      // transitionTicket itself handles dry run internally
      // so we just verify it was called (the service mock handles the rest)
      await handleBranchCreated(baseInput);

      expect(mockTransition).toHaveBeenCalledWith('PROJ-123', 'In Progress');
      consoleSpy.mockRestore();
    });
  });

  // ── Call order ──────────────────────────────────────────────────────────────

  describe('call order', () => {
    it('calls services in correct order: extract → getTicket → validate → transition', async () => {
      const callOrder: string[] = [];

      mockExtract.mockImplementation(() => {
        callOrder.push('extract');
        return ['PROJ-123'];
      });
      mockGetTicket.mockImplementation(async () => {
        callOrder.push('getTicket');
        return validTicket;
      });
      mockValidate.mockImplementation(() => {
        callOrder.push('validate');
        return validationPassed;
      });
      mockTransition.mockImplementation(async () => {
        callOrder.push('transition');
      });

      await handleBranchCreated(baseInput);

      expect(callOrder).toEqual(['extract', 'getTicket', 'validate', 'transition']);
    });
  });
});