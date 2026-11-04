import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

// The timer's end signal of the Stachel board (P5, web `features/collab/sound.ts` `chime`): three short sine tones
// 880 / 880 / 1175 Hz at 0 / 0.22 / 0.44 s, each rising in 20 ms and fading exponentially (0.18 s, the last 0.5 s) –
// rendered once as a WAV in memory (no audio file in the app) and played with audioplayers.

const _rate = 22050;

/// The signal as 16-bit mono WAV (same envelope as the web's Web-Audio nodes).
Uint8List stachelChimeWav() {
  const total = 0.44 + 0.55 + 0.05;
  final n = (total * _rate).round();
  final samples = Float64List(n);
  for (final (i, start) in [0.0, 0.22, 0.44].indexed) {
    final f = i == 2 ? 1175.0 : 880.0;
    final fade = i == 2 ? 0.5 : 0.18;
    final s0 = ((0.02 + start) * _rate).round();
    final len = (0.55 * _rate).round();
    for (var k = 0; k < len && s0 + k < n; k++) {
      final t = k / _rate;
      // exponential ramp 0.0001 → 0.25 in 20 ms, then → 0.0001 at `fade`
      final double gain;
      if (t < 0.02) {
        gain = 0.0001 * math.pow(0.25 / 0.0001, t / 0.02);
      } else if (t < fade) {
        gain = 0.25 * math.pow(0.0001 / 0.25, (t - 0.02) / (fade - 0.02));
      } else {
        gain = 0;
      }
      samples[s0 + k] += gain * math.sin(2 * math.pi * f * t);
    }
  }
  final data = ByteData(44 + n * 2);
  void str(int at, String s) {
    for (var i = 0; i < s.length; i++) {
      data.setUint8(at + i, s.codeUnitAt(i));
    }
  }

  str(0, 'RIFF');
  data.setUint32(4, 36 + n * 2, Endian.little);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data
    ..setUint32(16, 16, Endian.little)
    ..setUint16(20, 1, Endian.little) // PCM
    ..setUint16(22, 1, Endian.little) // mono
    ..setUint32(24, _rate, Endian.little)
    ..setUint32(28, _rate * 2, Endian.little)
    ..setUint16(32, 2, Endian.little)
    ..setUint16(34, 16, Endian.little);
  str(36, 'data');
  data.setUint32(40, n * 2, Endian.little);
  for (var i = 0; i < n; i++) {
    data.setInt16(44 + i * 2, (samples[i].clamp(-1.0, 1.0) * 32767).round(), Endian.little);
  }
  return data.buffer.asUint8List();
}

Uint8List? _wav;
AudioPlayer? _player;

/// Plays the signal (errors – no audio output – are swallowed like the web's `try { … } catch {}`).
Future<void> playStachelChime() async {
  try {
    final p = _player ??= AudioPlayer();
    await p.stop();
    await p.play(BytesSource(_wav ??= stachelChimeWav(), mimeType: 'audio/wav'));
  } catch (_) {
    // no audio available
  }
}
