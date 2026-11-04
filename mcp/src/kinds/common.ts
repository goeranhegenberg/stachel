// Gemeinsame Bausteine der Objekttypen: Fehler, Kontext, Zod-Schemas, Farb- und Textfelder.
import { z } from 'zod';
import type { BoardModel, NewObj, Obj, Patch } from '../board/model';
import { RICH_TYPES } from '../board/model';
import { markdownToDoc, docToMarkdown, hasFormatting } from '../board/markdown';
import { plainOf, type PMDoc } from '../../../web/src/features/richtext/doc';
import { resolveColor, type ColorUse } from '../board/palette';

/** Fehler mit Hinweis für den Assistenten (wird als Tool-Fehler zurückgegeben, nichts wurde geändert). */
export class ToolError extends Error {}

export interface BuildCtx {
  model: BoardModel;
  all: Obj[];
  byId: Map<string, Obj>;
  /** ref → id (in diesem Aufruf angelegte Objekte) */
  refs: Map<string, string>;
  /** in diesem Aufruf angelegte Objekte (noch nicht geschrieben) */
  pending: Map<string, NewObj & { id: string }>;
  /** Personen für „zuständig“ (Karten), nur wenn gebraucht vorab geladen */
  people: { key: string; name: string }[];
}

/** Objekt nach id oder ref (inkl. der in diesem Aufruf angelegten). */
export function lookup(ctx: BuildCtx, idOrRef: string): (Obj | (NewObj & { id: string })) | undefined {
  const id = ctx.refs.get(idOrRef) ?? idOrRef;
  return ctx.byId.get(id) ?? ctx.pending.get(id);
}

export function mustGet(ctx: BuildCtx, idOrRef: string, what = 'Objekt'): Obj | (NewObj & { id: string }) {
  const o = lookup(ctx, idOrRef);
  if (!o) throw new ToolError(`${what} „${idOrRef}“ gibt es auf diesem Board nicht. Gültige IDs liefern get_objects bzw. search; im selben Aufruf angelegte Objekte über ihren \`ref\`.`);
  return o;
}

export function color(v: string | undefined, use: ColorUse, field = 'color'): string | undefined {
  if (v === undefined) return undefined;
  const c = resolveColor(v, use);
  if (!c) throw new ToolError(`Farbe „${v}“ in \`${field}\` verstehe ich nicht. Erlaubt: #rrggbb oder Namen wie yellow, green, pink, blue, orange, violet, mint, coral, midblue, stone, white, gray, black, red, teal (auch deutsch: gelb, grün, koralle, mittelblau, steingrau, …).`);
  return c;
}

/** Text (Markdown) → Felder `text` + `content` (Rich-Text nur, wenn formatiert; sonst reicht der Klartext). */
export function textFields(md: string, type: string): Patch {
  const doc = markdownToDoc(md);
  if (!RICH_TYPES.has(type) || !hasFormatting(doc)) return { text: plainOf(doc), content: undefined };
  return { text: plainOf(doc), content: doc };
}

/** Text eines Objekts als Markdown (Rich-Text, wenn er zum Klartext passt – sonst gilt der Klartext). */
export function textOf(o: Obj): string | undefined {
  const c = o.content as PMDoc | undefined;
  if (c && typeof c === 'object' && Array.isArray(c.content) && plainOf(c) === (o.text ?? '')) return docToMarkdown(c);
  return typeof o.text === 'string' ? o.text : undefined;
}

// ---- Zod-Bausteine ----------------------------------------------------------------------------------------------------

export const Coord = z.number().min(-1_000_000).max(1_000_000);
export const Size = (min: number, max: number) => z.number().min(min).max(max);
export const ColorStr = z
  .string()
  .max(32)
  .describe('Farbe: #rrggbb oder Name (yellow, green, pink, blue, orange, violet, mint, coral, midblue, stone, white, gray, black, red, teal; deutsch: gelb, grün, rosa, blau, lila, koralle, mittelblau, steingrau, weiß, grau, schwarz, rot, türkis)');
export const TextMd = z
  .string()
  .max(5000)
  .describe('Text als einfaches Markdown: jede Zeile ein Absatz; **fett**, *kursiv*, ~~durch~~, `code`, [Link](https://…), ==markiert==, Listen mit "- ", "1. ", "- [ ] ", Überschriften "# "');
export const Ref = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .describe('Eigener Name für dieses neue Objekt, damit Verbinder im selben Aufruf darauf zeigen können (z. B. "start")');
export const InFrame = z.string().describe('Rahmen (id oder ref): x/y gelten dann relativ zur linken oberen Ecke des Rahmens; ohne x/y wird im Rahmen frei platziert');
export const Tag = z.object({ label: z.string().min(1).max(40), color: ColorStr.optional() }).strict();
export const Align = z.enum(['left', 'center', 'right']);
export const VAlign = z.enum(['top', 'middle', 'bottom']);
export const FontFamily = z.enum(['default', 'condensed', 'serif', 'mono']).describe('Schrift: default = Barlow, condensed = Barlow Condensed (Überschriften), serif, mono');
export const Side = z.enum(['n', 'e', 's', 'w']).describe('Andockseite: n oben, e rechts, s unten, w links');
export const Cap = z.enum(['none', 'arrow', 'triangle', 'triangleOpen', 'circle', 'circleOpen', 'diamond', 'diamondOpen', 'bar']);
export const LineStyle = z.enum(['curved', 'straight', 'elbow']).describe('curved = geschwungen (Standard), straight = gerade, elbow = rechtwinklig');
export const Dash = z.enum(['solid', 'dashed', 'dotted']);
export const End = z.union([
  z.string().describe('id oder ref eines Objekts (Seite wählt Stachel automatisch)'),
  z.object({ id: z.string(), side: Side.optional() }).strict().describe('Objekt mit fester Andockseite'),
  z.object({ x: Coord, y: Coord }).strict().describe('freier Punkt auf dem Board'),
]);

/** Gemeinsame Felder neuer Objekte. */
export const placeFields = {
  ref: Ref.optional(),
  x: Coord.optional().describe('linke obere Ecke (Weltkoordinaten; ohne x/y platziert Stachel frei neben vorhandenem Inhalt)'),
  y: Coord.optional(),
  in: InFrame.optional(),
  rotation: z.number().min(-360).max(360).optional().describe('Drehung in Grad im Uhrzeigersinn'),
};
