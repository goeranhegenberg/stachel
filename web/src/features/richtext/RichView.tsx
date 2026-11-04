// Anzeige außerhalb der Bearbeitung: statisch aus der Lesekopie (`content`), sonst der Klartext `text` (Vertrag).
import { memo, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { useFontsVersion } from '../../editor/textMeasure';
import type { TextViewProps } from '../../editor/text/engine';
import { richDoc, type PMDoc } from './doc';
import { fontCss } from './fonts';
import { useFit } from './fit';
import { blocks } from './render';
import { getApi } from './active';
import { toggleTaskAt } from './ops';

/** Stil des Textelements: Kern-Stil + Schriftart + ggf. eigene Auto-Größe. */
export function textStyle(style: CSSProperties | undefined, family: unknown, fit: number | undefined): CSSProperties {
  const css = fontCss(family);
  return { ...style, ...(css ? { fontFamily: css } : null), ...(fit !== undefined ? { fontSize: fit } : null) };
}

function RichViewImpl({ o, variant, className, style }: TextViewProps) {
  const fv = useFontsVersion();
  const ref = useRef<HTMLDivElement>(null);
  const doc: PMDoc | null = richDoc(o);
  const fit = useFit(ref, o, variant, doc, fv, o.text ?? '');
  const s = textStyle(style, o.fontFamily, fit);
  const align = s.textAlign as string | undefined;
  // Haftnotiz, deren Text auch in kleinster Schrift nicht passt: unten ausblenden (CSS rt-clip)
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && variant === 'sticky') el.classList.toggle('rt-clip', el.scrollHeight > el.clientHeight + 1);
  });
  if (!doc) {
    return variant === 'label' ? (
      <span className={className} style={s}>
        {o.text ?? ''}
      </span>
    ) : (
      <div ref={ref} className={className} style={s}>
        {o.text}
      </div>
    );
  }
  return (
    <div ref={ref} className={`${className} rt`} data-align={align} data-locked={o.locked ? '' : undefined} style={s} onPointerDown={(e) => onTaskDown(e, o)} onDoubleClick={onTaskDbl}>
      {blocks(doc.content)}
    </div>
  );
}

/** Klick auf ein Kästchen der Checkliste: abhaken ohne Bearbeitung und ohne Auswahl. */
function onTaskDown(e: PointerEvent<HTMLDivElement>, o: TextViewProps['o']) {
  const label = (e.target as HTMLElement).closest?.('li[data-type="taskItem"] > label');
  const api = getApi();
  if (!label || e.button !== 0 || o.locked || !api || !e.currentTarget.contains(label)) return;
  e.stopPropagation();
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll('li[data-type="taskItem"]')];
  toggleTaskAt(api, o, items.indexOf(label.parentElement!));
}

/** Schnelles zweimaliges Abhaken startet keine Bearbeitung. */
const onTaskDbl = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest?.('li[data-type="taskItem"] > label')) e.stopPropagation();
};

/** Felder, die nur die Lage betreffen: Beim Ziehen/Verschieben ändern sich nur diese, der Text muss nicht neu rendern. */
const PLACEMENT = new Set(['x', 'y', 'z', 'updatedAt']);

function sameShallow(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Gleiches Objekt bis auf Lage-Felder (alle anderen Felder per Identität). */
export function sameTextObject(a: TextViewProps['o'], b: TextViewProps['o']): boolean {
  if (a === b) return true;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k in ra) if (!PLACEMENT.has(k) && !Object.is(ra[k], rb[k])) return false;
  for (const k in rb) if (!PLACEMENT.has(k) && !(k in ra)) return false;
  return true;
}

/**
 * Statische Anzeige, memoisiert: Beim Ziehen vieler Notizen ändern sich nur x/y – dann bleibt der Rich-Text-Baum
 * (und die Schriftgrößen-Anpassung) unangetastet. Der Stil kommt pro Render als neues Objekt, daher flach verglichen.
 */
export const RichView = memo(
  RichViewImpl,
  (a, b) => a.variant === b.variant && a.className === b.className && sameShallow(a.style, b.style) && sameTextObject(a.o, b.o),
);
