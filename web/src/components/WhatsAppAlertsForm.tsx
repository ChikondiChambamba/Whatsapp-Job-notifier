import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorText } from '../format';
import { useApi } from '../hooks';

interface WhatsAppAlertSettings {
  target: 'self' | 'number';
  number?: string;
}

/** Choose where WhatsApp alerts are sent, and send a test. */
export function WhatsAppAlertsForm({ connected }: { connected: boolean }) {
  const current = useApi<WhatsAppAlertSettings>('/api/settings/whatsapp-alerts');
  const [target, setTarget] = useState<'self' | 'number'>('self');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (current.data) {
      setTarget(current.data.target);
      setNumber(current.data.number ?? '');
    }
  }, [current.data]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      current.setData(await api.put<WhatsAppAlertSettings>('/api/settings/whatsapp-alerts', { target, number }));
      setMessage({ kind: 'ok', text: 'Saved. Send a test message to check it.' });
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setMessage(null);
    try {
      await api.post('/api/settings/whatsapp-alerts/test');
      setMessage({ kind: 'ok', text: 'Test message sent. Check WhatsApp.' });
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const saved = current.data;
  const unchanged = saved && saved.target === target && (target === 'self' || (saved.number ?? '') === number);

  return (
    <form onSubmit={save}>
      <p className="muted small">
        Alerts with "WhatsApp message" turned on are sent from your linked WhatsApp to the chat you choose here.
      </p>
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="radio" name="wa-target" checked={target === 'self'} onChange={() => setTarget('self')} />
        <span>
          My own chat ("Message yourself")
          <span className="field-help">
            Your phone usually does not ring for these, because WhatsApp sees them as messages you sent. Good as a log
            you can check.
          </span>
        </span>
      </label>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="radio" name="wa-target" checked={target === 'number'} onChange={() => setTarget('number')} />
        <span>
          Another WhatsApp number
          <span className="field-help">
            For example a second SIM or a family member. That phone gets a normal notification.
          </span>
        </span>
      </label>
      {target === 'number' && (
        <label className="field">
          <span className="field-label">Number with country code</span>
          <input
            type="text"
            inputMode="tel"
            placeholder="e.g. 265 99 123 4567"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            required
          />
        </label>
      )}

      {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
      {!connected && <div className="notice warn">Connect WhatsApp to send a test message.</div>}

      <div className="row">
        <button className="btn primary" type="submit" disabled={busy !== null || Boolean(unchanged)}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" type="button" disabled={busy !== null || !connected} onClick={() => void test()}>
          {busy === 'test' ? 'Sending…' : 'Send test message'}
        </button>
      </div>
    </form>
  );
}
