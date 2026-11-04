// Zugriff auf die Editor-API für Teile ohne `api`-Prop (Objekt-Ansichten, Rahmen-Liste, Präsentationsleiste).
// Eine unsichtbare Overlay-Komponente merkt sich die API des gerade offenen Editors.
import { useLayoutEffect } from 'react';
import { defineSlot } from '../../editor/ext/registry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';

let current: EditorApi | null = null;

export const editorApi = (): EditorApi | null => current;

function ApiBridge({ api }: SlotProps) {
  useLayoutEffect(() => {
    current = api;
    return () => {
      if (current === api) current = null;
    };
  }, [api]);
  return null;
}

defineSlot({ id: 'structure.bridge', slot: 'overlay', order: 0, presenting: true, Component: ApiBridge });
