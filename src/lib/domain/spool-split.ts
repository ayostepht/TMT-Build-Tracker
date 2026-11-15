/** Split the grams of a logged run across filament roles (to deduct from linked spools). Pure. */
import { runRoleGrams } from './accounting.ts';

/** Kept under its old name for Spoolman deduction; the code lives in accounting.ts (`runRoleGrams`). */
export const splitGramsByRole = runRoleGrams;
export { runRoleGrams };
