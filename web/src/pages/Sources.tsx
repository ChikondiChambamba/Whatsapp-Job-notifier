import { SourcesManager } from '../components/SourcesManager';
import type { AppStatus } from '../types';

export function Sources({ status }: { status: AppStatus | undefined }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Groups & channels</h1>
          <p>Only messages from the chats ticked here are checked against your alerts.</p>
        </div>
      </div>
      <SourcesManager connected={status?.whatsapp.state === 'connected'} />
    </>
  );
}
