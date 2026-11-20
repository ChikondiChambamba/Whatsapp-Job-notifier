import {
  LIST_MARKER_BLAST_THRESHOLD,
  LIST_MARKER_PATTERN,
  REQUIRED_FIELD_CATEGORIES,
  SIGNAL_RULES,
  type SignalCategory,
} from '../config/keywords.js';
import { scoreLogger } from './logger.js';

export interface ScoreResult {
  matched: boolean;
  score: number;
  matchedKeywords: string[];
  categoryHits: Partial<Record<SignalCategory, string[]>>;
  isLikelyBlast: boolean;
}

const DEFAULT_MATCH_THRESHOLD = 4;
const NEGATIVE_MATCH_CAP = 3;
const MIN_DISTINCT_ROLES_FOR_BLAST = 2;

export class FilterEngine {
  constructor(
    private readonly threshold = Number(process.env.MATCH_THRESHOLD || DEFAULT_MATCH_THRESHOLD),
  ) {}

  score(text: string): ScoreResult {
    const categoryHits: Partial<Record<SignalCategory, string[]>> = {};
    let score = 0;
    let distinctNegativeHits = 0;

    for (const rule of SIGNAL_RULES) {
      const hits = rule.patterns
        .map((pattern) => text.match(pattern)?.[0])
        .filter((hit): hit is string => Boolean(hit));

      if (hits.length === 0) {
        continue;
      }

      const uniqueHits = Array.from(new Set(hits.map((hit) => hit.toLowerCase())));
      categoryHits[rule.category] = uniqueHits;

      if (rule.category === 'negative') {
        distinctNegativeHits = uniqueHits.length;
        score += rule.weight * Math.min(distinctNegativeHits, NEGATIVE_MATCH_CAP);
      } else {
        score += rule.weight;
      }
    }

    const listMarkerCount = (text.match(LIST_MARKER_PATTERN) ?? []).length;
    const isLikelyBlast =
      listMarkerCount >= LIST_MARKER_BLAST_THRESHOLD &&
      distinctNegativeHits >= MIN_DISTINCT_ROLES_FOR_BLAST;

    if (isLikelyBlast) {
      score -= 4;
    }

    const matchedKeywords = Object.values(categoryHits).flat();
    const hasFieldSignal = REQUIRED_FIELD_CATEGORIES.some((category) =>
      Boolean(categoryHits[category]),
    );
    const matched = hasFieldSignal && score >= this.threshold;

    scoreLogger.debug({ score, matched, isLikelyBlast, text }, 'scored vacancy candidate');

    return { matched, score, matchedKeywords, categoryHits, isLikelyBlast };
  }
}
