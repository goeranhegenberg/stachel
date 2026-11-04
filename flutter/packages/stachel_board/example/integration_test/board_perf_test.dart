// Performance spike E0 (concept §5 E0, target §3.2: ≥ 55 fps panning 2 000 mixed objects on a mid-range Android in a
// profile build, ≤ 1.5 s to the first picture). Boards like the web load test (perf-scale.spec.ts), see
// `mixedBoardJson`.
//
// Phone (profile, real frame times):
//   flutter drive --profile --driver=test_driver/perf_driver.dart --target=integration_test/board_perf_test.dart -d <id>
// Windows desktop:
//   flutter drive --profile --driver=test_driver/perf_driver.dart --target=integration_test/board_perf_test.dart -d windows
// With the Stachel sandbox (stachel/docs/native_fixtures/README.md) additionally the server's own big boards over the
// real WebSocket transport: --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600 (phone: http://<PC-IP>:8600, sandbox
// with --host 0.0.0.0).
// Results: console lines `PERF …` and build/integration_response_data.json.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:stachel_board/stachel_board.dart';

/// Frame statistics of one scenario.
class FrameStats {
  FrameStats(this.name, this.frames, this.elapsed);

  final String name;
  final List<FrameTiming> frames;
  final Duration elapsed;

  double _ms(Duration d) => d.inMicroseconds / 1000;
  List<double> _sorted(Duration Function(FrameTiming) f) => frames.map((t) => _ms(f(t))).toList()..sort();
  double _pct(List<double> s, double p) => s.isEmpty ? 0 : s[math.min(s.length - 1, (s.length * p).floor())];
  double _avg(List<double> s) => s.isEmpty ? 0 : s.reduce((a, b) => a + b) / s.length;

  Map<String, Object> toJson() {
    final build = _sorted((t) => t.buildDuration);
    final raster = _sorted((t) => t.rasterDuration);
    final worst = frames.map((t) => math.max(_ms(t.buildDuration), _ms(t.rasterDuration))).toList()..sort();
    final fps = frames.length / (elapsed.inMicroseconds / 1e6);
    return {
      'frames': frames.length,
      'fps': double.parse(fps.toStringAsFixed(1)),
      'build_avg_ms': double.parse(_avg(build).toStringAsFixed(2)),
      'build_p90_ms': double.parse(_pct(build, 0.9).toStringAsFixed(2)),
      'build_max_ms': double.parse((build.isEmpty ? 0.0 : build.last).toStringAsFixed(2)),
      'raster_avg_ms': double.parse(_avg(raster).toStringAsFixed(2)),
      'raster_p90_ms': double.parse(_pct(raster, 0.9).toStringAsFixed(2)),
      'raster_max_ms': double.parse((raster.isEmpty ? 0.0 : raster.last).toStringAsFixed(2)),
      // a frame is janky when UI or raster thread needs more than one 60 Hz frame
      'over_16ms_pct': double.parse(
        (worst.isEmpty ? 0.0 : worst.where((v) => v > 16.7).length * 100 / worst.length).toStringAsFixed(1),
      ),
    };
  }
}

/// Runs [step] once per frame for [duration] (t = 0 … 1) and returns the frame timings of that time.
Future<FrameStats> animate(String name, Duration duration, void Function(double t) step) async {
  final timings = <FrameTiming>[];
  void collect(List<FrameTiming> t) => timings.addAll(t);
  SchedulerBinding.instance.addTimingsCallback(collect);
  final done = Completer<void>();
  final sw = Stopwatch()..start();
  void frame(Duration _) {
    final t = sw.elapsedMicroseconds / duration.inMicroseconds;
    step(math.min(1, t));
    if (t >= 1) {
      done.complete();
    } else {
      SchedulerBinding.instance.scheduleFrameCallback(frame);
    }
  }

  SchedulerBinding.instance.scheduleFrameCallback(frame);
  SchedulerBinding.instance.scheduleFrame();
  await done.future;
  final elapsed = sw.elapsed;
  // timings arrive in batches (about every 100 ms in profile mode)
  await Future<void>.delayed(const Duration(milliseconds: 600));
  SchedulerBinding.instance.removeTimingsCallback(collect);
  return FrameStats(name, timings, elapsed);
}

Future<MemoryBoardImages> benchImages() async {
  final images = MemoryBoardImages();
  for (var k = 0; k < 8; k++) {
    final rec = ui.PictureRecorder();
    final c = Canvas(rec);
    c.drawRect(
      const Rect.fromLTWH(0, 0, 800, 600),
      Paint()..color = HSLColor.fromAHSL(1, k * 45.0, 0.7, 0.55).toColor(),
    );
    c.drawRect(Rect.fromLTWH(100 + k * 20.0, 100, 300, 200), Paint()..color = Colors.white);
    images.put('bench-img-$k', await rec.endRecording().toImage(800, 600));
  }
  return images;
}

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');

/// Board source per benchmark: the generator (like the web's load test) or the sandbox's "Groß N" board.
Future<BoardSource> _source(int n, {required bool live}) async {
  if (!live) return FixtureBoardSource(BoardSnapshot.fromJson(mixedBoardJson(n)));
  Future<Object?> http(String method, String path, {String? bearer, Object? body}) async {
    final c = HttpClient();
    try {
      final req = await c.openUrl(method, Uri.parse('$_sandbox$path'));
      if (bearer != null) req.headers.set('Authorization', 'Bearer $bearer');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(body));
      }
      return jsonDecode(await (await req.close()).transform(utf8.decoder).join());
    } finally {
      c.close();
    }
  }

  final token =
      ((await http('POST', '/api/auth/app-session', bearer: 'sandbox-mara', body: {})) as Map)['token'] as String;
  final boards = (((await http('GET', '/api/boards', bearer: token)) as Map)['boards'] as List).cast<Map>();
  final id = boards.firstWhere((b) => b['title'] == 'Groß $n')['id'] as String;
  return NativeBoardSource(
    base: Uri.parse(_sandbox),
    board: id,
    token: ({bool fresh = false}) async => token,
    appVersion: 'bench',
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  final report = <String, Object>{};

  for (final (n, live) in [
    (2000, false),
    (5000, false),
    if (_sandbox != '') (2000, true),
    if (_sandbox != '') (5000, true),
  ]) {
    final key = live ? 'server_$n' : 'mixed_$n';
    testWidgets(
      'Leistung: $n Objekte (${live ? 'Sandbox-Board über WebSocket' : 'Generator wie perf-scale.spec.ts'})',
      (tester) async {
        final images = await benchImages();
        final camera = CameraController();
        final stats = PaintStats();
        final sw = Stopwatch()..start();
        final controller = BoardController(await _source(n, live: live));
        await controller.start();
        while (!controller.loaded) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        final parseMs = sw.elapsedMicroseconds / 1000;
        final firstFrame = Completer<void>();
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: BoardView(controller: controller, camera: camera, images: images, stats: stats, fitOnLoad: false),
            ),
          ),
        );
        SchedulerBinding.instance.addPostFrameCallback((_) => firstFrame.complete());
        await firstFrame.future;
        final firstFrameMs = sw.elapsedMicroseconds / 1000;
        final size = tester.view.physicalSize / tester.view.devicePixelRatio;
        final bounds = BoardScene(controller.state).bounds!;
        final boardW = bounds.width;
        final result = <String, Object>{
          'objects': n,
          'load_ms': double.parse(parseMs.toStringAsFixed(1)),
          'objects_loaded': controller.state.length,
          'first_frame_ms': double.parse(firstFrameMs.toStringAsFixed(1)),
          'viewport': '${size.width.round()}x${size.height.round()}',
        };

        // warm-up: record the pictures of the start area
        camera.value = const Camera(0, 0, 1);
        await animate('warmup', const Duration(milliseconds: 800), (_) {});

        // 1) pan at 100 % across the board (new objects keep coming into view → recording + culling)
        final pan100 = await animate('pan_100', const Duration(seconds: 4), (t) {
          camera.value = Camera(-t * (boardW - size.width) * 0.6, -t * boardW * 0.25, 1);
        });
        // 2) pan at 50 % (more objects in view, all with text)
        final pan50 = await animate('pan_50', const Duration(seconds: 4), (t) {
          camera.value = Camera(-t * boardW * 0.35, -t * boardW * 0.15, 0.5);
        });
        // 3) overview at 15 %: flat look, (almost) everything visible
        final pan15 = await animate('pan_15', const Duration(seconds: 3), (t) {
          camera.value = Camera(-t * boardW * 0.05, 0, 0.15);
        });
        // 4) pinch zoom 10 % → 150 % → 10 % around the screen center
        final center = size.center(Offset.zero);
        final pinch = await animate('pinch', const Duration(seconds: 5), (t) {
          final z = 0.1 * math.pow(15, 1 - (2 * t - 1).abs()).toDouble();
          camera.value = const Camera(0, 0, 1).zoomAt(center, 1).zoomAt(center, z);
        });

        for (final s in [pan100, pan50, pan15, pinch]) {
          result[s.name] = s.toJson();
        }
        result['pictures_cached'] = stats.cachedPictures;
        report[key] = result;
        binding.reportData = report;
        // ignore: avoid_print
        print('PERF $key ${result.toString()}');
        expect(pan100.frames, isNotEmpty);
        controller.dispose();
      },
    );
  }
}
