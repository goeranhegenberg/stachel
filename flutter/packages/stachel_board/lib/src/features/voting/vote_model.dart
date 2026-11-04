import '../../model/board_object.dart';
import '../follow/collab_common.dart';

// Port of the web's `features/collab/voting.ts` (reading side; writing runs on the server with the web's code through
// the actions `collab.vote.*`). Session in `collab.vote`, votes in `collab.votes`, results in `collab.voteHistory`.

/// Archive size (web `MAX_HISTORY`).
const voteHistoryMax = 20;

/// Stimmen pro Person in the start sheet (web stepper 1–20, default 3).
const votePerPersonMax = 20;

/// Duration choices of the start sheet (web `DURATIONS`; null = „Ohne“).
const voteDurations = <(int?, String)>[(1, '1 Min.'), (3, '3 Min.'), (5, '5 Min.'), (10, '10 Min.'), (null, 'Ohne')];

class VoteSession {
  const VoteSession({
    required this.id,
    required this.title,
    required this.perPerson,
    required this.multi,
    required this.endsAt,
    required this.startedBy,
    required this.startedByName,
    required this.startedAt,
    required this.ended,
    required this.anonymous,
  });

  final String id;
  final String title;
  final int perPerson;
  final bool multi;

  /// End in ms since 1970 (null = no time limit).
  final int? endsAt;
  final String startedBy;
  final String startedByName;
  final int startedAt;
  final bool ended;
  final bool anonymous;

  /// Still running (not ended, time not over) – web `isRunning`.
  bool runningAt(int now) => !ended && (endsAt == null || now < endsAt!);
}

class Ranked {
  const Ranked(this.objectId, this.votes, this.rank);
  final String objectId;
  final int votes;
  final int rank;

  @override
  bool operator ==(Object other) =>
      other is Ranked && other.objectId == objectId && other.votes == votes && other.rank == rank;
  @override
  int get hashCode => Object.hash(objectId, votes, rank);
  @override
  String toString() => 'Ranked($objectId, $votes, $rank)';
}

class VoteResult {
  const VoteResult({
    required this.id,
    required this.title,
    required this.at,
    required this.voters,
    required this.total,
    required this.ranking,
  });
  final String id;
  final String title;

  /// ISO time ('' for the running session).
  final String at;
  final int voters;
  final int total;
  final List<Ranked> ranking;
}

double _num(Object? v, [double d = 0]) => v is num && v.isFinite ? v.toDouble() : d;
String _str(Object? v, [String d = '']) => v is String ? v : d;

/// Session from `collab.vote` (web `readSession`): tolerant, null without a valid one.
VoteSession? readVoteSession(Object? ext) {
  final s = ext is Map ? ext['session'] : null;
  if (s is! Map || s['id'] is! String) return null;
  final endsAt = s['endsAt'];
  return VoteSession(
    id: s['id'] as String,
    title: _str(s['title']),
    perPerson: _jsRound(_num(s['perPerson'], 3)).clamp(1, 1 << 30),
    multi: s['multi'] == true,
    endsAt: endsAt is num ? endsAt.toInt() : null,
    startedBy: _str(s['startedBy']),
    startedByName: _str(s['startedByName'], 'Jemand'),
    startedAt: _num(s['startedAt']).toInt(),
    ended: s['ended'] == true,
    anonymous: s['anonymous'] == true,
  );
}

int _jsRound(double v) => (v + 0.5).floorToDouble().toInt();

/// Votes `collab.votes` as `key → n` (only entries with a number).
Map<String, int> readVotes(Object? ext) => {
  if (ext is Map)
    for (final e in ext.entries)
      if (e.key is String && e.value is Map) e.key as String: _num((e.value as Map)['n']).toInt().clamp(0, 1 << 30),
};

/// Names at the votes (not anonymous): `key → name`.
Map<String, String> readVoteNames(Object? ext) => {
  if (ext is Map)
    for (final e in ext.entries)
      if (e.key is String && e.value is Map && (e.value as Map)['name'] is String)
        e.key as String: (e.value as Map)['name'] as String,
};

({String session, String user, String obj}) _parseKey(String k) {
  final parts = k.split('|');
  return (
    session: parts.first,
    user: parts.length > 1 ? parts[1] : '',
    obj: parts.length > 2 ? parts.sublist(2).join('|') : '',
  );
}

/// Who stands in the vote key: the userKey, or in anonymous votes a checksum different per vote (web `voterOf`).
String voterOf(VoteSession s, String userKey) => s.anonymous ? 'anon-${cyrb53('${s.id}|$userKey')}' : userKey;

/// My votes in session [sessionId] per object (web `myVotes`).
Map<String, int> myVotes(Map<String, int> votes, String sessionId, String me) {
  final out = <String, int>{};
  for (final MapEntry(:key, :value) in votes.entries) {
    final p = _parseKey(key);
    if (p.session == sessionId && p.user == me) out[p.obj] = value < 0 ? 0 : value;
  }
  return out;
}

int usedVotes(Map<String, int> mine) => mine.values.fold(0, (a, b) => a + b);

/// Ranking of the objects by votes (same votes = same rank), voters, total (web `tally`).
({List<Ranked> ranking, int voters, int total}) tally(
  Map<String, int> votes,
  String sessionId, {
  bool Function(String id)? exists,
}) {
  final sums = <String, int>{};
  final voters = <String>{};
  for (final MapEntry(:key, :value) in votes.entries) {
    final p = _parseKey(key);
    if (p.session != sessionId || value <= 0 || (exists != null && !exists(p.obj))) continue;
    sums[p.obj] = (sums[p.obj] ?? 0) + value;
    voters.add(p.user);
  }
  final sorted = sums.entries.toList()
    ..sort((a, b) {
      final c = b.value - a.value;
      if (c != 0) return c;
      return a.key.compareTo(b.key) < 0 ? -1 : 1;
    });
  var rank = 0;
  var prev = -1;
  final ranking = <Ranked>[];
  for (final (i, e) in sorted.indexed) {
    if (e.value != prev) rank = i + 1;
    prev = e.value;
    ranking.add(Ranked(e.key, e.value, rank));
  }
  return (ranking: ranking, voters: voters.length, total: ranking.fold(0, (a, r) => a + r.votes));
}

/// Names per object (only votes with a name; sorted like `localeCompare(…, 'de')` for plain names) – web `voterNames`.
Map<String, List<String>> voterNames(Map<String, int> votes, Map<String, String> names, String sessionId) {
  final out = <String, List<String>>{};
  for (final MapEntry(:key, :value) in votes.entries) {
    final p = _parseKey(key);
    final name = names[key];
    if (p.session != sessionId || value <= 0 || name == null || name.isEmpty) continue;
    final list = out.putIfAbsent(p.obj, () => []);
    if (!list.contains(name)) list.add(name);
  }
  for (final l in out.values) {
    l.sort((a, b) => _deKey(a).compareTo(_deKey(b)));
  }
  return out;
}

String _deKey(String s) =>
    s.toLowerCase().replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u').replaceAll('ß', 'ss');

/// Results archive (web `readHistory`).
List<VoteResult> readVoteHistory(Object? ext) => [
  if (ext is List)
    for (final r in ext)
      if (r is Map && r['id'] is String && r['ranking'] is List)
        VoteResult(
          id: r['id'] as String,
          title: _str(r['title']),
          at: _str(r['at']),
          voters: _num(r['voters']).toInt(),
          total: _num(r['total']).toInt(),
          ranking: [
            for (final x in r['ranking'] as List)
              if (x is Map && x['objectId'] is String)
                Ranked(x['objectId'] as String, _num(x['votes']).toInt(), _num(x['rank']).toInt()),
          ],
        ),
];

/// Objects one can vote on: not connectors, pen strokes, frames, nothing invisible (web `votable`).
bool votable(BoardObject o) =>
    o.type != 'connector' &&
    o.type != 'pen' &&
    o.type != 'frame' &&
    !o.hidden &&
    !(o.type == 'mindnode' && o.mind.hidden);

// ---- cyrb53 (53-bit checksum, web `voting.ts`) ----------------------------------------------------------------------

int _imul(int a, int b) {
  // JS Math.imul: 32-bit multiplication, result as signed 32-bit
  final lo = ((a & 0xffff) * (b & 0xffffffff)) & 0xffffffff;
  final hi = ((((a >> 16) & 0xffff) * (b & 0xffffffff)) & 0xffff) << 16;
  return ((lo + hi) & 0xffffffff).toSigned(32);
}

int _u32(int v) => v & 0xffffffff;

/// The web's `cyrb53` (only to obscure, no cryptography): same string → same text in base 36.
String cyrb53(String str) {
  var h1 = 0xdeadbeef.toSigned(32);
  var h2 = 0x41c6ce57;
  for (final ch in str.codeUnits) {
    h1 = _imul(h1 ^ ch, 2654435761);
    h2 = _imul(h2 ^ ch, 1597334677);
  }
  h1 = _imul(h1 ^ (_u32(h1) >> 16), 2246822507) ^ _imul(h2 ^ (_u32(h2) >> 13), 3266489909);
  h2 = _imul(h2 ^ (_u32(h2) >> 16), 2246822507) ^ _imul(h1 ^ (_u32(h1) >> 13), 3266489909);
  final v = 4294967296 * (2097151 & h2) + _u32(h1);
  return v.toRadixString(36);
}

/// Votes of a running session for the bar and the targets (my votes, my left votes, voters so far).
class VoteView {
  VoteView(this.session, this.votes, this.names, String meKey)
    : voter = voterOf(session, meKey),
      mine = myVotes(votes, session.id, voterOf(session, meKey));
  final VoteSession session;
  final Map<String, int> votes;
  final Map<String, String> names;
  final String voter;
  final Map<String, int> mine;

  int get left => session.perPerson - usedVotes(mine);
  int get voterCount => tally(votes, session.id).voters;
}

/// Reads the vote structures of [ext] (board state `ext`).
({VoteSession? session, Map<String, int> votes, Map<String, String> names, List<VoteResult> history}) readVoting(
  Map<String, Object?> ext,
) => (
  session: readVoteSession(ext[extVote]),
  votes: readVotes(ext[extVotes]),
  names: readVoteNames(ext[extVotes]),
  history: readVoteHistory(ext[extVoteHistory]),
);
