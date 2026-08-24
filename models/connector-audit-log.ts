import { model, models, Schema, type InferSchemaType, type Model } from "mongoose";

const connectorAuditKinds = ["created", "deleted", "tested", "updated"] as const;

const connectorAuditLogSchema = new Schema(
  {
    logId: { type: String, required: true, unique: true, immutable: true },
    connectorId: { type: String, required: true, immutable: true, index: true },
    workspaceId: { type: String, required: true, immutable: true, index: true },
    userId: { type: String, required: true, immutable: true },
    kind: { type: String, required: true, enum: connectorAuditKinds, immutable: true },
    detail: { type: String, default: "", maxlength: 2_000 },
  },
  { strict: "throw", timestamps: true },
);

connectorAuditLogSchema.index({ workspaceId: 1, createdAt: -1 });

export type ConnectorAuditLogRecord = InferSchemaType<typeof connectorAuditLogSchema>;
export const ConnectorAuditLogModel =
  (models.ZmzaiConnectorAuditLog as Model<ConnectorAuditLogRecord> | undefined) ?? model<ConnectorAuditLogRecord>("ZmzaiConnectorAuditLog", connectorAuditLogSchema);
