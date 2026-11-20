import { useState } from 'react';
import { collapseBlankLines, dateTime, timeAgo } from '../format';
import type { Match } from '../types';

const STATUS: Record<Match['status'], { label: string; tone: string }> = {
  sent: { label: 'Emailed', tone: 'ok' },
  pending: { label: 'Waiting to send', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Too old to send', tone: '' },
};

export function MatchList({ matches }: { matches: Match[] | undefined }) {
  const [open, setOpen] = useState<number | null>(null);

  if (!matches) {
    return <p className="muted">Loading…</p>;
  }
  if (matches.length === 0) {
    return <div className="empty">No matches yet. They will show up here as soon as one arrives.</div>;
  }

  return (
    <ul className="list">
      {matches.map((match) => {
        const status = STATUS[match.status];
        const expanded = open === match.id;
        return (
          <li key={match.id}>
            <div className="spread">
              <div className="row" style={{ gap: 8 }}>
                <span className="badge accent">{match.profileName}</span>
                <strong>{match.sourceName}</strong>
                {match.origin === 'catchup' && <span className="badge">missed while offline</span>}
              </div>
              <span className="muted small" title={dateTime(match.postedAt)}>
                {timeAgo(match.postedAt)}
              </span>
            </div>
            <div className={`message-text${expanded ? '' : ' clamp'}`}>
              {/* Collapse runs of blank lines in the short preview. */}
              {expanded ? match.text : collapseBlankLines(match.text)}
            </div>
            <div className="spread small" style={{ marginTop: 4 }}>
              <span className={`badge ${status.tone}`} title={match.lastError ?? undefined}>
                {status.label}
              </span>
              <button type="button" className="btn link small" onClick={() => setOpen(expanded ? null : match.id)}>
                {expanded ? 'Show less' : 'Show full message'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
