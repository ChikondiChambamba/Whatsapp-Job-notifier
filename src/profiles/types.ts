import { z } from 'zod';
import { parseTerm } from './terms.js';

const termSchema = z
  .string()
  .trim()
  .min(1, 'Terms cannot be empty')
  .superRefine((value, ctx) => {
    try {
      parseTerm(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid term "${value}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

export const ruleGroupSchema = z.object({
  /** Stable key; stored with match history, so keep it unchanged when renaming. */
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  /** Points added when the group hits. Negative weights make it an exclude group. */
  weight: z.number().min(-20).max(20),
  /** Plain words/phrases (whole-word, case-insensitive, * wildcard) or /regex/flags. */
  terms: z.array(termSchema).default([]),
  /** When any group is required, a message must hit at least one required group. */
  required: z.boolean().default(false),
  /** How many distinct hits in this group count towards the score (1 = counts once). */
  maxCountedHits: z.number().int().min(1).max(20).default(1),
});

export const listPostFilterSchema = z.object({
  /** Penalise multi-item list posts that mostly name things this profile excludes. */
  enabled: z.boolean().default(false),
  minListItems: z.number().int().min(2).default(3),
  minExcludedHits: z.number().int().min(1).default(2),
  penalty: z.number().min(0).default(4),
});

export const profileSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  sources: z
    .object({
      mode: z.enum(['all', 'selected']).default('all'),
      jids: z.array(z.string()).default([]),
    })
    .default({ mode: 'all', jids: [] }),
  groups: z.array(ruleGroupSchema).min(1, 'Add at least one group of terms'),
  threshold: z.number().min(0).max(100),
  listPostFilter: listPostFilterSchema.default({
    enabled: false,
    minListItems: 3,
    minExcludedHits: 2,
    penalty: 4,
  }),
  alerts: z
    .object({
      email: z.boolean().default(true),
      whatsappSelf: z.boolean().default(false),
    })
    .default({ email: true, whatsappSelf: false }),
});

export type RuleGroup = z.infer<typeof ruleGroupSchema>;
export type ListPostFilter = z.infer<typeof listPostFilterSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput = z.input<typeof profileSchema>;

export interface StoredProfile extends Profile {
  createdAt: number;
  updatedAt: number;
}
