/**
 * Remote, read-only MCP endpoint for Rowdy Cup, exposed as a Gen-2 HTTPS
 * Cloud Function. Players point their AI client (Claude.ai / ChatGPT / Claude
 * Code) at this URL to ask about players and stats.
 *
 * Transport: MCP Streamable HTTP in *stateless* mode — a fresh server +
 * transport per request (suits serverless; no cross-instance session state).
 *
 * Auth: a shared key (Functions secret ROWDY_MCP_KEY), passed as `?key=...` or
 * `Authorization: Bearer ...`. This only guards against random traffic running up
 * invocations — the data itself is already public-read.
 *
 * Read-only: the tools read via the unauthenticated Firebase Web SDK; Firestore
 * rules deny all client writes, so this endpoint physically cannot write.
 */
import { onRequest, type Request } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import type { Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const ROWDY_MCP_KEY = defineSecret("ROWDY_MCP_KEY");

/** Pull the shared key from the query string or an Authorization: Bearer header. */
function extractKey(req: Request): string | null {
  const q = req.query?.key;
  if (typeof q === "string" && q) return q;
  if (Array.isArray(q) && typeof q[0] === "string" && q[0]) return q[0];
  const auth = req.get("authorization") || req.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorized(req: Request): boolean {
  const expected = ROWDY_MCP_KEY.value();
  // In the local emulator the secret is often unset; allow access there so the
  // MCP Inspector can connect. Production always has the secret bound.
  if (!expected) return process.env.FUNCTIONS_EMULATOR === "true";
  const provided = extractKey(req);
  return provided !== null && constantTimeEqual(provided, expected);
}

export const mcp = onRequest(
  { secrets: [ROWDY_MCP_KEY], cors: true },
  async (req: Request, res: Response): Promise<void> => {
    if (!authorized(req)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid key." },
        id: null,
      });
      return;
    }

    // Stateless Streamable HTTP only handles POST (JSON-RPC). GET (SSE stream)
    // and DELETE (session teardown) aren't supported without sessions.
    if (req.method !== "POST") {
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed; use POST." },
        id: null,
      });
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("mcp request failed", {
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error." },
          id: null,
        });
      }
    }
  }
);
