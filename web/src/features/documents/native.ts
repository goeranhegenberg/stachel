// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P7 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): PDF-Dokumente blättern, nachgeladene Seiten eintragen, „Alle Seiten aufs Board“.
// Derselbe React-freie Code wie im Browser (yjs.ts setPage/fillPage/repairMirror, pages.ts expandLayout). Die Seiten
// rendert die App selbst (PDFium) und lädt sie über die Bild-Pipeline hoch, wie der Browser mit pdf.js.
// Test: server/test/native-act-documents.test.ts, Doku: Abschnitt „Native-Aktionen“ in docs/features/documents.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import type { BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';
import { A, parseArgs } from '../../native/args';
import { defineNativeAction } from '../../native/registry';
import { DOC_TYPE, MAX_PAGES } from './model';
import { currentPage, expandLayout, missingPages, pageCount, pageImage } from './pages';
import { fillPage, repairMirror, setPage } from './yjs';

const docOf = (store: BoardStore, id: string): BoardObject | null => {
  const o = store.get(id);
  return o && o.type === DOC_TYPE ? o : null;
};

/** Zustand nach der Aktion für die App: aktuelle Seite, ihr Bild (fehlt = muss erzeugt werden) */
const pageData = (o: BoardObject) => {
  const page = currentPage(o);
  return { page, imageId: pageImage(o, page) ?? null };
};

/**
 * `documents.page`: Seite wechseln (für alle) wie ‹ › an der Seitenleiste bzw. in der Kontextleiste (`setPage`, begrenzt
 * auf 0 … n − 1, `imageId` spiegelt das Seitenbild). Eigener Origin `documents` – kein Rückgängig-Schritt wie im Web.
 * Fehlt das Bild der neuen Seite, erzeugt es die App (rendern, hochladen, `documents.addPage`), wie `goToPage`.
 */
defineNativeAction<{ id: string; page: number }>('documents.page', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { id: A.id, page: A.int(0, 10_000) }),
  run(store, { id, page }) {
    if (!docOf(store, id)) return { skipped: true };
    setPage(store, id, page);
    return { data: pageData(docOf(store, id)!) };
  },
});

/**
 * `documents.addPage`: nachgeladenes Seitenbild eintragen (`fillPage`): nur wenn die Seite noch fehlt (wer zuerst kommt),
 * bei der aktuellen Seite auch `imageId`. Kein Rückgängig-Schritt. `data.imageId` = gültige Bild-ID (ggf. die eines
 * anderen Clients, der schneller war). Stellt außerdem einen verrutschten Spiegel richtig (`repairMirror`).
 */
defineNativeAction<{ id: string; page: number; imageId: string }>('documents.addPage', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { id: A.id, page: A.int(0, MAX_PAGES - 1), imageId: A.id }),
  run(store, { id, page, imageId }) {
    const o = docOf(store, id);
    if (!o || page >= pageCount(o)) return { skipped: true };
    const valid = fillPage(store, id, page, imageId);
    repairMirror(store, id);
    return { data: { imageId: valid ?? null, missing: missingPages(docOf(store, id)!) } };
  },
});

/**
 * `documents.repair`: `imageId` passt nicht zur aktuellen Seite (gleichzeitiges Blättern und Nachtragen) → richtigstellen
 * wie die Seitenleiste des Web für sichtbare Dokumente (`repairMirror`). Kein Rückgängig-Schritt.
 */
defineNativeAction<{ id: string }>('documents.repair', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { id: A.id }),
  run(store, { id }) {
    const o = docOf(store, id);
    if (!o) return { skipped: true };
    const img = pageImage(o, currentPage(o));
    if (!img || o.imageId === img) return { skipped: true };
    repairMirror(store, id);
    return { data: pageData(docOf(store, id)!) };
  },
});

/**
 * `documents.expand`: „Alle Seiten aufs Board legen“ (`expandPages`): Seitenbilder als normale Bilder rechts neben dem
 * Dokument (`expandLayout`: oben bündig, Breite wie das Dokument, ≈ √(1,6 n) Spalten ≤ 10), weiß hinterlegt, ein
 * Rückgängig-Schritt, danach gewählt, Kamera auf Dokument + Seiten. Fehlen noch Seitenbilder, legt die Aktion nichts an
 * und meldet sie in `data.missing` (die App erzeugt sie vorher wie `fillMissing` und ruft die Aktion erneut).
 * Gesperrte Dokumente: `skipped` (das Web zeigt den Eintrag dort nicht).
 */
defineNativeAction<{ id: string }>('documents.expand', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id }),
  // legt höchstens so viele Bilder an, wie ein Dokument Seiten hat (MAX_PAGES)
  cost: () => MAX_PAGES,
  run(store, { id }, ctx) {
    const doc = docOf(store, id);
    if (!doc || doc.locked) return { skipped: true };
    const missing = missingPages(doc);
    if (missing.length) return { skipped: true, data: { missing } };
    const n = pageCount(doc);
    const rects = expandLayout(doc);
    const ids = store.createMany(rects.map((r, i) => ({ id: ctx.id(i + 1), type: 'image' as const, ...r, imageId: pageImage(doc, i)!, color: '#ffffff' })));
    const all = rects.reduce((b, r) => ({ x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), r: Math.max(b.r, r.x + r.w), btm: Math.max(b.btm, r.y + r.h) }), {
      x: doc.x,
      y: doc.y,
      r: doc.x + doc.w,
      btm: doc.y + doc.h,
    });
    return {
      select: ids,
      focus: { x: all.x, y: all.y, w: all.r - all.x, h: all.btm - all.y },
      toast: n === 1 ? 'Seite liegt als Bild auf dem Board.' : `${n} Seiten liegen als Bilder auf dem Board.`,
    };
  },
});
