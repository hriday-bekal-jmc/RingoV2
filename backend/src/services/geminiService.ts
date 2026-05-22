// Gemini Vision OCR service.
// Sends a receipt / bill image to Gemini and extracts date + total amount.
//
// Required env:
//   GEMINI_API_KEY — Google AI Studio or Vertex API key
//   GEMINI_MODEL   — defaults to 'gemini-2.0-flash'
//
// The extracted fields map to standard form field names via the ai_file_reader
// field config (target_date_field, target_amount_field). The caller is responsible
// for routing the result to the right form fields.

import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { env } from '../config/env';

export interface OcrResult {
  date:   string | null;  // ISO 8601 "YYYY-MM-DD" or null if not found
  amount: number | null;  // integer yen amount, or null if not found
  raw:    string;         // raw Gemini response for debugging
}

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (_client) return _client;
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  _client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return _client;
}

const SYSTEM_PROMPT = `
You are a receipt/bill OCR assistant.
Extract two pieces of information from the image:
1. The date on the receipt (the transaction/issue date, not a due date)
2. The total amount paid (the final grand total including tax)

Respond ONLY with valid JSON in this exact format:
{
  "date": "YYYY-MM-DD",
  "amount": 1234
}

Rules:
- "date" must be ISO 8601 format (YYYY-MM-DD). Use null if no date found.
- "amount" must be a plain integer (yen, no symbols, no decimals). Use null if not found.
- If the receipt shows amounts in other currencies, convert to the displayed number as-is (do not convert currencies).
- Do not include any explanation, markdown, or extra text — only the JSON object.
`.trim();

export async function extractReceiptData(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<OcrResult> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Gemini not configured — set GEMINI_API_KEY');
  }

  // Only image types supported (not PDF for now — Gemini Flash handles common formats)
  const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const effectiveMime = supportedImageTypes.includes(mimeType) ? mimeType : 'image/jpeg';

  const client = getClient();
  const model  = client.getGenerativeModel({ model: env.GEMINI_MODEL });

  const imagePart: Part = {
    inlineData: {
      data:     imageBuffer.toString('base64'),
      mimeType: effectiveMime,
    },
  };

  const result = await model.generateContent([SYSTEM_PROMPT, imagePart]);
  const raw    = result.response.text().trim();

  // Strip markdown code fences if model wraps the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as { date?: unknown; amount?: unknown };

    const date = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : null;

    const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)
      ? Math.round(parsed.amount)
      : typeof parsed.amount === 'string' && /^\d+$/.test(parsed.amount)
        ? parseInt(parsed.amount, 10)
        : null;

    return { date, amount, raw };
  } catch {
    // JSON parse failed — return nulls, surface raw for debugging
    console.warn('[gemini] OCR JSON parse failed. Raw response:', raw);
    return { date: null, amount: null, raw };
  }
}
