import { z } from 'zod';
import { dateSchema, timeSchema, addDays, localDate } from './time.js';
export const parsedSchema = z
  .object({
    resourceType: z.string().max(60).optional(),
    date: dateSchema.optional(),
    time: timeSchema.optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    missingFields: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export interface AIProvider {
  parse(text: string, timezone: string): Promise<z.infer<typeof parsedSchema>>;
}
/** A deterministic, intentionally limited parser for demonstrations; not an LLM. */
export class MockProvider implements AIProvider {
  async parse(text: string, timezone: string) {
    const today = localDate(new Date(), timezone),
      lower = text.toLowerCase();
    const date = lower.includes('tomorrow')
      ? addDays(today, 1)
      : lower.includes('today')
        ? today
        : lower.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const type = lower.includes('court')
      ? 'sports_court'
      : lower.includes('lab') || lower.includes('microscope')
        ? 'lab_instrument'
        : lower.includes('room')
          ? 'meeting_room'
          : lower.includes('doctor') || lower.includes('consultation')
            ? 'clinician'
            : undefined;
    const match = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    const time = match
      ? `${String((Number(match[1]) % 12) + (match[3] === 'pm' ? 12 : 0)).padStart(2, '0')}:${match[2] ?? '00'}`
      : undefined;
    const duration = lower.match(/\b(\d+)\s*min/);
    const missingFields = [
      !type ? 'resourceType' : null,
      !date ? 'date' : null,
      !time ? 'time' : null,
    ].filter((x): x is string => !!x);
    return parsedSchema.parse({
      resourceType: type,
      date,
      time,
      durationMinutes: duration ? Number(duration[1]) : undefined,
      missingFields,
      confidence: missingFields.length ? 0.4 : 0.9,
    });
  }
}
export class DisabledProvider implements AIProvider {
  async parse() {
    return { missingFields: ['resourceType', 'date', 'time'], confidence: 0 };
  }
}
export async function parseRequest(
  text: string,
  timezone = 'Asia/Kolkata',
  providerName = process.env.AI_PROVIDER ?? 'disabled',
  provider?: AIProvider,
) {
  if (!provider && providerName !== 'mock')
    return {
      provider: 'disabled',
      fallback: true,
      reason: 'Use the filters to choose your resource and time. AI is optional.',
      preferences: await new DisabledProvider().parse(),
    };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const preferences = parsedSchema.parse(
      await Promise.race([
        (provider ?? new MockProvider()).parse(text, timezone),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('timeout')), 1500);
        }),
      ]),
    );
    return {
      provider: providerName,
      fallback: preferences.missingFields.length > 0,
      reason: 'Review these preferences before searching. No booking has been created.',
      preferences,
    };
  } catch {
    return {
      provider: providerName,
      fallback: true,
      reason: 'Could not safely interpret that request. Use the booking filters.',
      preferences: await new DisabledProvider().parse(),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
