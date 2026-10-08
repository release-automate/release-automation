/**
 * Express webhook server — used only for Flow 3 (JIRA → Confluence).
 *
 * During the POC with GitHub Actions only, this server is NOT needed.
 * When you're ready to activate Flow 3:
 *   1. Run `pnpm dev` (or deploy to a VPS)
 *   2. Expose the server publicly (ngrok for local dev)
 *   3. Register the public URL as a JIRA webhook for "Issue updated" events
 */

import express, { type Request, type Response } from 'express';
import crypto                                    from 'node:crypto';
import { config }                                from './config.js';
import { handleReleaseDocGen }                   from './handlers/releaseDocGen.js';

const app = express();

// Parse raw body so we can verify HMAC signatures
app.use(express.json({
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf;
  },
}));

// ── Signature verification ─────────────────────────────────────

function verifyJiraSignature(req: Request & { rawBody?: Buffer }): boolean {
  // JIRA Cloud webhooks send X-Hub-Signature (SHA-256)
  const signature = req.headers['x-hub-signature'] as string | undefined;
  if (!signature || !config.WEBHOOK_SECRET) {
    // If no secret configured, skip verification (useful for local dev)
    return !config.WEBHOOK_SECRET;
  }
  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.WEBHOOK_SECRET)
    .update(req.rawBody ?? '')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Health check ───────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── JIRA webhook endpoint ──────────────────────────────────────

app.post('/webhook/jira', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  // Respond immediately — JIRA webhooks time out after 10 seconds
  res.status(202).json({ received: true });

  if (!verifyJiraSignature(req)) {
    console.warn('⚠️  Invalid JIRA webhook signature — ignoring event.');
    return;
  }

  const body = req.body as {
    webhookEvent?: string;
    issue?:        { key: string; fields: { status: { name: string } } };
  };

  const event  = body.webhookEvent ?? '';
  const ticket = body.issue;

  if (!ticket || event !== 'jira:issue_updated') {
    return; // Only care about issue updates
  }

  const newStatus = ticket.fields.status.name;
  if (newStatus !== 'Ready to Accept') {
    return; // Only trigger on the specific transition
  }

  console.log(`[Flow 3] JIRA webhook: ${ticket.key} → "${newStatus}"`);

  try {
    // TODO: derive version and repos from the ticket or an env variable
    // For now, repos are taken from GH_REPOS env var (comma-separated)
    const repos   = (process.env.GH_REPOS ?? '').split(',').filter(Boolean);
    const version = process.env.RELEASE_VERSION ?? 'TBD';

    await handleReleaseDocGen({
      ticketIds: [ticket.key],
      version,
      repos,
    });
  } catch (err) {
    console.error('[Flow 3] Error generating release doc:', err);
  }
});

// ── GitHub webhook endpoint (optional — alternative to Actions) ──

app.post('/webhook/github', (req, res) => {
  // Placeholder — all GitHub flows are handled by Actions in this POC
  res.status(200).json({ message: 'GitHub events are handled by GitHub Actions in this setup.' });
});

// ── Start ──────────────────────────────────────────────────────

app.listen(config.PORT, () => {
  console.log(`🚀 Webhook server running on port ${config.PORT}`);
  console.log(`   Health: http://localhost:${config.PORT}/health`);
  console.log(`   JIRA:   http://localhost:${config.PORT}/webhook/jira`);
});
