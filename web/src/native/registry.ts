// Web-Aktionen für die native App (docs/contract.md §8.12): Die Apps lassen den Server rechnen, was das Web
// rechnet (Layout, Vorlagen, Ausrichten, Tabellen …) – mit genau diesem Code. Jedes Web-Modul meldet seine Aktionen in
// `features/<modul>/native.ts` (Kern: `board/ops/native.ts`) mit `defineNativeAction` an; `native/actions.ts`
// importiert alle diese Dateien (Sammel-Import, ändert kein Paket). Der Server (server/src/native/web-impl.ts) führt sie
// auf dem BoardStore der App-Sitzung aus. React-frei: Aktionen laufen auch ohne Browser.
import type { BoardStore } from '../board/store';
import type { NativeActResult } from '../../../shared/native';

export type { NativeActResult };

/** `undo` = gehört zum laufenden Rückgängig-Schritt der Sitzung (wie im Web); `none` = nicht rückgängig zu machen. */
export type NativeUndo = 'undo' | 'none';

/** Textbreite wie `measureText` (web/src/editor/measureText.ts), auf dem Server aus den Schriftmaßen. */
export type NativeMeasure = (text: string, fs: number, weight?: number, italic?: boolean, family?: string) => number;

/** Was ein Y.Text für `NativeTextMerge.apply` können muss. */
export interface NativeTextTarget {
  toString(): string;
  delete(index: number, length: number): void;
  insert(index: number, text: string): void;
}

/**
 * Klartext der App zusammenführen (Karten-Beschreibung, Tabellenzellen, Zeitleisten-Titel): server/src/native/ytext-merge.ts
 * – wie die `text`-Op für Rich-Text, aber Zeichen ohne Marks. Web-Code importiert keinen Server-Code, daher über `ctx`.
 */
export interface NativeTextMerge {
  /** Basis→App und Basis→aktuell zusammenlegen; `conflict` = dieselbe Stelle unterschiedlich geändert (App gewinnt) */
  merge(base: string, mine: string, theirs: string): { text: string; conflict: boolean };
  /** Y.Text gleich `target` machen – nur der Unterschied wird geschrieben */
  apply(t: NativeTextTarget, target: string): void;
}

/** `ctx.text` (der Server setzt es immer). */
export function textMerge(ctx: NativeActionCtx): NativeTextMerge {
  if (!ctx.text) throw new Error('ctx.text fehlt (Klartext-Zusammenführen des Servers)');
  return ctx.text;
}

export interface NativeActionCtx {
  /** wer die Aktion auslöst (die App-Sitzung) */
  readonly user: { key: string; name: string };
  /** Server-Zeit (ISO) – einmal je Aktion */
  readonly now: string;
  /** Version, die die App verlangt (`v`, Standard 1) */
  readonly v: number;
  /**
   * Feste ID Nummer `n` (ab 1) für Neues: `<key>-<n>`, wenn die App eine `key` mitgibt (Wiederholung legt nichts doppelt
   * an), sonst eine zufällige, die bei gleichem `n` gleich bleibt.
   */
  id(n: number): string;
  /** Gibt es das Objekt (Live-Stand)? */
  exists(id: string): boolean;
  /** Textbreite wie im Browser */
  readonly measure: NativeMeasure;
  /** Klartext zusammenführen (P3: Karten, Tabellen; P9: Zeitleiste); setzt der Server immer (optional nur für Test-Kontexte) */
  readonly text?: NativeTextMerge;
}

/** Ergebnis der Argument-Prüfung: geprüfte Argumente oder ein deutscher Fehlertext. */
export type NativeArgs<A> = { ok: true; args: A } | { ok: false; error: string };

export interface NativeActionDef<A = Record<string, unknown>> {
  /** Version der Aktion (Standard 1); steigt nur, wenn sich die Bedeutung ändert (§8.12) */
  version?: number;
  undo: NativeUndo;
  /** `args` der App vollständig prüfen (vor jedem Schreiben); Helfer in native/args.ts */
  args(raw: Record<string, unknown>, v: number): NativeArgs<A>;
  /** Einträge für die Grenze je Nachricht (Standard 1) */
  cost?(args: A): number;
  /** Ausführen wie im Browser: Store der Sitzung, geprüfte Argumente, Kontext. Kein Ergebnis = `{}`. */
  run(store: BoardStore, args: A, ctx: NativeActionCtx): NativeActResult | void;
  /** nur in der Sandbox (Env STACHEL_NATIVE_DEV_ACTIONS=1) verfügbar */
  dev?: boolean;
}

const NAME_RE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,3}$/;
const actions = new Map<string, NativeActionDef<any>>();

/** Web-Aktion anmelden (beim Import des Moduls). Doppelte Namen sind ein Programmierfehler. */
export function defineNativeAction<A>(name: string, def: NativeActionDef<A>): void {
  if (!NAME_RE.test(name) || name.length > 64) throw new Error(`Ungültiger Name einer Web-Aktion: ${name}`);
  if (actions.has(name)) throw new Error(`Web-Aktion doppelt angemeldet: ${name}`);
  if (def.version !== undefined && (!Number.isInteger(def.version) || def.version < 1)) throw new Error(`Version von ${name} muss eine ganze Zahl ≥ 1 sein`);
  actions.set(name, def);
}

/** Angemeldete Aktion (ohne Sandbox-Aktionen, außer `dev`). */
export function nativeAction(name: string, opts: { dev?: boolean } = {}): NativeActionDef<any> | undefined {
  const def = actions.get(name);
  return def && (!def.dev || opts.dev) ? def : undefined;
}

/** Alle verfügbaren Aktionen mit Version (welcome.actions), nach Namen sortiert. */
export function nativeActionList(opts: { dev?: boolean } = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of [...actions.keys()].sort()) {
    const def = actions.get(name)!;
    if (!def.dev || opts.dev) out[name] = def.version ?? 1;
  }
  return out;
}

/** Nur für Tests: Aktion wieder abmelden. */
export function removeNativeActionForTest(name: string): void {
  actions.delete(name);
}
