import jwt from "jsonwebtoken";
import { MCP_LINE_CONFIRMATION_VERSION } from "./mcp.constants.js";

export type LineMcpConfirmationOperation = "direct_send" | "broadcast";

export interface LineMcpConfirmationClaims {
  v: number;
  op: LineMcpConfirmationOperation;
  tenantId: string;
  agentId: string;
  cliSessionId: string;
  conversationId?: string;
  broadcastId?: string;
  contentType?: string;
  content?: Record<string, unknown>;
}

function signingSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for MCP confirmation tokens");
  return secret;
}

export function createLineMcpConfirmation(claims: Omit<LineMcpConfirmationClaims, "v">): string {
  return jwt.sign(
    { ...claims, v: MCP_LINE_CONFIRMATION_VERSION },
    signingSecret(),
    { expiresIn: "5m" },
  );
}

export function verifyLineMcpConfirmation(
  token: string,
  expected: Pick<LineMcpConfirmationClaims, "op" | "tenantId" | "agentId" | "cliSessionId">,
): LineMcpConfirmationClaims {
  const decoded = jwt.verify(token, signingSecret()) as LineMcpConfirmationClaims;
  if (
    decoded.v !== MCP_LINE_CONFIRMATION_VERSION ||
    decoded.op !== expected.op ||
    decoded.tenantId !== expected.tenantId ||
    decoded.agentId !== expected.agentId ||
    decoded.cliSessionId !== expected.cliSessionId
  ) {
    throw new Error("MCP confirmation token context mismatch");
  }
  return decoded;
}
