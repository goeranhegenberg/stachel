// Sehr häufige Passwörter (aus öffentlichen Auswertungen geleakter Listen, international und deutsch), klein
// geschrieben. Geprüft wird das ganze Passwort und der Kern ohne Ziffern/Zeichen am Anfang und Ende
// („Passwort2024!“ → „passwort“). Kein Anspruch auf Vollständigkeit; Länge ≥ 10 fängt den Großteil ohnehin ab.
const LIST = `
123456 123456789 12345678 1234567890 12345 1234567 password passwort qwerty qwertz abc123 111111 123123 000000
1q2w3e4r 1q2w3e4r5t qwerty123 qwertz123 iloveyou ichliebedich admin welcome willkommen letmein monkey dragon
football fussball baseball master hello hallo hallo123 freedom whatever trustno1 sunshine princess starwars login
passw0rd password1 password12 password123 password1234 passwort1 passwort12 passwort123 passwort1234 geheim geheim123
superman batman shadow michael jennifer jordan hunter ranger buster soccer harley andrew charlie thomas daniel
robert matthew joshua anthony ashley nicole jessica summer winter sommer herbst fruehling frühling ficken schatz
schatzi hase hasi mausi maus engel sonne blume blumen sternchen schalke borussia bayern bayernmuenchen werder
hamburg berlin muenchen münchen leipzig dresden koeln köln frankfurt stuttgart deutschland germany europa
computer internet google samsung apple iphone android windows microsoft facebook instagram youtube netflix
pokemon minecraft fortnite naruto killer pepper ginger cookie cheese chocolate schokolade banane banana orange
lovely loveyou forever family familie freunde freund freundin baby babygirl angel daniela andrea sabine stefanie
alexander christian sebastian tobias markus michaela julia lukas jonas leon maximilian sophie marie anna laura
mustermann musterfrau test test123 test1234 testtest tester demo demo123 user user123 benutzer gast guest
root toor administrator changeme default secret secret123 asdf asdfgh asdfghjkl asdf1234 yxcvbnm zxcvbnm
qazwsx qazwsxedc 1qaz2wsx zaq12wsx q1w2e3r4 q1w2e3r4t5 aa123456 a123456 abcd1234 abcdef abcdefg abcdefgh
abc12345 123abc 112233 121212 123321 654321 666666 696969 777777 888888 987654321 999999 159753 147258369
1111111111 0000000000 1212121212 1234512345 9876543210 0123456789 1q2w3e 1qazxsw2 passwort! kennwort kennwort1
kennwort123 zugang zugang123 start start123 neu neu123 neustart hallowelt helloworld hello123 hello1234 welcome1
welcome123 letmein1 letmein123 iloveyou1 iloveyou2 princess1 sunshine1 monkey123 dragon123 master123 qwerty1
qwertyuiop qwertzuiop qwertyui asdfasdf asdfqwer 1234qwer qwer1234 qweasd qweasdzxc mypassword meinpasswort
dasistgeheim keinpasswort nopassword password! p@ssw0rd p@ssword pa55word passw0rd! pass pass123 pass1234
access access123 trustme jesus christ heaven gott hallelujah liebe liebe123 schnuffel schnucki teddy teddybaer
dennis florian patrick stefan andreas thorsten martin klaus peter wolfgang juergen jürgen manfred helmut
heinz werner gerhard dieter uwe frank ralf holger matthias michael1 marcel kevin justin jacqueline chantal
mercedes porsche ferrari audi bmw volkswagen golf corvette mustang yamaha harley1 hondacivic toyota
starwars1 matrix gandalf frodo hogwarts harrypotter pikachu superman1 spiderman ironman avengers marvel
liverpool arsenal chelsea manchester barcelona realmadrid juventus dortmund bvb09 s04 hsv fcbayern
abcabc abc123abc aaaaaa aaaaaaaa aaaaaaaaaa zzzzzz xxxxxx qqqqqq 11111111 22222222 55555555 12341234 11223344
kaktus kaktus123 stachel stachel123 miro miro123 whiteboard board board123 festival festival2024
festival2025 festival2026 sommer2024 sommer2025 sommer2026 winter2024 winter2025 winter2026 januar februar
maerz märz april juni juli august september oktober november dezember montag dienstag mittwoch donnerstag
freitag samstag sonntag
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean));
