import type { AppStatus } from '../types';

const STATE_TEXT: Record<AppStatus['whatsapp']['state'], string> = {
  starting: 'Starting up…',
  waiting_for_scan: 'Waiting for you to scan the code',
  connecting: 'Connecting to WhatsApp…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  logged_out: 'Unlinked. A new code is on its way…',
};

export function QrPanel({ status }: { status: AppStatus | undefined }) {
  const whatsapp = status?.whatsapp;

  if (whatsapp?.state === 'connected') {
    return (
      <div className="notice ok">
        Linked to WhatsApp{whatsapp.account?.name ? ` as ${whatsapp.account.name}` : ''}.
      </div>
    );
  }

  return (
    <div className="qr-box">
      {whatsapp?.qrDataUrl ? (
        <img src={whatsapp.qrDataUrl} alt="WhatsApp link code. Scan it with your phone." />
      ) : (
        <div className="qr-placeholder">{STATE_TEXT[whatsapp?.state ?? 'starting']}</div>
      )}
      <div>
        <ol className="instructions">
          <li>Open WhatsApp on your phone.</li>
          <li>
            Tap <strong>Settings</strong> (iPhone) or the <strong>⋮ menu</strong> (Android).
          </li>
          <li>
            Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.
          </li>
          <li>Point your phone at this code.</li>
        </ol>
        <p className="muted small">
          The code refreshes every few seconds. This app links like WhatsApp Web: your phone
          stays the main device and you can unlink it any time from the same screen.
        </p>
      </div>
    </div>
  );
}
