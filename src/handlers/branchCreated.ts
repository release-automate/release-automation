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

  // Process all tickets independently — collect results
  const results = await Promise.allSettled(
    ticketIds.map(id => processSingleTicket(id))
  );

  // Check if any ticket failed validation
  const anyFailed = results.some(r => r.status === 'rejected');

  if (anyFailed) {
    console.error('One or more tickets failed validation — exiting with failure');
    process.exit(1); 
  }

  console.log('All tickets processed successfully');
}

// Returns normally on success
// Throws on validation failure or fetch error — caught by Promise.allSettled
async function processSingleTicket(ticketId: string): Promise<void> {

  // 1. Fetch ticket
  let ticket;
  try {
    ticket = await getTicket(ticketId);
  } catch (err) {
    console.error(`Failed to fetch ticket ${ticketId}: ${(err as Error).message}`);
    throw err;   // ← rethrow so allSettled marks this as rejected
  }

  // 2. Validate
  let result;
  try {
    result = validateTicket(ticket);
  } catch (err) {
    console.error(`Failed to validate ${ticketId}: ${(err as Error).message}`);
    throw err;   // ← rethrow
  }

  // 3. Validation failed — post comment and throw
  if (!result.valid) {
    console.error(`${ticketId} failed validation — blocking transition`);
    result.errors.forEach(e => console.error(`   ${e.field}: ${e.message}`));

    try {
      const comment = formatValidationComment(ticket, result, 'jira');
      await addComment(ticketId, comment);
      console.log(`Validation failure comment posted on ${ticketId}`);
    } catch (err) {
      console.error(`Failed to post comment on ${ticketId}: ${(err as Error).message}`);
    }

    throw new Error(`${ticketId} failed validation`);   // ← throw so allSettled marks as rejected
  }

  // 4. Log warnings (non-blocking)
  if (result.warnings.length > 0) {
    console.log(`${ticketId} warnings: ${result.warnings.map(w => w.field).join(', ')}`);
  }

  // 5. All good — transition
  try {
    await transitionTicket(ticketId, 'In Progress');
    console.log(`${ticketId} → In Progress`);
  } catch (err) {
    console.error(`Failed to transition ${ticketId}: ${(err as Error).message}`);
    throw err;
  }
}