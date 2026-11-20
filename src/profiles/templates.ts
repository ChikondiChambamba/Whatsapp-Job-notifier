import { LEGACY_PROFILE_ID, LEGACY_PROFILE_NAME } from '../services/migrations.js';
import { JOB_VACANCY_GROUPS } from './jobVacancyRules.js';
import { profileSchema, type Profile } from './types.js';

export interface ProfileTemplate {
  id: string;
  name: string;
  description: string;
  build: (overrides?: Partial<Profile>) => Profile;
}

/** Tech and civil engineering vacancies, from the original hard-coded rules. */
function buildJobVacancies(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    id: LEGACY_PROFILE_ID,
    name: LEGACY_PROFILE_NAME,
    threshold: 4,
    groups: JOB_VACANCY_GROUPS.map((group) => ({ ...group, terms: [...group.terms] })),
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
