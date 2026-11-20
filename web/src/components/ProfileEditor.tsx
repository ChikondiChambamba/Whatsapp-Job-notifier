import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { collapseBlankLines, dateTime, errorText, plural, timeAgo } from '../format';
import { useApi, useDebounced } from '../hooks';
import type { AiSettingsView, AiVerdict, PreviewResult, Profile, RuleGroup, ScoreResult, Source } from '../types';
import { Switch } from './Switch';
import { TermsInput } from './TermsInput';

type Kind = 'required' | 'bonus' | 'exclude';

const KIND_TEXT: Record<Kind, { label: string; help: string }> = {
  required: {
    label: 'Must mention one of these',
    help: 'Messages that mention none of the "must mention" lists are skipped.',
  },
  bonus: { label: 'Adds points', help: 'Each list that matches adds its points.' },
  exclude: { label: 'Rules the message out', help: 'Matching these takes points away.' },
};

const kindOf = (group: RuleGroup): Kind =>
  group.weight < 0 ? 'exclude' : group.required ? 'required' : 'bonus';

function withKind(group: RuleGroup, kind: Kind): RuleGroup {
  const points = Math.abs(group.weight) || (kind === 'exclude' ? 3 : kind === 'required' ? 2 : 1);
  return {
    ...group,
    required: kind === 'required',
    weight: kind === 'exclude' ? -points : points,
    maxCountedHits: kind === 'exclude' ? Math.max(group.maxCountedHits, 3) : 1,
  };
}

function newGroup(kind: Kind): RuleGroup {
  return withKind(
    {
      id: `g-${Date.now().toString(36)}`,
      label: kind === 'exclude' ? 'Ignore messages about' : 'New list',
      weight: 1,
      terms: [],
      required: false,
      maxCountedHits: 1,
    },
    kind,
  );
}

export function ProfileEditor({
  initial,
  saveLabel = 'Save alert',
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Profile;
  saveLabel?: string;
  onSave: (profile: Profile) => Promise<void>;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = useApi<Source[]>('/api/sources');
  const ai = useApi<AiSettingsView>('/api/settings/ai');
  const aiConfigured = ai.data?.configured ?? false;

  useEffect(() => setProfile(initial), [initial]);

  const update = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));
  const updateGroup = (index: number, group: RuleGroup) =>
    update({ groups: profile.groups.map((g, i) => (i === index ? group : g)) });

  const maxPoints = useMemo(
    () => profile.groups.reduce((sum, g) => sum + (g.weight > 0 ? g.weight : 0), 0),
    [profile.groups],
  );
  const sliderMax = Math.max(maxPoints, profile.threshold, 1);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(profile);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const watched = (sources.data ?? []).filter((s) => s.jid);

  return (
    <div>
      <section className="card">
        <label className="field">
          <span className="field-label">Alert name</span>
          <input
            type="text"
            value={profile.name}
            placeholder="e.g. Nursing jobs, Rooms to rent in Area 47"
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <div className="row">
          <Switch checked={profile.enabled} onChange={(enabled) => update({ enabled })} label="Alert on" />
          <span>{profile.enabled ? 'This alert is on' : 'This alert is paused'}</span>
        </div>
      </section>

      <section className="card">
        <h2>What to look for</h2>
        <p className="muted small">
          Words and phrases match whole words and ignore capital letters. Use * for word endings, e.g.{' '}
          <code>engineer*</code> matches engineer, engineers and engineering.
        </p>

        {profile.groups.map((group, index) => {
          const kind = kindOf(group);
          return (
            <div key={group.id} className={`group-card ${kind}`}>
              <div className="group-grid">
                <label>
                  <span className="field-label">List name</span>
                  <input
                    type="text"
                    value={group.label}
                    onChange={(event) => updateGroup(index, { ...group, label: event.target.value })}
                  />
                </label>
                <label>
                  <span className="field-label">How it counts</span>
                  <select
                    value={kind}
                    onChange={(event) => updateGroup(index, withKind(group, event.target.value as Kind))}
                  >
                    {(Object.keys(KIND_TEXT) as Kind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_TEXT[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-label">Points</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={Math.abs(group.weight)}
                    onChange={(event) => {
                      const points = Math.min(Math.max(Number(event.target.value) || 1, 1), 20);
                      updateGroup(index, { ...group, weight: kind === 'exclude' ? -points : points });
                    }}
                  />
                </label>
              </div>
              <TermsInput
                label={`Words for ${group.label}`}
                terms={group.terms}
                onChange={(terms) => updateGroup(index, { ...group, terms })}
              />
              <div className="spread" style={{ marginTop: 6 }}>
                <span className="field-help" style={{ marginTop: 0 }}>
                  {KIND_TEXT[kind].help}
                </span>
                <button
                  type="button"
                  className="btn link small"
                  disabled={profile.groups.length <= 1}
                  onClick={() => update({ groups: profile.groups.filter((_, i) => i !== index) })}
                >
                  Remove list
                </button>
              </div>
            </div>
          );
        })}

        <div className="row">
          <button type="button" className="btn small" onClick={() => update({ groups: [...profile.groups, newGroup('bonus')] })}>
            + Add a list of words
          </button>
          <button type="button" className="btn small" onClick={() => update({ groups: [...profile.groups, newGroup('exclude')] })}>
            + Add words to ignore
          </button>
        </div>
      </section>

      <section className="card">
        <h2>How strict</h2>
        <label className="field">
          <span className="field-label">
            Alert me when a message scores at least {profile.threshold} {profile.threshold === 1 ? 'point' : 'points'}
          </span>
          <input
            type="range"
            min={1}
            max={sliderMax}
            value={profile.threshold}
            onChange={(event) => update({ threshold: Number(event.target.value) })}
          />
          <span className="spread small muted">
            <span>More alerts</span>
            <span>Fewer, more precise alerts</span>
          </span>
          <span className="field-help">
            Your lists can add up to {plural(maxPoints, 'point')}.
            {profile.threshold > maxPoints && ' That is less than this setting, so nothing will match.'}
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.listPostFilter.enabled}
            onChange={(event) =>
              update({ listPostFilter: { ...profile.listPostFilter, enabled: event.target.checked } })
            }
          />
          <span>
            Skip long numbered lists that mostly mention ignored words
            <span className="field-help">
              Useful for job groups where one post lists many unrelated vacancies.
            </span>
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Where to look</h2>
        <label className="check" style={{ marginBottom: 6 }}>
          <input
            type="radio"
            name="source-mode"
            checked={profile.sources.mode === 'all'}
            onChange={() => update({ sources: { ...profile.sources, mode: 'all' } })}
          />
          <span>All groups and channels I watch</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="source-mode"
            checked={profile.sources.mode === 'selected'}
            onChange={() => update({ sources: { ...profile.sources, mode: 'selected' } })}
          />
          <span>Only these:</span>
        </label>
        {profile.sources.mode === 'selected' && (
          <ul className="list" style={{ paddingLeft: 26 }}>
            {watched.length === 0 && <li className="muted">You are not watching any groups or channels yet.</li>}
            {watched.map((source) => {
              const jid = source.jid as string;
              const checked = profile.sources.jids.includes(jid);
              return (
                <li key={source.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        update({
                          sources: {
                            ...profile.sources,
                            jids: checked
                              ? profile.sources.jids.filter((j) => j !== jid)
                              : [...profile.sources.jids, jid],
                          },
                        })
                      }
                    />
                    <span>
                      {source.name ?? jid} <span className="muted small">({source.type})</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Double-check with AI</h2>
          <span className="badge">optional</span>
        </div>
        <p className="muted small">
          After the words match, Claude reads the message and skips it if it is not really what you describe here.
          Each check costs a small amount on your Anthropic account.
        </p>
        {!aiConfigured && ai.data && (
          <div className="notice">
            Add an Anthropic API key in <a href="#/settings">Settings</a> to use this.
          </div>
        )}
        <div className="row" style={{ marginBottom: 10 }}>
          <Switch
            checked={profile.ai.enabled}
            disabled={!aiConfigured && !profile.ai.enabled}
            onChange={(enabled) => update({ ai: { ...profile.ai, enabled } })}
            label="Double-check with AI"
          />
          <span>{profile.ai.enabled ? 'AI checks every match before alerting you' : 'Off: words alone decide'}</span>
        </div>
        {(profile.ai.enabled || profile.ai.description) && (
          <label className="field">
            <span className="field-label">Describe what you want, as you would to a friend</span>
            <textarea
              value={profile.ai.description}
              maxLength={1000}
              placeholder="e.g. Vacancies for software developers or IT support in Malawi. Not people asking for jobs, and not sales or marketing roles."
              onChange={(event) => update({ ai: { ...profile.ai, description: event.target.value } })}
            />
          </label>
        )}
      </section>

      <section className="card">
        <h2>How to alert me</h2>
        <div className="row">
          <Switch
            checked={profile.alerts.email}
            onChange={(email) => update({ alerts: { ...profile.alerts, email } })}
            label="Email"
          />
          <span>{profile.alerts.email ? 'Email me each match' : 'No email'}</span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Switch
            checked={profile.alerts.whatsappSelf}
            onChange={(whatsappSelf) => update({ alerts: { ...profile.alerts, whatsappSelf } })}
            label="WhatsApp message"
          />
          <span>
            {profile.alerts.whatsappSelf ? 'Send me a WhatsApp message for each match' : 'No WhatsApp message'}
            <span className="field-help">
              Sent to the chat chosen in <a href="#/settings">Settings</a>.
            </span>
          </span>
        </div>
        {!profile.alerts.email && !profile.alerts.whatsappSelf && (
          <p className="field-help">Matches will only be listed in this app.</p>
        )}
      </section>

      <TryIt profile={profile} aiConfigured={aiConfigured} />

      {error && <div className="notice danger">{error}</div>}
      <div className="spread">
        <div className="row">
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : saveLabel}
          </button>
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (window.confirm(`Delete the alert "${profile.name}"?`)) {
                void onDelete();
              }
            }}
          >
            Delete alert
          </button>
        )}
      </div>
    </div>
  );
}

/** Live test against a pasted message, plus a preview over recent messages. */
function TryIt({ profile, aiConfigured }: { profile: Profile; aiConfigured: boolean }) {
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debouncedText = useDebounced(text, 350);
  const debouncedProfile = useDebounced(profile, 350);
  const labels = useMemo(() => new Map(profile.groups.map((g) => [g.id, g.label])), [profile.groups]);

  useEffect(() => {
    if (!debouncedText.trim()) {
      setResult(null);
      setTestError(null);
      return;
    }
    let cancelled = false;
    api
      .post<ScoreResult>('/api/profiles/test', { profile: debouncedProfile, text: debouncedText })
      .then((r) => !cancelled && (setResult(r), setTestError(null)))
      .catch((err: unknown) => !cancelled && (setResult(null), setTestError(errorText(err))));
    return () => {
      cancelled = true;
    };
  }, [debouncedText, debouncedProfile]);

  // A preview is stale once the rules change.
  useEffect(() => setPreview(null), [debouncedProfile]);
  // An AI answer is stale once the message or description changes.
  useEffect(() => {
    setVerdict(null);
    setAiError(null);
  }, [text, profile.ai.description]);

  const askAi = async () => {
    setAsking(true);
    setAiError(null);
    try {
      setVerdict(await api.post<AiVerdict>('/api/profiles/ai-test', { description: profile.ai.description, text }));
    } catch (err) {
      setAiError(errorText(err));
    } finally {
      setAsking(false);
    }
  };

  const canAskAi = aiConfigured && profile.ai.enabled && profile.ai.description.trim() && text.trim();

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await api.post<PreviewResult>('/api/profiles/preview', { profile }));
    } catch (err) {
      setPreviewError(errorText(err));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <section className="card">
      <h2>Try it out</h2>
      <label className="field">
        <span className="field-label">Paste a message to see if it would alert you</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {testError && <div className="notice warn">{testError}</div>}
      {result && (
        <div className={`notice ${result.matched ? 'ok' : ''}`}>
          <strong>{result.matched ? 'Would alert you' : 'Would not alert you'}</strong> ·{' '}
          {plural(result.score, 'point')} (needs {profile.threshold})
          {!result.gatePassed && <div className="small">It doesn't mention anything from a "must mention" list.</div>}
          {result.isLikelyBlast && <div className="small">Looks like a long list of unrelated items.</div>}
          {Object.entries(result.categoryHits).length > 0 && (
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {Object.entries(result.categoryHits).map(([id, hits]) => (
                <li key={id}>
                  {labels.get(id) ?? id}: {hits.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canAskAi && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className="btn small" disabled={asking} onClick={() => void askAi()}>
            {asking ? 'Asking the AI…' : 'Ask the AI about this message'}
          </button>
          <span className="muted small">Uses one AI check.</span>
        </div>
      )}
      {aiError && <div className="notice warn">{aiError}</div>}
      {verdict && (
        <div className={`notice ${verdict.relevant ? 'ok' : ''}`}>
          <strong>AI: {verdict.relevant ? 'yes, this is what you want' : 'no, it would skip this'}</strong>
          <div className="small">{verdict.reason}</div>
        </div>
      )}

      <div className="spread" style={{ marginTop: 8 }}>
        <span className="muted small">Or check what it would have caught recently (words only, no AI cost).</span>
        <button type="button" className="btn" disabled={previewing} onClick={() => void runPreview()}>
          {previewing ? 'Checking…' : 'Check recent messages'}
        </button>
      </div>
      {previewError && <div className="notice warn" style={{ marginTop: 10 }}>{previewError}</div>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <p>
            <strong>{plural(preview.matchCount, 'match', 'matches')}</strong> in{' '}
            {plural(preview.checked, 'recent message')}
            {preview.oldest && <span className="muted"> (since {timeAgo(preview.oldest)})</span>}.
          </p>
          {preview.checked === 0 && (
            <p className="muted small">
              No messages saved yet. Messages from watched groups are kept on this computer for 7 days so you can test
              here.
            </p>
          )}
          <ul className="list">
            {preview.matches.map((match) => (
              <li key={match.messageId}>
                <div className="spread small muted">
                  <span>{match.sourceName}</span>
                  <span>
                    {dateTime(match.postedAt)} · {plural(match.score, 'point')}
                  </span>
                </div>
                <div className="message-text clamp">{collapseBlankLines(match.text)}</div>
              </li>
            ))}
          </ul>
          {preview.matchCount > preview.matches.length && (
            <p className="muted small">Showing the newest {preview.matches.length}.</p>
          )}
        </div>
      )}
    </section>
  );
}
