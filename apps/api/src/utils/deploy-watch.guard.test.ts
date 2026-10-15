import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * `.github/scripts/deploy-watch.sh` is the deploy watchdog, run when a deploy
 * finishes: it reads
 * the latest deploy runs through the GitHub API and opens an issue when a
 * deploy failed, hung, or left its site unhealthy. It must never act on the
 * deployment itself (no rollback, no rerun, no repoint) and it must not open a
 * second issue for a failure it already reported. A workflow with an open
 * report gets later failures as comments on it, and the report is closed once
 * the workflow is green and its site healthy again (#850).
 *
 * The cases below drive the real script against a fake API and a fake site, so
 * they exercise the same `curl`/`jq` paths a real run would.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'deploy-watch.sh');
const REPO = 'testorg/testrepo';
const SHA = 'deadbeefcafebabe0000000000000000000000ff';

type Scenario = {
  status: 'completed' | 'in_progress';
  conclusion: string | null;
  minutesAgo: number;
  healthCommit: string | null; // null => /healthz unreachable
  manifestStatus: number;
  /** The `deploy-watch` issues the repository already has. */
  issues: Issue[];
  /** Comments on those issues, by number. */
  comments?: Record<number, string[]>;
  /** The run's jobs; the default is the failed `Update staging`. */
  jobs?: { id: number; name: string; conclusion: string }[];
  /** Job logs answer 302 to a blob URL, as GitHub's do. */
  logsRedirect?: boolean;
  /** HTTP status of the runs listing (403 = a token without actions: read). */
  runsStatus?: number;
};
type Issue = { number: number; state: 'open' | 'closed'; body: string; updated_at?: string };
let issuesQuery = '';

let scenario: Scenario;
let server: Server;
let baseUrl: string;
let openedBodies: string[];
let commented: { n: number; body: string }[];
let patched: { n: number; body: Record<string, string> }[];

const BASMALAH = 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ';
const AI_FOOTER = 'This comment was created by an AI agent';
const now = () => new Date().toISOString();
/** An open report of a workflow, as every report names its workflow file. */
const report = (number: number, file: string, over: Partial<Issue> = {}): Issue => ({
  number,
  state: 'open',
  body: `<!-- deploy-watch:run=${number}000 -->\n**Workflow:** Deploy x (\`${file}\`)`,
  updated_at: now(),
  ...over,
});

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
}

function runJson() {
  return {
    id: 424242,
    name: 'Deploy staging',
    head_sha: SHA,
    status: scenario.status,
    conclusion: scenario.conclusion,
    created_at: isoMinutesAgo(scenario.minutesAgo),
    html_url: `https://github.com/${REPO}/actions/runs/424242`,
  };
}

function handler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url || '').split('?')[0];
  const json = (code: number, body: unknown) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': data.length });
    res.end(data);
  };
  const text = (code: number, body: string) => {
    res.writeHead(code, {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  if (path === '/site/healthz') {
    if (scenario.healthCommit === null) return text(502, 'bad gateway');
    return json(200, { status: 'ok', commit: scenario.healthCommit });
  }
  if (path === '/site/manifest.json') {
    return scenario.manifestStatus === 200 ? json(200, {}) : text(scenario.manifestStatus, 'boom');
  }
  if (path.endsWith('/actions/workflows/deploy-staging.yml/runs')) {
    if (scenario.runsStatus && scenario.runsStatus !== 200) return json(scenario.runsStatus, {});
    return json(200, { workflow_runs: [runJson()] });
  }
  if (path.endsWith('/actions/workflows/deploy-production.yml/runs')) {
    return json(200, { workflow_runs: [] });
  }
  if (/\/actions\/runs\/\d+\/jobs$/.test(path)) {
    return json(200, {
      jobs: scenario.jobs ?? [{ id: 7, name: 'Update staging', conclusion: 'failure' }],
    });
  }
  if (/\/actions\/jobs\/\d+\/logs$/.test(path) && scenario.logsRedirect) {
    res.writeHead(302, { Location: `${baseUrl}/blob/job-7.log`, 'Content-Length': 0 });
    return res.end();
  }
  if (/\/actions\/jobs\/\d+\/logs$/.test(path) || path === '/blob/job-7.log') {
    return text(
      200,
      '2026-10-07T00:00:00Z waiting for release\n' +
        '2026-10-07T00:00:05Z ::error::staging not answering with commit deadbeef\n' +
        '2026-10-07T00:15:00Z timeout after 900s\n'
    );
  }
  if (path.endsWith('/issues') && req.method === 'GET') {
    issuesQuery = (req.url || '').split('?')[1] ?? '';
    const state = new URLSearchParams(issuesQuery).get('state');
    return json(
      200,
      scenario.issues.filter((i) => state === 'all' || i.state === state)
    );
  }
  const commentsOf = /\/issues\/(\d+)\/comments$/.exec(path);
  if (commentsOf && req.method === 'GET') {
    const list = scenario.comments?.[Number(commentsOf[1])] ?? [];
    return json(
      200,
      list.map((body) => ({ body }))
    );
  }
  const readBody = (then: (parsed: Record<string, string>) => void) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => then(JSON.parse(raw)));
  };
  if (commentsOf && req.method === 'POST') {
    return readBody((b) => {
      commented.push({ n: Number(commentsOf[1]), body: b.body });
      json(201, { id: 1 });
    });
  }
  const issueOf = /\/issues\/(\d+)$/.exec(path);
  if (issueOf && req.method === 'PATCH') {
    return readBody((b) => {
      patched.push({ n: Number(issueOf[1]), body: b });
      json(200, { number: Number(issueOf[1]) });
    });
  }
  if (path.endsWith('/labels') && req.method === 'POST') return json(201, {});
  if (path.endsWith('/issues') && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      openedBodies.push(JSON.parse(raw).body);
      json(201, { number: 999 });
    });
    return;
  }
  return json(404, {});
}

function resetScenario(over: Partial<Scenario> = {}) {
  scenario = {
    status: 'completed',
    conclusion: 'success',
    minutesAgo: 10,
    healthCommit: SHA,
    manifestStatus: 200,
    issues: [],
    ...over,
  };
  openedBodies = [];
  commented = [];
  patched = [];
  issuesQuery = '';
}

async function runWatch(): Promise<string> {
  // Async, not execFileSync: the fake API runs in this process, so a
  // synchronous exec would block the event loop and the server could never
  // answer the script's curl calls — every request would time out.
  const { stdout } = await execFileAsync('bash', [SCRIPT], {
    encoding: 'utf8',
    timeout: 60_000, // a hung watchdog must fail the test, not hang the suite
    env: {
      ...process.env,
      GITHUB_REPOSITORY: REPO,
      GH_TOKEN: 'test-token',
      GITHUB_API_URL: baseUrl,
      DEPLOY_WATCH_WORKFLOWS: `Deploy staging|deploy-staging.yml|${baseUrl}/site`,
    },
  });
  return stdout;
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
});

// close() alone waits for keep-alive sockets to drain; the script's curl
// connections would keep the process alive and hang the suite.
afterAll(
  () =>
    new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    })
);

describe('deploy-watch.sh', () => {
  it('opens an issue with the run id and log lines when a deploy failed', async () => {
    resetScenario({ conclusion: 'failure' });
    const out = await runWatch();
    expect(out).toContain('opened issue');
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('deploy-watch:run=424242');
    expect(openedBodies[0]).toContain('424242');
    expect(openedBodies[0]).toContain('not answering with commit deadbeef');
    expect(openedBodies[0]).toContain('failed');
  });

  it('treats a cancelled run as a failed deploy', async () => {
    resetScenario({ conclusion: 'cancelled' });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('cancelled');
  });

  // A skipped run deployed nothing: E2E or CI did not pass on main, and that
  // failure is reported upstream. Calling it a failed deploy would be a second
  // alert for one problem (lesson from 2026-10-09, a skipped run in the history).
  it('stays quiet about a skipped run — the failure is upstream, not a deploy', async () => {
    resetScenario({ conclusion: 'skipped' });
    await runWatch();
    expect(openedBodies).toEqual([]);
  });

  it('follows the redirect GitHub answers for job logs, so the issue carries them', async () => {
    resetScenario({ conclusion: 'failure', logsRedirect: true });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('staging not answering with commit deadbeef');
  });

  it('a green run that deployed nothing (no code changed) is not "degraded"', async () => {
    // docs-only merge: the Update job is skipped and the site keeps the
    // earlier commit on purpose.
    resetScenario({
      healthCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jobs: [
        { id: 6, name: 'CI and E2E passed on x', conclusion: 'success' },
        { id: 7, name: 'Update staging', conclusion: 'skipped' },
      ],
    });
    await runWatch();
    expect(openedBodies).toEqual([]);
  });

  it('…but it still reports a site that does not answer', async () => {
    resetScenario({
      healthCommit: null,
      jobs: [{ id: 7, name: 'Update staging', conclusion: 'skipped' }],
    });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
  });

  it('looks for an earlier report among closed issues too', async () => {
    resetScenario({ conclusion: 'failure' });
    await runWatch();
    expect(issuesQuery).toContain('state=all');
  });

  it('a watch that cannot read the runs fails loudly instead of passing', async () => {
    resetScenario({ runsStatus: 403 });
    await expect(runWatch()).rejects.toMatchObject({ code: 1 });
    expect(openedBodies).toEqual([]);
  });

  it('reports a run stuck past the threshold and stays quiet below it', async () => {
    resetScenario({ status: 'in_progress', conclusion: null, minutesAgo: 120 });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('stuck');

    resetScenario({ status: 'in_progress', conclusion: null, minutesAgo: 5 });
    const out = await runWatch();
    expect(openedBodies).toHaveLength(0);
    expect(out).toContain('within the');
  });

  it('reports a green run whose site serves the wrong commit or a dead web container', async () => {
    resetScenario({ healthCommit: '0ldc0de' });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('degraded');

    resetScenario({ manifestStatus: 500 });
    await runWatch();
    expect(openedBodies).toHaveLength(1);
    expect(openedBodies[0]).toContain('manifest.json');
  });

  it('does nothing when the latest run is green and the site is healthy', async () => {
    resetScenario();
    const out = await runWatch();
    expect(openedBodies).toHaveLength(0);
    expect(out).toContain('success');
  });

  it('does not open a second issue for a run already reported', async () => {
    resetScenario({
      conclusion: 'failure',
      issues: [{ number: 1, state: 'closed', body: '<!-- deploy-watch:run=424242 -->' }],
    });
    const out = await runWatch();
    expect(openedBodies).toHaveLength(0);
    expect(commented).toHaveLength(0);
    expect(out).toContain('already reported');
  });

  // Rule 13 of docs/LABELS.md. basmalah.yml never sees this issue: one opened
  // with GITHUB_TOKEN starts no workflow run.
  it('opens its issue with the basmalah, the run marker below it', async () => {
    resetScenario({ conclusion: 'failure' });
    await runWatch();
    expect(openedBodies[0].startsWith(`${BASMALAH}\n\n<!-- deploy-watch:run=424242 -->`)).toBe(
      true
    );
  });

  it('never mutates the deployment — a human decides', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    // No rollback, rerun, or container repoint: those are human actions.
    for (const forbidden of [
      'workflow run',
      'gh run rerun',
      'az webapp sitecontainers update',
      'az acr import',
      'docker service update',
      'git revert',
      'git push',
    ]) {
      expect(script).not.toContain(forbidden);
    }
    expect(script).toContain('never rolls back');
  });
});

/**
 * One open report per workflow (#850). From 2026-10-12 one cause opened eleven
 * issues, one per failed run, and the fleet triaged each of them.
 */
describe('deploy-watch.sh — one report per workflow', () => {
  it('a later failure of a workflow with an open report is a comment on it, not a new issue', async () => {
    resetScenario({ conclusion: 'failure', issues: [report(800, 'deploy-staging.yml')] });
    const out = await runWatch();
    expect(openedBodies).toEqual([]);
    expect(commented).toHaveLength(1);
    expect(commented[0].n).toBe(800);
    expect(commented[0].body).toContain('<!-- deploy-watch:run=424242 -->');
    expect(commented[0].body).toContain('staging not answering with commit deadbeef');
    expect(commented[0].body).toContain(AI_FOOTER);
    expect(out).toContain('added run 424242');
  });

  it('comments on the oldest open report when several are open', async () => {
    resetScenario({
      conclusion: 'failure',
      issues: [report(843, 'deploy-staging.yml'), report(800, 'deploy-staging.yml')],
    });
    await runWatch();
    expect(commented.map((c) => c.n)).toEqual([800]);
  });

  it('does not add the same run to the report twice', async () => {
    resetScenario({
      conclusion: 'failure',
      issues: [report(800, 'deploy-staging.yml')],
      comments: { 800: ['<!-- deploy-watch:run=424242 -->\n## Deploy staging failed again'] },
    });
    const out = await runWatch();
    expect(commented).toEqual([]);
    expect(openedBodies).toEqual([]);
    expect(out).toContain('already reported');
  });

  it('…nor raise it again after a person closed the report while it is still the latest run', async () => {
    resetScenario({
      conclusion: 'failure',
      issues: [report(800, 'deploy-staging.yml', { state: 'closed' })],
      comments: { 800: ['<!-- deploy-watch:run=424242 -->'] },
    });
    await runWatch();
    expect(openedBodies).toEqual([]);
    expect(commented).toEqual([]);
  });

  it("one workflow's open report does not take another workflow's failure", async () => {
    resetScenario({ conclusion: 'failure', issues: [report(800, 'deploy-production.yml')] });
    await runWatch();
    expect(commented).toEqual([]);
    expect(openedBodies).toHaveLength(1);
  });

  it('closes the open report once the workflow is green and its site serves the commit', async () => {
    resetScenario({ issues: [report(800, 'deploy-staging.yml')] });
    const out = await runWatch();
    expect(patched).toEqual([{ n: 800, body: { state: 'closed', state_reason: 'completed' } }]);
    expect(commented).toHaveLength(1);
    expect(commented[0].body).toContain('Recovered');
    expect(commented[0].body).toContain(SHA);
    expect(commented[0].body).toContain(AI_FOOTER);
    expect(out).toContain('closed #800');
  });

  it('…keeps it open, with the new evidence, while the site is still unhealthy', async () => {
    resetScenario({ healthCommit: '0ldc0de', issues: [report(800, 'deploy-staging.yml')] });
    await runWatch();
    expect(patched).toEqual([]);
    expect(openedBodies).toEqual([]);
    expect(commented).toHaveLength(1);
    expect(commented[0].body).toContain('degraded');
  });

  it("…and leaves another workflow's report alone", async () => {
    resetScenario({ issues: [report(800, 'deploy-production.yml')] });
    await runWatch();
    expect(patched).toEqual([]);
    expect(commented).toEqual([]);
  });
});

/**
 * A monitor that watches a name no workflow has finds no runs and stays silent —
 * the failure the github-actions-minutes-exhausted lesson records ("a monitor
 * that hears nothing is not a pass"). The watched name must equal the `name:`
 * of the workflow file it points at.
 */
describe('deploy-watch workflow', () => {
  const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'deploy-watch.yml');

  function watched(): { name: string; file: string; url: string }[] {
    const text = readFileSync(WORKFLOW, 'utf8');
    return [...text.matchAll(/^\s*([^|\n#]+?)\|([\w.-]+\.yml)\|(https?:\/\/\S+)\s*$/gm)].map(
      (m) => ({
        name: m[1].trim(),
        file: m[2],
        url: m[3],
      })
    );
  }

  it('watches the two deploy workflows by their real name', () => {
    const pairs = watched();
    expect(pairs.map((p) => p.name)).toEqual(['Deploy staging', 'Deploy production']);
    for (const { name, file } of pairs) {
      const source = readFileSync(join(REPO_ROOT, '.github', 'workflows', file), 'utf8');
      expect(source, `${file} must be named "${name}"`).toMatch(
        new RegExp(`^name:\\s*${name}\\s*$`, 'm')
      );
    }
  });

  it('runs when either deploy finishes, never on a clock', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    expect(text).toMatch(/^\s*workflow_run:/m);
    expect(text).toMatch(/workflows:\s*\['Deploy staging', 'Deploy production'\]/);
    expect(text).toMatch(/types:\s*\[completed\]/);
    // A cron here was ~1,440 runs a month (decided 2026-10-10).
    expect(text).not.toMatch(/^\s*schedule:/m);
    expect(text).toMatch(/^\s*issues:\s*write/m);
    // Listing runs and reading logs need it; without it every call is a 403.
    expect(text).toMatch(/^\s*actions:\s*read/m);
    expect(text).toMatch(/^\s*issues:\s*write/m);
    expect(text).toMatch(/timeout-minutes:/);
  });
});
