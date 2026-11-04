// P5 models: ports of the web's voting.ts, timer.ts, laser.ts and helpers – same results as the web code.
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/voting/vote_model.dart';

void main() {
  group('Abstimmung (voting.ts)', () {
    test('cyrb53 wie im Web (Referenzwerte aus Node)', () {
      expect(cyrb53('abc12345|a:mara'), '1k1ejg8ns1x');
      expect(cyrb53('Xy_-0aZ9|m:4711'), '1g3c7ytt6x1');
      expect(cyrb53(''), 'wvjl67o803');
      expect(cyrb53('äöü|ß'), 'x1jcdt8x7n');
      expect(cyrb53('x' * 50), '29gec3xvo41');
    });

    VoteSession session({bool anonymous = false, bool multi = false, int per = 3, int? endsAt, bool ended = false}) =>
        readVoteSession({
          'session': {
            'id': 'abc12345',
            'title': 'Bühne?',
            'perPerson': per,
            'multi': multi,
            'endsAt': endsAt,
            'startedBy': 'a:mara',
            'startedByName': 'Mara',
            'startedAt': 1000,
            'ended': ended,
            'anonymous': anonymous,
          },
        })!;

    test('Sitzung tolerant lesen, läuft bis zum Ende', () {
      expect(readVoteSession(null), isNull);
      expect(
        readVoteSession({
          'session': {'title': 'ohne id'},
        }),
        isNull,
      );
      final s = readVoteSession({
        'session': {'id': 'x', 'perPerson': 2.6},
      })!;
      expect((s.perPerson, s.startedByName, s.endsAt, s.multi), (3, 'Jemand', null, false));
      expect(session(endsAt: 5000).runningAt(4999), isTrue);
      expect(session(endsAt: 5000).runningAt(5000), isFalse);
      expect(session().runningAt(1 << 50), isTrue);
      expect(session(ended: true).runningAt(0), isFalse);
    });

    test('voterOf: anonym = Prüfsumme je Abstimmung', () {
      expect(voterOf(session(), 'a:mara'), 'a:mara');
      expect(voterOf(session(anonymous: true), 'a:mara'), 'anon-1k1ejg8ns1x');
    });

    test('Rangfolge: gleiche Stimmen = gleicher Platz, gelöschte zählen nicht, Wähler', () {
      final votes = readVotes({
        's1|a:mara|n1': {'n': 2, 'name': 'Mara'},
        's1|a:jonas|n2': {'n': 2, 'name': 'Jonas'},
        's1|a:lena|n3': {'n': 1, 'name': 'Lena'},
        's1|a:lena|weg': {'n': 4, 'name': 'Lena'},
        's2|a:mara|n1': {'n': 9},
        'kaputt': 'x',
      });
      final t = tally(votes, 's1', exists: (id) => id != 'weg');
      expect(t.ranking, const [Ranked('n1', 2, 1), Ranked('n2', 2, 1), Ranked('n3', 1, 3)]);
      expect((t.voters, t.total), (3, 5));
      expect(myVotes(votes, 's1', 'a:lena'), {'n3': 1, 'weg': 4});
      expect(usedVotes(myVotes(votes, 's1', 'a:lena')), 5);
      final names = voterNames(
        readVotes({
          's1|a:z|n1': {'n': 1, 'name': 'Zoe'},
          's1|a:a|n1': {'n': 1, 'name': 'Änne'},
          's1|a:b|n1': {'n': 1, 'name': 'Bernd'},
        }),
        readVoteNames({
          's1|a:z|n1': {'n': 1, 'name': 'Zoe'},
          's1|a:a|n1': {'n': 1, 'name': 'Änne'},
          's1|a:b|n1': {'n': 1, 'name': 'Bernd'},
        }),
        's1',
      );
      expect(names['n1'], ['Änne', 'Bernd', 'Zoe']);
    });

    test('Archiv tolerant lesen; abstimmbar sind nicht Verbinder, Stift, Rahmen, Ausgeblendetes', () {
      final h = readVoteHistory([
        {
          'id': 'v1',
          'title': 'A',
          'at': '2026-11-02T10:00:00Z',
          'voters': 2,
          'total': 3,
          'ranking': [
            {'objectId': 'n1', 'votes': 3, 'rank': 1},
          ],
        },
        {'id': 'kaputt'},
        'x',
      ]);
      expect(h.single.ranking.single, const Ranked('n1', 3, 1));
      BoardObject o(String type, [Map<String, Object?> more = const {}]) =>
          BoardObject({'id': 'o', 'type': type, 'x': 0, 'y': 0, 'w': 10, 'h': 10, ...more});
      expect(votable(o('sticky')), isTrue);
      expect(votable(o('shape')), isTrue);
      expect(votable(o('connector')), isFalse);
      expect(votable(o('pen')), isFalse);
      expect(votable(o('frame')), isFalse);
      expect(votable(o('sticky', {'hidden': true})), isFalse);
    });
  });

  group('Timer (timer.ts)', () {
    test('formatMs: Sekunden aufgerundet, ab einer Stunde mit Stunden', () {
      expect(formatMs(0), '0:00');
      expect(formatMs(1), '0:01');
      expect(formatMs(245000), '4:05');
      expect(formatMs(3723000), '1:02:03');
      expect(formatMs(-5), '0:00');
    });

    test('Ansicht: läuft, pausiert, „Zeit!“ 12 s nach dem Ende, dann aus', () {
      final t = readTimer({
        'timer': {'state': 'running', 'endsAt': 10000, 'remaining': 0, 'duration': 60000, 'by': 'Mara', 'run': 2},
      });
      expect((t.state, t.by, t.run), (TimerRun.running, 'Mara', 2));
      expect(timerView(t, 9999), TimerView.running);
      expect(timerView(t, 10000), TimerView.over);
      expect(timerView(t, 21999), TimerView.over);
      expect(timerView(t, 22000), TimerView.idle);
      expect(remainingMs(t, 4000), 6000);
      final p = readTimer({
        'timer': {'state': 'paused', 'remaining': 3000},
      });
      expect((timerView(p, 0), remainingMs(p, 99999)), (TimerView.paused, 3000));
      expect(readTimer(null).state, TimerRun.idle);
      expect(readTimer({'timer': 'x'}).state, TimerRun.idle);
    });
  });

  group('Laser (laser.ts)', () {
    test('Sender: letzte 24 Punkte gerundet, Strich-Anfänge in g', () {
      final s = LaserSender()..begin();
      var m = s.add(const Offset(1.4, 2.5));
      expect(m, {
        's': 1,
        'p': [1, 3],
        'g': [1],
      });
      for (var i = 0; i < 30; i++) {
        m = s.add(Offset(i.toDouble(), 0));
      }
      expect(m['s'], 31);
      expect((m['p']! as List).length, 48);
      expect(m.containsKey('g'), isFalse, reason: 'Anfang ist aus dem Fenster');
      s.begin();
      m = s.add(const Offset(5, 5));
      expect(m['g'], [32]);
    });

    test('Empfänger: neue Punkte, Lücke trennt, Neuladen beginnt von vorn, verblasst nach 900 ms', () {
      final r = LaserReceiver();
      expect(
        r.take({
          's': 2,
          'p': [0, 0, 10, 0],
          'g': [1],
        }, 100),
        isTrue,
      );
      expect(
        r.take({
          's': 2,
          'p': [0, 0, 10, 0],
        }, 110),
        isFalse,
        reason: 'nichts Neues',
      );
      expect(
        r.take({
          's': 5,
          'p': [40, 0, 50, 0],
        }, 120),
        isTrue,
      );
      expect([for (final p in r.points) p.gap], [true, false, true, false], reason: 'Punkt 3 fehlt → Lücke');
      expect(trailSegments(r.points, 120).length, 2);
      expect(
        r.take({
          's': 1,
          'p': [7, 7],
        }, 130),
        isTrue,
        reason: 'Seite neu geladen',
      );
      r.prune(1025);
      expect(r.points.length, 1);
      expect(
        r.take({
          's': 3,
          'p': [1],
        }, 200),
        isFalse,
        reason: 'ungültig',
      );
      final segs = trailSegments([const TrailPoint(0, 0, 0), const TrailPoint(1, 0, 450)], 450);
      expect(segs.single.alpha, 1);
      expect(trailSegments([const TrailPoint(0, 0, 0), const TrailPoint(1, 0, 0)], 900), isEmpty);
    });
  });

  group('Anwesenheit', () {
    test('Initialen wie im Web', () {
      expect(webInitials('Lena'), 'LE');
      expect(webInitials('Mara Kern'), 'MK');
      expect(webInitials('jean-luc picard'), 'JP');
      expect(webInitials('  '), '?');
      expect(webInitials('Ölaf (Orga)'), 'ÖO');
    });

    test('eine Person je Schlüssel ohne mich, Rechteck aus der Awareness, Status', () {
      const a = Peer(id: 1, key: 'k1', name: 'A', color: '#000000');
      const a2 = Peer(id: 2, key: 'k1', name: 'A', color: '#000000');
      const me = Peer(id: 3, key: 'me', name: 'Ich', color: '#000000');
      expect(uniquePeers([a, a2, me], 'me'), [a]);
      expect(awRect({'x': 1, 'y': 2, 'w': 3, 'h': 4}), const Rect.fromLTWH(1, 2, 3, 4));
      expect(awRect({'x': 1, 'y': 2, 'w': 0, 'h': 4}), isNull);
      expect(awRect({'x': 1, 'y': 2, 'w': 3}), isNull);
      expect(
        statusOf(const Peer(id: 1, key: 'k', name: '', color: '', extra: {'collab.status': 'away'})),
        PresenceStatus.away,
      );
      expect(
        statusOf(const Peer(id: 1, key: 'k', name: '', color: '', extra: {'collab.status': 'quatsch'})),
        PresenceStatus.active,
      );
    });
  });
}
