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
        "Opens an interactive color texture picker. Users can upload or drag an image, click or drag to select a region, and instantly see extracted color textures (palette + CSS gradients, noise, and mesh patterns). Optionally pass an image URL to load it automatically.",
      inputSchema: {
        image_base64: z
          .string()
          .optional()
          .describe("Optional base64-encoded image data to load directly"),
        image_url: z
          .string()
          .optional()
          .describe("Optional URL of an image to load"),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ image_base64, image_url }) => {
      // Pass through base64 directly if provided (e.g. host-injected)
      if (image_base64) {
        return {
          structuredContent: { image_base64 },
          content: [
            {
              type: "text",
              text: "Color texture picker opened with provided image.",
            },
          ],
        };
      }
      // Fetch from URL if provided
      if (image_url) {
        try {
          const resp = await fetch(image_url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = Buffer.from(await resp.arrayBuffer());
          const b64 = buf.toString("base64");
          return {
            structuredContent: { image_base64: b64 },
            content: [
              {
                type: "text",
                text: "Color texture picker opened with provided image.",
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch image: ${err}. Upload an image manually.`,
              },
            ],
          };
        }
      }
      return {
        content: [
          {
            type: "text",
            text: "Color texture picker opened. Upload an image, then click or drag on it to select a region and extract color textures.",
          },
        ],
      };
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
