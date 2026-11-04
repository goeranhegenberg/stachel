/// Native Stachel board for Flutter apps – the Stachel app and host apps that embed it (concept `stachel/docs/native_flutter_konzept.md` §3).
///
/// - `protocol/`: messages of the native API v1 (welcome/patch/… in, hello/presence/ops out), [NativeBoardSource]
///   (WebSocket transport with resume, ping, token renewal), [PresenceSender] (own presence, throttled)
/// - `model/`: [BoardObject], [BoardState] (snapshot + patches), rich text, [BoardSource] + [BoardController],
///   [BoardCache] (offline: last snapshot per board)
/// - `geometry/`: shape paths (all 41 kinds), connector routes and caps, spatial grid, SVG path parser
/// - `render/`: [BoardPainter] (one CustomPainter, culling, picture cache, detail levels), [PresencePainter]
///   (others' cursors and selections), text layout, images
/// - `editor/`: [Camera] math, [BoardView] (pan/pinch/inertia, two-finger double tap, tap selection, focus `?o=`)
/// - `editor/registry/` (F2): registers like the web – tools, context bar entries, menus (object / empty board /
///   board), sheets, overlays, type behavior; `all_features.dart` collects every package's `features/*/register.dart`;
///   `editor/ui/`: tool bar, context bar with overflow, menu sheets, overlays and the hint service built from them
/// - `mindmap/`: port of the web's mind map code (layout, sizes from the Chromium font metrics, ops) for the
///   app's prediction of the server's `mind` op ([MindPlanner]), drawing and buttons of mind nodes
/// - `web/`: the web app's constants (`WebConstants`, generated from `stachel/docs/native_fixtures/web/constants.json`)
/// - `features/<paket>/register.dart`: the entries of every feature package (core, mind map, P1–P9)
/// - `fixtures/`, `debug/`: all-types board, benchmark generator, [BoardDebugScreen]
library;

export 'src/debug/board_debug_screen.dart';
export 'src/editor/board_editor.dart';
export 'src/editor/board_view.dart';
export 'src/editor/camera.dart';
export 'src/editor/desktop.dart';
export 'src/editor/editor_tools.dart';
export 'src/editor/gestures.dart';
export 'src/editor/transform.dart';
export 'src/features/arrange/arrange.dart';
export 'src/features/clipboard/clipboard.dart';
export 'src/features/desktop/keyboard.dart';
export 'src/features/desktop/shortcuts_help.dart';
export 'src/features/snapping/snapping.dart';
export 'src/editor/registry/all_features.dart';
export 'src/editor/registry/board_ui.dart';
export 'src/editor/registry/context_action_def.dart';
export 'src/editor/registry/menu_item_def.dart';
export 'src/editor/registry/overlay_def.dart';
export 'src/editor/registry/registry.dart';
export 'src/editor/registry/sheet_def.dart';
export 'src/editor/registry/tool_def.dart';
export 'src/editor/registry/type_behavior.dart';
export 'src/editor/ui/board_context_bar.dart';
export 'src/editor/ui/board_hints.dart';
export 'src/editor/ui/board_menus.dart';
export 'src/editor/ui/board_overlays.dart';
export 'src/editor/ui/board_side_panel.dart';
export 'src/editor/ui/board_toolbar.dart';
export 'src/editor/ui/multi_select_chip.dart';
export 'src/editor/rich_text_field.dart';
export 'src/editor/two_finger_tap.dart';
export 'src/features/core/core_widgets.dart';
export 'src/features/core/register.dart';
export 'src/features/richtext/format_bar.dart' show RichFormatBar, RichFormat;
export 'src/features/follow/collab_api.dart';
export 'src/features/documents/doc_pages.dart'
    show isPdfFile, looksLikePdf, maxPdfBytes, pageJpegQuality, renderSize, docType, cleanName;
export 'src/features/documents/document_host.dart';
export 'src/features/documents/documents.dart' show Documents, DocumentTexts;
export 'src/features/mindmap/register.dart';
export 'src/features/onboarding/gesture_onboarding.dart' show GestureOnboarding, showGestureOnboarding;
export 'src/features/private/private_model.dart';
export 'src/features/templates/instance_templates.dart';
export 'src/features/templates/own_templates.dart' show OwnTemplatesHost, OwnTemplate, ownCategory;
export 'src/features/text_object/next_note.dart' show NextNoteButton, editNext;
export 'src/features/versions/admin_host.dart';
export 'src/features/view/view_api.dart';
export 'src/fixtures/all_types_board.dart';
export 'src/fixtures/board_generator.dart';
export 'src/licenses.dart';
export 'src/geometry/connector_route.dart';
export 'src/geometry/shape_paths.dart';
export 'src/geometry/spatial_grid.dart';
export 'src/geometry/svg_path.dart';
export 'src/mindmap/mind_measure.dart';
export 'src/mindmap/mind_model.dart';
export 'src/mindmap/mind_plan.dart';
export 'src/mindmap/mind_render.dart';
export 'src/model/board_cache.dart';
export 'src/model/board_object.dart';
export 'src/model/board_source.dart';
export 'src/model/board_state.dart';
export 'src/model/collab.dart';
export 'src/features/shapes/catalog.dart' show shapeKindLabel;
export 'src/model/pending_ops.dart';
export 'src/model/pending_store.dart';
export 'src/model/rich_edit.dart';
export 'src/model/rich_text.dart';
export 'src/protocol/native_board_source.dart';
export 'src/protocol/native_messages.dart';
export 'src/protocol/presence_sender.dart';
export 'src/render/board_images.dart';
export 'src/render/board_painter.dart';
export 'src/render/board_scene.dart';
export 'src/render/collab_painter.dart';
export 'src/render/object_renderers.dart';
export 'src/render/paint_utils.dart';
export 'src/render/presence_painter.dart';
export 'src/render/text_layout.dart';
export 'src/web/web_constants.dart';
