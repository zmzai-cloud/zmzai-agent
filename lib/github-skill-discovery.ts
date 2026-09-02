import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getServerEnvironment } from "@/config/env";
import { type ImportedGithubSkill, importGithubSkill } from "@/lib/github-skills";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 10 * 60 * 1_000;

export type TrustedSkill = {
  id: string;
  publisher: string;
  repository: string;
  ref: string;
  path: string;
  name: string;
  description: string;
};

/** Code-reviewed, public upstream sources.  A catalog card is only a shortcut:
 * every item still gets fetched and reviewed at its exact Git commit. */
export const TRUSTED_SKILLS: readonly TrustedSkill[] = [
  { id: "openai-pdf", publisher: "OpenAI", repository: "openai/skills", ref: "main", path: "skills/.curated/pdf", name: "PDF", description: "Read, create, inspect and verify PDF documents." },
  { id: "openai-openai-docs", publisher: "OpenAI", repository: "openai/skills", ref: "main", path: "skills/.curated/openai-docs", name: "OpenAI docs", description: "Find and use official OpenAI product documentation." },
  { id: "openai-security", publisher: "OpenAI", repository: "openai/skills", ref: "main", path: "skills/.curated/security-best-practices", name: "Security best practices", description: "Apply security practices during software work." },
  { id: "anthropic-docx", publisher: "Anthropic", repository: "anthropics/skills", ref: "main", path: "skills/docx", name: "DOCX", description: "Create and edit Word documents." },
  { id: "anthropic-pdf", publisher: "Anthropic", repository: "anthropics/skills", ref: "main", path: "skills/pdf", name: "PDF", description: "Create, edit, and inspect PDF documents." },
  { id: "anthropic-frontend", publisher: "Anthropic", repository: "anthropics/skills", ref: "main", path: "skills/frontend-design", name: "Frontend design", description: "Design and implement frontend interfaces." },
];

type ReviewPayload = { v: number; uid: string; wid: string; repository: string; ref: string; path: string; sha: string; digest: string; exp: number };

function digest(markdown: string): string { return createHash("sha256").update(markdown, "utf8").digest("hex"); }
function sign(encoded: string): string { return createHmac("sha256", getServerEnvironment().AUTH_SECRET).update(encoded).digest("base64url"); }

export function listTrustedSkills(query = ""): TrustedSkill[] {
  const term = query.trim().toLocaleLowerCase();
  return !term ? [...TRUSTED_SKILLS] : TRUSTED_SKILLS.filter((item) => `${item.name} ${item.description} ${item.publisher} ${item.repository}`.toLocaleLowerCase().includes(term));
}

export async function previewGithubSkill(input: { userId: string; workspaceId: string; repository: string; ref?: string; path: string }): Promise<{ skill: ImportedGithubSkill; reviewToken: string; expiresAt: string }> {
  const skill = await importGithubSkill(input);
  const payload: ReviewPayload = { v: TOKEN_VERSION, uid: input.userId, wid: input.workspaceId, repository: skill.repository, ref: skill.requestedRef, path: skill.path, sha: skill.commitSha, digest: digest(skill.markdown), exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { skill, reviewToken: `${encoded}.${sign(encoded)}`, expiresAt: new Date(payload.exp).toISOString() };
}

export function reviewedGithubSkill(input: { userId: string; workspaceId: string; reviewToken: string; markdown: string }): ImportedGithubSkill {
  const [encoded, signature, ...extra] = input.reviewToken.split(".");
  if (!encoded || !signature || extra.length) throw new Error("Skill 预览凭证无效或已过期");
  const expected = Buffer.from(sign(encoded));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("Skill 预览凭证无效或已过期");
  let payload: ReviewPayload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ReviewPayload; }
  catch { throw new Error("Skill 预览凭证无效或已过期"); }
  if (payload.v !== TOKEN_VERSION || payload.uid !== input.userId || payload.wid !== input.workspaceId || payload.exp < Date.now() || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(payload.repository) || !/^[0-9a-f]{40}$/.test(payload.sha) || !/^[0-9a-f]{64}$/.test(payload.digest) || !payload.ref || !payload.path) throw new Error("Skill 预览凭证无效或已过期");
  if (!input.markdown.trim() || input.markdown.length > 256 * 1024 || digest(input.markdown) !== payload.digest) throw new Error("Skill 内容与已预览版本不一致，请重新预览");
  // The preview response is intentionally the only source for name/description;
  // rederive conservative metadata only through the persisted markdown view.
  const heading = /^#\s+(.+)$/m.exec(input.markdown)?.[1]?.trim() || payload.path.split("/").at(-1) || "GitHub Skill";
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(input.markdown)?.[1] ?? "";
  const fromKey = (key: string) => new RegExp(`^${key}:\\s*[\\\"']?(.+?)[\\\"']?\\s*$`, "m").exec(frontmatter)?.[1]?.trim();
  return { repository: payload.repository, requestedRef: payload.ref, commitSha: payload.sha, path: payload.path, name: fromKey("name") || heading, description: fromKey("description") || "", markdown: input.markdown };
}
