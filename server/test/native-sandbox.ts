// Boards für App-Tests über einen laufenden Server anlegen (tools/sandbox.mts --seed, tools/native-fixtures.mts):
// Board per HTTP, echte Bilder/PDF hochladen, Inhalt wie ein Browser über /sync schreiben (native-seed.ts).
import sharp from 'sharp';
import { seedAllTypes, seedBig, type SeedImages } from './native-seed.js';
import { webClient } from './native-client.js';

/** Passwort-Login (Org-Fake) → Cookie-Header. */
export async function passwordLogin(base: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' }, body: JSON.stringify({ username, password }) });
  if (res.status !== 200) throw new Error(`Login ${username}: HTTP ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c?.startsWith('stachel_session='));
  if (!cookie) throw new Error('kein Sitzungs-Cookie');
  return cookie;
}

export async function createBoard(base: string, cookie: string, title: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Stachel': '1' }, body: JSON.stringify({ title }) });
  if (res.status !== 201) throw new Error(`Board anlegen: HTTP ${res.status}`);
  return ((await res.json()) as { board: { id: string } }).board.id;
}

async function upload(base: string, cookie: string, path: string, name: string, type: string, data: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type }), name);
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie, 'X-Stachel': '1' }, body: form });
  if (res.status !== 201) throw new Error(`Upload ${name}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { image?: { id: string }; file?: { id: string } };
  return (body.image ?? body.file)!.id;
}

/** Testbild mit Farbverlauf und Beschriftung (PNG). */
async function picture(w: number, h: number, a: string, b: string, label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="55%" font-family="sans-serif" font-size="${Math.round(h / 8)}" text-anchor="middle" fill="#ffffff">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const MINI_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** Bilder für das Alle-Typen-Board hochladen. */
export async function uploadSeedImages(base: string, cookie: string, boardId: string): Promise<SeedImages> {
  const img = (data: Buffer, name: string) => upload(base, cookie, `/api/boards/${boardId}/images`, name, 'image/png', data);
  return {
    photo: await img(await picture(1600, 1200, '#2b8a3e', '#c9e14a', 'Gelände'), 'gelaende.png'),
    page0: await img(await picture(1240, 1754, '#1763b5', '#9fd3ff', 'Seite 1'), 'seite1.png'),
    page1: await img(await picture(1754, 1240, '#ec4e92', '#ffb3d1', 'Seite 2'), 'seite2.png'),
    pdf: await upload(base, cookie, `/api/boards/${boardId}/files`, 'lageplan.pdf', 'application/pdf', MINI_PDF),
  };
}

/** Inhalt wie ein Browser schreiben und warten, bis der Server ihn hat. */
export async function seedViaSync(base: string, cookie: string, boardId: string, fill: (doc: import('yjs').Doc) => void) {
  const w = webClient(base.replace(/^http/, 'ws'), boardId, { cookie });
  try {
    await w.synced();
    fill(w.doc);
    await w.flushed(30_000);
  } finally {
    w.destroy();
  }
}

/** Board „Alle Typen“ mit echten Bildern; liefert Board-ID und Bild-IDs. */
export async function seedAllTypesBoard(base: string, cookie: string, title = 'Alle Typen') {
  const id = await createBoard(base, cookie, title);
  const images = await uploadSeedImages(base, cookie, id);
  await seedViaSync(base, cookie, id, (doc) => seedAllTypes(doc, images));
  return { id, images };
}

/** Großes Board (deterministisch, native-seed.ts seedBig). */
export async function seedBigBoard(base: string, cookie: string, n: number, title = `Groß ${n}`) {
  const id = await createBoard(base, cookie, title);
  await seedViaSync(base, cookie, id, (doc) => seedBig(doc, n));
  return { id };
}
