import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorText } from '../format';
import { useApi } from '../hooks';
import type { AiSettingsView } from '../types';

/** API key and model for the optional AI check. */
export function AiForm({ onChange }: { onChange?: () => void }) {
  const current = useApi<AiSettingsView>('/api/settings/ai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (current.data) {
      setModel(current.data.model ?? current.data.models[0]?.id ?? '');
    }
  }, [current.data]);

  const configured = current.data?.configured ?? false;
  const selected = current.data?.models.find((m) => m.id === model);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.put<AiSettingsView>('/api/settings/ai', { apiKey, model });
      current.setData(result);
      setApiKey('');
      setMessage({ kind: 'ok', text: 'Key checked and saved. Turn on the AI check in any alert.' });
      onChange?.();
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove your API key? Alerts will be sent on keywords alone.')) {
      return;
    }
    try {
      current.setData(await api.del('/api/settings/ai').then(() => api.get<AiSettingsView>('/api/settings/ai')));
      setMessage(null);
      onChange?.();
    } catch (err) {
      setMessage({ kind: 'danger', text: errorText(err) });
    }
  };

  return (
    <form onSubmit={save}>
      <p className="muted small">
        Optional. When an alert's words match, Claude reads the message and skips the ones that are not really what you
        described, such as people asking for jobs instead of offering them. You pay Anthropic directly for each check
        with your own API key, and the message text is sent to Anthropic to be checked.
      </p>

      <label className="field">
        <span className="field-label">Anthropic API key</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={configured ? `Saved key ending in ${current.data?.keyHint}. Leave blank to keep it.` : 'sk-ant-…'}
          onChange={(event) => setApiKey(event.target.value)}
          required={!configured}
        />
        <span className="field-help">
          Create one at{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>{' '}
          and add a little credit to your account.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Model</span>
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          {current.data?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {selected && <span className="field-help">{selected.note}</span>}
      </label>

      {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

      <div className="spread">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Checking key…' : configured ? 'Save' : 'Check and save key'}
        </button>
        {configured && (
          <button className="btn danger small" type="button" onClick={() => void remove()}>
            Remove key
          </button>
        )}
      </div>
    </form>
  );
}
