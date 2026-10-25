import { z } from 'zod';
import type { Currency } from './money';

export const REGIONS = ['IN', 'US'] as const;
export const RegionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof RegionSchema>;

/** Each market has one currency (ADR-004: India real calls, US browser calls only). */
export const REGION_CURRENCY = { IN: 'INR', US: 'USD' } as const satisfies Record<Region, Currency>;

export const LanguageSchema = z.enum(['hi', 'en']);
export type Language = z.infer<typeof LanguageSchema>;
