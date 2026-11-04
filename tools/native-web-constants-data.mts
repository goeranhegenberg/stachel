// Konstanten der Web-App für die native App (docs/contract.md §8.13, Audit §3.3): alles, was die App sonst abschreiben
// müsste (Paletten, Schriftgrößen, Formen-Katalog, Stempel, Emoji, Icons, Vorlagen, Karten-Status, Zeitleiste, Mindmap,
// Reaktionen, Timer, Rahmen-Formate) – direkt aus dem Web-Code gelesen. Erzeugt von tools/native-web-constants.mts nach
// docs/native_fixtures/web/constants.json; server/test/native-constants.test.ts scheitert, wenn die Datei veraltet ist.
// Neue Konstante: hier ergänzen (Schlüssel bleiben stabil, die App liest nach Namen) und README der Fixtures nachziehen.
import { BRAND, STICKY_COLORS, STICKY_COLS, STICKY_ROWS, USER_COLORS } from '../shared/protocol';
import { PRESENCE_COLORS } from '../web/src/board/session';
import { FONT_SIZES as TEXT_FONT_SIZES } from '../web/src/editor/core/contextActions';
import { ERASER_SIZES } from '../web/src/editor/core/tools';
import { FONTS } from '../web/src/features/richtext/fonts';
import { FONT_SIZES as RICH_FONT_SIZES } from '../web/src/features/richtext/FormatBar';
import { SECTIONS, SHAPE_ENTRIES } from '../web/src/features/shapes/catalog';
import { EMOJI_GROUPS } from '../web/src/features/shapes/emoji';
import { ICON_GROUPS, ICONS } from '../web/src/features/shapes/iconSet';
import { CAP_STYLES } from '../web/src/features/shapes/model';
import { nameOf, SHAPE_PALETTE } from '../web/src/features/shapes/palette';
import { STAMPS } from '../web/src/features/shapes/stamps';
import { EMOJI_SIZE, ICON_SIZE, STAMP_SIZE } from '../web/src/features/shapes/stickers';
import { EMOJIS } from '../web/src/features/collab/reactions';
import { MAX_TIMER_MS } from '../web/src/features/collab/timer';
import { PRESETS as TIMER_PRESETS } from '../web/src/features/collab/TimerViews';
import { STATUSES } from '../web/src/features/structure/card/status';
import { CARD_COLORS, CARD_MIN_W, CARD_PLACEHOLDER, CARD_W, TAG_COLORS, TAG_MAX } from '../web/src/features/structure/card/model';
import { MAX_COLS as PASTE_MAX_COLS, MAX_NOTES as PASTE_MAX_NOTES, MAX_ROWS as PASTE_MAX_ROWS } from '../web/src/features/structure/paste-model';
import { TABLE_HEAD_COLORS, TABLE_HEADS, TABLE_W } from '../web/src/features/structure/table/create';
import * as TB from '../web/src/features/structure/table/model';
import { FRAME_PRESETS } from '../web/src/features/structure/frames/frames';
import { GRID_SIZES } from '../web/src/features/structure/frames/grid';
import { MIND_COLORS, MIND_PLACEHOLDER, MIND_STYLES } from '../web/src/features/structure/mindmap/style';
import { CATEGORIES, TEMPLATES } from '../web/src/features/structure/templates/catalog';
import * as TL from '../web/src/features/structure/timeline/model';

/**
 * SVG eines Stempels (React-Element, viewBox 64×64) als Knotenliste wie `iconNode`: `[tag, attrs, children?]`, Text als
 * `["#text", {}, "…"]`; `currentColor` = `ink` des Stempels.
 */
type SvgNode = [string, Record<string, unknown>, SvgNode[]?] | ['#text', Record<string, never>, string];
function svgNodes(el: unknown): SvgNode[] {
  if (el === null || el === undefined || el === false) return [];
  if (Array.isArray(el)) return el.flatMap(svgNodes);
  if (typeof el === 'string' || typeof el === 'number') return [['#text', {}, String(el)]];
  const e = el as { type: unknown; props: Record<string, unknown> };
  if (typeof e.type !== 'string') throw new Error('Stempel: nur SVG-Elemente erwartet');
  const { children, ...attrs } = e.props;
  const kids = svgNodes(children);
  const textOnly = kids.length === 1 && kids[0]![0] === '#text';
  if (textOnly) return [[e.type, attrs, kids]];
  return [kids.length ? [e.type, attrs, kids] : [e.type, attrs]];
}

/** Inhalt von constants.json (stabil sortiert, ohne Zeitabhängiges). */
export function buildWebConstants() {
  return {
    version: 1,
    colors: {
      brand: BRAND,
      sticky: STICKY_COLORS,
      // Raster der Notizfarben (Spalten = Farbtöne, Reihen = hell/kräftig/dunkel; zeilenweise in `sticky`)
      stickyGrid: { cols: STICKY_COLS, rows: STICKY_ROWS },
      user: USER_COLORS,
      presence: PRESENCE_COLORS,
      shape: SHAPE_PALETTE.map((hex) => ({ hex, name: nameOf(hex) })),
      mind: MIND_COLORS,
      timeline: TL.TL_COLORS,
    },
    fonts: FONTS.map(({ key, label, family, css }) => ({ key, label, family, css })),
    fontSizes: { text: TEXT_FONT_SIZES, richText: RICH_FONT_SIZES },
    eraserSizes: ERASER_SIZES,
    shapes: { sections: SECTIONS, entries: SHAPE_ENTRIES, capStyles: CAP_STYLES },
    stickers: {
      sizes: { stamp: STAMP_SIZE, emoji: EMOJI_SIZE, icon: ICON_SIZE },
      stamps: STAMPS.map(({ id, label, bg, ink, glyph }) => ({ id, label, bg, ink, viewBox: 64, glyph: svgNodes(glyph) })),
      emojiGroups: EMOJI_GROUPS,
      iconGroups: ICON_GROUPS,
      icons: ICONS,
    },
    templates: {
      categories: CATEGORIES,
      // „Enthält“ wie die Galerie: Objekte je Typ aus dem Bau der Vorlage
      list: TEMPLATES.map((t) => {
        const contains: Record<string, number> = {};
        for (const o of t.build()) contains[o.type] = (contains[o.type] ?? 0) + 1;
        // `keywords`: zusätzliche Suchwörter der Galerie (catalog.ts `searchText`), leer = keine
        return { id: t.id, name: t.name, desc: t.desc, category: t.category, keywords: t.keywords ?? [], contains: Object.fromEntries(Object.entries(contains).sort(([a], [b]) => (a < b ? -1 : 1))) };
      }),
    },
    card: { statuses: STATUSES, colors: CARD_COLORS, tagColors: TAG_COLORS, width: CARD_W, minWidth: CARD_MIN_W, tagMax: TAG_MAX, placeholder: CARD_PLACEHOLDER },
    table: {
      headColors: TABLE_HEAD_COLORS,
      heads: TABLE_HEADS,
      width: TABLE_W,
      layout: { fontSize: TB.TABLE_FS, lineHeight: TB.TABLE_LH, padX: TB.TABLE_PAD_X, padY: TB.TABLE_PAD_Y, minRow: TB.MIN_ROW, minColPx: TB.MIN_COL_PX },
    },
    paste: { maxNotes: PASTE_MAX_NOTES, maxRows: PASTE_MAX_ROWS, maxCols: PASTE_MAX_COLS },
    timeline: {
      units: TL.UNITS,
      dayPx: TL.DAY_PX,
      newLen: TL.NEW_LEN,
      months: TL.MONTHS,
      monthsShort: TL.MONTHS_SHORT,
      weekdays: TL.WEEKDAYS,
      layout: { labelW: TL.LABEL_W, headTop: TL.HEAD_TOP, headH: TL.HEAD_H, barH: TL.BAR_H, rowH: TL.ROW_H, lanePad: TL.LANE_PAD, minLaneH: TL.MIN_LANE_H, diamond: TL.DIAMOND },
      limits: { minDays: TL.MIN_DAYS, maxDays: TL.MAX_DAYS, maxLanes: TL.MAX_LANES },
      defaultItemColor: TL.DEFAULT_ITEM_COLOR,
    },
    mind: { styles: MIND_STYLES, colors: MIND_COLORS, placeholder: MIND_PLACEHOLDER },
    reactions: EMOJIS,
    timer: { presetsMin: TIMER_PRESETS, maxMs: MAX_TIMER_MS },
    frames: { presets: FRAME_PRESETS, gridSizes: GRID_SIZES },
  };
}
