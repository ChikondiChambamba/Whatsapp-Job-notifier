import { REQUIRED_FIELD_CATEGORIES, SIGNAL_RULES, type SignalCategory } from './jobVacancyRules.js';
import { LEGACY_PROFILE_ID, LEGACY_PROFILE_NAME } from '../services/migrations.js';
import { regexToTerm } from './terms.js';
import { profileSchema, type Profile } from './types.js';

export interface ProfileTemplate {
  id: string;
  name: string;
  description: string;
  build: (overrides?: Partial<Profile>) => Profile;
}

const CATEGORY_LABELS: Record<SignalCategory, string> = {
  techRole: 'Tech job titles',
  techSkill: 'Tech skills',
  civilRole: 'Civil engineering job titles',
  civilSkill: 'Civil engineering skills',
  hiringVerb: 'Hiring words',
  applyInstruction: 'How to apply',
  negative: 'Job seekers and other professions',
};

/** The original hard-coded tech + civil engineering vacancy rules, unchanged. */
function buildJobVacancies(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    id: LEGACY_PROFILE_ID,
    name: LEGACY_PROFILE_NAME,
    threshold: 4,
    groups: SIGNAL_RULES.map((rule) => ({
      id: rule.category,
      label: CATEGORY_LABELS[rule.category],
      weight: rule.weight,
      terms: rule.patterns.map(regexToTerm),
      required: REQUIRED_FIELD_CATEGORIES.includes(rule.category),
      maxCountedHits: rule.weight < 0 ? 3 : 1,
    })),
    listPostFilter: { enabled: true, minListItems: 3, minExcludedHits: 2, penalty: 4 },
    ...overrides,
  });
}

function buildBlank(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    id: 'new-profile',
    name: 'New alert',
    threshold: 2,
    groups: [
      { id: 'must', label: 'What I am looking for', weight: 2, terms: [], required: true },
      { id: 'bonus', label: 'Nice to have', weight: 1, terms: [] },
      { id: 'exclude', label: 'Ignore messages with', weight: -3, terms: [], maxCountedHits: 3 },
    ],
    ...overrides,
  });
}

export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'job-vacancies',
    name: 'Job vacancies (tech & civil engineering)',
    description: 'Vacancy posts for software/IT and civil engineering roles, ignoring job seekers.',
    build: buildJobVacancies,
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    description: 'Empty keyword lists to fill in yourself.',
    build: buildBlank,
  },
];

export function getTemplate(id: string): ProfileTemplate | undefined {
  return PROFILE_TEMPLATES.find((template) => template.id === id);
}
