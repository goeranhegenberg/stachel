// Kleiner ZIP-Schreiber ohne Abhängigkeiten (für „Meine Daten herunterladen“, data-export.ts): Einträge werden einzeln
// gelesen, komprimiert und gestreamt – im Speicher liegt immer nur eine Datei. Kein ZIP64 (bis 4 GB, reicht für Boards).
import { Readable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Pfad im Archiv mit `/` (UTF-8) */
  name: string;
  /** Inhalt oder Lader (erst beim Schreiben aufgerufen); null = Eintrag überspringen (z. B. Datei fehlt) */
  data: Buffer | string | (() => Promise<Buffer | null>);
  /** false = speichern ohne Kompression (Bilder, PDFs) */
  compress?: boolean;
}

const MAX_32 = 0xffffffff;

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** ZIP als Stream; `now` = Zeitstempel aller Einträge. */
export function zipStream(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>, now = new Date()): Readable {
  const { time, date } = dosTime(now);
  async function* gen(): AsyncGenerator<Buffer> {
    const central: Buffer[] = [];
    let offset = 0;
    let count = 0;
    for await (const e of entries) {
      const raw = typeof e.data === 'function' ? await e.data() : typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data;
      if (!raw) continue;
      const name = Buffer.from(e.name, 'utf8');
      const deflate = e.compress !== false && raw.length > 0;
      const body = deflate ? deflateRawSync(raw, { level: 6 }) : raw;
      const crc = crc32(raw) >>> 0;
      if (offset + body.length + 30 + name.length > MAX_32) throw new Error('ZIP zu groß (über 4 GB)');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // Version zum Entpacken 2.0
      local.writeUInt16LE(0x0800, 6); // Bit 11: Namen in UTF-8
      local.writeUInt16LE(deflate ? 8 : 0, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(deflate ? 8 : 0, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(body.length, 20);
      cd.writeUInt32LE(raw.length, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, name);
      count++;
      offset += local.length + name.length + body.length;
      yield Buffer.concat([local, name]);
      yield body;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(cdBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    yield Buffer.concat([cdBuf, end]);
  }
  return Readable.from(gen(), { objectMode: false });
}
