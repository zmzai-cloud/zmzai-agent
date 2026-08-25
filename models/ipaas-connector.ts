import { model, models, Schema, type InferSchemaType, type Model } from "mongoose";

const ipaasConnectorSchema = new Schema(
  {
    connectorId: { type: String, required: true, unique: true, immutable: true },
    workspaceId: { type: String, required: true, immutable: true, index: true },
    platform: { type: String, enum: ["feishu", "email", "webhook"], required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    encryptedCredentials: { type: String, required: true, select: false, immutable: true },
    inboundEnabled: { type: Boolean, required: true, default: false },
    inboundWebhookUrl: { type: String, default: null, maxlength: 500 },
    outboundEnabled: { type: Boolean, required: true, default: false },
    linkedAutomationId: { type: String, default: null },
    status: { type: String, enum: ["active", "paused"], required: true, default: "active" },
    lastActivityAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 2_000 },
  },
  { strict: "throw", timestamps: true },
);

ipaasConnectorSchema.index({ workspaceId: 1, platform: 1 });
ipaasConnectorSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export type IpaasConnectorRecord = InferSchemaType<typeof ipaasConnectorSchema>;
export const IpaasConnectorModel =
  (models.ZmzaiIpaasConnector as Model<IpaasConnectorRecord> | undefined) ??
  model<IpaasConnectorRecord>("ZmzaiIpaasConnector", ipaasConnectorSchema);
