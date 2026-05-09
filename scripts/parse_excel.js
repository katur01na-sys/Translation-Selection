const XLSX = require('./polskiej-chinese-src/node_modules/xlsx');
const wb = XLSX.readFile('/Users/wangyijun/Desktop/deepseek v4.0 flash.xlsx');
const sheetName = wb.SheetNames[0];
const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

console.log(`表头: ${JSON.stringify(data[0])}`);
console.log(`前3行数据:`);
for(let i = 1; i <= 3 && i < data.length; i++) {
  console.log(`[${i}] 中文: ${data[i][1]?.substring(0,20)}... | 波兰语: ${data[i][2]?.substring(0,30)}...`);
}
