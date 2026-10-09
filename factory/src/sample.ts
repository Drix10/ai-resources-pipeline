import type { Storyboard } from './schema';
import sample from '../fixtures/struct-padding.json';

/**
 * Studio default and render smoke test (also used by `node factory-run.js --sample`).
 * Cut from "LinkedIn Insights/c-struct-padding-…md"; every number in it appears in that article.
 */
export const SAMPLE = sample as Storyboard;
