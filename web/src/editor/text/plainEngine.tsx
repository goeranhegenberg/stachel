// Klartext-Engine (Standard): Feld `text`, Bearbeitung per contentEditable bzw. Eingabefeld.
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent as RKeyboardEvent } from 'react';
import { mergeRemoteText } from '../render/remoteText';
import type { EditCallbacks } from '../ext/types';
import type { LabelEditProps, TextEditProps, TextEngine, TextViewProps } from './engine';

function PlainView({ o, className, style }: TextViewProps) {
  return (
    <div className={className} style={style}>
      {o.text}
    </div>
  );
}

function PlainEdit({ o, className, style, placeholder, cb, onForeign }: TextEditProps) {
  return <Editable id={o.id} className={className} initial={o.text ?? ''} current={o.text ?? ''} style={style} placeholder={placeholder} cb={cb} onForeign={onForeign} />;
}

function LabelView({ o, className }: TextViewProps) {
  return <span className={className}>{o.text ?? ''}</span>;
}

export const plainEngine: TextEngine = {
  View: (p) => (p.variant === 'label' ? <LabelView {...p} /> : <PlainView {...p} />),
  Edit: PlainEdit,
  LabelEdit: ConnectorLabelInput,
};

/**
 * Direkt bearbeitbarer Text (unkontrolliert, damit der Cursor nicht springt).
 * Ändert jemand anderes den Text (`current` weicht vom zuletzt Geschriebenen ab), merken wir den fremden Stand
 * und hängen ihn beim Beenden an, statt ihn stillschweigend zu überschreiben.
 */
export function Editable({
  id,
  className,
  initial,
  current,
  style,
  placeholder,
  cb,
  onForeign,
}: {
  id: string;
  className: string;
  initial: string;
  current: string;
  style?: CSSProperties;
  placeholder?: string;
  cb: EditCallbacks;
  onForeign?: (on: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sent = useRef(initial);
  const foreign = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = initial;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    if (initial) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (current === sent.current) return;
    const own = ref.current ? ref.current.innerText.replace(/\n$/, '') : sent.current;
    if (current === own) return;
    foreign.current = current;
    onForeign?.(true);
  }, [current, onForeign]);
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      ref.current?.blur();
    }
  };
  return (
    <div
      ref={ref}
      className={`${className} editing`}
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Text bearbeiten"
      data-placeholder={placeholder}
      spellCheck
      onInput={(e) => {
        const text = (e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, '');
        sent.current = text;
        cb.onTextChange(id, text);
      }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const own = e.currentTarget.innerText.replace(/\n$/, '');
        const merged = mergeRemoteText(own, foreign.current);
        if (foreign.current !== null && merged !== current) cb.onTextChange(id, merged);
        foreign.current = null;
        onForeign?.(false);
        cb.onEditDone(id, e.currentTarget.closest('.obj'));
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/** Beschriftung eines Verbinders in der Linienmitte bearbeiten. */
function ConnectorLabelInput({ o, at, cb }: LabelEditProps) {
  const ref = useRef<HTMLInputElement>(null);
  const initial = useRef(o.text ?? '').current;
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="ov-conn-label"
      style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }}
      defaultValue={initial}
      placeholder="Beschriftung"
      aria-label="Beschriftung des Verbinders"
      size={Math.max(8, initial.length + 1)}
      onChange={(e) => {
        e.currentTarget.size = Math.max(8, e.currentTarget.value.length + 1);
        cb.onTextChange(o.id, e.target.value);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') ref.current?.blur();
      }}
      onBlur={() => cb.onEditDone(o.id, null)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
