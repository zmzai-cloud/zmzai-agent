import { model, models, Schema, type InferSchemaType, type Model } from "mongoose";

const taskShareSchema = new Schema({
  shareId: { type: String, required: true, unique: true, immutable: true },
  taskId: { type: String, required: true, immutable: true, index: true },
  tokenHash: { type: String, required: true, unique: true, immutable: true },
  userId: { type: String, required: true, immutable: true },
  expiresAt: { type: Date, required: true },
}, { strict: "throw", timestamps: true });

taskShareSchema.index({ tokenHash: 1, expiresAt: 1 });
export type TaskShareRecord = InferSchemaType<typeof taskShareSchema>;
export const TaskShareModel =
  (models.ZmzaiTaskShare as Model<TaskShareRecord> | undefined) ??
  model<TaskShareRecord>("ZmzaiTaskShare", taskShareSchema);
