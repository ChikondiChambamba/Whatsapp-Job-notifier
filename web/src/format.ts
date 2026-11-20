const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return 'never';
  }
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

export function dateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Squash runs of blank lines so short previews show actual content. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n\s*\n+/g, '\n');
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
