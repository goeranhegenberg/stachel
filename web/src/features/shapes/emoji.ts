// Eigener Emoji-Datensatz (offline, ohne Paket): Zeichen mit deutschen Suchwörtern, nach Gruppen.
// Format je Gruppe: "Zeichen wort wort|Zeichen wort …". Dargestellt mit der Emoji-Schrift des Systems.
import { matches } from './catalog';

export interface EmojiEntry {
  ch: string;
  keys: string;
  group: string;
}

const RAW: [string, string][] = [
  [
    'Smileys',
    '😀 grinsen lachen freude|😃 lachen freude glücklich|😄 lachen augen freude|😁 grinsen zähne|😆 lachen zugekniffen|😅 schweiß erleichtert|🤣 kugeln lachen boden|😂 tränen lachen|🙂 lächeln|🙃 kopfüber ironie|😉 zwinkern|😊 lächeln rot|😇 engel unschuld|🥰 verliebt herzen|😍 herzaugen verliebt|🤩 sternaugen begeistert wow|😘 kuss|😋 lecker zunge|😛 zunge|😜 zwinkern zunge verrückt|🤪 verrückt crazy|🤑 geld|🤗 umarmen danke|🤭 kichern hand|🤫 psst leise geheim|🤔 denken nachdenken überlegen|🤐 reißverschluss schweigen|🤨 skeptisch augenbraue|😐 neutral|😑 ausdruckslos|😶 sprachlos|😏 grinsen schief|😒 genervt|🙄 augenrollen genervt|😬 grimasse peinlich|😮‍💨 ausatmen puh|🤥 lügen|😌 erleichtert|😔 nachdenklich traurig|😪 müde schläfrig|🤤 sabbern|😴 schlafen müde|😷 maske krank|🤒 fieber krank|🤕 verletzt verband|🤢 übel|🤮 erbrechen|🥵 heiß schwitzen hitze|🥶 kalt frieren|🥴 benommen beschwipst|😵 schwindlig|🤯 explodieren kopf wow|🤠 cowboy|🥳 party feiern geburtstag|😎 cool sonnenbrille|🤓 nerd streber|🧐 monokel prüfen|😕 verwirrt|😟 besorgt|🙁 traurig|😮 überrascht staunen|😲 erstaunt schock|😳 errötet peinlich|🥺 bitte flehen|😢 weinen träne|😭 heulen weinen|😱 schreien angst|😖 verzweifelt|😣 durchhalten|😞 enttäuscht|😓 schweiß|😩 erschöpft|😫 müde fertig|🥱 gähnen müde|😤 schnauben triumph|😡 wütend sauer|😠 ärgerlich|🤬 fluchen|😈 teufel frech|💀 totenkopf|💩 haufen kacke|🤡 clown|👻 geist gespenst|👽 alien|🤖 roboter|😺 katze lachen|😻 katze verliebt',
  ],
  [
    'Gesten',
    '👍 daumen hoch gut ja super okay|👎 daumen runter schlecht nein|👌 okay perfekt|✌️ peace frieden sieg|🤞 daumen drücken glück|🤟 liebe dich|🤘 rock metal|🤙 anrufen hang loose|👈 links zeigen|👉 rechts zeigen|👆 oben zeigen|👇 unten zeigen|☝️ achtung zeigefinger|👋 winken hallo tschüss|🤚 hand stopp|✋ hand stopp|🖐️ hand fünf|🖖 vulkanier|👏 klatschen applaus bravo|🙌 hurra jubel|👐 offene hände|🤲 bitten|🤝 handschlag einigung deal|🙏 danke bitte beten|✍️ schreiben|💪 stark muskel kraft|🦾 roboterarm|🧠 gehirn idee denken|👀 augen schauen ansehen|👁️ auge|👂 ohr hören|👃 nase|👄 mund|🫶 herzhände liebe|🫡 salutieren|👶 baby|🧒 kind|👦 junge|👧 mädchen|🧑 person|👨 mann|👩 frau|🧓 älter|🧑‍💻 entwickler laptop programmieren|🧑‍🔧 technik mechaniker|🧑‍🍳 koch küche|🧑‍🎤 sänger musik|🧑‍🎨 künstler kunst|🧑‍🚒 feuerwehr|👮 polizei|🕵️ detektiv|💂 wache|👷 bau bauarbeiter helm|🧑‍⚕️ sanitäter arzt|🦸 held superheld|🧙 zauberer|🧚 fee|🧜 meerjungfrau|🙋 melden hand hoch frage|🙅 nein stopp|🙆 okay ja|💁 info|🤷 schulterzucken weiß nicht|🤦 facepalm|🙇 verbeugen entschuldigung|💃 tanzen|🕺 tanzen disco|👯 tanzen gruppe|🚶 gehen laufen|🏃 rennen eilig schnell|🧘 yoga ruhe|👪 familie|👫 paar|🗣️ sprechen reden|👥 gruppe team leute',
  ],
  [
    'Herzen & Symbole',
    '❤️ herz liebe rot|🧡 herz orange|💛 herz gelb|💚 herz grün|💙 herz blau|💜 herz lila|🖤 herz schwarz|🤍 herz weiß|🤎 herz braun|💔 gebrochenes herz|❣️ herz ausrufezeichen|💕 herzen|💖 funkelndes herz|💯 hundert prozent perfekt|💢 ärger|💥 knall explosion|💫 schwindel stern|💦 tropfen schweiß|💨 schnell wind|💬 sprechblase kommentar|💭 gedanke|💤 schlafen|✅ erledigt haken fertig ja|☑️ abgehakt|✔️ haken|❌ kreuz falsch nein|❎ kreuz|➕ plus|➖ minus|➗ geteilt|✖️ mal|❓ frage|❔ frage weiß|❗ ausrufezeichen wichtig|❕ ausrufezeichen|‼️ doppelt wichtig|⁉️ frage ausruf|⚠️ warnung achtung|🚫 verboten|⛔ verboten einfahrt|🔴 rot punkt|🟠 orange punkt|🟡 gelb punkt|🟢 grün punkt|🔵 blau punkt|🟣 lila punkt|⚫ schwarz punkt|⚪ weiß punkt|🟥 rot quadrat|🟧 orange quadrat|🟨 gelb quadrat|🟩 grün quadrat|🟦 blau quadrat|🟪 lila quadrat|⭐ stern|🌟 leuchtender stern|✨ funkeln glitzer neu|⚡ blitz schnell strom|🔥 feuer heiß top|🎯 ziel treffer|🏁 ziel flagge|🚩 flagge markierung|🏳️‍🌈 regenbogen pride|♻️ recycling|🆕 neu|🆗 ok|🆒 cool|🆘 sos hilfe|🔝 top|🔜 bald|ℹ️ info|🔔 glocke|🔕 stumm|📌 pin stecknadel|📍 ort pin|🔗 link|🔒 schloss gesperrt|🔓 offen|🔑 schlüssel|⏰ wecker zeit|⏳ sanduhr warten|⌛ sanduhr|🕐 uhr|♾️ unendlich|🔀 zufall mischen|🔁 wiederholen|➡️ pfeil rechts|⬅️ pfeil links|⬆️ pfeil hoch|⬇️ pfeil runter|↗️ pfeil schräg|🔃 aktualisieren',
  ],
  [
    'Natur',
    '🌵 kaktus stachel|🌱 keim pflanze wachsen|🌿 kraut|☘️ klee|🍀 glücksklee glück|🌳 baum|🌲 tanne nadelbaum|🌴 palme urlaub|🍁 ahorn herbst|🍂 laub herbst|🍃 blätter|🌸 kirschblüte|🌺 hibiskus blume|🌻 sonnenblume|🌹 rose|🌷 tulpe|🌼 blüte|💐 blumenstrauß|🍄 pilz|🌍 erde welt europa|🌎 erde amerika|🌏 erde asien|🌙 mond nacht|🌕 vollmond|🌞 sonne gesicht|☀️ sonne sonnig|🌤️ sonne wolke|⛅ wolkig|☁️ wolke|🌧️ regen|⛈️ gewitter|🌩️ blitz|❄️ schnee kalt|☃️ schneemann|🌈 regenbogen|☔ regenschirm|💧 tropfen wasser|🌊 welle meer|🌪️ tornado sturm|🌫️ nebel|🔥 feuer|🐶 hund|🐱 katze|🐭 maus|🐹 hamster|🐰 hase|🦊 fuchs|🐻 bär|🐼 panda|🐨 koala|🐯 tiger|🦁 löwe|🐮 kuh|🐷 schwein|🐸 frosch|🐵 affe|🐔 huhn|🐧 pinguin|🐦 vogel|🦆 ente|🦉 eule|🦇 fledermaus|🐺 wolf|🐗 wildschwein|🐴 pferd|🦄 einhorn|🐝 biene|🐛 raupe|🦋 schmetterling|🐌 schnecke langsam|🐞 marienkäfer|🐜 ameise|🕷️ spinne|🐢 schildkröte langsam|🐍 schlange|🦎 eidechse|🐙 oktopus|🦀 krebs|🐠 fisch|🐬 delfin|🐳 wal|🦈 hai|🐊 krokodil|🦒 giraffe|🐘 elefant|🦔 igel|🐿️ eichhörnchen|🐾 pfoten spuren',
  ],
  [
    'Essen & Trinken',
    '🍏 apfel grün|🍎 apfel rot|🍐 birne|🍊 orange|🍋 zitrone|🍌 banane|🍉 wassermelone|🍇 trauben|🍓 erdbeere|🫐 blaubeere|🍒 kirsche|🍑 pfirsich|🥭 mango|🍍 ananas|🥥 kokosnuss|🥝 kiwi|🍅 tomate|🥑 avocado|🍆 aubergine|🥕 karotte möhre|🌽 mais|🌶️ chili scharf|🥒 gurke|🥦 brokkoli|🧄 knoblauch|🧅 zwiebel|🥔 kartoffel|🥐 croissant|🥖 baguette brot|🍞 brot|🥨 brezel|🧀 käse|🥚 ei|🍳 spiegelei|🥞 pfannkuchen|🥓 speck|🍔 burger|🍟 pommes|🍕 pizza|🌭 hotdog wurst|🥪 sandwich|🌮 taco|🌯 burrito wrap|🥗 salat|🍝 nudeln pasta|🍜 suppe ramen|🍲 eintopf|🍛 curry|🍣 sushi|🍦 eis softeis|🍨 eis|🍩 donut|🍪 keks|🎂 geburtstagstorte|🍰 kuchen|🧁 cupcake|🍫 schokolade|🍬 bonbon|🍭 lolli|🍿 popcorn kino|☕ kaffee|🍵 tee|🧃 saft|🥤 becher getränk|🧋 bubble tea|🍺 bier|🍻 prost bier|🥂 sekt anstoßen|🍷 wein|🍸 cocktail|🍹 cocktail tropisch|🧉 mate|🥃 whisky|🧊 eis würfel|💧 wasser|🍽️ besteck essen|🍴 gabel messer',
  ],
  [
    'Feiern & Freizeit',
    '🎉 party konfetti feiern|🎊 konfetti|🎈 luftballon|🎁 geschenk|🎀 schleife|🎄 weihnachtsbaum|🎃 kürbis halloween|🎆 feuerwerk|🎇 wunderkerze|🪩 discokugel|🎤 mikrofon singen|🎧 kopfhörer musik|🎼 noten|🎵 musik note|🎶 musik|🎹 klavier|🥁 schlagzeug|🎸 gitarre|🎺 trompete|🎷 saxophon|🎻 geige|🪕 banjo|🎪 zirkuszelt festival|🎭 theater|🎨 kunst palette|🎬 film klappe|🎮 spielen|🎲 würfel|🧩 puzzle|♟️ schach|🎯 dart ziel|🎳 bowling|⚽ fußball|🏀 basketball|🏐 volleyball|🎾 tennis|🏓 tischtennis|🏸 badminton|🥏 frisbee|⛳ golf|🏹 bogen|🎣 angeln|🛹 skateboard|⛺ zelt camping|🏕️ camping|🔥 lagerfeuer|🏆 pokal sieger|🥇 gold erster|🥈 silber zweiter|🥉 bronze dritter|🏅 medaille|🎫 ticket eintritt|🎟️ eintrittskarte ticket|📸 foto kamera|📷 kamera|🎥 videokamera|🎙️ podcast mikro|📻 radio',
  ],
  [
    'Reisen & Orte',
    '🚗 auto|🚕 taxi|🚌 bus|🚐 kleinbus|🚚 lieferwagen transport|🚛 lkw|🚜 traktor|🏍️ motorrad|🚲 fahrrad|🛴 roller|🚂 zug|🚆 zug bahn|🚇 u-bahn|🚊 straßenbahn|✈️ flugzeug flug|🚁 hubschrauber|🚀 rakete start launch|🛸 ufo|⛵ segelboot|🚤 boot|🛳️ schiff|⚓ anker|⛽ tankstelle|🚧 baustelle|🚦 ampel|🛑 stopp schild|🚏 haltestelle|🗺️ karte|🧭 kompass|🏔️ berg|⛰️ berg|🏖️ strand|🏝️ insel|🏜️ wüste|🏞️ park|🏟️ stadion|🏛️ gebäude|🏗️ kran bau|🏠 haus zuhause|🏡 haus garten|🏢 büro|🏥 krankenhaus|🏦 bank|🏨 hotel|🏪 laden|🏫 schule|🏰 burg|⛪ kirche|🗼 turm|🗽 freiheitsstatue|⛲ brunnen|🎡 riesenrad|🎢 achterbahn|🎠 karussell|🌃 nacht stadt|🌆 stadt abend|🌄 sonnenaufgang|🌅 sonnenaufgang meer|🚻 toiletten wc|🚾 wc|♿ rollstuhl barrierefrei|🅿️ parken parkplatz',
  ],
  [
    'Objekte',
    '💡 idee glühbirne|🔦 taschenlampe|🕯️ kerze|📱 handy smartphone|💻 laptop computer|🖥️ bildschirm|⌨️ tastatur|🖱️ maus|🖨️ drucker|📞 telefon|☎️ telefon|📠 fax|🔋 akku batterie|🔌 stecker strom|💾 speichern diskette|💿 cd|📀 dvd|📺 fernseher|📡 antenne|⏱️ stoppuhr|⏲️ timer|🕰️ uhr|💰 geld sack|💶 euro geld|💳 karte zahlen|🧾 beleg quittung|💸 geld weg ausgaben|📈 steigend wachstum chart|📉 fallend chart|📊 balken diagramm statistik|📋 klemmbrett liste|📌 pin|📎 büroklammer|✂️ schere|📏 lineal|📐 geodreieck|🖊️ stift|✏️ bleistift|🖍️ wachsmalstift|🖌️ pinsel|📝 notiz memo|📒 notizbuch|📓 notizbuch|📔 buch|📕 buch rot|📚 bücher lernen|📄 seite dokument|📃 dokument|📑 lesezeichen|🗂️ register|📁 ordner|📂 ordner offen|🗃️ karteikasten|🗄️ aktenschrank|🗑️ papierkorb müll|📅 kalender datum|📆 kalender|🗓️ kalender planung|📇 kartei|📦 paket kiste|📫 briefkasten|✉️ brief|📧 e-mail|📨 eingang|📩 nachricht|📢 lautsprecher ansage|📣 megafon|🔔 glocke|🔍 lupe suchen|🔎 suchen|🔐 sicher|🧰 werkzeugkasten|🔧 schraubenschlüssel|🔨 hammer|🪛 schraubenzieher|⚙️ zahnrad einstellungen|🧲 magnet|🪜 leiter|🧯 feuerlöscher|🩹 pflaster|💊 tablette|🩺 stethoskop|🧪 reagenzglas test|🔬 mikroskop|🔭 teleskop|🧹 besen|🧺 korb|🧻 klopapier|🧼 seife|🪣 eimer|🚪 tür|🛏️ bett|🪑 stuhl|🛒 einkaufswagen|🎒 rucksack|👕 tshirt|👟 schuh|🧢 kappe|👓 brille|🕶️ sonnenbrille|💍 ring|👑 krone',
  ],
];

export const EMOJI_GROUPS: { id: string; label: string; items: EmojiEntry[] }[] = RAW.map(([label, raw]) => ({
  id: label,
  label,
  items: raw.split('|').map((part) => {
    const i = part.indexOf(' ');
    return { ch: part.slice(0, i), keys: part.slice(i + 1), group: label };
  }),
}));

export const ALL_EMOJI: EmojiEntry[] = (() => {
  // gleiche Zeichen in mehreren Gruppen nur einmal (Suchwörter zusammenführen)
  const seen = new Map<string, EmojiEntry>();
  for (const g of EMOJI_GROUPS)
    for (const e of g.items) {
      const prev = seen.get(e.ch);
      if (prev) prev.keys += ` ${e.keys}`;
      else seen.set(e.ch, { ...e });
    }
  return [...seen.values()];
})();

export const searchEmoji = (q: string) => ALL_EMOJI.filter((e) => matches(q, e.keys));

// ---- zuletzt verwendet (nur in diesem Browser) ---------------------------------------------------------------------------

const RECENT_KEY = 'stachel.shapes.recentEmoji';
const DEFAULT_RECENT = ['👍', '❤️', '🎉', '✅', '🔥', '🌵'];

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.slice(0, 12) : DEFAULT_RECENT;
  } catch {
    return DEFAULT_RECENT;
  }
}

export function rememberEmoji(ch: string) {
  try {
    const next = [ch, ...recentEmoji().filter((x) => x !== ch)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Speicher gesperrt (privates Fenster) – egal */
  }
}
