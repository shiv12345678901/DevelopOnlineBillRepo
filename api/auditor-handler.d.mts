export declare function handleAuditor(body: { imageBase64: string; mimeType: string }): Promise<{ status: number; body: unknown }>;
export declare function cleanAndParseJson(text: string): Record<string, unknown>;
