/**
 * Australian receipt auditor (Gemini) — the experiment behind the Settings
 * "OCR Scanner" bench. Beyond extracting the total, it classifies the
 * image: valid retail/grocery expenses pass, flatmate bank-transfer
 * screenshots are filtered out, and every read carries a category plus a
 * HIGH/MEDIUM/LOW confidence grade and a blur flag.
 *
 * Mirrors the reference implementation but speaks raw REST (no SDK), so it
 * runs in both the Vite dev middleware and Netlify functions. Keys rotate
 * across every candidate model before the call fails.
 */

const PROMPT = `You are an expert Australian bill and receipt auditor for a flatmate grocery and household group.
Your task is to identify and extract VALID grocery, supermarket, and household bills, and STRICTLY EXCLUDE bank transfers, peer-to-peer payments, or settlement transaction screenshots.

CRITICAL NEGATIVE FILTER (EXCLUDE ONLY FLATMATES P2P TRANSFERS):
- STRICTLY EXCLUDE PEER-TO-PEER TRANSFERS: Images showing money transfers sent to another individual/flatmate (e.g. "Sent to Arjun", "Transfer to Shiva", "PayID payment to [Person]", "Osko payment to Arjun", "Transfer Successful to [Name]", "Account Transfer to [Name]").
  Set: isBankTransfer: true, amount: 0, merchant: "Bank Transfer", category: "Other".
  These are flatmate reimbursement transfers, not grocery expenses!

- VALID RETAIL CARD PAYMENTS (EVEN IF SHOWN IN A BANKING APP):
  If an image is a mobile banking app transaction screenshot showing a card purchase paid to a STORE, MERCHANT, or RESTAURANT (e.g. "Nepal House -$9.19", "Woolworths -$45.20", "Country Fresh -$15.00", "FoodWorks", "Primeline Butchery", "Indreni Supermarket"):
  This IS a valid expense!
  Set: isBankTransfer: false, merchant: Store name (e.g. "Nepal House"), amount: the positive purchase amount (e.g. 9.19), category: "Groceries" or "Dining".

RETAIL MERCHANTS & HOUSEHOLD BILLS:
- Supermarkets and grocery stores (Woolworths, Coles, Aldi, Indian Grocers, Costco, IGA, Asian supermarkets, butchers, fruit & veg).
- Utilities (Electricity, Gas, Internet, Water).
- Restaurant/Takeaway food dockets for the household (e.g. Nepal House, Bhok & Bhojan).
- General household supplies (Kmart, Target, Bunnings, Chemist Warehouse).

Output properties:
- merchant: Store name (e.g. "Woolworths", "Coles", "Aldi", "Indian Grocer").
- amount: The final grand total paid as a clean positive float (e.g. 45.20). If not a retail receipt, use 0.
- category: One of ["Groceries", "Utilities", "Dining", "Household Supplies", "Other"].
- isBankTransfer: true if bank transfer confirmation/screenshot, false if retail receipt.
- confidence: "HIGH" if numbers and store name are crisp and clear; "MEDIUM" if partially wrinkled; "LOW" if blurry/faded.
- isBlurry: true if image is low-resolution, out of focus, or numbers are hard to read; false otherwise.`;

const STRUCTURED_SCHEMA = {
  type: "OBJECT",
  properties: {
    merchant: { type: "STRING" },
    amount: { type: "NUMBER" },
    category: {
      type: "STRING",
      enum: ["Groceries", "Utilities", "Dining", "Household Supplies", "Other"],
    },
    isBankTransfer: { type: "BOOLEAN" },
    confidence: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW"] },
    isBlurry: { type: "BOOLEAN" },
  },
  required: ["merchant", "amount", "category", "isBankTransfer", "confidence", "isBlurry"],
};

// Verified available on the free tier (ListModels). Racing all key x model
// combinations in parallel keeps the call inside Netlify's 10s budget
// (sequential fan-out used to 504 the function).
const CANDIDATE_MODELS = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
];

export function cleanAndParseJson(text) {
  let cleaned = (text || "").trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  const parsed = JSON.parse(cleaned);
  let amount = parseFloat(parsed.amount);
  if (isNaN(amount) || amount < 0) amount = 0;

  const isBankTransfer = Boolean(parsed.isBankTransfer);
  if (isBankTransfer) {
    amount = 0;
  }

  const validCategories = [
    "Groceries",
    "Utilities",
    "Dining",
    "Household Supplies",
    "Other",
  ];
  let category = parsed.category || "Other";
  if (!validCategories.includes(category)) {
    category = "Other";
  }

  const confidence = ["HIGH", "MEDIUM", "LOW"].includes(parsed.confidence)
    ? parsed.confidence
    : amount > 0
      ? "HIGH"
      : "LOW";
  const isBlurry = Boolean(parsed.isBlurry);

  return {
    merchant: String(
      parsed.merchant || (isBankTransfer ? "Bank Transfer" : "Unknown Store"),
    ).trim(),
    amount: Math.round(amount * 100) / 100,
    category,
    isBankTransfer,
    confidence,
    isBlurry,
  };
}

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

export async function handleAuditor({ imageBase64, mimeType }) {
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
        role: "user",
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: STRUCTURED_SCHEMA,
    },
  });

  let lastError = null;

  // Race every key x model combination; the first clean structured read wins.
  const attempts = [];
  for (const key of keys) {
    for (const model of CANDIDATE_MODELS) {
      attempts.push(
        (async () => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              signal: AbortSignal.timeout(8500),
            },
          );
          if (!res.ok) throw new Error(`Gemini error ${res.status} on ${model}`);
          const data = await res.json().catch(() => null);
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          return { ...cleanAndParseJson(text), model };
        })(),
      );
    }
  }

  try {
    const winner = await Promise.any(attempts);
    return { status: 200, body: winner };
  } catch (aggregate) {
    const failures = aggregate?.errors ?? [];
    lastError = failures[failures.length - 1] ?? new Error("all Gemini attempts failed");
  }

  return {
    status: 502,
    body: {
      error: `Gemini Vision extraction failed across ${keys.length} key(s): ${lastError?.message || "Unsupported model or API key error"}`,
    },
  };
}
