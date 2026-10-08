# release-automation

Automated release documentation across 20+ repos — GitHub Actions + JIRA + Confluence + OpenAI GPT-4o.

## How it works

| Flow | Trigger | Action |
|---|---|---|
| 1 | Branch `feature/PROJ-123-*` or `defect/PROJ-456-*` created | JIRA ticket → **In Progress** |
| 2 | PR merged to `main` | JIRA ticket → **Ready for Testing** |
| 3 | JIRA ticket → "Ready to Accept" *(Express server, activate later)* | GenAI → **Confluence release page** |
| 4 | Push to `release/**` branch | All linked JIRA tickets → **Accepted** |

All logic lives in this hub repo. Your 20 repos each add **one file** — the caller workflow.

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/release-automation
cd release-automation
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your real values
```

Required for Flows 1, 2, 4:
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`
- `GH_TOKEN` (PAT with `repo` + `read:org`), `GH_ORG`

Required for Flow 3 (when you activate it):
- `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_SPACE_KEY`, `CONFLUENCE_PARENT_PAGE_ID`
- `OPENAI_API_KEY`

### 3. Run tests

```bash
pnpm test
```

### 4. Set GitHub Org Secrets

Go to **GitHub → Your Org → Settings → Secrets and variables → Actions → New org secret** and add each variable from `.env.example`. All 20 repos will inherit them automatically.

### 5. Add the caller workflow to each repo

Copy `caller-workflow-template.yml` to each repo at:

```
.github/workflows/release-automation.yml
```

Replace `YOUR_ORG` with your GitHub organisation name. That's the only change per repo.

To do it in bulk with GitHub CLI:
```bash
for repo in repo1 repo2 repo3; do
  gh api repos/YOUR_ORG/$repo/contents/.github/workflows/release-automation.yml \
    --method PUT \
    -f message="chore: add release automation workflow" \
    -f content="$(base64 < caller-workflow-template.yml)"
done
```

### 6. Set your branch naming convention

All developers must use:
```
feature/PROJ-123-short-description
defect/PROJ-456-short-description
release/v2.4.0
```

The JIRA project key (`PROJ`) must match `JIRA_PROJECT_KEY` in your secrets.

---

## Branch naming convention

| Branch pattern | Flow triggered |
|---|---|
| `feature/PROJ-NNN-*` | Flow 1 — In Progress |
| `defect/PROJ-NNN-*` | Flow 1 — In Progress |
| PR merged to `main` (title/body must mention `PROJ-NNN`) | Flow 2 — Ready for Testing |
| `release/v*.*.*` pushed | Flow 4 — Accepted |

---

## Activating Flow 3 (Confluence release doc)

Flow 3 requires the Express server to receive JIRA webhook calls.

```bash
# Start the server locally
pnpm dev

# In another terminal, expose it publicly
npx ngrok http 3000

# Register the ngrok URL in JIRA:
# Project Settings → Webhooks → Create webhook
# URL: https://xxxx.ngrok.io/webhook/jira
# Events: Issue → updated
# Filter: status = "Ready to Accept"
```

Or run it manually for testing:
```bash
TICKET_IDS=PROJ-1,PROJ-2 VERSION=v1.0.0 REPOS=YOUR_ORG/repo1,YOUR_ORG/repo2 \
  pnpm tsx src/handlers/releaseDocGen.ts
```

---

## Project structure

```
release-automation/
├── .github/workflows/
│   ├── branch-automation.yml    # Reusable — Flow 1
│   ├── pr-automation.yml        # Reusable — Flow 2
│   └── deploy-automation.yml   # Reusable — Flow 4
├── scripts/
│   ├── branchCreated.ts         # Actions entry point — Flow 1
│   ├── prMerged.ts              # Actions entry point — Flow 2
│   └── releaseDeploy.ts         # Actions entry point — Flow 4
├── src/
│   ├── config.ts                # Typed, validated env config
│   ├── server.ts                # Express server for Flow 3
│   ├── handlers/
│   │   ├── branchCreated.ts     # Flow 1 logic
│   │   ├── prMerged.ts          # Flow 2 logic
│   │   ├── releaseDocGen.ts     # Flow 3 logic
│   │   └── releaseDeploy.ts     # Flow 4 logic
│   └── services/
│       ├── jira.ts              # JIRA REST API client
│       ├── github.ts            # GitHub API client (Octokit)
│       ├── openai.ts            # OpenAI GPT-4o integration
│       └── confluence.ts        # Confluence REST API client
├── tests/
│   ├── branchCreated.test.ts
│   ├── prMerged.test.ts
│   └── jira.extractTicketIds.test.ts
├── caller-workflow-template.yml # Copy this to each of your 20 repos
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Development

```bash
pnpm dev          # Start Express server with hot reload (Flow 3)
pnpm test         # Run all tests
pnpm typecheck    # TypeScript type checking
pnpm build        # Compile to dist/
pnpm lint         # ESLint
```
