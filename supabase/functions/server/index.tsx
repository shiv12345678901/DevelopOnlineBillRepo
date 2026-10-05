import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";

const app = new Hono();
const CYCLE_PREFIX = "grocery-ledger:v2:cycle:";
const ENTRY_PREFIX = "grocery-ledger:v2:entry:";
const META_KEY = "grocery-ledger:v2:meta";
const RECEIPT_BUCKET = "grocery-receipts";
const OCR_PROMPT =
  "Read this Australian grocery or store receipt. Find the merchant and final grand total paid. " +
  'Respond only with JSON: {"merchant": <string>, "amount": <number or null>, "confidence": <0 to 1>}. ' +
  "Use an empty merchant, null amount, and 0 confidence when uncertain.";

const database = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function ensureReceiptBucket() {
  const client = database();
  const { data } = await client.storage.getBucket(RECEIPT_BUCKET);
  if (!data) {
    const { error } = await client.storage.createBucket(RECEIPT_BUCKET, {
      public: false,
      fileSizeLimit: 8_000_000,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (error && !error.message.toLowerCase().includes("already exists")) throw error;
  }
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/^data:[^;]+;base64,/, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

app.get("/make-server-3d31521b/health", (c) => c.json({ status: "ok" }));

app.get("/make-server-3d31521b/ledger", async (c) => {
  try {
    const [cycles, entries, meta] = await Promise.all([
      kv.getByPrefix(CYCLE_PREFIX),
      kv.getByPrefix(ENTRY_PREFIX),
      kv.get(META_KEY),
    ]);
    cycles.sort((a, b) => String(b.startsOn).localeCompare(String(a.startsOn)));
    entries.sort((a, b) =>
      String(b.spentOn).localeCompare(String(a.spentOn)) ||
      String(b.createdAt).localeCompare(String(a.createdAt))
    );

    const paths = entries.map((entry) => entry.receiptPath).filter(Boolean);
    if (paths.length) {
      const { data } = await database().storage.from(RECEIPT_BUCKET).createSignedUrls(paths, 3600);
      const urls = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
      entries.forEach((entry) => {
        if (entry.receiptPath) entry.receiptUrl = urls.get(entry.receiptPath) ?? null;
      });
    }

    const requested = typeof meta?.activeId === "string" ? meta.activeId : null;
    const activeId = cycles.some((cycle) => cycle.id === requested)
      ? requested
      : cycles.find((cycle) => !cycle.endsOn)?.id ?? cycles[0]?.id ?? null;
    return c.json({ cycles, entries, activeId });
  } catch (error) {
    console.error("Ledger load failed", error);
    return c.json({ error: "Could not load the ledger." }, 500);
  }
});

app.post("/make-server-3d31521b/cycles", async (c) => {
  try {
    const body = await c.req.json();
    const name = String(body?.name ?? "").trim();
    const members = Array.isArray(body?.members)
      ? body.members.map((member) => String(member).trim()).filter(Boolean)
      : [];
    const startsOn = String(body?.startsOn ?? "");
    if (!name || !members.length || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
      return c.json({ error: "A name, members, and valid start date are required." }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const cycle = {
      id,
      name: name.slice(0, 120),
      members: [...new Set(members)].slice(0, 30),
      startsOn,
      endsOn: null,
      createdAt: now,
      updatedAt: now,
    };
    await Promise.all([
      kv.set(`${CYCLE_PREFIX}${id}`, cycle),
      kv.set(META_KEY, { activeId: id, updatedAt: now }),
    ]);
    return c.json({ cycle }, 201);
  } catch (error) {
    console.error("Cycle create failed", error);
    return c.json({ error: "Could not create the cycle." }, 500);
  }
});

app.patch("/make-server-3d31521b/cycles/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const existing = await kv.get(`${CYCLE_PREFIX}${id}`);
    if (!existing) return c.json({ error: "Cycle not found." }, 404);
    const body = await c.req.json();
    const cycle = {
      ...existing,
      ...("endsOn" in body && (body.endsOn === null || /^\d{4}-\d{2}-\d{2}$/.test(String(body.endsOn)))
        ? { endsOn: body.endsOn }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`${CYCLE_PREFIX}${id}`, cycle);
    return c.json({ cycle });
  } catch (error) {
    console.error("Cycle update failed", error);
    return c.json({ error: "Could not update the cycle." }, 500);
  }
});

app.put("/make-server-3d31521b/ledger/active", async (c) => {
  try {
    const body = await c.req.json();
    const activeId = body?.activeId === null ? null : String(body?.activeId ?? "");
    if (activeId && !(await kv.get(`${CYCLE_PREFIX}${activeId}`))) {
      return c.json({ error: "Cycle not found." }, 404);
    }
    await kv.set(META_KEY, { activeId, updatedAt: new Date().toISOString() });
    return c.json({ ok: true });
  } catch (error) {
    console.error("Active cycle update failed", error);
    return c.json({ error: "Could not select the cycle." }, 500);
  }
});

app.post("/make-server-3d31521b/entries", async (c) => {
  try {
    const body = await c.req.json();
    if (!Array.isArray(body?.entries) || !body.entries.length || body.entries.length > 20) {
      return c.json({ error: "Provide between 1 and 20 entries." }, 400);
    }
    await ensureReceiptBucket();
    const createdAt = new Date().toISOString();
    const entries = [];
    for (const input of body.entries) {
      const cycleId = String(input?.cycleId ?? "");
      const payer = String(input?.payer ?? "").trim();
      const amount = Number(input?.amount);
      const spentOn = String(input?.spentOn ?? "");
      if (!cycleId || !payer || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
        return c.json({ error: "Each entry needs a cycle, payer, positive amount, and valid date." }, 400);
      }
      if (!(await kv.get(`${CYCLE_PREFIX}${cycleId}`))) {
        return c.json({ error: "The selected cycle no longer exists." }, 409);
      }

      const id = crypto.randomUUID();
      let receiptPath: string | null = null;
      const receiptImageBase64 = String(input?.receiptImageBase64 ?? "");
      if (receiptImageBase64) {
        const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(String(input?.receiptMimeType))
          ? String(input.receiptMimeType)
          : "image/jpeg";
        receiptPath = `${cycleId}/${id}.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`;
        const { error } = await database().storage.from(RECEIPT_BUCKET).upload(
          receiptPath,
          decodeBase64(receiptImageBase64),
          { contentType: mimeType, upsert: false },
        );
        if (error) throw error;
      }

      entries.push({
        id,
        cycleId,
        payer: payer.slice(0, 80),
        amount: Math.round(amount * 100) / 100,
        merchant: String(input?.merchant ?? "").trim().slice(0, 160),
        note: String(input?.note ?? "").trim().slice(0, 300),
        spentOn,
        confidence: Math.min(1, Math.max(0, Number(input?.confidence) || 0)),
        receiptPath,
        createdAt,
      });
    }
    await kv.mset(entries.map((entry) => `${ENTRY_PREFIX}${entry.id}`), entries);
    const signed = await Promise.all(entries.map(async (entry) => {
      if (!entry.receiptPath) return entry;
      const { data } = await database().storage.from(RECEIPT_BUCKET).createSignedUrl(entry.receiptPath, 3600);
      return { ...entry, receiptUrl: data?.signedUrl ?? null };
    }));
    return c.json({ entries: signed }, 201);
  } catch (error) {
    console.error("Entry create failed", error);
    return c.json({ error: "Could not save the receipt and expense." }, 500);
  }
});

app.delete("/make-server-3d31521b/entries/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const entry = await kv.get(`${ENTRY_PREFIX}${id}`);
    if (entry?.receiptPath) await database().storage.from(RECEIPT_BUCKET).remove([entry.receiptPath]);
    await kv.del(`${ENTRY_PREFIX}${id}`);
    return c.json({ ok: true });
  } catch (error) {
    console.error("Entry delete failed", error);
    return c.json({ error: "Could not delete the entry." }, 500);
  }
});

app.post("/make-server-3d31521b/ocr", async (c) => {
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return c.json({ error: "Receipt scanning is not configured." }, 503);
    const body = await c.req.json();
    const imageBase64 = String(body?.imageBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
    const mimeType = String(body?.mimeType ?? "image/jpeg");
    if (!imageBase64 || !mimeType.startsWith("image/")) {
      return c.json({ error: "A valid receipt image is required." }, 400);
    }
    if (imageBase64.length > 12_000_000) return c.json({ error: "Receipt image is too large." }, 413);

    const configuredModel = Deno.env.get("GEMINI_MODEL");
    const models = configuredModel ? [configuredModel] : ["gemini-2.5-flash", "gemini-2.0-flash"];
    for (const model of models) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: OCR_PROMPT },
              { inlineData: { mimeType, data: imageBase64 } },
            ] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
      );
      if (!response.ok) {
        console.error("Gemini request failed", model, response.status);
        if ([404, 429, 500, 503].includes(response.status) && model !== models.at(-1)) continue;
        return c.json({ error: `Receipt recognition failed (${response.status}).` }, 502);
      }
      const result = await response.json();
      const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      try {
        const parsed = JSON.parse(String(raw).replace(/^```json\s*|\s*```$/g, ""));
        return c.json({
          amount: typeof parsed.amount === "number" ? parsed.amount : null,
          merchant: typeof parsed.merchant === "string" ? parsed.merchant.trim().slice(0, 160) : "",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        });
      } catch {
        return c.json({ amount: null, merchant: "", confidence: 0 });
      }
    }
    return c.json({ error: "No receipt recognition model is available." }, 502);
  } catch (error) {
    console.error("Receipt OCR failed", error);
    return c.json({ error: "Could not read this receipt. Enter the details manually." }, 500);
  }
});

Deno.serve(app.fetch);
