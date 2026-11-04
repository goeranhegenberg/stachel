// Eingabefeld für Kommentare mit @Erwähnung (Vorschläge mit Pfeiltasten, Enter/Tab übernimmt).
import { useLayoutEffect, useRef, useState } from 'react';
import { initials, userColor } from '../../board/colors';
import { insertMention, matchPeople, mentionDone, mentionQuery, type Person } from './mentions';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  people: readonly Person[];
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}

export function MentionInput({ value, onChange, onSubmit, onCancel, people, placeholder, label, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const q = mentionQuery(value, caret);
  const list = q && closedAt !== q.start && !mentionDone(q.query, people) ? matchPeople(people, q.query) : [];
  const open = list.length > 0;

  // Höhe folgt dem Inhalt (bis 6 Zeilen)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 136)}px`;
  }, [value]);
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (p: Person) => {
    if (!q) return;
    const r = insertMention(value, q.start, caret, p.name);
    onChange(r.text);
    setCaret(r.caret);
    setActive(0);
    // übernommen: an dieser Stelle keine Vorschläge mehr (das nächste Enter sendet)
    setClosedAt(q.start);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
    });
  };

  return (
    <div className="collab-input">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        data-suggest={open ? 'open' : undefined}
        spellCheck
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(list[Math.min(active, list.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setClosedAt(q!.start);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {open && (
        <ul className="collab-suggest" role="listbox" aria-label="Personen erwähnen">
          {list.map((p, i) => (
            <li key={p.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'is-active' : ''}
                onPointerDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(p)}
              >
                <span className="collab-av collab-av--s" style={{ background: userColor(p.key) }}>
                  {initials(p.name)}
                </span>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
