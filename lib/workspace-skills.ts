import { createHash, randomUUID } from "node:crypto";

import { type ImportedGithubSkill, importGithubSkill } from "@/lib/github-skills";
import { WorkspaceModel } from "@/models/workspace";
import { WorkspaceSkillModel } from "@/models/workspace-skill";

export type WorkspaceSkillSummary = {
  id: string;
  name: string;
  description: string;
  repository: string;
  requestedRef: string;
  commitSha: string;
  path: string;
  createdAt: string;
};

function summary(record: { skillId: string; name: string; description: string; repository: string; requestedRef: string; commitSha: string; path: string; createdAt: Date }): WorkspaceSkillSummary {
  return { id: record.skillId, name: record.name, description: record.description, repository: record.repository, requestedRef: record.requestedRef, commitSha: record.commitSha, path: record.path, createdAt: record.createdAt.toISOString() };
}

export async function listWorkspaceSkills(input: { userId: string; workspaceId: string }): Promise<WorkspaceSkillSummary[]> {
  const records = await WorkspaceSkillModel.find({ userId: input.userId, workspaceId: input.workspaceId }).sort({ createdAt: -1 }).lean();
  return records.map(summary);
}

/** Resolve only workspace-owned immutable copies. Agent versions retain the
 * IDs; this lookup supplies their pinned markdown at execution time. */
export async function getWorkspaceSkillsByIds(input: { userId: string; workspaceId: string; skillIds: string[] }): Promise<Array<{ skillId: string; name: string; markdown: string }>> {
  const ids = [...new Set(input.skillIds)];
  if (!ids.length) return [];
  const records = await WorkspaceSkillModel.find({
    userId: input.userId,
    workspaceId: input.workspaceId,
    skillId: { $in: ids },
  }).lean();
  const byId = new Map(records.map((record) => [record.skillId, record]));
  return ids.flatMap((id) => {
    const record = byId.get(id);
    return record ? [{ skillId: record.skillId, name: record.name, markdown: record.markdown }] : [];
  });
}

export async function workspaceOwnsSkillIds(input: { userId: string; workspaceId: string; skillIds: string[] }): Promise<boolean> {
  const ids = [...new Set(input.skillIds)];
  if (ids.length !== input.skillIds.length) return false;
  return (await getWorkspaceSkillsByIds(input)).length === ids.length;
}

export async function addGithubWorkspaceSkill(input: { userId: string; workspaceId: string; repository: string; ref?: string; path: string }): Promise<{ skill: WorkspaceSkillSummary; reused: boolean }> {
  const imported = await importGithubSkill(input);
  return addImportedGithubWorkspaceSkill({ userId: input.userId, workspaceId: input.workspaceId, imported });
}

/** Persist an already reviewed immutable GitHub revision.  Discovery preview
 * verifies the immutable source; this function deliberately never fetches. */
export async function addImportedGithubWorkspaceSkill(input: { userId: string; workspaceId: string; imported: ImportedGithubSkill }): Promise<{ skill: WorkspaceSkillSummary; reused: boolean }> {
  const { imported } = input;
  const existing = await WorkspaceSkillModel.findOne({ workspaceId: input.workspaceId, repository: imported.repository, commitSha: imported.commitSha, path: imported.path }).lean();
  if (existing) return { skill: summary(existing), reused: true };
  const skill = await WorkspaceSkillModel.create({ skillId: `skl_${randomUUID()}`, userId: input.userId, workspaceId: input.workspaceId, ...imported });
  return { skill: summary(skill), reused: false };
}

/** Refresh a GitHub-sourced skill to the latest version from the source
 *  repository. Atomically replaces the old skill record: create new →
 *  update all workspace skillIds references → delete old. */
export async function refreshGithubSkill(input: { userId: string; workspaceId: string; skillId: string }): Promise<{ updated: boolean; oldSha: string; newSha: string; skill: WorkspaceSkillSummary | null }> {
  const old = await WorkspaceSkillModel.findOne({ skillId: input.skillId, workspaceId: input.workspaceId, userId: input.userId }).lean();
  if (!old || old.repository === "zmzai/task") return { updated: false, oldSha: "", newSha: "", skill: null };
  const imported = await importGithubSkill({ repository: old.repository, ref: old.requestedRef, path: old.path });
  if (imported.commitSha === old.commitSha) return { updated: false, oldSha: old.commitSha, newSha: imported.commitSha, skill: null };
  const newSkill = await WorkspaceSkillModel.create({
    skillId: `skl_${randomUUID()}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: imported.name,
    description: imported.description,
    repository: imported.repository,
    requestedRef: imported.requestedRef,
    commitSha: imported.commitSha,
    path: imported.path,
    markdown: imported.markdown,
  });
  // Replace old skillId with new skillId in every workspace that references it.
  const workspaces = await WorkspaceModel.find({ userId: input.userId, skillIds: old.skillId }).select({ workspaceId: 1, skillIds: 1 }).lean();
  for (const workspace of workspaces) {
    await WorkspaceModel.updateOne(
      { userId: input.userId, workspaceId: workspace.workspaceId },
      { $set: { skillIds: workspace.skillIds.map((id: string) => id === old.skillId ? newSkill.skillId : id) } },
    );
  }
  await WorkspaceSkillModel.deleteOne({ _id: old._id });
  return { updated: true, oldSha: old.commitSha, newSha: newSkill.commitSha, skill: summary(newSkill) };
}

/** Save a successful task as a pinned local skill. Local skills use a content
 * hash as their immutable version boundary, matching imported GitHub skills. */
export async function addTaskWorkspaceSkill(input: { userId: string; workspaceId: string; taskId: string; name: string; description: string; markdown: string }): Promise<{ skill: WorkspaceSkillSummary; reused: boolean }> {
  const markdown = input.markdown.trim();
  const commitSha = createHash("sha256").update(markdown).digest("hex").slice(0, 40);
  const repository = "zmzai/task";
  const path = `tasks/${input.taskId}.md`;
  const existing = await WorkspaceSkillModel.findOne({ workspaceId: input.workspaceId, repository, commitSha, path }).lean();
  if (existing) return { skill: summary(existing), reused: true };
  const skill = await WorkspaceSkillModel.create({
    skillId: `skl_${randomUUID()}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description,
    repository,
    requestedRef: input.taskId,
    commitSha,
    path,
    markdown,
  });
  return { skill: summary(skill), reused: false };
}
