import { describe, expect, it } from 'vitest';
import { RuleEngine } from './ruleEngine.js';
import { getTemplate } from './templates.js';
import { profileSchema } from './types.js';

describe('RuleEngine with the job vacancies template', () => {
  const engine = new RuleEngine();
  const profile = getTemplate('job-vacancies')!.build();
  const score = (text: string) => engine.score(profile, text);

  it('matches a real software vacancy', () => {
    const result = score('We are hiring a backend developer. Send your CV before Friday.');

    expect(result.matched).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it('matches a data vacancy with tools and application instructions', () => {
    expect(score('Vacancy: Data Analyst with SQL and Power BI experience. Apply by email.').matched).toBe(
      true,
    );
  });

  it('does not match a role keyword by itself', () => {
    expect(score('I spent the weekend learning React and Python.').matched).toBe(false);
  });

  it('does not match a generic non-tech vacancy', () => {
    const result = score('Vacancy for a cashier. Apply now by sending your CV.');

    expect(result.matched).toBe(false);
    expect(result.gatePassed).toBe(false);
  });

  it('suppresses business development roles that contain developer-like wording', () => {
    expect(score('We are hiring a Business Development Officer. Send your CV.').matched).toBe(false);
  });

  it('suppresses job seeker messages with negative signals', () => {
    const result = score('I am looking for a software developer job, anyone hiring?');

    expect(result.matched).toBe(false);
    expect(result.score).toBeLessThan(4);
  });

  it('penalises multi-vacancy list posts naming other professions', () => {
    const result = score(
      'We are hiring:\n1. Driver\n2. Software Engineer\n3. Cashier\n4. Accountant\nApply now.',
    );

    expect(result.isLikelyBlast).toBe(true);
    expect(result.matched).toBe(false);
  });

  it('uses the configured threshold', () => {
    const strict = { ...profile, threshold: 10 };
    expect(engine.score(strict, 'We are hiring a backend developer. Send your CV.').matched).toBe(
      false,
    );
  });
});

describe('RuleEngine with plain keyword profiles', () => {
  const engine = new RuleEngine();
  const profile = profileSchema.parse({
    id: 'rooms',
    name: 'Rooms to rent',
    threshold: 3,
    groups: [
      { id: 'what', label: 'What', weight: 2, terms: ['room to rent', 'bedsitter', 'house for rent'], required: true },
      { id: 'where', label: 'Where', weight: 1, terms: ['area 47', 'area 4*'] },
      { id: 'no', label: 'Ignore', weight: -5, terms: ['looking for a room'] },
    ],
  });

  it('matches phrases case-insensitively across spacing', () => {
    const result = engine.score(profile, 'ROOM  TO RENT in Area 47, K80,000 per month');

    expect(result.matched).toBe(true);
    expect(result.categoryHits.what).toEqual(['room  to rent']);
  });

  it('requires a required group to hit', () => {
    expect(engine.score(profile, 'Nice weather in Area 47 today').matched).toBe(false);
  });

  it('applies exclude groups', () => {
    expect(engine.score(profile, 'I am looking for a room to rent in Area 47').matched).toBe(false);
  });

  it('passes the gate when no group is required', () => {
    const open = profileSchema.parse({
      id: 'open',
      name: 'Open',
      threshold: 1,
      groups: [{ id: 'any', label: 'Any', weight: 1, terms: ['laptop'] }],
    });
    expect(engine.score(open, 'Laptop for sale').matched).toBe(true);
  });

  it('recompiles when a profile changes', () => {
    const v1 = { ...profile, updatedAt: 1 };
    const v2 = {
      ...profile,
      updatedAt: 2,
      groups: [{ ...profile.groups[0]!, terms: ['flat'] }],
    };
    expect(engine.score(v1, 'room to rent here').matched).toBe(false);
    expect(engine.score(v2, 'room to rent here').categoryHits.what).toBeUndefined();
  });
});
