import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorText } from '../format';
import { useApi } from '../hooks';
import type { EmailSettings } from '../types';

interface Draft {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  to: string;
  fromName: string;
}

const PROVIDERS: Record<string, { host: string; port: number; label: string }> = {
  gmail: { host: 'smtp.gmail.com', port: 587, label: 'Gmail' },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, label: 'Outlook / Hotmail' },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 587, label: 'Yahoo' },
};

function providerFor(host: string): string {
  return Object.entries(PROVIDERS).find(([, p]) => p.host === host)?.[0] ?? 'other';
}

/** Email alert settings with a send-test button. */
export function EmailForm({ onSaved }: { onSaved?: () => void }) {
  const current = useApi<EmailSettings>('/api/settings/email');
  const [draft, setDraft] = useState<Draft>({
    smtpHost: PROVIDERS.gmail!.host,
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    to: '',
    fromName: 'WhatsApp Alerts',
  });
  const [provider, setProvider] = useState('gmail');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const data = current.data;
    if (data?.configured) {
      setDraft({
        smtpHost: data.smtpHost ?? '',
        smtpPort: data.smtpPort ?? 587,
        smtpUser: data.smtpUser ?? '',
        smtpPass: '',
        to: data.to ?? '',
        fromName: data.fromName ?? 'WhatsApp Alerts',
      });
      setProvider(providerFor(data.smtpHost ?? ''));
    }
  }, [current.data]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const chooseProvider = (id: string) => {
    setProvider(id);
    const preset = PROVIDERS[id];
    if (preset) {
      setDraft((d) => ({ ...d, smtpHost: preset.host, smtpPort: preset.port }));
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      // Sending to yourself is the usual setup.
      const to = draft.to.trim() || draft.smtpUser.trim();
      await api.put('/api/settings/email', { ...draft, to });
      setDraft((d) => ({ ...d, to, smtpPass: '' }));
      current.reload();
      setMessage({ kind: 'ok', text: 'Saved. Send a test email to check it works.' });
      onSaved?.();
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.post<{ to: string }>('/api/settings/email/test');
      setMessage({ kind: 'ok', text: `Test email sent to ${result.to}. Check your inbox (and spam folder).` });
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  const configured = current.data?.configured ?? false;
  const passwordHelp =
    provider === 'gmail' ? (
      <>
        Gmail needs an <strong>app password</strong>, not your normal password. Turn on 2-Step
        Verification, then create one at{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
          myaccount.google.com/apppasswords
        </a>{' '}
        and paste the 16-letter code here.
      </>
    ) : (
      'Many providers need an app password instead of your normal password.'
    );

  return (
    <form onSubmit={save}>
      <label className="field">
        <span className="field-label">Email provider</span>
        <select value={provider} onChange={(event) => chooseProvider(event.target.value)}>
          {Object.entries(PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
          <option value="other">Other (enter server details)</option>
        </select>
      </label>

      {provider === 'other' && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ flex: 3, minWidth: 200 }}>
            <span className="field-label">SMTP server</span>
            <input type="text" value={draft.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} required />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 90 }}>
            <span className="field-label">Port</span>
            <input
              type="number"
              value={draft.smtpPort}
              onChange={(e) => set('smtpPort', Number(e.target.value))}
              required
            />
          </label>
        </div>
      )}

      <label className="field">
        <span className="field-label">Your email address</span>
        <input
          type="email"
          value={draft.smtpUser}
          autoComplete="username"
          onChange={(e) => set('smtpUser', e.target.value)}
          required
        />
        <span className="field-help">Alerts are sent from this address.</span>
      </label>

      <label className="field">
        <span className="field-label">App password</span>
        <input
          type="password"
          value={draft.smtpPass}
          autoComplete="current-password"
          placeholder={configured && current.data?.hasPassword ? 'Saved (leave blank to keep)' : ''}
          onChange={(e) => set('smtpPass', e.target.value)}
          required={!configured}
        />
        <span className="field-help">{passwordHelp}</span>
      </label>

      <label className="field">
        <span className="field-label">Send alerts to</span>
        <input
          type="email"
          value={draft.to}
          placeholder={draft.smtpUser || 'Same as your email address'}
          onChange={(e) => set('to', e.target.value)}
        />
      </label>

      {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

      <div className="row">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" type="button" onClick={() => void test()} disabled={!configured || testing}>
          {testing ? 'Sending…' : 'Send test email'}
        </button>
      </div>
    </form>
  );
}
