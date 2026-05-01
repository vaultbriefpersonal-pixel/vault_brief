export interface GitHubActivity {
  githubCommitsCount: number;
  githubPrsMerged: number;
  githubContributorsActive: number;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
}

interface GitHubCommit {
  sha: string;
  commit: { author: { name: string; email: string; date: string } };
  author?: { login: string } | null;
}

interface GitHubPR {
  id: number;
  merged_at: string | null;
  state: string;
}

async function githubFetch<T>(
  path: string,
  token?: string | null
): Promise<T[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "VaultBrief/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let page = 1;
  const all: T[] = [];

  while (true) {
    const url = `https://api.github.com${path}${
      path.includes("?") ? "&" : "?"
    }per_page=100&page=${page}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 404 || res.status === 401) break;
      throw new Error(`GitHub API ${res.status}: ${path}`);
    }

    const data: T[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return all;
}

export async function fetchGitHubActivity(
  org: string,
  token?: string | null,
  period?: { start: Date; end: Date }
): Promise<GitHubActivity> {
  const repos = await githubFetch<GitHubRepo>(`/orgs/${org}/repos`, token);

  const sinceParam = period
    ? `&since=${period.start.toISOString()}`
    : "";

  let totalCommits = 0;
  let totalPRsMerged = 0;
  const activeContributors = new Set<string>();

  await Promise.all(
    repos.map(async (repo) => {
      const [commits, prs] = await Promise.all([
        githubFetch<GitHubCommit>(
          `/repos/${org}/${repo.name}/commits?since=${
            period?.start.toISOString() ?? new Date(Date.now() - 30 * 86400_000).toISOString()
          }&until=${period?.end.toISOString() ?? new Date().toISOString()}`,
          token
        ).catch(() => [] as GitHubCommit[]),
        githubFetch<GitHubPR>(
          `/repos/${org}/${repo.name}/pulls?state=closed&sort=updated${sinceParam}`,
          token
        ).catch(() => [] as GitHubPR[]),
      ]);

      totalCommits += commits.length;

      const periodEnd = period?.end ?? new Date();
      const periodStart = period?.start ?? new Date(Date.now() - 30 * 86400_000);

      for (const pr of prs) {
        if (pr.merged_at) {
          const mergedAt = new Date(pr.merged_at);
          if (mergedAt >= periodStart && mergedAt <= periodEnd) {
            totalPRsMerged++;
          }
        }
      }

      for (const commit of commits) {
        const author = commit.author?.login ?? commit.commit.author.email;
        activeContributors.add(author);
      }
    })
  );

  return {
    githubCommitsCount: totalCommits,
    githubPrsMerged: totalPRsMerged,
    githubContributorsActive: activeContributors.size,
  };
}
