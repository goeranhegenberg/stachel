// Datenfelder des Rich-Text-Moduls (Module-Augmentation, siehe docs/features/richtext.md).
import type { FontKey } from './fonts';

declare module '../../../../shared/protocol' {
  interface BoardObject {
    /** Schriftart fürs ganze Objekt (sticky/text/shape/connector); fehlt = Barlow */
    fontFamily?: FontKey;
  }
}

export {};
