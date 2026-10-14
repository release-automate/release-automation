import type { JiraTicket } from './jira';

export interface ValidationResult {
  valid:    boolean;
  errors:   ValidationError[];
  warnings: ValidationError[];
}

export interface ValidationError {
  field:   string;
  message: string;
  code:    string;
}

// Rules — what a ticket MUST have before transitioning
const REQUIRED_RULES: Array<{
  field:    string;
  code:     string;
  message:  string;
  check:    (ticket: JiraTicket) => boolean;
}> = [
  {
    field:   'Assignee',
    code:    'NO_ASSIGNEE',
    message: 'Ticket has no assignee — assign it before moving forward.',
    check:   t => t.owner !== 'Unassigned' && !!t.owner,
  },
  {
    field:   'Description',
    code:    'NO_DESCRIPTION',
    message: 'Ticket has no description — add context before moving forward.',
    check:   t => !!t.description?.trim(),
  },
  {
    field:   'Acceptance Criteria',
    code:    'NO_ACCEPTANCE_CRITERIA',
    message: 'Ticket has no acceptance criteria — QA cannot test without it.',
    check:   t => !!t.acceptanceCriteria?.trim(),
  },
  {
    field:   'Story Points',
    code:    'NO_STORY_POINTS',
    message: 'Ticket has no story points estimated.',
    check:   t => t.points !== null && t.points > 0,
  },
  {
    field:   'Epic / Feature Link',
    code:    'NO_EPIC_LINK',
    message: 'Ticket is not linked to an epic or feature.',
    check:   t => !!t.epicLink,
  },
];

// Warnings — nice to have but won't block the transition
const WARNING_RULES: Array<{
  field:   string;
  code:    string;
  message: string;
  check:   (ticket: JiraTicket) => boolean;
}> = [
  {
    field:   'Priority',
    code:    'NO_PRIORITY',
    message: 'Ticket has no priority set.',
    check:   t => !!t.priority,
  },
  {
    field:   'Fix Version',
    code:    'NO_FIX_VERSION',
    message: 'Ticket has no fix version set.',
    check:   t => !!t.fixVersion,
  },
];

export function validateTicket(ticket: JiraTicket): ValidationResult {
  const errors:   ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const rule of REQUIRED_RULES) {
    if (!rule.check(ticket)) {
      errors.push({ field: rule.field, message: rule.message, code: rule.code });
    }
  }

  for (const rule of WARNING_RULES) {
    if (!rule.check(ticket)) {
      warnings.push({ field: rule.field, message: rule.message, code: rule.code });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Format a readable comment for JIRA / GitHub
export function formatValidationComment(
  ticket:  JiraTicket,
  result:  ValidationResult,
  context: 'jira' | 'github',
): string {
  const errorList = result.errors
    .map(e => `  ${e.field}: ${e.message}`)
    .join('\n');

  const warnList = result.warnings.length > 0
    ? '\n\nWarnings (non-blocking):\n' + result.warnings
        .map(w => `  ${w.field}: ${w.message}`)
        .join('\n')
    : '';

  if (context === 'github') {
    return [
      `## JIRA Ticket Validation Failed — ${ticket.key}`,
      '',
      `The ticket **[${ticket.key}](${ticket.url})** is missing required fields.`,
      `Status transition has been **blocked** until these are fixed in JIRA:`,
      '',
      result.errors.map(e => `- **${e.field}**: ${e.message}`).join('\n'),
      warnList,
      '',
      `Fix these in JIRA and re-run the workflow.`,
    ].join('\n');
  }

  // JIRA comment format
  return [
    `*Automated validation failed — status transition blocked*`,
    '',
    `The following fields must be completed before this ticket can progress:`,
    '',
    errorList,
    warnList,
    '',
    `Please fix the above issues and the next GitHub event will re-validate automatically.`,
  ].join('\n');
}