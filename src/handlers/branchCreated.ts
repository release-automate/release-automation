import { extractTicketIds, transitionTicket, getTicket, addComment } from '../services/jira';
import { validateTicket, formatValidationComment }                    from '../services/validator';

export interface BranchCreatedInput {
  branchName: string;
  refType:    string;
  repo:       string;
}

export async function handleBranchCreated(input: BranchCreatedInput): Promise<void> {
  const { branchName, refType } = input;

  if (refType !== 'branch') {
    console.log(`Skipping — ref type is "${refType}", not "branch".`);
    return;
  }

  if (!/^(feature|defect)\//i.test(branchName)) {
    console.log(`Skipping — branch "${branchName}" is not a feature or defect branch.`);
    return;
  }

  const ticketIds = extractTicketIds(branchName);

  if (ticketIds.length === 0) {
    console.log(`No JIRA ticket IDs found in branch name "${branchName}".`);
    return;
  }

  console.log(`Branch "${branchName}" → tickets: ${ticketIds.join(', ')}`);

  // Process each ticket independently — one failure must not stop the others
  await Promise.allSettled(
    ticketIds.map(id => processSingleTicket(id, branchName))
  );
}

async function processSingleTicket(ticketId: string, branchName: string): Promise<void> {
  // 1. Fetch ticket details — catch separately so one bad ticket doesn't stop others
  let ticket;
  try {
    ticket = await getTicket(ticketId);
  } catch (err) {
    console.error(`Failed to fetch ticket ${ticketId}: ${(err as Error).message}`);
    return;   // skip this ticket — can't validate without data
  }

  // 2. Validate
  let result;
  try {
    result = validateTicket(ticket);
  } catch (err) {
    console.error(`Failed to validate ticket ${ticketId}: ${(err as Error).message}`);
    return;
  }

  // 3. Validation failed — post comment and block transition
  if (!result.valid) {
    console.log(`${ticketId} failed validation — blocking transition`);
    result.errors.forEach(e => console.error(`   ${e.field}: ${e.message}`));

    try {
      const comment = formatValidationComment(ticket, result, 'jira');
      await addComment(ticketId, comment);
    } catch (err) {
      console.error(`Failed to post comment on ${ticketId}: ${(err as Error).message}`);
    }
    return;   // do NOT transition
  }

  // 4. Log warnings (non-blocking)
  if (result.warnings.length > 0) {
    console.log(`${ticketId} has warnings: ${result.warnings.map(w => w.field).join(', ')}`);
  }

  // 5. All good — transition
  try {
    await transitionTicket(ticketId, 'In Progress');
  } catch (err) {
    console.error(`Failed to transition ${ticketId}: ${(err as Error).message}`);
  }
}