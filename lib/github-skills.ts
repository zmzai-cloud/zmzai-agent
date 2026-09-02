import { basename } from "node:path";

/** Public GitHub-only importer. It never fetches a caller-provided host: the
 * repository name is validated, then every network target is constructed by us. */
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_HEADERS = { accept: "application/vnd.github+json", "user-agent": "zmzai-agent" };

async function githubJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body) throw new Error("GitHub 响应为空");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new Error("GitHub 响应超过安全大小限制");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("GitHub 响应超过安全大小限制");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("GitHub 返回了无法解析的响应"); }
}

export type ImportedGithubSkill = {
  repository: string;
  requestedRef: string;
  commitSha: string;
  path: string;
  name: string;
  description: string;
  markdown: string;
};

export function normalizeGithubSkillInput(input: { repository: string; ref?: string; path: string }): { repository: string; ref: string; path: string } | null {
  const repository = input.repository.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "");
  const ref = (input.ref?.trim() || "main");
  const path = input.path.trim().replace(/^\/+|\/+$/g, "");
  if (!REPOSITORY_RE.test(repository) || !ref || ref.length > 256 || !path || path.length > 500 || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
  return { repository, ref, path: path.endsWith("SKILL.md") ? path.slice(0, -"SKILL.md".length).replace(/\/$/, "") : path };
}

function metadata(markdown: string, path: string): { name: string; description: string } {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const fromKey = (key: string) => new RegExp(`^${key}:\\s*[\\"']?(.+?)[\\"']?\\s*$`, "m").exec(frontmatter)?.[1]?.trim();
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return {
    name: fromKey("name") || heading || basename(path) || "GitHub Skill",
    description: fromKey("description") || "",
  };
}

export async function importGithubSkill(input: { repository: string; ref?: string; path: string }): Promise<ImportedGithubSkill> {
  const parsed = normalizeGithubSkillInput(input);
  if (!parsed) throw new Error("GitHub 仓库、ref 或 Skill 目录格式不正确");
  const commitResponse = await fetch(`https://api.github.com/repos/${parsed.repository}/commits/${encodeURIComponent(parsed.ref)}`, {
    headers: GITHUB_HEADERS,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const commit = await githubJson(commitResponse, 64 * 1024).catch(() => null) as { sha?: unknown; message?: unknown } | null;
  const commitSha = typeof commit?.sha === "string" ? commit.sha : "";
  if (!commitResponse.ok || !/^[0-9a-f]{40}$/.test(commitSha)) throw new Error(typeof commit?.message === "string" ? `无法解析 GitHub ref：${commit.message}` : "无法解析 GitHub ref");
  const skillPath = `${parsed.path ? `${parsed.path}/` : ""}SKILL.md`;
  // Keep content retrieval on api.github.com as well. Raw GitHub is a
  // different origin and is commonly blocked by enterprise egress rules.
  const markdownResponse = await fetch(`https://api.github.com/repos/${parsed.repository}/contents/${skillPath.split("/").map(encodeURIComponent).join("/")}?ref=${commitSha}`, {
    headers: GITHUB_HEADERS,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  // Base64 raises the 256 KiB source cap by roughly one third; bound the wire
  // payload before JSON parsing as well as the decoded markdown below.
  const content = await githubJson(markdownResponse, 512 * 1024).catch(() => null) as { content?: unknown; encoding?: unknown } | null;
  if (!markdownResponse.ok) throw new Error(markdownResponse.status === 404 ? "该目录未找到 SKILL.md" : "无法读取 GitHub Skill");
  if (content?.encoding !== "base64" || typeof content.content !== "string") throw new Error("GitHub 未返回可读取的 SKILL.md 内容");
  const markdown = Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (!markdown.trim() || markdown.length > 256 * 1024) throw new Error("SKILL.md 为空或超过 256 KiB 限制");
  const details = metadata(markdown, parsed.path);
  return { repository: parsed.repository, requestedRef: parsed.ref, commitSha, path: parsed.path, markdown, ...details };
}
