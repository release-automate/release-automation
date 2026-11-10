import { config }       from '../config';
import type { ReleaseDoc }   from './openai';
import type { JiraTicket }   from './jira';
import type { PullRequest }  from './github';

const BASE    = config.CONFLUENCE_BASE_URL;
const auth    = Buffer.from(`${config.CONFLUENCE_EMAIL}:${config.CONFLUENCE_API_TOKEN}`).toString('base64');
const HEADERS = {
  Authorization: `Basic ${auth}`,
  'Content-Type': 'application/json',
  Accept:         'application/json',
};

// ── Storage-format builder ─────────────────────────────────────

/**
 * Converts a ReleaseDoc + raw ticket/PR data into Confluence Storage Format
 * (a subset of XHTML with Confluence macros).
 */
function buildStorageFormat(
  doc:     ReleaseDoc,
  tickets: JiraTicket[],
  prs:     PullRequest[],
): string {
  const ticketRows = tickets.map(t => `
    <tr>
      <td><a href="${t.url}">${t.key}</a></td>
      <td>${t.type}</td>
      <td>${t.summary}</td>
      <td>${t.owner}</td>
      <td>${t.points ?? '—'}</td>
    </tr>`).join('');

  const prRows = prs.map(pr => `
    <tr>
      <td><a href="${pr.url}">#${pr.number}</a></td>
      <td>${pr.repo}</td>
      <td>${pr.title}</td>
      <td>${pr.author}</td>
      <td>+${pr.additions} / -${pr.deletions}</td>
    </tr>`).join('');

  const riskItems = doc.risks.map(r => `<li>${r}</li>`).join('');
  const checklistItems = doc.checklist.map(c => `
    <ac:task>
      <ac:task-status>incomplete</ac:task-status>
      <ac:task-body>${c}</ac:task-body>
    </ac:task>`).join('');

  const highlightItems = doc.highlights.map(h => `<li>${h}</li>`).join('');

  return `
<ac:structured-macro ac:name="info">
  <ac:parameter ac:name="title">Release ${doc.version} — ${doc.date}</ac:parameter>
  <ac:rich-text-body>
    <p>${doc.summary}</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>Highlights</h2>
<ul>${highlightItems}</ul>

<h2>JIRA Tickets</h2>
<table>
  <tbody>
    <tr>
      <th>Ticket</th><th>Type</th><th>Summary</th><th>Owner</th><th>Points</th>
    </tr>
    ${ticketRows}
  </tbody>
</table>

<h2>Pull Requests</h2>
<table>
  <tbody>
    <tr>
      <th>PR</th><th>Repo</th><th>Title</th><th>Author</th><th>Changes</th>
    </tr>
    ${prRows}
  </tbody>
</table>

<h2>Risk Assessment</h2>
<ac:structured-macro ac:name="warning">
  <ac:parameter ac:name="title">Risks identified by automated analysis</ac:parameter>
  <ac:rich-text-body>
    <ul>${riskItems}</ul>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>Impact Analysis</h2>
<p>${doc.impact}</p>

<h2>Sign-off Checklist</h2>
<ac:task-list>
  ${checklistItems}
</ac:task-list>`;
}

// ── Public API ─────────────────────────────────────────────────

export interface ConfluencePage {
  id:     string;
  title:  string;
  webUrl: string;
}

interface Page {
  id: string;
  type: 'page';
  title: string;
  version?: {
    number: number;
  };
  body?: {
    storage?: {
      value: string;
      representation: string;
    };
  };
}

/**
 * Create a new Confluence page for this release.
 * Returns the page ID and URL.
 */
export async function createReleasePage(
  doc:     ReleaseDoc,
  tickets: JiraTicket[],
  prs:     PullRequest[],
): Promise<ConfluencePage> {
  const title   = `Release Notes — ${doc.version} — ${doc.date}`;
  const content = buildStorageFormat(doc, tickets, prs);

  if (config.DRY_RUN) {
    console.log(`[DRY RUN] Would create Confluence page: "${title}"`);
    return { id: 'dry-run', title, webUrl: `${BASE}/dry-run` };
  }
  const existingPage = await findConfluencePage(title);
  let res;

  if (existingPage) {
    console.log(
      `Confluence page found: ${existingPage.id}. Updating...`
    );

    res = await updateConfluencePage(
      existingPage,
      title,
      content
    );
  }

  console.log(
    `Confluence page "${title}" not found. Creating...`
  );

  res = await createConfluencePage(
    title,
    content
  );


  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence create/update page failed: ${res.status} — ${body}`);
  }

  const page = await res.json() as { id: string; title: string; _links: { webui: string } };
  const webUrl = `${BASE}${page._links.webui}`;
  console.log(`✅ Confluence page created: ${webUrl}`);
  return { id: page.id, title: page.title, webUrl };
}

async function findConfluencePage(title: string) {
  const params = new URLSearchParams({
    spaceKey: config.CONFLUENCE_SPACE_KEY,
    title,
    expand: 'version,body.storage',
  });

  const res = await fetch(
    `${BASE}/rest/api/content?${params.toString()}`,
    {
      method: 'GET',
      headers: HEADERS,
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(
      `Failed to find Confluence page: ${res.status} ${error}`
    );
  }

  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  // Since we searched by exact title + space,
  // return the matching page.
  return data.results.find(
    (page: Page) => page.title === title
  ) ?? null;
}

async function updateConfluencePage(page: Page, title: string, content: string) {
  const currentVersion = page.version?.number;

  if (!currentVersion) {
    throw new Error(
      `Version information missing for Confluence page ${page.id}`
    );
  }

  return await fetch(
    `${BASE}/rest/api/content/${page.id}`,
    {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({
        id: page.id,
        type: 'page',
        title,
        space: {
          key: config.CONFLUENCE_SPACE_KEY,
        },
        body: {
          storage: {
            value: content,
            representation: 'storage',
          },
        },
        version: {
          number: currentVersion + 1,
          message: 'Release documentation updated automatically',
        },
      }),
    }
  );
}

async function createConfluencePage(title: string, content: string) {
  return await fetch(`${BASE}/rest/api/content`, {
    method:  'POST',
    headers: HEADERS,
    body: JSON.stringify({
      type:      'page',
      title,
      space:     { key: config.CONFLUENCE_SPACE_KEY },
      ancestors: [{ id: config.CONFLUENCE_PARENT_PAGE_ID }],
      body: {
        storage: {
          value:          content,
          representation: 'storage',
        },
      },
    }),
  });
}