// Feature-Modul „collab“: Zusammenarbeit – Kommentare mit @Erwähnung, Reaktionen, Abstimmung, Timer,
// Folgen und „Alle zu mir holen“, Laserpointer, Anwesenheit mit Status. Vertrag: docs/features/collab.md.
import './collab.css';
import { defineContextAction, defineMenuItem, defineModal, defineShortcut, defineSidebarTab, defineSlot, defineTool } from '../../editor/ext/registry';
import { CursorChatLayer, openCursorChat } from './CursorChat';
import { anchorAt } from './comments';
import { CommentLayer, startComment } from './CommentLayer';
import { CommentsIcon, CommentsPanel } from './CommentsPanel';
import { COMMENT_CURSOR, IconComment, IconLaser, LASER_CURSOR } from './icons';
import { LaserLayer, laserDown } from './LaserLayer';
import { AuthorHover, AuthorLabels, PeerUploads } from './PeerHints';
import { CollabBar, Notices } from './Notices';
import { FollowLayer, PresenceBar, summonAll } from './Presence';
import { ReactBar, ReactionLayer, ReactPicker } from './ReactionViews';
import { readTimer, startTimer, stopTimer, timerMap } from './timer';
import { timerView } from './TimerViews';
import { uiOf } from './ui';
import { VoteLayer, VoteResultsDialog, VoteStartDialog } from './VoteViews';
import { historyArray, readSession, voteMap } from './voting';

// ---- Werkzeuge ------------------------------------------------------------------------------------------------------

defineTool({
  id: 'collab.comment',
  label: 'Kommentar',
  // nach „Bild einfügen“ (am Handy hinter „Weitere Werkzeuge“)
  order: 110,
  key: 'c',
  sepBefore: true,
  Icon: IconComment,
  cursor: COMMENT_CURSOR,
  down: (_e, api) => ({
    kind: 'comment',
    up: (e) => {
      startComment(api, anchorAt(e.world, api.hitTest(e.world)));
      api.setTool('select');
    },
  }),
});

defineTool({ id: 'collab.laser', label: 'Laserpointer', hint: 'Laserpointer (gedrückt halten)', order: 112, phone: 'more', Icon: IconLaser, cursor: LASER_CURSOR, down: laserDown });

// ---- Oberfläche -----------------------------------------------------------------------------------------------------

defineSlot({ id: 'collab.bar', slot: 'topbarRight', order: 10, Component: CollabBar });
// ersetzt die Kern-Anwesenheit (EditorPage zeigt ihre eigene nur ohne 'core.presence')
defineSlot({ id: 'core.presence', slot: 'topbarRight', order: 90, Component: PresenceBar });
defineSlot({ id: 'collab.reactions', slot: 'overlay', order: 4, Component: ReactionLayer });
defineSlot({ id: 'collab.votes', slot: 'overlay', order: 6, Component: VoteLayer });
defineSlot({ id: 'collab.comments', slot: 'overlay', order: 8, Component: CommentLayer });
defineSlot({ id: 'collab.laser', slot: 'overlay', order: 20, Component: LaserLayer, presenting: true });
defineSlot({ id: 'collab.follow', slot: 'overlay', order: 30, Component: FollowLayer, presenting: true });
defineSlot({ id: 'collab.notices', slot: 'overlay', order: 40, Component: Notices, presenting: true });
defineSlot({ id: 'collab.cursorChat', slot: 'overlay', order: 25, Component: CursorChatLayer });
defineSlot({ id: 'collab.uploads', slot: 'overlay', order: 3, Component: PeerUploads });
defineSlot({ id: 'collab.author', slot: 'overlay', order: 5, Component: AuthorHover });
defineSlot({ id: 'collab.authors', slot: 'overlay', order: 4, Component: AuthorLabels });
defineShortcut({ id: 'collab.cursorChat', keys: ['/'], late: true, run: (api) => openCursorChat(api), help: { group: 'Zusammenarbeit', keys: '/', label: 'Nachricht am Mauszeiger', order: 40 } });

defineSidebarTab({ id: 'collab.comments', title: 'Kommentare', order: 10, button: true, Icon: CommentsIcon, Panel: CommentsPanel });

defineModal({ id: 'collab.voteStart', Component: VoteStartDialog });
defineModal({ id: 'collab.voteResults', Component: VoteResultsDialog });

defineContextAction({
  id: 'collab.react',
  order: 85,
  when: (c) => c.selected.length > 0,
  Bar: ReactBar,
  pops: { react: { className: 'ctx-pop--row collab-emoji-pop', label: 'Reaktionen', Body: ReactPicker } },
});

// ---- Menüs ----------------------------------------------------------------------------------------------------------

defineMenuItem({
  id: 'collab.comment',
  on: 'object',
  order: 75,
  item: (api, at) => ({ label: 'Kommentieren', shortcut: 'C', sep: true, onSelect: () => startComment(api, anchorAt(at, api.hitTest(at))) }),
});
defineMenuItem({ id: 'collab.commentHere', on: 'canvas', order: 40, item: (api, at) => ({ label: 'Hier kommentieren', sep: true, onSelect: () => startComment(api, anchorAt(at, null)) }) });

defineMenuItem({
  id: 'collab.vote',
  on: 'board',
  order: 40,
  item: (api) => {
    const s = readSession(voteMap(api.store));
    if (s && !s.ended) return { label: 'Abstimmung läuft …', disabled: true, onSelect: () => {} };
    return { label: s ? 'Ergebnis der Abstimmung' : 'Abstimmung starten', onSelect: () => api.openModal(s ? 'collab.voteResults' : 'collab.voteStart', s ? { id: s.id } : undefined) };
  },
});
defineMenuItem({
  id: 'collab.voteHistory',
  on: 'board',
  order: 41,
  item: (api) => (historyArray(api.store).length ? { label: 'Frühere Abstimmungen', onSelect: () => api.openModal('collab.voteResults', {}) } : null),
});
defineMenuItem({
  id: 'collab.timer',
  on: 'board',
  order: 45,
  item: (api) => {
    const t = readTimer(timerMap(api.store));
    if (timerView(t, Date.now()) !== 'idle') return { label: 'Timer beenden', onSelect: () => stopTimer(api.store) };
    return { label: 'Timer für alle: 5 Min.', onSelect: () => startTimer(api.store, 5 * 60_000, api.session.user.name) };
  },
});
defineMenuItem({
  id: 'collab.summon',
  on: 'board',
  order: 50,
  item: (api) => ({ label: 'Alle zu mir holen', disabled: api.session.getPeers().length === 0, onSelect: () => summonAll(api) }),
});
defineMenuItem({
  id: 'collab.toggleComments',
  on: 'board',
  order: 55,
  item: (api) => {
    const ui = uiOf(api.store);
    const on = ui.showComments.get();
    return { label: on ? 'Kommentar-Pins ausblenden' : 'Kommentar-Pins zeigen', onSelect: () => ui.showComments.set(!on) };
  },
});
