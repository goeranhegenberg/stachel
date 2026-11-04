// Rahmen-Vorlagen (16:9, A4, Handy …) im Rahmen-Werkzeug und in der Kontextleiste, Folgen bei Präsentationen.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { center, normRect, objRect, type Rect } from '../../../board/geometry';
import { defineContextAction, defineSlot, defineTool, tools, typeDef } from '../../../editor/ext/registry';
import { getToolOption, useToolOption } from '../../../editor/ext/toolOptions';
import type { EditorApi, SlotProps, ToolGesture, ToolPointerEvent } from '../../../editor/ext/types';
import { PopBtn } from '../../../editor/ContextBar';
import { Avatar } from '../card/card';
import { IconAspect, IconEye } from '../icons';
import { PRESENT_FIELD, type PresentState } from './present';
import { currentPresenter, takeFollowAfter } from './handover';

export interface FramePreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

/** Rahmen-Formate (Weltpunkte, 1 = 1 px bei 100 %). */
export const FRAME_PRESETS: FramePreset[] = [
  { id: 'free', label: 'Frei', w: 640, h: 420 },
  { id: '16:9', label: '16:9', w: 1280, h: 720 },
  { id: '4:3', label: '4:3', w: 1024, h: 768 },
  { id: 'a4', label: 'A4', w: 794, h: 1123 },
  { id: 'a4q', label: 'A4 quer', w: 1123, h: 794 },
  { id: 'phone', label: 'Handy', w: 390, h: 844 },
  { id: '1:1', label: 'Quadrat', w: 800, h: 800 },
];

const presetOf = (id: string) => FRAME_PRESETS.find((p) => p.id === id) ?? FRAME_PRESETS[0];

/** Rechteck aus Ziehen: mit Format festes Seitenverhältnis. */
export function presetRect(start: { x: number; y: number }, end: { x: number; y: number }, preset: FramePreset, square = false): Rect {
  let r = normRect(start, end);
  const free = preset.id === 'free';
  if (!free || square) {
    const ratio = free ? 1 : preset.w / preset.h;
    const w = Math.max(r.w, r.h * ratio);
    const h = w / ratio;
    const sx = Math.sign(end.x - start.x || 1);
    const sy = Math.sign(end.y - start.y || 1);
    r = normRect(start, { x: start.x + sx * w, y: start.y + sy * h });
  }
  return r;
}

function frameGesture(api: EditorApi, down: ToolPointerEvent): ToolGesture {
  const preset = presetOf(getToolOption('frame', 'preset', 'free'));
  const start = down.world;
  let rect: Rect | null = null;
  return {
    kind: 'draw',
    move: (e) => {
      rect = presetRect(start, e.world, preset, e.shift);
      api.setDraft({ kind: 'frame', rect });
    },
    up: (e) => {
      let r = rect ?? normRect(start, e.world);
      // kurzer Klick: Rahmen im gewählten Format um den Klickpunkt
      if (Math.hypot(e.screen.x - down.screen.x, e.screen.y - down.screen.y) < 8) r = { x: start.x - preset.w / 2, y: start.y - preset.h / 2, w: preset.w, h: preset.h };
      r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(16, Math.round(r.w)), h: Math.max(16, Math.round(r.h)) };
      const base = typeDef('frame').create!(center(r), api);
      api.create({ ...base, ...r }, { select: true });
    },
  };
}

function FrameOptions() {
  const [preset, setPreset] = useToolOption('frame', 'preset', 'free');
  return (
    <>
      {FRAME_PRESETS.map((p) => (
        <button key={p.id} className={`structure-fly-chip${preset === p.id ? ' is-active' : ''}`} aria-pressed={preset === p.id} aria-label={`Format ${p.label}`} onClick={() => setPreset(p.id)}>
          <PresetIcon p={p} />
          {p.label}
        </button>
      ))}
    </>
  );
}

/** Kleines Seitenverhältnis-Symbol. */
function PresetIcon({ p }: { p: FramePreset }) {
  if (p.id === 'free') return <span className="structure-preset-ico structure-preset-ico--free" />;
  const k = 16 / Math.max(p.w, p.h);
  return <span className="structure-preset-ico" style={{ width: Math.round(p.w * k), height: Math.round(p.h * k) }} />;
}

const coreFrame = tools.get('frame');
if (coreFrame) defineTool({ ...coreFrame, Options: FrameOptions, down: (e, api) => frameGesture(api, e) });

// ---- Format eines vorhandenen Rahmens ----------------------------------------------------------------------------------

defineContextAction({
  id: 'structure.frameFormat',
  order: 22,
  when: (c) => !!c.single && c.single.type === 'frame' && !c.locked,
  Bar: (p) => (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'frameFormat'} onToggle={p.togglePop('frameFormat')} label="Format">
        <IconAspect />
      </PopBtn>
    </div>
  ),
  pops: {
    frameFormat: {
      className: 'ctx-pop--list structure-pop-formats',
      label: 'Format',
      Body: (p) => (
        <>
          {FRAME_PRESETS.filter((x) => x.id !== 'free').map((x) => {
            const on = p.first.w === x.w && p.first.h === x.h;
            return (
              <button key={x.id} className={`ctx-chip structure-format-chip${on ? ' is-active' : ''}`} onClick={() => p.choose(() => ({ w: x.w, h: x.h }))}>
                <PresetIcon p={x} />
                {x.label}
              </button>
            );
          })}
        </>
      ),
    },
  },
});

// ---- Folgen (Mitlesende sehen den Rahmen der präsentierenden Person) ----------------------------------------------------

function FollowPresenter({ api, snap }: SlotProps) {
  const peers = useSyncExternalStore(api.session.subscribe, api.session.getPeers);
  // bei einer Übergabe präsentieren kurz zwei: die neue Person zählt
  const presenter = currentPresenter(peers);
  const state = presenter?.extra[PRESENT_FIELD] as PresentState | undefined;
  const [following, setFollowing] = useState<number | null>(null);
  const followingThis = presenter && following === presenter.clientId;
  const frame = state ? snap.byId.get(state.frameId) : undefined;
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!followingThis || !frame) return;
    const key = `${frame.id}:${frame.x}:${frame.y}:${frame.w}:${frame.h}`;
    if (last.current === key) return;
    last.current = key;
    api.fitTo(objRect(frame), 4);
  }, [api, followingThis, frame]);
  useEffect(() => {
    if (!presenter) {
      if (following !== null) setFollowing(null);
      return;
    }
    // Übergabe: wer der bisherigen Person folgte (bzw. sie selbst), folgt der neuen
    const from = state?.from;
    if (following !== presenter.clientId && ((from !== undefined && from === following) || takeFollowAfter(presenter))) {
      last.current = null;
      setFollowing(presenter.clientId);
    }
  }, [presenter, following, state?.from]);

  if (!presenter || !state) return null;
  return (
    <div className={`structure-follow panel${followingThis ? ' is-following' : ''}`} role="status" onPointerDown={(e) => e.stopPropagation()}>
      <Avatar person={{ key: presenter.user.key, name: presenter.user.name }} size={26} />
      <span className="structure-follow__text">
        <strong>{presenter.user.name}</strong> präsentiert
        <span className="structure-follow__frame">
          {state.index + 1}/{state.total} · {state.title}
        </span>
      </span>
      {followingThis ? (
        <button className="structure-follow__btn is-on" onClick={() => setFollowing(null)}>
          Nicht mehr folgen
        </button>
      ) : (
        <button
          className="structure-follow__btn"
          onClick={() => {
            last.current = null;
            setFollowing(presenter.clientId);
          }}
        >
          <IconEye size={16} /> Folgen
        </button>
      )}
    </div>
  );
}

defineSlot({ id: 'structure.follow', slot: 'overlay', order: 30, Component: FollowPresenter });
