/**
 * Shared Gemini receipt-OCR handler, used by:
 *   - the Vite dev server middleware (vite.config.ts)
 *   - the Netlify function (netlify/functions/ocr.mjs)
 * Keys come from the environment (GEMINI_API_KEY or GEMINI_API_KEY_1..N)
 * and rotate automatically on rate limits / transient errors.
 */

const PROMPT =
  "This is a photo of a grocery/store receipt or a payment screenshot. " +
  "Find the store or merchant name and the final grand total amount paid. " +
  'Respond ONLY with JSON: {"amount": <number>, "merchant": "<store name or empty string>", "confidence": <0-1>}. ' +
  'If you cannot confidently determine a total, respond {"amount": null, "merchant": "", "confidence": 0}. No other text.';

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

export async function handleOcr({ imageBase64, mimeType }) {
  const keys = geminiKeys();
  if (!imageBase64) return { status: 400, body: { error: "imageBase64 is required." } };
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

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  for (let i = 0; i < keys.length; i++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: payload },
    );
    if (!res.ok) {
      if ([429, 403, 500, 503].includes(res.status) && i < keys.length - 1) continue;
      return { status: 502, body: { error: `Gemini error ${res.status}` } };
    }
    const data = await res.json();
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
      return { status: 200, body: { amount: null, merchant: "", confidence: 0 } };
    }
  }
  return { status: 200, body: { amount: null, merchant: "", confidence: 0 } };
}
