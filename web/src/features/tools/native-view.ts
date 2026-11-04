// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P4 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Board-Einstellungen (Hintergrund für alle, ohne Rückgängig wie im Web).
// Test: server/test/native-act-view.test.ts, Doku: „Native-Aktionen“ in docs/features/tools.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import { A, parseArgs } from '../../native/args';
import { defineNativeAction } from '../../native/registry';
import { PATTERNS, readSettings, settingsMapOf, toggleGridOf, writeSettingsTo, type Pattern } from './settingsModel';

/**
 * `tools.settings`: Hintergrund-Muster und/oder -Farbe setzen (Dialog „Board-Einstellungen“) bzw. das Raster
 * ein-/ausschalten (`toggleGrid`, merkt `lastPattern` wie Strg '), `authors` = Autor:in an Haftnotizen zeigen (Schalter im
 * Dialog). Ergebnis `data` = die Einstellungen danach.
 */
defineNativeAction<{ pattern?: Pattern; color?: string; toggleGrid?: boolean; authors?: boolean }>('tools.settings', {
  undo: 'none',
  // 2: `authors` (ältere Server kennen das Argument nicht – die App zeigt den Schalter erst ab Version 2)
  version: 2,
  args: (raw) => {
    const r = parseArgs<{ pattern?: Pattern; color?: string; toggleGrid?: boolean; authors?: boolean }>(raw, {
      pattern: A.opt(A.oneOf(...PATTERNS)),
      color: A.opt((v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)),
      toggleGrid: A.opt(A.bool),
      authors: A.opt(A.bool),
    });
    if (r.ok && r.args.pattern === undefined && r.args.color === undefined && r.args.authors === undefined && !r.args.toggleGrid) return { ok: false, error: 'Nichts zu ändern.' };
    if (r.ok && r.args.toggleGrid && r.args.pattern !== undefined) return { ok: false, error: '„toggleGrid“ und „pattern“ schließen sich aus.' };
    return r;
  },
  run(store, { pattern, color, toggleGrid, authors }) {
    if (toggleGrid) toggleGridOf(store);
    if (pattern !== undefined || color !== undefined || authors !== undefined) writeSettingsTo(store, { pattern, color: color?.toLowerCase(), authors });
    return { data: readSettings(settingsMapOf(store)) };
  },
});
