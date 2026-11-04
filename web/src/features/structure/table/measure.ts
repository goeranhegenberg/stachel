// Textmessung der Tabellenzellen (Schrift wie in der Ansicht).
import { measureText } from '../../../editor/measureText';
import { TABLE_FS, type CellMeasure } from './model';

export const cellMeasure: CellMeasure = (s, bold) => measureText(s, TABLE_FS, bold ? 700 : 500);
