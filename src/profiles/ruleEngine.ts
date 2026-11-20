import { scoreLogger } from '../services/logger.js';
import { parseTerm } from './terms.js';
import type { Profile, RuleGroup } from './types.js';

/** Numbered or bulleted list items at the start of a line. */
export const LIST_MARKER_PATTERN = /(?:^|\n)\s*(?:\d{1,2}[.)]|[-•▪●])\s+\S/gm;

export interface ScoreResult {
  matched: boolean;
  score: number;
  /** Distinct matched text per rule group id. */
  categoryHits: Record<string, string[]>;
  /** True when the profile's required-group check passed (or it has no required groups). */
  gatePassed: boolean;
  isLikelyBlast: boolean;
}

interface CompiledGroup {
  group: RuleGroup;
  patterns: RegExp[];
}

interface CompiledProfile {
  profile: Profile;
  groups: CompiledGroup[];
  hasRequiredGroups: boolean;
}

export function compileProfile(profile: Profile): CompiledProfile {
  return {
    profile,
    groups: profile.groups.map((group) => ({ group, patterns: group.terms.map(parseTerm) })),
    hasRequiredGroups: profile.groups.some((group) => group.required),
  };
}

export function scoreCompiled(
  compiled: CompiledProfile,
  text: string,
  options: { log?: boolean } = {},
): ScoreResult {
  const { profile } = compiled;
  const categoryHits: Record<string, string[]> = {};
  let score = 0;
  let excludedHits = 0;
  let gatePassed = !compiled.hasRequiredGroups;

  for (const { group, patterns } of compiled.groups) {
    const hits = patterns
      .map((pattern) => text.match(pattern)?.[0])
      .filter((hit): hit is string => Boolean(hit));
    if (hits.length === 0) {
      continue;
    }

    const uniqueHits = Array.from(new Set(hits.map((hit) => hit.toLowerCase())));
    categoryHits[group.id] = uniqueHits;
    score += group.weight * Math.min(uniqueHits.length, group.maxCountedHits);

    if (group.weight < 0) {
      excludedHits += uniqueHits.length;
    }
    if (group.required) {
      gatePassed = true;
    }
  }

  const filter = profile.listPostFilter;
  const listItems = (text.match(LIST_MARKER_PATTERN) ?? []).length;
  const isLikelyBlast =
    filter.enabled && listItems >= filter.minListItems && excludedHits >= filter.minExcludedHits;
  if (isLikelyBlast) {
    score -= filter.penalty;
  }

  const matched = gatePassed && score >= profile.threshold;
  if (options.log ?? true) {
    scoreLogger.debug(
      { profileId: profile.id, score, matched, isLikelyBlast, text },
      'scored message for profile',
    );
  }

  return { matched, score, categoryHits, gatePassed, isLikelyBlast };
}

/**
 * Scores text against profiles, caching compiled patterns until a profile's
 * updatedAt changes.
 */
export class RuleEngine {
  private readonly cache = new Map<string, { version: number; compiled: CompiledProfile }>();

  score(profile: Profile & { updatedAt?: number }, text: string): ScoreResult {
    const version = profile.updatedAt ?? 0;
    let entry = this.cache.get(profile.id);
    if (!entry || entry.version !== version || version === 0) {
      entry = { version, compiled: compileProfile(profile) };
      this.cache.set(profile.id, entry);
    }

    return scoreCompiled(entry.compiled, text);
  }
}
