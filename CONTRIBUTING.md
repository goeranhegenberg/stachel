# Contributing to Stachel

Thanks for your interest! Bug reports, ideas and pull requests are welcome – in **English or German**
(Beiträge auf Deutsch sind genauso willkommen).

## Before you start

- **Bugs and ideas:** open an issue (templates help). Security problems: see [SECURITY.md](SECURITY.md), not an issue.
- **Larger changes** (new object types, protocol or data-model changes, new dependencies): please open an issue first so
  we can agree on the approach. The UI deliberately follows the conventions of established online whiteboards –
  people should be able to start without explanation.
- Read [`docs/architecture.md`](docs/architecture.md) before touching the editor (core vs. feature modules, registries)
  and [`docs/contract.md`](docs/contract.md) for the HTTP API, Yjs data model and the native API.

## Development setup

Node.js 22.13+ (the server uses `node:sqlite`). Every folder is its own npm package (no workspace):

```bash
# server (port 8095), own accounts without mail server
cd server && npm ci
printf 'STACHEL_AUTH=local\nSTACHEL_MAIL_MODE=log\n' > .env   # mails (with links) go to data/mail.log
npm run dev

# web app (port 5173, proxies /api and /sync to the server)
cd web && npm ci && npm run dev
```

Open <http://localhost:5173>, register (the confirmation link is in `server/data/mail.log`, or set
`STACHEL_REQUIRE_VERIFICATION=0`) and create a board. Without a server: <http://localhost:5173/?offline=1&demo=1>.

A ready-made sandbox with seeded accounts and boards: `npm --prefix server run build` and then
`server/node_modules/.bin/tsx tools/sandbox.mts 8620 --local --seed`.

Flutter (Android app and shared packages) lives in [`flutter/`](flutter/): `flutter/packages/stachel_board` (board
model, renderer, editor), `flutter/packages/stachel_client` (app layer), `flutter/app` (the Stachel app). Flutter 3.47+.

## Tests

| Part | Command |
|---|---|
| Server | `cd server && npm test` (Vitest: API, auth, sync, native API) and `npm run build` |
| Web | `cd web && npm test` (Vitest) and `npm run build`; browser E2E: `npx playwright test` |
| Full stack | `cd e2e && npm ci && npm run build && npx playwright test` (real server + built web app) |
| MCP | `cd mcp && npm ci && npm test` (integration test needs the e2e build) |
| Flutter | `flutter analyze` and `flutter test` in `flutter/packages/stachel_board`, `flutter/packages/stachel_client`, `flutter/app` |

CI runs server, web, MCP unit tests, Flutter and a Docker build for every pull request. Golden images of the Flutter
board are rendered on Windows; regenerate them only there (`flutter test --update-goldens`).

Rules that keep web and apps in sync:

- A new object type or Yjs field in the web editor needs a row in `docs/native_paritaet.md` and `shared/native.ts`
  (otherwise `server/test/native-parity.test.ts` fails); a new Yjs field also needs the codec import in
  `server/src/native/web-impl.ts`.
- Logic the apps need is computed on the server with the web code (`defineNativeAction`, `docs/contract.md` §8.12) –
  keep such modules free of React.

## Pull requests

- Keep them focused; describe what and why, how you tested, and add screenshots for visible changes.
- Code style: TypeScript strict, Prettier-like formatting as in the surrounding code, comments explain *why*.
  Existing code and comments are mostly German – new code may use English or German, just stay consistent within a file.
- UI texts are German (short, no jargon); English UI is a welcome future contribution (i18n).
- No new runtime dependencies without discussion; no trackers, CDNs or external calls (privacy by design).
- Never commit secrets, personal data or real board content (fixtures and screenshots use invented data).

## License and sign-off (DCO)

Stachel is licensed under the [Apache License 2.0](LICENSE). By contributing you agree that your contribution is
licensed under the same license (Apache-2.0, section 5) – **no CLA** is required.

Please sign off every commit to certify the [Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "Fix connector snapping on rotated frames"
# adds: Signed-off-by: Your Name <you@example.org>
```

**File headers / SPDX:** new source files may start with an SPDX line, e.g.
`// SPDX-License-Identifier: Apache-2.0`; it is not required – files without a header are covered by `LICENSE` and
`NOTICE`. Do not add copyright headers of third parties to existing files. Code copied from other projects must be
license-compatible with Apache-2.0 and be named in the pull request (and in `NOTICE` where its license requires it).

The name “Stachel” and the logo are not covered by the code license – see [TRADEMARKS.md](TRADEMARKS.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
