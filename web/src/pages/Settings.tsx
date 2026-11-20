import { useState } from 'react';
import { api } from '../api';
import { AiForm } from '../components/AiForm';
import { EmailForm } from '../components/EmailForm';
import { QrPanel } from '../components/QrPanel';
import { WhatsAppAlertsForm } from '../components/WhatsAppAlertsForm';
import { errorText, timeAgo } from '../format';
import type { AppStatus } from '../types';

export function Settings({ status, refresh }: { status: AppStatus | undefined; refresh: () => void }) {
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whatsapp = status?.whatsapp;

  const unlink = async () => {
    if (!window.confirm('Unlink this computer from WhatsApp? Alerts stop until you scan a new code.')) {
      return;
    }
    setUnlinking(true);
    setError(null);
    try {
      await api.post('/api/whatsapp/logout');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="card">
        <h2>Email alerts</h2>
        <EmailForm />
      </section>

      <section className="card">
        <h2>WhatsApp alerts</h2>
        <WhatsAppAlertsForm connected={whatsapp?.state === 'connected'} />
      </section>

      <section className="card">
        <h2>AI check</h2>
        <AiForm onChange={refresh} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>WhatsApp</h2>
          {whatsapp?.state === 'connected' && (
            <button className="btn danger small" disabled={unlinking} onClick={() => void unlink()}>
              {unlinking ? 'Unlinking…' : 'Unlink this computer'}
            </button>
          )}
        </div>
        {error && <div className="notice danger">{error}</div>}
        {whatsapp?.state === 'connected' ? (
          <p>
            Linked{whatsapp.account?.name ? ` as ${whatsapp.account.name}` : ''}. Connected since{' '}
            {timeAgo(whatsapp.lastConnectedAt)}.
          </p>
        ) : (
          <QrPanel status={status} />
        )}
      </section>
    </>
  );
}
