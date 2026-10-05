import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
const app = new Hono();

const LEDGER_KEY = "grocery-ledger:state";
const OCR_PROMPT =
  "This is a grocery or store receipt. Find the final grand total amount paid. " +
  'Respond only with JSON: {"amount": <number or null>, "confidence": <number from 0 to 1>}. ' +
  "Use null and 0 confidence if the total cannot be determined.";

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-3d31521b/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/make-server-3d31521b/ledger", async (c) => {
  try {
    const state = await kv.get(LEDGER_KEY);
    return c.json({ state: state ?? null });
  } catch (error) {
    console.error("Ledger load failed", error);
    return c.json({ error: "Could not load the ledger." }, 500);
  }
});

app.put("/make-server-3d31521b/ledger", async (c) => {
  try {
    const body = await c.req.json();
    if (!Array.isArray(body?.cycles) || !Array.isArray(body?.entries) || typeof body?.activeId !== "number") {
      return c.json({ error: "Invalid ledger state." }, 400);
    }
    if (body.cycles.length > 100 || body.entries.length > 10000) {
      return c.json({ error: "Ledger state is too large." }, 413);
    }
    await kv.set(LEDGER_KEY, {
      cycles: body.cycles,
      entries: body.entries,
      activeId: body.activeId,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true });
  } catch (error) {
    console.error("Ledger save failed", error);
    return c.json({ error: "Could not save the ledger." }, 500);
  }
});

app.post("/make-server-3d31521b/ocr", async (c) => {
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return c.json({ error: "Receipt scanning is not configured." }, 503);
    }

    const body = await c.req.json();
    const imageBase64 = String(body?.imageBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
    const mimeType = String(body?.mimeType ?? "image/jpeg");
    if (!imageBase64 || !mimeType.startsWith("image/")) {
      return c.json({ error: "A valid receipt image is required." }, 400);
    }
    if (imageBase64.length > 12_000_000) {
      return c.json({ error: "Receipt image is too large." }, 413);
    }

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: OCR_PROMPT },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
          },
        }),
      },
    );

    if (!response.ok) {
      console.error("Gemini request failed", response.status);
      return c.json({ error: "Could not read this receipt. Enter the total manually." }, 502);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      const parsed = JSON.parse(text ?? "{}");
      return c.json({
        amount: typeof parsed.amount === "number" ? parsed.amount : null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      });
    } catch {
      return c.json({ amount: null, confidence: 0 });
    }
  } catch (error) {
    console.error("Receipt OCR failed", error);
    return c.json({ error: "Could not read this receipt. Enter the total manually." }, 500);
  }
});

Deno.serve(app.fetch);
