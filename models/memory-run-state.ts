import { model, models, Schema, type InferSchemaType, type Model } from "mongoose";

const hitSchema = new Schema(
  { memoryId: { type: String }, text: { type: String, required: true, maxlength: 240 } },
  { _id: false, strict: "throw" },
);

const memoryRunStateSchema = new Schema(
  {
    runId: { type: String, required: true, unique: true, immutable: true },
    sessionId: { type: String, required: true, immutable: true },
    bankId: { type: String, required: true, immutable: true },
    recall: {
      status: { type: String, required: true, enum: ["pending", "hit", "empty", "unavailable", "disabled"], default: "pending" },
      hits: { type: [hitSchema], default: [] },
      usedHitCount: { type: Number, min: 0, default: 0 },
      observedAt: { type: Date, default: null },
    },
    retention: {
      status: { type: String, required: true, enum: ["not_started", "pending", "succeeded", "skipped", "failed", "unknown", "disabled"], default: "not_started" },
      updatedAt: { type: Date, default: null },
    },
  },
  { strict: "throw", timestamps: false },
);

memoryRunStateSchema.index({ sessionId: 1, runId: 1 });

export type MemoryRunStateRecord = InferSchemaType<typeof memoryRunStateSchema>;
export const MemoryRunStateModel =
  (models.ZmzaiMemoryRunState as Model<MemoryRunStateRecord> | undefined) ??
  model<MemoryRunStateRecord>("ZmzaiMemoryRunState", memoryRunStateSchema);
