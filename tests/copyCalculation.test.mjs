import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CopyCalculationError, formatFixedCents, formatReceiptCents, generateCopyCalculation, writeCalculationText } from "../src/copyCalculation.ts";

const names = ["Arjun Bhurtel", "Arpan Bhurtel", "Shiva Kafle", "Swasti Adhikari"];
const permissions = { can_view: true, can_edit: true, can_review_disabled_receipts: true };

function receipt(id, payer, amount_cents, extra = {}) {
  return { id, period_id: "period-test", captured_at: null, merchant: "Groceries", amount_cents, payer, category: "Groceries", date: "2026-11-01", is_excluded: false, image_url: null, ...extra };
}

function membership(modes = {}) {
  return { period_id: "period-test", revision: 3, status: "CURRENT", permissions, members: names.map((member_name) => ({ member_name, participation_mode: modes[member_name] || "enabled" })) };
}

function preview(paid, modes = {}, overrides = {}) {
  const enabled = names.filter((name) => (modes[name] || "enabled") === "enabled");
  const total = names.reduce((sum, name) => sum + ((modes[name] || "enabled") === "disabled" ? 0 : (paid[name] || 0)), 0);
  const rounded = enabled.length ? Math.round(total / enabled.length) : 0;
  return {
    period_id: "period-test", revision: 3, total_cents: total, receipt_count: 0, equal_share_cents: rounded, permissions,
    members: names.map((member_name) => {
      const mode = modes[member_name] || "enabled";
      const paid_cents = mode === "disabled" ? 0 : (paid[member_name] || 0);
      const share_cents = mode === "enabled" ? rounded : 0;
      return { member_name, participation_mode: mode, paid_cents, share_cents, net_cents: paid_cents - share_cents };
    }),
    ...overrides,
  };
}

const exampleAmounts = {
  "Arjun Bhurtel": [4926, 2143, 2738, 2118, 10285, 719, 9196],
  "Arpan Bhurtel": [6350, 5138, 3388, 1200, 1200, 11600, 732, 753],
  "Shiva Kafle": [6000, 2050, 2018, 3416, 999],
  "Swasti Adhikari": [1334, 799, 2660, 2787, 4186, 1547, 2448, 1675, 2211],
};
const exampleReceipts = names.flatMap((name) => exampleAmounts[name].map((amount, index) => receipt(`${name}-${index}`, name, amount)));
const examplePaid = Object.fromEntries(names.map((name) => [name, exampleAmounts[name].reduce((sum, value) => sum + value, 0)]));
const examplePreview = preview(examplePaid, {}, {
  total_cents: 96616, equal_share_cents: 24154,
  members: names.map((member_name) => ({ member_name, participation_mode: "enabled", paid_cents: examplePaid[member_name], share_cents: 24154, net_cents: examplePaid[member_name] - 24154 })),
});

test("generates the exact four-member WhatsApp calculation", () => {
  const result = generateCopyCalculation(exampleReceipts, membership(), examplePreview);
  assert.equal(result.text, `Arjun ==
49.26+21.43+27.38+21.18+102.85+7.19+91.96=321.25

Arpan ==
63.5+51.38+33.88+12+12+116+7.32+7.53=303.61

Shiva ==
60+20.5+20.18+34.16+9.99=144.83

Swasti ==
13.34+7.99+26.6+27.87+41.86+15.47+24.48+16.75+22.11=196.47

Total ==
321.25+303.61+144.83+196.47=966.16

$241.54 each`);
});

test("uses fixed member order and integer-cent formatting", () => {
  assert.equal(formatReceiptCents(6350), "63.5");
  assert.equal(formatReceiptCents(1200), "12");
  assert.equal(formatReceiptCents(2018), "20.18");
  assert.equal(formatFixedCents(30000), "300.00");
  assert.deepEqual(generateCopyCalculation(exampleReceipts, membership(), examplePreview).text.match(/^(Arjun|Arpan|Shiva|Swasti) ==/gm), ["Arjun ==", "Arpan ==", "Shiva ==", "Swasti =="]);
});

test("disabled member is completely excluded and has zero backend balance", () => {
  const modes = { "Arpan Bhurtel": "disabled" };
  const receipts = [receipt("a1", "Arjun Bhurtel", 20000), receipt("a2", "Arjun Bhurtel", 10000), receipt("s1", "Shiva Kafle", 10000), receipt("s2", "Shiva Kafle", 10000), receipt("w1", "Swasti Adhikari", 10000)];
  const paid = { "Arjun Bhurtel": 30000, "Shiva Kafle": 20000, "Swasti Adhikari": 10000 };
  const result = generateCopyCalculation(receipts, membership(modes), preview(paid, modes));
  assert.doesNotMatch(result.text, /Arpan ==/);
  assert.match(result.text, /\$200\.00 each \(3 participating members\)/);
  assert.match(result.text, /Arpan: Disabled — excluded from settlement\./);
  const invalidPreview = preview(paid, modes);
  invalidPreview.members[1] = { ...invalidPreview.members[1], net_cents: 10000 };
  assert.throws(() => generateCopyCalculation(receipts, membership(modes), invalidPreview), (error) => error instanceof CopyCalculationError && error.code === "MEMBER_MISMATCH");
});

test("Keep Receipts counts contributions with a zero share", () => {
  const modes = { "Arpan Bhurtel": "keep_receipts" };
  const receipts = [receipt("a", "Arjun Bhurtel", 30000), receipt("p", "Arpan Bhurtel", 10000), receipt("s", "Shiva Kafle", 20000), receipt("w", "Swasti Adhikari", 10000)];
  const paid = { "Arjun Bhurtel": 30000, "Arpan Bhurtel": 10000, "Shiva Kafle": 20000, "Swasti Adhikari": 10000 };
  const financial = preview(paid, modes);
  financial.members = financial.members.map((member, index) => member.participation_mode === "enabled" ? { ...member, share_cents: index === 0 ? 23334 : 23333, net_cents: member.paid_cents - (index === 0 ? 23334 : 23333) } : member);
  const result = generateCopyCalculation(receipts, membership(modes), financial);
  assert.match(result.text, /Arpan \(Keep Receipts\) ==\n100=100\.00/);
  assert.match(result.text, /700\.00/);
  assert.match(result.text, /\$233\.33 each \(3 participating members\)/);
});

test("enabled and Keep Receipts members with no receipts remain visible", () => {
  const modes = { "Arpan Bhurtel": "keep_receipts" };
  const paid = { "Shiva Kafle": 3000 };
  const financial = preview(paid, modes);
  financial.members = financial.members.map((member) => member.participation_mode === "enabled" ? { ...member, share_cents: 1000, net_cents: member.paid_cents - 1000 } : member);
  const text = generateCopyCalculation([receipt("s", "Shiva Kafle", 3000)], membership(modes), financial).text;
  assert.match(text, /Arjun ==\n0\.00/);
  assert.match(text, /Arpan \(Keep Receipts\) ==\n0\.00/);
});

test("manual exclusions, bank evidence and other periods never enter the copy", () => {
  const valid = receipt("valid", "Arjun Bhurtel", 1000);
  const ignored = [receipt("excluded", "Arjun Bhurtel", 9000, { is_excluded: true }), receipt("bank", "Arjun Bhurtel", 8000, { merchant: "Bank Transfer" }), receipt("other", "Arjun Bhurtel", 7000, { period_id: "other" })];
  const paid = { "Arjun Bhurtel": 1000 };
  const financial = preview(paid);
  financial.members = financial.members.map((member) => ({ ...member, share_cents: 250, net_cents: member.paid_cents - 250 }));
  const result = generateCopyCalculation([valid, ...ignored], membership(), financial);
  assert.equal(result.receiptCount, 1);
  assert.match(result.text, /10=10\.00/);
  assert.doesNotMatch(result.text, /90|80|70/);
});

test("historical membership is used as supplied and remains calculation-only", () => {
  const historical = { ...membership({ "Swasti Adhikari": "disabled" }), status: "CLOSED" };
  const paid = { "Arjun Bhurtel": 3000 };
  const financial = preview(paid, { "Swasti Adhikari": "disabled" });
  financial.members = financial.members.map((member) => member.participation_mode === "enabled" ? { ...member, share_cents: 1000, net_cents: member.paid_cents - 1000 } : member);
  assert.match(generateCopyCalculation([receipt("a", "Arjun Bhurtel", 3000)], historical, financial).text, /Swasti: Disabled/);
});

test("detects stale revisions, missing receipts and authoritative mismatches", () => {
  assert.throws(() => generateCopyCalculation([], membership(), { ...examplePreview, revision: 4 }), (error) => error.code === "STALE_REVISION");
  assert.throws(() => generateCopyCalculation(exampleReceipts.slice(1), membership(), examplePreview), (error) => error.code === "MEMBER_MISMATCH");
  assert.throws(() => generateCopyCalculation(exampleReceipts, membership(), { ...examplePreview, total_cents: 1 }), (error) => error.code === "TOTAL_MISMATCH");
  const wrongMember = { ...examplePreview, members: examplePreview.members.map((member) => member.member_name === "Arjun Bhurtel" ? { ...member, paid_cents: member.paid_cents + 1 } : member) };
  assert.throws(() => generateCopyCalculation(exampleReceipts, membership(), wrongMember), (error) => error.code === "MEMBER_MISMATCH");
});

test("duplicate stable receipt IDs are counted once", () => {
  const financial = preview({ "Arjun Bhurtel": 1000 });
  financial.members = financial.members.map((member) => ({ ...member, share_cents: 250, net_cents: member.paid_cents - 250 }));
  const one = receipt("same-id", "Arjun Bhurtel", 1000);
  const result = generateCopyCalculation([one, { ...one }], membership(), financial);
  assert.equal(result.receiptCount, 1);
  assert.match(result.text, /10=10\.00/);
});

test("supports long receipt calculations", () => {
  const receipts = Array.from({ length: 200 }, (_, index) => receipt(`long-${index}`, "Arjun Bhurtel", 1));
  const financial = preview({ "Arjun Bhurtel": 200 });
  financial.members = financial.members.map((member) => ({ ...member, share_cents: 50, net_cents: member.paid_cents - 50 }));
  const result = generateCopyCalculation(receipts, membership(), financial);
  assert.equal(result.receiptCount, 200);
  assert.match(result.text, /=2\.00/);
});

test("clipboard success and fallback failure are explicit", async () => {
  let copied = "";
  await writeCalculationText("hello", { writeText: async (text) => { copied = text; } }, undefined);
  assert.equal(copied, "hello");
  await writeCalculationText("fallback", undefined, (text) => text === "fallback");
  await assert.rejects(() => writeCalculationText("fail", undefined, () => false), /Clipboard access is unavailable/);
});

test("receipt loading is paginated and sheet is mobile scrollable", async () => {
  const [api, css, component] = await Promise.all([
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/index.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CopyCalculationSettings.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(api, /fetchAllEligibleReceiptsForPeriod[\s\S]*?\.range\(from, from \+ pageSize - 1\)/);
  assert.match(css, /\.copy-calculation-sheet[\s\S]*?overflow-y: auto/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(component, /navigator\.clipboard/);
  assert.match(component, /generationRef/);
});
