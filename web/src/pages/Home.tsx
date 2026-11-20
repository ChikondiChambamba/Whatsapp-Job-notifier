import { MatchList } from '../components/MatchList';
import { timeAgo } from '../format';
import { useApi } from '../hooks';
import type { AppStatus, Match, Stats } from '../types';

export function Home({ status }: { status: AppStatus | undefined }) {
  const stats = useApi<Stats>('/api/stats');
  const matches = useApi<Match[]>('/api/matches?limit=20');
  const setup = status?.setup;
  const connected = status?.whatsapp.state === 'connected';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {connected ? 'Watching your WhatsApp groups.' : 'WhatsApp is not connected right now.'} Last message checked{' '}
            {timeAgo(stats.data?.lastMessageAt)}.
          </p>
        </div>
        <button className="btn" onClick={() => (stats.reload(), matches.reload())}>
          Refresh
        </button>
      </div>

      {setup && !setup.email && (
        <div className="notice warn">
          Email is not set up, so matches are waiting here instead of reaching you.{' '}
          <a href="#/settings">Set up email</a>
        </div>
      )}
      {setup && setup.profiles === 0 && (
        <div className="notice warn">
          You have no alerts yet. <a href="#/alerts/new">Create one</a>
        </div>
      )}

      <div className="grid-3">
        <div className="stat">
          <div className="stat-value">{stats.data?.totalScored ?? '–'}</div>
          <div className="stat-label">Messages checked today</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.data?.matchedCount ?? '–'}</div>
          <div className="stat-label">Matches today</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.data?.emailsSent ?? '–'}</div>
          <div className="stat-label">
            Emails sent today
            {stats.data && stats.data.emailsFailed > 0 && (
              <span className="badge danger" style={{ marginLeft: 6 }}>
                {stats.data.emailsFailed} failed
              </span>
            )}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Recent matches</h2>
        </div>
        {matches.error && <div className="notice danger">{matches.error}</div>}
        <MatchList matches={matches.data} />
      </section>
    </>
  );
}
