import { model, models, Schema, type InferSchemaType, type Model } from "mongoose";

const activityKinds = [
  "task_created",
  "task_completed",
  "task_failed",
  "artifact_created",
  "member_joined",
  "automation_run",
] as const;

const projectActivitySchema = new Schema(
  {
    activityId: { type: String, required: true, unique: true, immutable: true },
    projectId: { type: String, required: true, immutable: true, index: true },
    userId: { type: String, required: true, immutable: true },
    kind: { type: String, required: true, enum: activityKinds, immutable: true },
    taskId: { type: String, default: null, immutable: true },
    runId: { type: String, default: null, immutable: true },
    artifactId: { type: String, default: null, immutable: true },
    summary: { type: String, default: "", maxlength: 500 },
  },
  { strict: "throw", timestamps: true },
);

projectActivitySchema.index({ projectId: 1, createdAt: -1 });

export type ProjectActivityRecord = InferSchemaType<typeof projectActivitySchema>;
export const ProjectActivityModel =
  (models.ZmzaiAgentProjectActivity as Model<ProjectActivityRecord> | undefined) ??
  model<ProjectActivityRecord>("ZmzaiAgentProjectActivity", projectActivitySchema);
