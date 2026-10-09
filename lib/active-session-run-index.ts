import { RunModel } from "@/models/run";

const key = { sessionId: 1, active: 1 } as const;
const options = { unique: true, partialFilterExpression: { active: true } } as const;

/** Make the database constraint ready before accepting a WorkOS continuation. */
export async function ensureActiveSessionRunIndex(): Promise<boolean> {
  try {
    // Idempotent when already present; fails if legacy duplicate active Runs
    // prevent installation. Do not cache success across requests so a dropped
    // index cannot leave this process silently accepting unguarded traffic.
    await RunModel.collection.createIndex(key, options);
    const indexes = await RunModel.collection.listIndexes().toArray();
    return indexes.some(index =>
      index.key?.sessionId === 1 && index.key?.active === 1 &&
      Object.keys(index.key).length === 2 && index.unique === true &&
      index.partialFilterExpression?.active === true &&
      Object.keys(index.partialFilterExpression).length === 1,
    );
  } catch {
    return false;
  }
}
