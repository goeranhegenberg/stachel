// Text-Engine: wie Text in Haftnotiz, Text, Form und Verbinder-Beschriftung angezeigt und bearbeitet wird.
// Standard ist Klartext (plainEngine); das Rich-Text-Modul ersetzt sie per setTextEngine (Vertrag: docs/contract.md §4).
import type { ComponentType, CSSProperties } from 'react';
import type { BoardObject } from '../../protocol';
import type { Point } from '../../board/geometry';
import type { EditCallbacks, EditorApi } from '../ext/types';
import { plainEngine } from './plainEngine';

export type TextVariant = 'sticky' | 'text' | 'shape' | 'label';

export interface TextViewProps {
  o: BoardObject;
  variant: TextVariant;
  /** Klasse des Textelements (sticky-text, text-content, shape-text, conn-label-text) */
  className: string;
  style?: CSSProperties;
}

export interface TextEditProps extends TextViewProps {
  placeholder?: string;
  cb: EditCallbacks;
  /** jemand anderes ändert den Text gerade mit */
  onForeign?: (on: boolean) => void;
}

export interface LabelEditProps {
  o: BoardObject;
  /** Linienmitte in Bildschirmkoordinaten */
  at: Point;
  cb: EditCallbacks;
}

export interface TextEngine {
  View: ComponentType<TextViewProps>;
  /** Bearbeitung im Objekt; muss die Klasse `editing` tragen und beim Verlassen cb.onEditDone melden */
  Edit: ComponentType<TextEditProps>;
  /** Bearbeitung der Verbinder-Beschriftung (Overlay-Ebene) */
  LabelEdit: ComponentType<LabelEditProps>;
  /** Tippen auf ein ausgewähltes Objekt: Zeichen anhängen, bevor die Bearbeitung startet (Standard: an `text`) */
  typeInto?: (o: BoardObject, ch: string, api: EditorApi) => void;
  /** nachgeladener Code (z. B. Tiptap): die Editor-Seite erscheint erst, wenn er da ist */
  ready?: Promise<unknown>;
}

let engine: TextEngine = plainEngine;

/** Text-Engine ganz oder teilweise ersetzen (z. B. Rich-Text). */
export function setTextEngine(next: Partial<TextEngine>) {
  engine = { ...engine, ...next };
}

export const textEngine = (): TextEngine => engine;
