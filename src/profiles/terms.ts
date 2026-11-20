const REGEX_TERM = /^\/(.+)\/([a-z]*)$/s;
const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u']);

/**
 * Turn a user-entered term into a RegExp.
 *
 * - `software developer` matches the whole phrase, any case, any spacing.
 * - `engineer*` / `*phone` use * as a wildcard for the rest of a word.
 * - `/back-?end (dev|engineer)/i` is used as a regular expression as-is.
 *
 * Throws on an invalid regular expression.
 */
export function parseTerm(term: string): RegExp {
  const trimmed = term.trim();
  const regexMatch = REGEX_TERM.exec(trimmed);
  if (regexMatch) {
    const [, body = '', flags = ''] = regexMatch;
    // g/y make RegExp stateful between calls; drop anything unknown.
    const safeFlags = Array.from(new Set(flags.split('')))
      .filter((flag) => ALLOWED_FLAGS.has(flag))
      .join('');
    return new RegExp(body, safeFlags);
  }

  if (!trimmed) {
    throw new Error('empty term');
  }

  const body = trimmed
    .split(/\s+/)
    .map((word) => word.split('*').map(escapeRegex).join('\\w*'))
    .join('\\s+');
  const start = /^\w/.test(trimmed) ? '\\b' : '';
  const end = /\w$/.test(trimmed) ? '\\b' : '';
  return new RegExp(`${start}${body}${end}`, 'i');
}

export function regexToTerm(pattern: RegExp): string {
  return `/${pattern.source}/${pattern.flags}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
