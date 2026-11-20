import { useState } from 'react';
import { collapseBlankLines, dateTime, timeAgo } from '../format';
import type { Match } from '../types';

const WHATSAPP: Record<NonNullable<Match['waState']>, { label: string; tone: string }> = {
  sent: { label: 'WhatsApp sent', tone: 'ok' },
  pending: { label: 'WhatsApp waiting', tone: 'warn' },
  failed: { label: 'WhatsApp failed', tone: 'danger' },
  expired: { label: 'WhatsApp too old', tone: '' },
};

const STATUS: Record<Match['status'], { label: string; tone: string }> = {
  sent: { label: 'Emailed', tone: 'ok' },
  pending: { label: 'Waiting to send', tone: 'warn' },
  review: { label: 'Being checked by AI', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Too old to send', tone: '' },
  rejected: { label: 'Skipped by AI', tone: '' },
  in_app: { label: 'Shown here only', tone: 'accent' },
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
            {match.aiReason && (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                <strong>AI:</strong> {match.aiReason}
              </p>
            )}
            <div className="spread small" style={{ marginTop: 4 }}>
              <span className="row" style={{ gap: 6 }}>
                <span className={`badge ${status.tone}`} title={match.lastError ?? undefined}>
                  {status.label}
                </span>
                {match.waState && (
                  <span className={`badge ${WHATSAPP[match.waState].tone}`} title={match.waError ?? undefined}>
                    {WHATSAPP[match.waState].label}
                  </span>
                )}
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
