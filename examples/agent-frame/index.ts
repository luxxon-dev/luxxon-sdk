// Minimal SDK demo: open the latest decoded frame from a LIVE
// session and write it to disk. Run after you've created a session
// via the REST API (or your own SDK build) and the operator has
// started publishing.
//
//   LUXXON_API_KEY=lxxn_test_... \
//     SESSION_ID=b1e2f3a4-... \
//     node --experimental-strip-types ./index.ts
//
// The MCP server next door does the same thing one step removed:
// when an agent calls the `get_frame` tool, it ends up here.

import { Luxxon } from "@luxxon/sdk";
import { writeFile } from "node:fs/promises";

const apiKey = process.env.LUXXON_API_KEY;
const sessionId = process.env.SESSION_ID;
if (!apiKey || !sessionId) {
  console.error(
    "Set LUXXON_API_KEY + SESSION_ID. The session must be LIVE and an operator must be publishing.",
  );
  process.exit(1);
}

const lx = new Luxxon({ apiKey });

// Poll until the first keyframe lands. ~3-5s on a healthy session.
const start = Date.now();
const deadline = start + 30_000;
let frame: { bytes: Uint8Array; contentType: string } | null = null;
while (!frame && Date.now() < deadline) {
  try {
    frame = await lx.sessions.frame(sessionId);
  } catch (err) {
    if ((err as { code?: string }).code !== "FRAME_NOT_AVAILABLE") throw err;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
if (!frame) {
  console.error("Timed out waiting for the first frame after 30s.");
  process.exit(2);
}

const out = `frame-${sessionId.slice(0, 8)}-${Date.now()}.jpg`;
await writeFile(out, frame.bytes);
console.log(
  `Wrote ${frame.bytes.byteLength} bytes (${frame.contentType}) to ${out} in ${Date.now() - start}ms.`,
);
