import { searchTicketsByStatus } from "../services/jira";
import { handleReleaseDocGen } from "./releaseDocGen";

export interface PollJiraInput {
  repos: string[];
  version: string;
  releaseBranch: string
}

export async function handleJiraPoll(input: PollJiraInput): Promise<void> {
  const { repos, version, releaseBranch } = input;

  console.log(
    `[Poller] ${new Date().toISOString()} — Searching for "Ready to Accept" tickets...`
  );

  const tickets = await searchTicketsByStatus("Ready to Accept");

  if (tickets.length === 0) {
    console.log("[Poller] No tickets found — exiting.");
    return;
  }

  console.log(`[Poller] Found: ${tickets.map((t) => t.key).join(", ")}`);

  await handleReleaseDocGen({
    ticketIds: tickets.map((t) => t.key),
    version,
    repos,
    releaseBranch
  });

  console.log("[Poller] Done.");
}
