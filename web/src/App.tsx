import { useEffect, useState } from 'react';
import { useRoute, useStatus } from './hooks';
import { Alerts } from './pages/Alerts';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Sources } from './pages/Sources';
import type { AppStatus } from './types';

const NAV = [
  { path: '', label: 'Overview' },
  { path: 'alerts', label: 'Alerts' },
  { path: 'sources', label: 'Groups & channels' },
  { path: 'settings', label: 'Settings' },
];

function needsSetup(status: AppStatus): boolean {
  const { setup } = status;
  return !setup.linked || setup.sources === 0 || setup.profiles === 0;
}

export function App() {
  const { status, offline, refresh } = useStatus();
  const route = useRoute();
  // Decided once, when status first loads, so finishing a step does not
  // yank the user out of the wizard mid-way.
  const [inSetup, setInSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (status && inSetup === null) {
      setInSetup(needsSetup(status));
    }
  }, [status, inSetup]);

  if (offline && !status) {
    return <div className="setup notice danger">Can't reach the app. Make sure it is running, then reload this page.</div>;
  }
  if (!status || inSetup === null) {
    return <div className="setup muted">Loading…</div>;
  }
  if (inSetup) {
    return (
      <Setup
        status={status}
        onDone={() => {
          setInSetup(false);
          window.location.hash = '/';
        }}
      />
    );
  }

  const [section = '', sub] = route;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ●
          </span>
          WhatsApp Alerts
        </div>
        {NAV.map((item) => (
          <a
            key={item.path}
            href={`#/${item.path}`}
            className={`nav-link${section === item.path ? ' active' : ''}`}
            aria-current={section === item.path ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
        <div className="sidebar-footer small">
          <ConnectionBadge status={status} offline={offline} />
        </div>
      </nav>
      <main className="main">
        {offline && <div className="notice danger">Lost contact with the app. Retrying…</div>}
        {status.whatsapp.state !== 'connected' && section !== 'settings' && (
          <div className="notice warn">
            WhatsApp is not connected.{' '}
            {status.whatsapp.state === 'waiting_for_scan' || status.whatsapp.state === 'logged_out' ? (
              <a href="#/settings">Scan the code to link it again</a>
            ) : (
              'Trying to reconnect…'
            )}
          </div>
        )}
        {section === '' && <Home status={status} />}
        {section === 'alerts' && <Alerts editId={sub} />}
        {section === 'sources' && <Sources status={status} />}
        {section === 'settings' && <Settings status={status} refresh={refresh} />}
        {!NAV.some((item) => item.path === section) && (
          <div className="card empty">
            Page not found. <a href="#/">Go to overview</a>
          </div>
        )}
      </main>
    </div>
  );
}

function ConnectionBadge({ status, offline }: { status: AppStatus; offline: boolean }) {
  const state = offline ? 'offline' : status.whatsapp.state;
  const tone = state === 'connected' ? 'ok' : state === 'offline' || state === 'logged_out' ? 'danger' : 'warn';
  const text: Record<string, string> = {
    connected: 'WhatsApp connected',
    offline: 'App not responding',
    logged_out: 'WhatsApp unlinked',
    waiting_for_scan: 'Waiting for QR scan',
    reconnecting: 'Reconnecting…',
    connecting: 'Connecting…',
    starting: 'Starting…',
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`dot ${tone}`} />
      {text[state] ?? state}
    </span>
  );
}
