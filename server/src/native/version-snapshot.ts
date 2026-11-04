// Versions-Vorschau für die Apps (docs/contract.md §8.14): Inhalt einer Version als Objekt-JSON wie
// `welcome.snapshot` (§8.4/§8.5), damit die App ihn ohne Yjs schreibgeschützt zeigen kann. Der Browser holt dafür das
// Yjs-Update (`GET /api/boards/:id/versions/:vid`) und baut daraus eine lokale Sitzung – die App bekommt dasselbe Ergebnis
// fertig serialisiert, mit denselben Codecs wie der Spiegel (serialize.ts).
import * as Y from 'yjs';
import { NATIVE_BELOW_TYPES, type NativeObject } from '../../../shared/native.js';
import { extNames, serializeExt, serializeObjects } from './serialize.js';

export interface VersionSnapshot {
  /** alle Objekte in Zeichenreihenfolge (Rahmen zuerst), wie `welcome.snapshot.objects` */
  objects: NativeObject[];
  /** alle Feature-Strukturen mit Inhalt (wie `want: ["ext"]`) */
  ext: Record<string, unknown>;
}

/** Yjs-Stand einer Version (entpackt) → Objekt-JSON und Feature-Strukturen. */
export function versionSnapshot(update: Uint8Array): VersionSnapshot {
  const doc = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(doc, update);
    const objects = serializeObjects(doc);
    const ext: Record<string, unknown> = {};
    for (const name of extNames(doc)) {
      const v = serializeExt(doc, name);
      if (v !== null) ext[name] = v;
    }
    return { objects, ext };
  } finally {
    doc.destroy();
  }
}

export const VERSION_SNAPSHOT_BELOW = [...NATIVE_BELOW_TYPES];
