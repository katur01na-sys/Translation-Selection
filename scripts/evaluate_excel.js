const XLSX = require('./polskiej-chinese-src/node_modules/xlsx');
const wb = XLSX.readFile('/Users/wangyijun/Desktop/deepseek v4.0 flash.xlsx');
const sheetName = wb.SheetNames[0];
const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

// 测试点：刘雅（女）过去时 - przygotowałam
const row6 = data.find(r => r['#'] === 6);
console.log(`\n[测试1: 女性过去时] 中文: ${row6?.['源文']}`);
console.log(`波兰语译文: ${row6?.['当前译文']}`);

// 测试点：卡琳娜（女）对赵远（男）的敬语 Pan
const row15 = data.find(r => r['#'] === 15);
console.log(`\n[测试2: 敬语 Pan/Pani] 中文: ${row15?.['源文']}`);
console.log(`波兰语译文: ${row15?.['当前译文']}`);

// 测试点：赵远（男）过去时和动词变位 - zatrudniłem
const row47 = data.find(r => r['#'] === 47);
console.log(`\n[测试3: 男性过去时] 中文: ${row47?.['源文']}`);
console.log(`波兰语译文: ${row47?.['当前译文']}`);

// 测试点：刘雅（女）转述的句子和技术动词
const row62 = data.find(r => r['#'] === 62);
console.log(`\n[测试4: 复杂长句与技术推演] 中文: ${row62?.['源文']}`);
console.log(`波兰语译文: ${row62?.['当前译文']}`);

// 获取评分和错误统计
const scores = data.map(r => r['质量评分']).filter(s => s !== undefined && s !== null);
const avgScore = scores.reduce((a,b)=>a+b,0) / (scores.length || 1);
const totalErrors = data.reduce((sum, r) => sum + (r['错误数'] || 0), 0);
console.log(`\n=== 统计信息 ===`);
console.log(`平均分: ${avgScore.toFixed(1)}, 总错误数: ${totalErrors}`);

