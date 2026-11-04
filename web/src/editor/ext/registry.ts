// Register-Kern: Feature-Module tragen sich beim Import hier ein (define*). Gleiche id ersetzt einen Eintrag –
// so lässt sich auch Kern-Verhalten austauschen, ohne Kern-Dateien zu ändern. Siehe docs/architecture.md.
import type { BoardObject } from '../../protocol';
import { registerShapeOutline } from '../../board/connector';
import { registerTypeInfo } from '../../board/types';
import type {
  ContextActionDef,
  FileHandlerDef,
  MenuItemDef,
  ModalDef,
  ObjectTypeDef,
  ShapeKindDef,
  ShortcutDef,
  SidebarTabDef,
  SlotDef,
  SlotName,
  ToolDef,
} from './types';

/** Liste mit Ersetzen per id und Sortierung nach `order` (bei Gleichstand: Eintragsreihenfolge). */
export class Registry<T> {
  private items = new Map<string, T>();
  private sorted: T[] | null = null;
  constructor(
    private readonly keyOf: (t: T) => string,
    private readonly orderOf: (t: T) => number = () => 0,
  ) {}
  define(item: T) {
    this.items.set(this.keyOf(item), item);
    this.sorted = null;
  }
  remove(key: string) {
    this.items.delete(key);
    this.sorted = null;
  }
  get(key: string): T | undefined {
    return this.items.get(key);
  }
  list(): readonly T[] {
    this.sorted ??= [...this.items.values()].map((t, i) => [t, i] as const).sort((a, b) => this.orderOf(a[0]) - this.orderOf(b[0]) || a[1] - b[1]).map(([t]) => t);
    return this.sorted;
  }
}

export const objectTypes = new Registry<ObjectTypeDef>((d) => d.type);
export const shapeKinds = new Registry<ShapeKindDef>(
  (d) => d.kind,
  (d) => d.order,
);
export const tools = new Registry<ToolDef>(
  (d) => d.id,
  (d) => d.order,
);
export const contextActions = new Registry<ContextActionDef>(
  (d) => d.id,
  (d) => d.order,
);
export const shortcuts = new Registry<ShortcutDef>((d) => d.id);
export const slots = new Registry<SlotDef>(
  (d) => d.id,
  (d) => d.order,
);
export const sidebarTabs = new Registry<SidebarTabDef>(
  (d) => d.id,
  (d) => d.order,
);
export const modals = new Registry<ModalDef>((d) => d.id);
export const menuItems = new Registry<MenuItemDef>(
  (d) => d.id,
  (d) => d.order,
);
export const fileHandlers = new Registry<FileHandlerDef>((d) => d.id);

// ---- define* ------------------------------------------------------------------------------------------------------

export function defineObjectType(def: ObjectTypeDef) {
  objectTypes.define(def);
  const { below, hit, dependent, move, remap, plainText, sibling, invisible } = def;
  registerTypeInfo(def.type, { below, hit, dependent: dependent ?? !!def.derive, move, remap, plainText, sibling, invisible });
  for (const a of def.actions ?? []) contextActions.define(a);
}

export function defineShapeKind(def: ShapeKindDef) {
  shapeKinds.define(def);
  if (def.outline) registerShapeOutline(def.kind, def.outline);
}

export const defineTool = (def: ToolDef) => tools.define(def);
export const defineContextAction = (def: ContextActionDef) => contextActions.define(def);
export const defineShortcut = (def: ShortcutDef) => shortcuts.define(def);
export const defineSlot = (def: SlotDef) => slots.define(def);
export const defineSidebarTab = (def: SidebarTabDef) => sidebarTabs.define(def);
export const defineModal = (def: ModalDef) => modals.define(def);
export const defineMenuItem = (def: MenuItemDef) => menuItems.define(def);
export const defineFileHandler = (def: FileHandlerDef) => fileHandlers.define(def);

// ---- Lesen --------------------------------------------------------------------------------------------------------

const NO_TYPE: Partial<ObjectTypeDef> = {};

/** Typ-Definition eines Objekts (leer für unbekannte Typen). */
export const typeDef = (o: Pick<BoardObject, 'type'> | string): Partial<ObjectTypeDef> =>
  objectTypes.get(typeof o === 'string' ? o : o.type) ?? NO_TYPE;

export const slotsAt = (slot: SlotName) => slots.list().filter((s) => s.slot === slot);

/** Bearbeitbar durch Tippen bzw. Enter (Text im Objekt oder Titel) */
export const typesIntoText = (o: Pick<BoardObject, 'type'>) => {
  const e = typeDef(o).edit;
  return e === 'text' || e === 'title';
};
