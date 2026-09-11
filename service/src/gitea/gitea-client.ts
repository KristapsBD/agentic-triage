/**
 * Direct Gitea REST API calls (ADR-0004) — no `tea` CLI subprocess, no shell
 * interpolation of any model-derived string. Mirrors app/gitea_client.py.
 */

import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS, Settings } from '../config/settings';
import { GiteaIssue } from '../reports/types';
import { GiteaError } from './gitea.errors';
import { DEFAULT_LABEL_COLOR, LABEL_COLORS } from './labels';

interface RawGiteaLabel {
  id: number;
  name: string;
}

interface RawGiteaIssue {
  number: number;
  title: string;
  body?: string | null;
  labels?: RawGiteaLabel[];
  state?: string;
}

const PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class GiteaClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private labelIdCache: Map<string, number> | null = null;

  constructor(@Inject(SETTINGS) settings: Settings) {
    this.base = `${settings.gitea_url}/api/v1/repos/${settings.gitea_repo_owner}/${settings.gitea_repo_name}`;
    this.headers = { Authorization: `token ${settings.gitea_token}`, 'Content-Type': 'application/json' };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await this.fetchResponse(method, path, body);
    await this.throwIfErrorStatus(response);
    return response;
  }

  private async fetchResponse(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GiteaError(`Gitea request failed: ${(err as Error).message}`);
    }
  }

  private async throwIfErrorStatus(response: Response): Promise<void> {
    if (response.status >= 500) {
      throw new GiteaError(`Gitea returned ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status);
    }
    if (response.status >= 400) {
      throw new GiteaError(`Gitea rejected request (${response.status}): ${(await response.text()).slice(0, 300)}`, response.status);
    }
  }

  private async labelIds(): Promise<Map<string, number>> {
    if (this.labelIdCache === null) {
      const resp = await this.request('GET', '/labels');
      const raw = (await resp.json()) as RawGiteaLabel[];
      this.labelIdCache = new Map(raw.map((label) => [label.name, label.id]));
    }
    return this.labelIdCache;
  }

  /**
   * Create any of `names` that don't already exist in the repo, and return
   * the full set's label ids. Idempotent — safe to call every startup/seed
   * run.
   */
  async ensureLabels(names: readonly string[]): Promise<number[]> {
    const ids = await this.labelIds();
    const missing = names.filter((name) => !ids.has(name));
    for (const name of missing) {
      const resp = await this.request('POST', '/labels', {
        name,
        color: LABEL_COLORS[name] ?? DEFAULT_LABEL_COLOR,
      });
      const created = (await resp.json()) as RawGiteaLabel;
      ids.set(created.name, created.id);
    }
    return names.map((name) => {
      const id = ids.get(name);
      if (id === undefined) {
        throw new GiteaError(`Label "${name}" was neither found nor created`);
      }
      return id;
    });
  }

  async createIssue(title: string, body: string, labels: readonly string[]): Promise<number> {
    const labelIds = labels.length > 0 ? await this.ensureLabels(labels) : [];
    const resp = await this.request('POST', '/issues', { title, body, labels: labelIds });
    const created = (await resp.json()) as RawGiteaIssue;
    return created.number;
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    await this.request('POST', `/issues/${issueNumber}/comments`, { body });
  }

  async listOpenIssues(): Promise<GiteaIssue[]> {
    const issues: GiteaIssue[] = [];
    let page = 1;
    for (;;) {
      const resp = await this.request(
        'GET',
        `/issues?state=open&type=issues&page=${page}&limit=${PAGE_SIZE}`,
      );
      const batch = (await resp.json()) as RawGiteaIssue[];
      if (batch.length === 0) break;
      issues.push(...batch.map(fromRawIssue));
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
    return issues;
  }

  async findIssueByTitle(title: string): Promise<GiteaIssue | null> {
    const resp = await this.request(
      'GET',
      `/issues?state=all&type=issues&q=${encodeURIComponent(title)}`,
    );
    const raw = (await resp.json()) as RawGiteaIssue[];
    const match = raw.find((issue) => issue.title === title);
    return match ? fromRawIssue(match) : null;
  }
}

function fromRawIssue(raw: RawGiteaIssue): GiteaIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    labels: (raw.labels ?? []).map((label) => label.name),
    state: raw.state ?? 'open',
  };
}
