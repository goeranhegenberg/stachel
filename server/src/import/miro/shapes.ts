// Tabellen Miro → Stachel für Formen, Schriftarten und Verbinder-Spitzen (docs/import_miro_konzept.md §2.3/§2.4).
// Reine Daten + kleine Nachschlage-Funktionen.

/** Treue einer Abbildung: exakt gleich dargestellt oder erkennbar gleich mit Abweichungen. */
export type Fidelity = 'exact' | 'similar';

export interface ShapeMap {
  shape: string;
  fidelity: Fidelity;
  /** um 90° gedreht anlegen (w/h getauscht, Mitte bleibt) */
  rotate90?: boolean;
}

const ex = (shape: string): ShapeMap => ({ shape, fidelity: 'exact' });
const sim = (shape: string, extra: Partial<ShapeMap> = {}): ShapeMap => ({ shape, fidelity: 'similar', ...extra });

/** Die 21 Formen der REST-API v2 (`ShapeData.shape`). */
export const MIRO_SHAPES_V2: Readonly<Record<string, ShapeMap>> = {
  rectangle: ex('rect'),
  round_rectangle: ex('roundrect'),
  circle: ex('ellipse'),
  triangle: ex('triangle'),
  rhombus: ex('diamond'),
  parallelogram: ex('parallelogram'),
  trapezoid: ex('trapezoid'),
  pentagon: ex('pentagon'),
  hexagon: ex('hexagon'),
  octagon: ex('octagon'),
  wedge_round_rectangle_callout: sim('callout'),
  star: ex('star'),
  flow_chart_predefined_process: ex('predefined'),
  cloud: ex('cloud'),
  cross: ex('cross'),
  can: ex('cylinder'),
  right_arrow: ex('arrowRight'),
  left_arrow: ex('arrowLeft'),
  left_right_arrow: ex('arrowDouble'),
  left_brace: ex('braceLeft'),
  right_brace: ex('braceRight'),
};

/** Die 24 Flussdiagramm-Formen (nur über `/v2-experimental`). */
export const MIRO_SHAPES_FLOW: Readonly<Record<string, ShapeMap>> = {
  flow_chart_process: ex('rect'),
  flow_chart_decision: ex('diamond'),
  flow_chart_input_output: ex('parallelogram'),
  flow_chart_terminator: ex('terminator'),
  flow_chart_document: ex('document'),
  flow_chart_multidocuments: ex('multiDocument'),
  flow_chart_predefined_process_2: ex('predefined'),
  flow_chart_preparation: ex('hexagon'),
  flow_chart_manual_input: ex('manualInput'),
  flow_chart_manual_operation: ex('manualOperation'),
  flow_chart_delay: ex('delay'),
  flow_chart_display: ex('display'),
  flow_chart_merge: ex('merge'),
  flow_chart_offpage_connector: ex('offPage'),
  flow_chart_internal_storage: ex('internalStorage'),
  flow_chart_online_storage: ex('storedData'),
  flow_chart_or: ex('or'),
  flow_chart_summing_junction: ex('summing'),
  flow_chart_connector: ex('ellipse'),
  flow_chart_magnetic_disk: ex('cylinder'),
  flow_chart_magnetic_drum: sim('cylinder', { rotate90: true }),
  flow_chart_note_curly_left: sim('braceLeft'),
  flow_chart_note_curly_right: sim('braceRight'),
  flow_chart_note_square: sim('braceLeft'),
};

/** Form nachschlagen (v2 und Flussdiagramm); undefined = unbekannt. */
export function mapShape(miro: unknown): ShapeMap | undefined {
  if (typeof miro !== 'string') return undefined;
  const k = miro.trim().toLowerCase();
  return MIRO_SHAPES_V2[k] ?? MIRO_SHAPES_FLOW[k];
}

// ---- Schriftarten ----------------------------------------------------------------------------------------------------

/** Stachel-Schriften (docs/features/richtext.md `fontFamily`); `undefined` = Barlow (Feld weglassen). */
export type StachelFont = 'serif' | 'mono' | 'condensed' | undefined;

const SERIF = ['georgia', 'times_new_roman', 'eb_garamond', 'pt_serif', 'roboto_slab', 'plex_serif', 'tiempos_text', 'abril_fatface', 'gravitas_one', 'bodoni_moda', 'noto_serif', 'merriweather', 'playfair_display', 'serif'];
const MONO = ['roboto_mono', 'plex_mono', 'nixie_one', 'source_code_pro', 'courier_new', 'monospace'];
const CONDENSED = ['pt_sans_narrow', 'roboto_condensed', 'bangers', 'graduate', 'oswald', 'barlow_condensed'];

/** Miro-Schrift (30 Werte) → eine der 4 Stachel-Schriften. `exact` = Miro-Standard bzw. Barlow-ähnlich ohne Hinweis. */
export function mapFont(miro: unknown): { font: StachelFont; changed: boolean } {
  if (typeof miro !== 'string' || !miro.trim()) return { font: undefined, changed: false };
  const k = miro.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (SERIF.includes(k)) return { font: 'serif', changed: true };
  if (MONO.includes(k)) return { font: 'mono', changed: true };
  if (CONDENSED.includes(k)) return { font: 'condensed', changed: true };
  // Sans-Serif (Arial, Open Sans, Roboto …) ≈ Barlow; nur ausgefallene Schriften gelten als ersetzt
  const plainSans = ['arial', 'open_sans', 'roboto', 'noto_sans', 'plex_sans', 'pt_sans', 'helvetica', 'inter', 'lato', 'barlow', 'sans_serif', 'sans'];
  return { font: undefined, changed: !plainSans.includes(k) };
}

// ---- Verbinder-Spitzen -----------------------------------------------------------------------------------------------

/** Stachel-Spitzen (`CapStyle` in web/src/features/shapes/model.ts). */
export type CapStyle = 'none' | 'arrow' | 'triangle' | 'triangleOpen' | 'circle' | 'circleOpen' | 'diamond' | 'diamondOpen' | 'bar';

export interface CapMap {
  cap: CapStyle;
  /** `erd` = Krähenfuß vereinfacht, `unknown` = unbekannter Wert */
  note?: 'erd' | 'unknown';
}

/** Miro `startStrokeCap`/`endStrokeCap` (17 Werte) → Stachel. */
export const MIRO_CAPS: Readonly<Record<string, CapMap>> = {
  none: { cap: 'none' },
  stealth: { cap: 'triangle' },
  rounded_stealth: { cap: 'triangle' },
  filled_triangle: { cap: 'triangle' },
  arrow: { cap: 'arrow' },
  triangle: { cap: 'triangleOpen' },
  filled_diamond: { cap: 'diamond' },
  diamond: { cap: 'diamondOpen' },
  filled_oval: { cap: 'circle' },
  oval: { cap: 'circleOpen' },
  erd_one: { cap: 'bar' },
  erd_only_one: { cap: 'bar' },
  erd_zero_or_one: { cap: 'bar', note: 'erd' },
  erd_many: { cap: 'arrow', note: 'erd' },
  erd_one_or_many: { cap: 'arrow', note: 'erd' },
  erd_zero_or_many: { cap: 'arrow', note: 'erd' },
};

/** Spitze nachschlagen; fehlt = Miro-Standard (Anfang ohne, Ende `stealth`). */
export function mapCap(miro: unknown, end: 'start' | 'end'): CapMap {
  if (miro === undefined || miro === null || miro === '') return { cap: end === 'start' ? 'none' : 'triangle' };
  const k = typeof miro === 'string' ? miro.trim().toLowerCase() : '';
  return MIRO_CAPS[k] ?? { cap: end === 'start' ? 'none' : 'triangle', note: 'unknown' };
}

/** Linienart: Miro `shape` → Stachel `lineStyle` (fehlt/unbekannt = Miro-Standard „curved“). */
export function mapLineStyle(miro: unknown): 'straight' | 'elbow' | 'curved' {
  if (miro === 'straight') return 'straight';
  if (miro === 'elbowed') return 'elbow';
  return 'curved';
}

/** Strichstärken (Rand einer Form, Verbinder): Stufen von Stachel. */
export const STROKE_STEPS = [1, 2, 4, 8] as const;

/** Auf die nächste Stufe runden (bei Gleichstand die dünnere). */
export function roundStroke(w: number): number {
  let best: number = STROKE_STEPS[0];
  for (const s of STROKE_STEPS) if (Math.abs(s - w) < Math.abs(best - w)) best = s;
  return best;
}
