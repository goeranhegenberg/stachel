// Prüf-Helfer für die `args` der Web-Aktionen (native/registry.ts, docs/contract.md §8.12) – gleiche Grenzen wie die
// übrigen Ops der Native-API (server/src/native/validate.ts). Beispiel:
//   args: (raw) => parseArgs(raw, { id: A.id, at: A.opt(A.int(0, 1000)), color: A.opt(A.color) })
import type { NativeArgs } from './registry';

/** Prüfung eines Werts: true = gültig */
export type Check = (v: unknown) => boolean;

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** größte Koordinate (wie validate.ts) */
export const MAX_COORD = 10_000_000;
/** längster Text (wie NATIVE_LIMITS.maxTextLength) */
export const MAX_TEXT = 20_000;

const OPTIONAL = Symbol('optional');
type Optional = Check & { [OPTIONAL]: true };

export const A = {
  num: (min = -MAX_COORD, max = MAX_COORD): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
  int: (min = 0, max = 1_000_000): Check => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max,
  bool: ((v) => typeof v === 'boolean') as Check,
  str: (max = MAX_TEXT, min = 0): Check => (v) => typeof v === 'string' && v.length <= max && v.length >= min,
  oneOf: (...xs: string[]): Check => (v) => typeof v === 'string' && xs.includes(v),
  color: ((v) => typeof v === 'string' && COLOR_RE.test(v)) as Check,
  id: ((v) => typeof v === 'string' && ID_RE.test(v)) as Check,
  ids: (max = 500): Check => (v) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((x) => typeof x === 'string' && ID_RE.test(x)),
  arrayOf: (max: number, item: Check): Check => (v) => Array.isArray(v) && v.length <= max && v.every(item),
  point: ((v) => !!v && typeof v === 'object' && A.num()((v as { x?: unknown }).x) && A.num()((v as { y?: unknown }).y)) as Check,
  rect: ((v) => {
    const r = v as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
    return !!r && typeof r === 'object' && A.num()(r.x) && A.num()(r.y) && A.num(0)(r.w) && A.num(0)(r.h);
  }) as Check,
  /** beliebiges JSON-Objekt (Tiefe/Größe prüft der Server für die ganze Op) */
  obj: ((v) => !!v && typeof v === 'object' && !Array.isArray(v)) as Check,
  /** darf fehlen (undefined); `null` nur, wenn `check` es zulässt */
  opt: (check: Check): Optional => Object.assign((v: unknown) => v === undefined || check(v), { [OPTIONAL]: true as const }),
};

/**
 * `raw` gegen ein Schema prüfen: jedes Feld mit seiner Prüfung, fehlende Pflichtfelder und unbekannte Felder sind
 * Fehler (unbekannte nur, wenn `strict`, Standard ja – so fallen Tippfehler der App sofort auf).
 */
export function parseArgs<A>(raw: Record<string, unknown>, schema: Record<string, Check>, opts: { strict?: boolean } = {}): NativeArgs<A> {
  if (opts.strict !== false) {
    for (const k of Object.keys(raw)) if (!(k in schema)) return { ok: false, error: `Unbekanntes Argument „${k.slice(0, 40)}“.` };
  }
  for (const [k, check] of Object.entries(schema)) {
    const v = raw[k];
    if (v === undefined && !(OPTIONAL in check)) return { ok: false, error: `Argument „${k}“ fehlt.` };
    if (!check(v)) return { ok: false, error: `Ungültiger Wert für „${k}“.` };
  }
  return { ok: true, args: raw as A };
}
