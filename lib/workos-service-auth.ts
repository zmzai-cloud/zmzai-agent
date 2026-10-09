import { timingSafeEqual } from "node:crypto";
import { isValidObjectId } from "mongoose";
import { getServerEnvironment } from "@/config/env";

function secretMatches(input: string | null, expected: string | undefined): boolean {
  if (!input || !expected) return false;
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Only trusted WorkOS server calls may supply the authenticated user's scope. */
export function isWorkosServiceAuthorized(request: Request): boolean {
  const environment = getServerEnvironment();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-workos-service-secret");
  return secretMatches(supplied, environment.WORKOS_SERVICE_SECRET_CURRENT) || secretMatches(supplied, environment.WORKOS_SERVICE_SECRET_PREVIOUS);
}

export function isWorkosUserId(value: string): boolean {
  return isValidObjectId(value);
}
