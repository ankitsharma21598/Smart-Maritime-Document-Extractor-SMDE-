import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<{ text: string }>;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { text } = await pdfParse(buffer);
  return text.trim();
}
