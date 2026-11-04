// Nur für E2E-Tests (e2e/mobile.spec.ts): ConnectionNotice mit einer steuerbaren Fake-Sitzung einhängen.
// Wird von der App nicht importiert und landet daher nicht im Build.
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import type { ConnectionStatus } from '../board/session';
import { LOCAL_ORIGIN } from '../board/store';
import { ConnectionNotice } from './ConnectionNotice';
import '../styles/global.css';

export function mountConnectionNotice(el: HTMLElement) {
  const listeners = new Set<() => void>();
  let status: ConnectionStatus = 'connecting';
  const doc = new Y.Doc();
  const session = {
    store: { doc },
    getStatus: () => status,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  createRoot(el).render(<ConnectionNotice session={session} />);
  return {
    setStatus(s: ConnectionStatus) {
      status = s;
      listeners.forEach((fn) => fn());
    },
    localEdit() {
      doc.transact(() => doc.getMap('objects').set(`n${Date.now()}`, new Y.Map()), LOCAL_ORIGIN);
    },
  };
}
