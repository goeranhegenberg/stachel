// Tiptap-Erweiterungen des Rich-Text-Editors (Knoten/Marks laut Vertrag). Ohne Sync-Plugin, das hängt RichEdit an.
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { safeHref } from './links';
import { StachelExtras } from './extras';

export function richExtensions(placeholder?: string): AnyExtension[] {
  const list: AnyExtension[] = [
    StarterKit.configure({
      // Rückgängig läuft über den Board-UndoManager (Vertrag), keine Extra-Absätze hinter Listen
      undoRedo: false,
      trailingNode: false,
      dropcursor: false,
      link: {
        openOnClick: false,
        enableClickSelection: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => !!safeHref(url),
        HTMLAttributes: { class: 'rt-link', target: '_blank', rel: 'noopener noreferrer nofollow' },
      },
    }),
    TextStyle,
    Color,
    // Schriftgröße für einen Textteil (Text/Form), relativ zur Objektgröße in em
    FontSize,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    StachelExtras,
  ];
  if (placeholder) list.push(Placeholder.configure({ placeholder, showOnlyCurrent: false }));
  return list;
}
