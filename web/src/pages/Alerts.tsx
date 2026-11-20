import { useMemo, useState } from 'react';
import { api } from '../api';
import { ProfileEditor } from '../components/ProfileEditor';
import { Switch } from '../components/Switch';
import { errorText, plural } from '../format';
import { navigate, useApi } from '../hooks';
import type { Profile, Template } from '../types';

export function Alerts({ editId }: { editId: string | undefined }) {
  if (editId === 'new') {
    return <NewAlert />;
  }
  if (editId) {
    return <EditAlert id={editId} />;
  }
  return <AlertList />;
}

function AlertList() {
  const profiles = useApi<Profile[]>('/api/profiles');
  const [error, setError] = useState<string | null>(null);

  const toggle = async (profile: Profile, enabled: boolean) => {
    setError(null);
    try {
      await api.put(`/api/profiles/${encodeURIComponent(profile.id)}`, { ...profile, enabled });
      profiles.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>Each alert describes one kind of message you want to hear about.</p>
        </div>
        <a className="btn primary" href="#/alerts/new" style={{ textDecoration: 'none' }}>
          New alert
        </a>
      </div>
      {error && <div className="notice danger">{error}</div>}
      {profiles.data?.length === 0 && (
        <div className="card empty">No alerts yet. Create one to start getting notified.</div>
      )}
      {profiles.data?.map((profile) => {
        const words = profile.groups.reduce((n, g) => n + g.terms.length, 0);
        return (
          <div key={profile.id} className="card spread">
            <div>
              <h2 style={{ marginBottom: 2 }}>
                <a href={`#/alerts/${encodeURIComponent(profile.id)}`}>{profile.name}</a>
              </h2>
              <span className="muted small">
                {plural(profile.groups.length, 'list')} · {plural(words, 'word')} · needs{' '}
                {plural(profile.threshold, 'point')} ·{' '}
                {profile.sources.mode === 'all' ? 'all watched chats' : plural(profile.sources.jids.length, 'chat')}
              </span>
            </div>
            <div className="row">
              <Switch
                checked={profile.enabled}
                onChange={(enabled) => void toggle(profile, enabled)}
                label={`${profile.name} on`}
              />
              <a className="btn small" href={`#/alerts/${encodeURIComponent(profile.id)}`} style={{ textDecoration: 'none' }}>
                Edit
              </a>
            </div>
          </div>
        );
      })}
    </>
  );
}

function EditAlert({ id }: { id: string }) {
  const profiles = useApi<Profile[]>('/api/profiles');
  const profile = profiles.data?.find((p) => p.id === id);
  const initial = useMemo(() => (profile ? { ...profile } : null), [profile]);

  if (profiles.loading && !profiles.data) {
    return <p className="muted">Loading…</p>;
  }
  if (!initial) {
    return (
      <div className="card empty">
        That alert no longer exists. <a href="#/alerts">Back to alerts</a>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p>
            <a href="#/alerts">← Alerts</a>
          </p>
          <h1>{initial.name}</h1>
        </div>
      </div>
      <ProfileEditor
        initial={initial}
        onCancel={() => navigate('/alerts')}
        onSave={async (draft) => {
          await api.put(`/api/profiles/${encodeURIComponent(id)}`, draft);
          navigate('/alerts');
        }}
        onDelete={async () => {
          await api.del(`/api/profiles/${encodeURIComponent(id)}`);
          navigate('/alerts');
        }}
      />
    </>
  );
}

function NewAlert() {
  const templates = useApi<Template[]>('/api/templates');
  const [chosen, setChosen] = useState<string | null>(null);
  const template = templates.data?.find((t) => t.id === chosen);
  const initial = useMemo(() => (template ? { ...template.profile } : null), [template]);

  return (
    <>
      <div className="page-head">
        <div>
          <p>
            <a href="#/alerts">← Alerts</a>
          </p>
          <h1>New alert</h1>
        </div>
      </div>
      {!initial &&
        templates.data?.map((t) => (
          <button key={t.id} type="button" className="template-option" onClick={() => setChosen(t.id)}>
            <strong>{t.name}</strong>
            <div className="muted small">{t.description}</div>
          </button>
        ))}
      {initial && (
        <ProfileEditor
          initial={initial}
          saveLabel="Create alert"
          onCancel={() => setChosen(null)}
          onSave={async (profile) => {
            const { id: _templateId, createdAt: _c, updatedAt: _u, ...rest } = profile;
            await api.post('/api/profiles', rest);
            navigate('/alerts');
          }}
        />
      )}
    </>
  );
}
