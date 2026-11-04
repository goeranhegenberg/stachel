// Haftnotiz: größte Schrift finden, bei der der Text in die Notiz passt.
export type MeasureFn = (text: string, fontSize: number) => number;

/** Zeilenumbruch wie im Browser (Wortweise, überlange Wörter werden hart getrennt). */
export function wrapLines(text: string, fontSize: number, maxWidth: number, measure: MeasureFn): string[] {
  return wrap(text, fontSize, maxWidth, measure).lines;
}

function wrap(text: string, fontSize: number, maxWidth: number, measure: MeasureFn): { lines: string[]; broke: boolean } {
  const lines: string[] = [];
  let broke = false;
  for (const para of text.split('\n')) {
    // Browser umbrechen auch nach Bindestrichen – das hier nachbilden.
    const tokens: { t: string; space: boolean }[] = [];
    for (const word of para.split(/\s+/).filter(Boolean)) {
      word.split(/(?<=-)(?=.)/).forEach((seg, i) => tokens.push({ t: seg, space: i === 0 }));
    }
    if (tokens.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const tok of tokens) {
      let t = tok.t;
      const cand = line ? line + (tok.space ? ' ' : '') + t : t;
      if (measure(cand, fontSize) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) lines.push(line);
      // überlanges Wort hart trennen
      while (measure(t, fontSize) > maxWidth && t.length > 1) {
        broke = true;
        let cut = t.length - 1;
        while (cut > 1 && measure(t.slice(0, cut), fontSize) > maxWidth) cut--;
        lines.push(t.slice(0, cut));
        t = t.slice(cut);
      }
      line = t;
    }
    lines.push(line);
  }
  return { lines, broke };
}

export const LINE_HEIGHT = 1.22;

/** Größte Schriftgröße in [min, max], bei der `text` in w×h passt. */
export function fitFontSize(
  text: string,
  w: number,
  h: number,
  measure: MeasureFn,
  opts: { min?: number; max?: number } = {},
): number {
  const min = opts.min ?? 6;
  const max = Math.max(min, opts.max ?? Math.min(64, w / 5));
  if (!text.trim()) return Math.round(max * 0.75);
  // Erst ohne Worttrennung versuchen; nur wenn das selbst bei `min` nicht geht, Trennung erlauben.
  let allowBreak = false;
  const fits = (fs: number) => {
    const { lines, broke } = wrap(text, fs, w, measure);
    return (allowBreak || !broke) && lines.length * fs * LINE_HEIGHT <= h;
  };
  if (fits(max)) return max;
  if (!fits(min)) allowBreak = true;
  let lo = min;
  let hi = max;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}
