const XLSX = require('/Users/wangyijun/Desktop/波兰语助手/polskiej-chinese-src/node_modules/xlsx');

const data = [
  ['Source', 'Target'],
  // ——— 日常对话 ———
  ["Hey, what's up?", "Hej, co słychać?"],
  ["I'm so tired today.", "Jestem dziś taka zmęczona."],
  ["Can you pass me the water?", "Możesz mi podać wodę?"],
  ["Let's grab some coffee.", "Chodźmy na kawę."],
  ["I'll be right back.", "Zaraz wracam."],
  // ——— 俚语/口语 ———
  ["That's lit, bro!", "To jest mega, bracie!"],
  ["She totally ghosted me.", "Ona mnie totalnie zignorowała."],
  ["Stop being so salty about it.", "Przestań się o to obrażać."],
  ["He's lowkey jealous.", "On jest po cichu zazdrosny."],
  ["No cap, this is the best show ever.", "Serio, to najlepszy serial ever."],
  // ——— 影视行业术语 ———
  ["We need to reshoot this scene.", "Musimy nakręcić tę scenę od nowa."],
  ["The ratings are through the roof.", "Oglądalność jest kosmiczna."],
  ["She nailed the audition.", "Zdała przesłuchanie na piątkę."],
  ["That's a wrap for today.", "Na dziś kończymy zdjęcia."],
  ["The plot twist was insane.", "Zwrot akcji był szalony."],
  // ——— 情感/冲突 ———
  ["You stabbed me in the back!", "Wbiłeś mi nóż w plecy!"],
  ["I can't believe you sold me out.", "Nie mogę uwierzyć, że mnie wydałeś."],
  ["We're done. Get out.", "Koniec. Wynoś się."],
  ["You think you're hot stuff?", "Myślisz, że jesteś kimś ważnym?"],
  ["Don't play dumb with me.", "Nie udawaj głupka."],
  // ——— 文化负载词 ———
  ["She's the real MVP.", "Ona jest prawdziwą gwiazdą."],
  ["That was a mic drop moment.", "To był moment, gdy powiedziano ostatnie słowo."],
  ["He pulled an all-nighter.", "Zarwał całą noc."],
  ["It's raining cats and dogs.", "Leje jak z cebra."],
  ["Break a leg!", "Połamania nóg!"],
  // ——— 商务/正式 ———
  ["Let's circle back on this.", "Wróćmy do tego później."],
  ["We need to touch base ASAP.", "Musimy się skontaktować jak najszybciej."],
  ["The deadline is non-negotiable.", "Termin jest niepodlegający negocjacjom."],
  ["Please keep me in the loop.", "Proszę, informujcie mnie na bieżąco."],
  ["Let's take this offline.", "Porozmawiajmy o tym prywatnie."],
  // ——— 混合/高难度 ———
  ["Yo, she straight up clapped back!", "Stary, ona mu po prostu odpowiedziała z mocą!"],
  ["He's been sus lately, not gonna lie.", "Ostatnio jest podejrzany, nie będę kłamać."],
  ["This whole situation is giving me anxiety.", "Ta cała sytuacja powoduje u mnie stres."],
  ["She threw shade at him during the meeting.", "Rzuciła w niego ukrytą kąśliwość na spotkaniu."],
  ["We're about to pull up on them.", "Zaraz się do nich doberamy."],
  // ——— 带有错误的翻译（用于测试审核） ———
  ["I love this city.", "Nienawidzę tego miasta."],  // 故意反义
  ["He went to the store.", "Poszedł do szkoły."],  // 故意错误地点
  ["She is very happy.", "Ona jest bardzo smutna."],  // 故意反义
  ["The weather is nice today.", ""],  // 空译文
  ["Good morning, everyone!", ""],  // 空译文
];

const ws = XLSX.utils.aoa_to_sheet(data);

// 设置列宽
ws['!cols'] = [{ wch: 45 }, { wch: 50 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '翻译测试');

const outPath = '/Users/wangyijun/Desktop/测试翻译文件.xlsx';
XLSX.writeFile(wb, outPath);
console.log('✅ 测试文件已生成：' + outPath);
console.log(`共 ${data.length - 1} 条句段（含 2 条故意错误 + 2 条空译文）`);
