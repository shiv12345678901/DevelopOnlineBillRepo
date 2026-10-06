export declare function handleOcr(body: {
  imageBase64?: string;
  mimeType?: string;
}): Promise<{
  status: number;
  body:
    | {
        merchant: string;
        amount: number;
        category: string;
        isBankTransfer: boolean;
        confidence: "HIGH" | "MEDIUM" | "LOW";
        isBlurry: boolean;
        model: string;
      }
    | { error: string };
}>;

export declare function cleanAndParseJson(text: string): Record<string, unknown>;
