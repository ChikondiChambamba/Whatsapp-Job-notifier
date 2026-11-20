import { describe, expect, it } from 'vitest';
import { FilterEngine } from './filterEngine.js';

describe('FilterEngine', () => {
  const engine = new FilterEngine(4);

  it('matches a real software vacancy', () => {
    const result = engine.score('We are hiring a backend developer. Send your CV before Friday.');

    expect(result.matched).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it('matches a data vacancy with tools and application instructions', () => {
    const result = engine.score(
      'Vacancy: Data Analyst with SQL and Power BI experience. Apply by email.',
    );

    expect(result.matched).toBe(true);
  });

  it('does not match a role keyword by itself', () => {
    const result = engine.score('I spent the weekend learning React and Python.');

    expect(result.matched).toBe(false);
  });

  it('does not match a generic non-tech vacancy', () => {
    const result = engine.score('Vacancy for a cashier. Apply now by sending your CV.');

    expect(result.matched).toBe(false);
  });

  it('suppresses business development roles that contain developer-like wording', () => {
    const result = engine.score('We are hiring a Business Development Officer. Send your CV.');

    expect(result.matched).toBe(false);
  });

  it('suppresses job seeker messages with negative signals', () => {
    const result = engine.score('I am looking for a software developer job, anyone hiring?');

    expect(result.matched).toBe(false);
    expect(result.score).toBeLessThan(4);
  });
});
