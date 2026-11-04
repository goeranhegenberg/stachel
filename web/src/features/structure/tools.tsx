// Ein Werkzeug für Karte, Tabelle, Mindmap und Zeitleiste (Untermenü wie bei Formen) – hält die Werkzeugleiste kurz.
import type { ComponentType } from 'react';
import { defineTool } from '../../editor/ext/registry';
import { getToolOption, useToolOption } from '../../editor/ext/toolOptions';
import { tapGesture } from '../../editor/core/tools';
import type { EditorApi } from '../../editor/ext/types';
import type { Point } from '../../board/geometry';
import { IconCard, IconMindmap, IconTable } from './icons';
import { newRoot } from './mindmap/ops';
import { newTimeline } from './timeline/timeline';
import { IconTimeline } from './timeline/icons';

const TOOL = 'structure.blocks';

interface Block {
  id: 'card' | 'table' | 'mindmap' | 'timeline';
  label: string;
  hint: string;
  Icon: ComponentType<{ size?: number }>;
  place: (api: EditorApi, p: Point) => void;
}

export const BLOCKS: Block[] = [
  { id: 'card', label: 'Karte', hint: 'Aufgabe mit Person, Datum und Status', Icon: IconCard, place: (api, p) => void api.placeAt('card', p) },
  { id: 'table', label: 'Tabelle', hint: 'Zellen mit Doppelklick bearbeiten', Icon: IconTable, place: (api, p) => void api.placeAt('table', p) },
  { id: 'mindmap', label: 'Mindmap', hint: 'Tab = Unterthema, Enter = gleiche Ebene', Icon: IconMindmap, place: (api, p) => void api.create(newRoot(p), { edit: true }) },
  { id: 'timeline', label: 'Zeitleiste', hint: 'Spuren mit Terminen, Doppelklick legt einen Eintrag an', Icon: IconTimeline, place: (api, p) => void api.create(newTimeline(p), { select: true }) },
];

const blockOf = (id: string) => BLOCKS.find((b) => b.id === id) ?? BLOCKS[0];

function BlockIcon() {
  const [kind] = useToolOption(TOOL, 'kind', 'card');
  const B = blockOf(kind);
  return <B.Icon />;
}

function BlockOptions() {
  const [kind, setKind] = useToolOption(TOOL, 'kind', 'card');
  return (
    <>
      {BLOCKS.map((b) => (
        <button key={b.id} className={`structure-fly-chip${kind === b.id ? ' is-active' : ''}`} aria-pressed={kind === b.id} aria-label={b.label} title={b.hint} onClick={() => setKind(b.id)}>
          <b.Icon size={18} />
          {b.label}
        </button>
      ))}
    </>
  );
}

defineTool({
  id: TOOL,
  label: 'Karte, Tabelle, Mindmap',
  hint: 'Karte, Tabelle, Mindmap oder Zeitleiste',
  order: 84,
  phone: 'more',
  Icon: BlockIcon,
  Options: BlockOptions,
  down: (e, api) => {
    const b = blockOf(getToolOption(TOOL, 'kind', 'card'));
    const place = () => b.place(api, e.world);
    if (e.pointerType === 'touch') return tapGesture(e, place);
    place();
  },
});
