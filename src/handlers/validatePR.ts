import {
  extractTicketIds,
  getTicket,
  addComment,
} from "../services/jira";
import { addGitHubPRComment } from "../services/github";
import {
  validateTicket,
  formatValidationComment,
} from "../services/validator";

export interface PRValidateInput {
  prNumber: number;
  prTitle: string;
  prBody: string;
  repo: string;
}

export async function handlePRValidation(
  input: PRValidateInput
): Promise<void> {
  const { prNumber, prTitle, prBody, repo } = input;

  // Extract ticket IDs from PR title + body
  const ticketIds = extractTicketIds(`${prTitle} ${prBody}`);

  if (ticketIds.length === 0) {
    console.log("No JIRA ticket IDs found in PR title or body.");
    console.log(
      "    Add the ticket ID to the PR title e.g. [PROJ-123] My feature"
    );
    // Post comment on PR explaining why it is blocked
    await addGitHubPRComment(repo, prNumber,
      [
        '## PR Blocked — No JIRA Ticket Found',
        '',
        'No JIRA ticket ID was found in the PR title or body.',
        '',
        '**Fix:** Add the ticket ID to your PR title:',
        '```',
        '[SCRUM-123] Your PR title here',
        '```',
        'Or mention it in the PR body:',
        '```',
        'Closes SCRUM-123',
        '```',
      ].join('\n')
    ).catch(e => console.warn('Could not post PR comment:', e.message));

    process.exit(1);   // ← blocks merge
  }

  console.log(`Found tickets: ${ticketIds.join(", ")}`);

  let allValid = true;
  const summary: string[] = [];

  for (const id of ticketIds) {
    let ticket;

    try {
      ticket = await getTicket(id);
    } catch (err) {
      console.error(`Could not fetch ticket ${id}: ${(err as Error).message}`);
      allValid = false;
      continue;
    }
    const result = validateTicket(ticket);

    if (!result.valid) {
      allValid = false;

      console.log(`\n${id} — validation FAILED`);
      result.errors.forEach((e) =>
        console.log(`   ${e.field}: ${e.message}`)
      );

      // Post comment on JIRA ticket
      await addComment(
        id,
        formatValidationComment(ticket, result, "jira")
      ).catch((err) =>
        console.warn(`Could not comment on ${id}: ${err.message}`)
      );

      summary.push(
        `**${id}**: ${result.errors.map((e) => e.field).join(", ")}`
      );
    } else {
      console.log(`\n${id} — all fields valid`);
      if (result.warnings.length > 0) {
        result.warnings.forEach((w) =>
          console.log(`   ${w.field}: ${w.message}`)
        );
      }
    }
  }

  // Post a single summary comment on the GitHub PR
  if (!allValid) {
    const body = [
      "## JIRA Validation Failed — PR Merge Blocked",
      "",
      "The following tickets are missing required fields.",
      "Fix them in JIRA and push a commit (or re-run this check) to unblock the PR.",
      "",
      summary.map((s) => `- ${s}`).join("\n"),
      "",
      "### Required fields",
      "- Assignee",
      "- Description",
      "- Acceptance Criteria",
      "- Story Points",
      "- Epic / Feature Link",
    ].join("\n");

    await addGitHubPRComment(repo, prNumber, body).catch((err) =>
      console.warn(`Could not comment on PR: ${err.message}`)
    );

    console.error('\nValidation failed — blocking merge');
    process.exit(1);
  }

  console.log('\n✅ All tickets passed — merge is allowed');
  process.exit(0); 
}
