// Objektfelder des Moduls tools (docs/features/tools.md), per Module-Augmentation statt in shared/protocol.ts.
declare module '../../../../shared/protocol' {
  interface BoardObject {
    /** ausgeblendet: für alle unsichtbar und nicht anklickbar, bis jemand „Ausgeblendete zeigen“ wählt */
    hidden?: boolean;
    /** Stiftstrich ist ein Textmarker: halbtransparent, `multiply` (Werkzeug Stift → Textmarker) */
    marker?: boolean;
    /** Link zu einem anderen Objekt bzw. Rahmen desselben Boards (Objekt-id); Knopf am Objekt springt hin */
    linkTo?: string;
  }
}
export {};
