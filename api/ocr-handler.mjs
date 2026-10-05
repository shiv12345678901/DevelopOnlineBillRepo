/**
 * Shared Gemini receipt-OCR handler, used by:
 *   - the Vite dev server middleware (vite.config.ts)
 *   - the Netlify function (netlify/functions/ocr.mjs)
 * Keys come from the environment (GEMINI_API_KEY or GEMINI_API_KEY_1..N)
 * and rotate automatically on rate limits / transient errors.
 *
 * The model defaults to the "flash-latest" alias rather than a pinned
 * version: pinned names (e.g. gemini-2.5-flash) disappear when Google
 * retires them and every scan starts failing with a 404.
 */

const PROMPT =
  "This is a photo of a grocery/store receipt or a payment screenshot. " +
  "Find the store or merchant name and the final grand total amount paid. " +
  'Respond ONLY with JSON: {"amount": <number>, "merchant": "<store name or empty string>", "confidence": <0-1>}. ' +
  'If you cannot confidently determine a total, respond {"amount": null, "merchant": "", "confidence": 0}. No other text.';

// Free-tier overload (503) and rate limits (429) are transient; a short
// second attempt on the same key usually gets through.
const RETRYABLE = new Set([429, 500, 503]);
const ATTEMPTS_PER_KEY = 2;
const RETRY_DELAY_MS = 900;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function geminiKeys() {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
  ].filter(Boolean);
}

function askGemini(model, key, payload) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: payload },
  );
}

export async function handleOcr({ imageBase64, mimeType }) {
  if (!imageBase64) return { status: 400, body: { error: "imageBase64 is required." } };

  const keys = geminiKeys();
  if (keys.length === 0) {
    return {
      status: 500,
      body: { error: "GEMINI_API_KEY (or GEMINI_API_KEY_1..N) is not configured on the server." },
    };
  }

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  let lastError = "no keys attempted";

  // Walk every key; only a definitive read ends the loop early.
  for (const key of keys) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_KEY; attempt++) {
      let res;
      try {
        res = await askGemini(model, key, payload);
      } catch (error) {
        lastError = `network: ${error instanceof Error ? error.message : "unknown"}`;
        continue;
      }

      if (!res.ok) {
        lastError = `Gemini error ${res.status}`;
        if (RETRYABLE.has(res.status) && attempt < ATTEMPTS_PER_KEY) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break; // this key is done — move to the next one
      }

      const data = await res.json().catch(() => null);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      try {
        const parsed = JSON.parse(text);
        return {
          status: 200,
          body: {
            amount: typeof parsed.amount === "number" ? parsed.amount : null,
            merchant: typeof parsed.merchant === "string" ? parsed.merchant : "",
            confidence: parsed.confidence ?? 0,
          },
        };
      } catch {
        // A malformed read is worth one more try before blaming the key.
        lastError = "unparseable Gemini response";
        if (attempt < ATTEMPTS_PER_KEY) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
  }

  // The client falls back to on-device OCR when it sees this.
  return { status: 502, body: { error: lastError } };
}
