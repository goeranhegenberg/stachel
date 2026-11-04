// German names of the board colors for screen readers (P8, audit P03) – the web's `ui/a11y.ts` `COLOR_NAMES`:
// „Notizfarbe Gelb“, „Textfarbe Blau“ instead of a hex value.

/// Names of all colors of STICKY_COLORS, SHAPE_FILLS, INK_COLORS and USER_COLORS (web `COLOR_NAMES`).
const colorNames = <String, String>{
  '#fff27a': 'Gelb',
  '#c9e14a': 'Grün',
  '#ffb3d1': 'Rosa',
  '#9fd3ff': 'Hellblau',
  '#ffd08a': 'Orange',
  '#e2d5ff': 'Lila',
  '#ffffff': 'Weiß',
  '#ff9e8a': 'Koralle',
  '#b9ecd8': 'Mint',
  '#7fd6e0': 'Türkis',
  '#7fb2f0': 'Mittelblau',
  '#d4d4cc': 'Steingrau',
  '#000000': 'Schwarz',
  '#0a0a0a': 'Schwarz',
  '#1763b5': 'Blau',
  '#ec4e92': 'Pink',
  '#e9e9e4': 'Hellgrau',
  '#8a8a85': 'Grau',
  '#7aa21b': 'Dunkelgrün',
  '#e8590c': 'Dunkelorange',
  '#7048e8': 'Violett',
  '#0c8599': 'Petrol',
  '#c2255c': 'Beere',
  '#5c940d': 'Olivgrün',
};

/// German name of [hex] (web `colorName`): unknown colors keep their value, none = „Standard“.
String colorName(String? hex) => hex == null ? 'Standard' : (colorNames[hex.toLowerCase()] ?? hex);
