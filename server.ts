import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// build/server.js runs from build/, but dist/ is at project root
const DIST_DIR = path.join(import.meta.dirname, "..", "dist");

/** Try to compress with sharp. Returns original on any failure. */
async function tryCompress(base64: string): Promise<string> {
  try {
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(base64, "base64");
    const compressed = await sharp(buf)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return compressed.toString("base64");
  } catch {
    // sharp unavailable or failed — pass through raw image
    return base64;
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Gritt",
    version: "1.0.0",
  });

  const resourceUri = "ui://color-texture-picker/mcp-app.html";

  registerAppTool(
    server,
    "color_texture_picker",
    {
      title: "Gritt",
      description:
        "Opens an interactive color texture picker. Load an image, click or drag to select a region, and instantly see extracted color textures (palette + CSS). Provide a base64-encoded image.",
      inputSchema: {
        image_base64: z
          .string()
          .describe("Base64-encoded image data (PNG, JPG, WebP)"),
      },
      _meta: { ui: { resourceUri } },
    },
    async (args) => {
      try {
        const image = await tryCompress(args.image_base64);
        return {
          content: [
            {
              type: "text",
              text: "Color texture picker opened. Click or drag on the image to select a region and extract color textures.",
            },
          ],
          structuredContent: { image_base64: image },
        };
      } catch (err) {
        // Absolute fallback — never let the tool hang
        return {
          content: [
            {
              type: "text",
              text: `Color texture picker opened (compression skipped: ${err}).`,
            },
          ],
          structuredContent: { image_base64: args.image_base64 },
        };
      }
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
