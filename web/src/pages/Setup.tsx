import { useMemo, useState } from 'react';
import { api } from '../api';
import { EmailForm } from '../components/EmailForm';
import { ProfileEditor } from '../components/ProfileEditor';
import { QrPanel } from '../components/QrPanel';
import { SourcesManager } from '../components/SourcesManager';
import { useApi } from '../hooks';
import type { AppStatus, Profile, Template } from '../types';

const STEPS = ['Link WhatsApp', 'Choose groups', 'Create an alert', 'Email'] as const;

/** First-run wizard. Starts at the first unfinished step. */
export function Setup({ status, onDone }: { status: AppStatus | undefined; onDone: () => void }) {
  const setup = status?.setup;
  const [step, setStep] = useState(() => {
    if (!setup?.linked) return 0;
    if (!setup.sources) return 1;
    if (!setup.profiles) return 2;
    return 3;
  });
  const connected = status?.whatsapp.state === 'connected';

  return (
    <div className="setup">
      <div className="steps" aria-hidden="true">
        {STEPS.map((name, index) => (
          <span key={name} className={index <= step ? 'done' : ''} />
        ))}
      </div>
      <p className="muted small">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      {step === 0 && (
        <>
          <h1>Link your WhatsApp</h1>
          <p className="muted">
            The app reads messages in the groups and channels you choose, on this computer only, and tells you when
            one matches what you are looking for.
          </p>
          <div className="card">
            <QrPanel status={status} />
          </div>
          <div className="notice warn small">
            This app uses an unofficial WhatsApp connection. WhatsApp does not allow unofficial apps and may suspend
            numbers that use them. Use it at your own risk.
          </div>
          <div className="row">
            <button className="btn primary" disabled={!connected} onClick={() => setStep(1)}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1>Which groups should it watch?</h1>
          <p className="muted">Tick the groups and add the channels where useful messages are posted.</p>
          <SourcesManager connected={connected} />
          <div className="row">
            <button className="btn" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn primary" disabled={!setup?.sources} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 2 && <FirstAlert onBack={() => setStep(1)} onCreated={() => setStep(3)} />}

      {step === 3 && (
        <>
          <h1>Where should alerts go?</h1>
          <p className="muted">Matching messages are emailed to you. You can change this later in Settings.</p>
          <div className="card">
            <EmailForm />
          </div>
          <div className="row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn primary" onClick={onDone}>
              {setup?.email ? 'Finish' : 'Skip for now'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FirstAlert({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const templates = useApi<Template[]>('/api/templates');
  const [chosen, setChosen] = useState<string | null>(null);
  const template = templates.data?.find((t) => t.id === chosen);
  // Stable object so the editor does not reset while typing.
  const initial = useMemo<Profile | null>(() => (template ? { ...template.profile } : null), [template]);

  if (initial) {
    return (
      <>
        <h1>Set up your alert</h1>
        <p className="muted">Adjust the words, then try it on a real message before saving.</p>
        <ProfileEditor
          initial={initial}
          saveLabel="Save and continue"
          onCancel={() => setChosen(null)}
          onSave={async (profile) => {
            const { id: _templateId, createdAt: _c, updatedAt: _u, ...rest } = profile;
            await api.post('/api/profiles', rest);
            onCreated();
          }}
        />
      </>
    );
  }

  return (
    <>
      <h1>What do you want to be alerted about?</h1>
      <p className="muted">Start from a ready-made alert or build your own. You can add more alerts later.</p>
      {templates.error && <div className="notice danger">{templates.error}</div>}
      {templates.data?.map((t) => (
        <button key={t.id} type="button" className="template-option" onClick={() => setChosen(t.id)}>
          <strong>{t.name}</strong>
          <div className="muted small">{t.description}</div>
        </button>
      ))}
      <div className="row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
