import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: { JIRA_PROJECT_KEY: 'PROJ', JIRA_BASE_URL: 'https://test.atlassian.net' },
}));

import { extractTicketIds } from '../src/services/jira.js';

describe('extractTicketIds', () => {
  it('extracts a single ticket from a branch name', () => {
    expect(extractTicketIds('feature/PROJ-123-login-screen')).toEqual(['PROJ-123']);
  });

  it('extracts multiple tickets', () => {
    expect(extractTicketIds('PROJ-1 and PROJ-2 are related')).toEqual(['PROJ-1', 'PROJ-2']);
  });

  it('deduplicates repeated IDs', () => {
    expect(extractTicketIds('PROJ-1 PROJ-1 PROJ-2')).toEqual(['PROJ-1', 'PROJ-2']);
  });

  it('is case-insensitive', () => {
    expect(extractTicketIds('proj-99')).toEqual(['PROJ-99']);
  });

  it('returns empty array when no tickets found', () => {
    expect(extractTicketIds('chore/update-readme')).toEqual([]);
  });

  it('extracts from PR body text', () => {
    const body = 'This PR closes PROJ-42.\nAlso fixes PROJ-43.';
    expect(extractTicketIds(body)).toEqual(['PROJ-42', 'PROJ-43']);
  });
});
