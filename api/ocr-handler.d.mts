export function handleOcr(body: {
  imageBase64?: string;
  mimeType?: string;
}): Promise<{
  status: number;
  body: { amount: number | null; merchant: string; confidence: number } | { error: string };
}>;
