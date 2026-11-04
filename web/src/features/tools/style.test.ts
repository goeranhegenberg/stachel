// Format übertragen ohne Editor-Register (Web-Aktion `tools.pasteStyle` der App): die festen Eigenschaften der Typen
// in style.ts müssen zu `typeDef(…).textual`/`.valign` aller registrierten Typen passen, sonst rechnet der Server anders.
import { describe, expect, it } from 'vitest';
import '../../editor/core';
import '../shapes/stickyShape';
import '../shapes/stickers';
import '../structure/card/card';
import '../structure/table/table';
import '../structure/mindmap/mindmap';
import '../structure/timeline/timeline';
import './tags';
import { objectTypes } from '../../editor/ext/registry';
import { CORE_STYLE_TRAITS } from './style';
import { editorStyleTraits } from './formatPainter';

describe('Format übertragen: Typ-Eigenschaften ohne Register', () => {
  it('CORE_STYLE_TRAITS = typeDef(…).textual/.valign für jeden Typ', () => {
    const types = objectTypes.list().map((d) => d.type);
    expect(types).toEqual(expect.arrayContaining(['sticky', 'text', 'shape', 'card', 'table', 'mindnode']));
    for (const t of types) {
      expect({ t, textual: CORE_STYLE_TRAITS.textual(t) }).toEqual({ t, textual: editorStyleTraits.textual(t) });
      expect({ t, valign: CORE_STYLE_TRAITS.valign(t) }).toEqual({ t, valign: editorStyleTraits.valign(t) });
    }
  });
});
