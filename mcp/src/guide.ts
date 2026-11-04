// Texte für den Assistenten: Server-Anleitung (MCP instructions), Gestaltungsanleitung und Objektschema
// (als Ressource, Prompt und Tool get_design_guide, weil nicht jeder Client Ressourcen anzeigt).
import { COLOR_NAMES } from './board/palette';
import { KINDS, SHAPE_KINDS, STAMPS } from './kinds/kinds';

export const INSTRUCTIONS = `Stachel ist ein Online-Whiteboard für Teams. Du arbeitest live auf echten Boards: alle Anwesenden sehen jede Änderung sofort, du erscheinst als „KI (für <Name>)“ mit Cursor.

Arbeitsweise:
1. list_boards → Board wählen (oder create_board).
2. get_board_overview → Bereiche, Rahmen, Mindmaps, freie Fläche verstehen; Details mit get_objects/search.
3. Anlegen: create_objects (Notizen, Texte, Formen, Rahmen, Karten, Tabellen, Sticker, Verbinder – mit ref untereinander verknüpfbar), create_notes (viele Notizen im Raster), create_mindmap, create_kanban, connect.
4. Ordnen: update_objects, arrange_objects (ausrichten/verteilen/verschieben/Ebene), auto_layout (Raster, Fluss, Baum, Cluster), group_objects (Gruppe/Rahmen drumherum).
5. Immer mit screenshot prüfen, wie es aussieht, und nachbessern. labels: true blendet Nummern ein (Legende mit IDs).
6. Fehler gemacht? undo nimmt deine letzten Schritte zurück (jede Tool-Ausführung = ein Schritt).

Koordinaten: Weltpunkte, x nach rechts, y nach unten; Haftnotiz 200×200. Ohne x/y legt Stachel neue Objekte frei neben den vorhandenen Inhalt. Gestaltungsregeln: get_design_guide.`;

export const DESIGN_GUIDE = `# So baut man auf Stachel ein gutes Board

## Aufbau
- Gliedere große Themen in **Rahmen** (frame) – je Thema/Arbeitsschritt einer, nebeneinander in Lesereihenfolge (links → rechts, dann nach unten). Abstand zwischen Rahmen 120–200.
- Im Rahmen: Innenabstand 48, oben ein Titel als Text (fontSize 40–56, bold, fontFamily condensed) oder nur der Rahmentitel.
- Hierarchie über Schriftgröße: Board-Überschrift 64–96 · Abschnitt 40–56 · Unterpunkt 28–32 · Fließtext 18–24.
- Eine Idee pro Haftnotiz, kurz (≤ 12 Wörter). Längere Texte in Karten (desc) oder Text-Objekten mit width.

## Abstände (Standard-Abstände)
- Notizen im Cluster: 24 Abstand (create_notes macht das), Cluster untereinander 120+.
- Formen im Flussdiagramm: 100–140 waagrecht, 60–80 senkrecht; auto_layout mode flow/tree erledigt das.
- Nichts überlappen lassen (außer Objekte in Rahmen). Die Tools melden Überdeckungen.

## Farben (Stachel-Look: Schwarz/Weiß mit Akzenten)
- Notizen: yellow (Standard), green, pink, blue, orange, violet, white – Farbe trägt Bedeutung (z. B. grün = gut, pink = Problem, blue = Idee). Höchstens 3–4 Farben je Bereich.
- Akzente: Grün #c9e14a, Blau #1763b5, Pink #ec4e92. Text schwarz (#0a0a0a). Formen: weiße Fläche + schwarzer Rand oder helle Fläche ohne Rand (strokeWidth 0).
- Verbinder schwarz bzw. in der Farbe des Zweigs; Beschriftungen kurz.
- Farbnamen: ${COLOR_NAMES.join(', ')} (oder #rrggbb).

## Verbinden
- Verbinder docken an Objekte an (from/to = id oder ref) und wandern mit. Stil curved (Standard), elbow für Flussdiagramme/Organigramme, straight für Zeitachsen.
- Andockseiten (n/e/s/w) nur setzen, wenn die automatische Wahl unschön ist.
- Mindmaps verbinden sich selbst (Linien zeichnet Stachel), keine Verbinder zwischen Mindmap-Knoten anlegen.

## Strukturen
- Mindmap (create_mindmap): Wurzel = Thema, 3–7 Hauptäste, je 2–6 Unterpunkte; ab 5 Hauptästen werden sie links/rechts verteilt.
- Kanban (create_kanban): Spalten Offen / In Arbeit / Erledigt, Karten mit Status, Tags, Fälligkeit.
- Tabelle für Vergleiche und Listen mit mehreren Spalten; erste Zeile = Kopf.
- Präsentation: Rahmen im Format 16:9 (format "16:9"), einer je Folie.

## Prüfen
- Nach jedem größeren Schritt screenshot (ganzes Board, einzelner Rahmen oder ids). Achte auf: Überlappungen, abgeschnittene Texte, ungleichmäßige Abstände, zu viele Farben, leere Flächen. Mit auto_layout / arrange_objects nachbessern.`;

export function schemaText(): string {
  const lines = ['# Stachel-Objektschema (für den Assistenten)', '', 'Gemeinsam: id, type, x, y, w, h (Weltpunkte, linke obere Ecke, ungedreht), rotation, locked, hidden, linkTo, group (gleiche groupId), frame (Rahmen, der das Objekt enthält).', ''];
  for (const k of KINDS) {
    lines.push(`## ${k.type} – ${k.label}`, k.about, `Änderbar mit update_objects: ${k.updatable.join(', ')}`, k.create ? 'Anlegen: create_objects' : k.type === 'mindnode' ? 'Anlegen: create_mindmap' : 'Anlegen: nicht über MCP', '');
  }
  lines.push(`Formarten: ${SHAPE_KINDS.join(', ')}`, `Stempel: ${STAMPS.join(', ')}`, '', 'Text-Felder sind einfaches Markdown (jede Zeile ein Absatz; **fett**, *kursiv*, ~~durch~~, `code`, [Link](url), ==markiert==, Listen "- ", "1. ", "- [ ] ", Überschriften "# ").');
  return lines.join('\n');
}
