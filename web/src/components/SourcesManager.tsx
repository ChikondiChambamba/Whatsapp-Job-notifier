import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errorText, plural } from '../format';
import { useApi } from '../hooks';
import type { ChannelInfo, GroupInfo, Source } from '../types';

interface ChatsResponse {
  groups: GroupInfo[];
  suggestedChannels: ChannelInfo[];
}

/** Pick which WhatsApp groups and channels the app watches. */
export function SourcesManager({ connected }: { connected: boolean }) {
  const sources = useApi<Source[]>('/api/sources');
  const chats = useApi<ChatsResponse>(connected ? '/api/chats' : null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const sourceByJid = useMemo(
    () => new Map((sources.data ?? []).filter((s) => s.jid).map((s) => [s.jid as string, s])),
    [sources.data],
  );

  const groups = useMemo(() => {
    const listed = chats.data?.groups ?? [];
    const listedJids = new Set(listed.map((g) => g.jid));
    // Watched groups this account is no longer in (or while offline).
    const extra = (sources.data ?? [])
      .filter((s) => s.type === 'group' && s.jid && !listedJids.has(s.jid))
      .map((s) => ({ jid: s.jid as string, name: s.name ?? s.jid ?? '', participants: 0, watched: true }));
    const all = [...listed, ...extra];
    const q = query.trim().toLowerCase();
    return q ? all.filter((g) => g.name.toLowerCase().includes(q)) : all;
  }, [chats.data, sources.data, query]);

  const channels = (sources.data ?? []).filter((s) => s.type === 'channel');
  const watchedGroupCount = (sources.data ?? []).filter((s) => s.type === 'group').length;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      sources.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleGroup = (group: { jid: string; name: string }) => {
    const existing = sourceByJid.get(group.jid);
    void run(group.jid, () =>
      existing
        ? api.del(`/api/sources/${existing.id}`)
        : api.post('/api/sources', { jid: group.jid, name: group.name }),
    );
  };

  const addLink = (event: FormEvent) => {
    event.preventDefault();
    setLinkMessage(null);
    void run('link', async () => {
      const response = await fetch('/api/sources/channel-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ link: link.trim() }),
      });
      const body = (await response.json()) as Source & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Could not add that channel');
      }
      setLink('');
      setLinkMessage(
        response.status === 202
          ? 'Saved. The channel will be looked up next time WhatsApp connects.'
          : `Now watching ${body.name ?? 'the channel'}.`,
      );
    });
  };

  return (
    <div>
      {error && <div className="notice danger">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Groups</h2>
          <span className="badge accent">{plural(watchedGroupCount, 'watched group')}</span>
        </div>
        {!connected && (
          <div className="notice warn">
            Connect WhatsApp to see all your groups. Groups you already watch are listed below.
          </div>
        )}
        {chats.error && connected && <div className="notice danger">{chats.error}</div>}
        <input
          type="search"
          placeholder="Search groups"
          aria-label="Search groups"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ marginBottom: 10 }}
        />
        <ul className="list scroll-list">
          {chats.loading && connected && <li className="muted">Loading your groups…</li>}
          {!chats.loading && groups.length === 0 && (
            <li className="empty">{query ? 'No groups match your search.' : 'No groups yet.'}</li>
          )}
          {groups.map((group) => (
            <li key={group.jid}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={sourceByJid.has(group.jid)}
                  disabled={busy === group.jid}
                  onChange={() => toggleGroup(group)}
                />
                <span>
                  {group.name}
                  {group.participants > 0 && (
                    <span className="muted small"> · {plural(group.participants, 'member')}</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Channels</h2>
          <span className="badge accent">{plural(channels.length, 'watched channel')}</span>
        </div>
        <p className="muted small">
          In WhatsApp, open the channel, tap its name, then <strong>Share</strong> →{' '}
          <strong>Copy link</strong>, and paste the link here.
        </p>
        <form className="row" onSubmit={addLink} style={{ marginBottom: 12 }}>
          <input
            type="url"
            placeholder="https://whatsapp.com/channel/…"
            aria-label="Channel link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            style={{ flex: 1, minWidth: 220 }}
            required
          />
          <button className="btn primary" type="submit" disabled={busy === 'link'}>
            {busy === 'link' ? 'Adding…' : 'Add channel'}
          </button>
        </form>
        {linkMessage && <div className="notice ok">{linkMessage}</div>}

        {chats.data && chats.data.suggestedChannels.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p className="field-label">Channels you follow</p>
            <ul className="list">
              {chats.data.suggestedChannels.map((channel) => (
                <li key={channel.jid} className="spread">
                  <span>{channel.name}</span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy === channel.jid}
                    onClick={() =>
                      void run(channel.jid, async () => {
                        await api.post('/api/sources', { jid: channel.jid, name: channel.name });
                        chats.reload();
                      })
                    }
                  >
                    Watch
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {channels.length > 0 && <p className="field-label">Watching</p>}
        {channels.length > 0 && (
          <ul className="list">
            {channels.map((channel) => (
              <li key={channel.id} className="spread">
                <span>
                  {channel.name ?? channel.inviteLink ?? channel.jid}
                  {!channel.jid && <span className="badge warn" style={{ marginLeft: 8 }}>waiting to connect</span>}
                </span>
                <button
                  type="button"
                  className="btn small danger"
                  disabled={busy === `rm-${channel.id}`}
                  onClick={() => void run(`rm-${channel.id}`, () => api.del(`/api/sources/${channel.id}`))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
