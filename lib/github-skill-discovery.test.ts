import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importer = vi.hoisted(() => ({ importGithubSkill: vi.fn() }));
vi.mock("@/lib/github-skills", () => importer);

import { resetServerEnvironmentForTest } from "@/config/env";
import { listTrustedSkills, previewGithubSkill, reviewedGithubSkill } from "@/lib/github-skill-discovery";

const originalEnvironment = { ...process.env };
const skill = {
  repository: "openai/skills", requestedRef: "main", commitSha: "a".repeat(40), path: "skills/pdf",
  name: "PDF", description: "PDF work", markdown: "---\nname: PDF\ndescription: PDF work\n---\n# PDF\n",
};

beforeEach(() => {
  process.env.AUTH_SECRET = "a".repeat(64);
  process.env.MONGODB_URI = "mongodb://example.test/agent";
  resetServerEnvironmentForTest();
  importer.importGithubSkill.mockResolvedValue(skill);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
  resetServerEnvironmentForTest();
});

describe("GitHub skill discovery", () => {
  it("filters the server-owned trusted catalog without contacting GitHub", () => {
    expect(listTrustedSkills("anthropic")).toEqual(expect.arrayContaining([expect.objectContaining({ publisher: "Anthropic" })]));
    expect(listTrustedSkills("no-such-skill")).toEqual([]);
    expect(importer.importGithubSkill).not.toHaveBeenCalled();
  });

  it("imports exactly reviewed content only for the same user and workspace", async () => {
    const preview = await previewGithubSkill({ userId: "user_1", workspaceId: "ws_1", repository: "openai/skills", path: "skills/pdf" });
    expect(reviewedGithubSkill({ userId: "user_1", workspaceId: "ws_1", reviewToken: preview.reviewToken, markdown: skill.markdown })).toMatchObject(skill);
    expect(() => reviewedGithubSkill({ userId: "user_2", workspaceId: "ws_1", reviewToken: preview.reviewToken, markdown: skill.markdown })).toThrow("预览凭证");
    expect(() => reviewedGithubSkill({ userId: "user_1", workspaceId: "ws_1", reviewToken: preview.reviewToken, markdown: "# different" })).toThrow("内容与已预览版本不一致");
  });

  it("rejects expired preview tokens", async () => {
    vi.useFakeTimers();
    const preview = await previewGithubSkill({ userId: "user_1", workspaceId: "ws_1", repository: "openai/skills", path: "skills/pdf" });
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    expect(() => reviewedGithubSkill({ userId: "user_1", workspaceId: "ws_1", reviewToken: preview.reviewToken, markdown: skill.markdown })).toThrow("预览凭证");
    vi.useRealTimers();
  });
});
