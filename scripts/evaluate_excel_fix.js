const XLSX = require('./polskiej-chinese-src/node_modules/xlsx');
const wb = XLSX.readFile('/Users/wangyijun/Desktop/deepseek v4.0 flash.xlsx');
const sheetName = wb.SheetNames[0];
const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

console.log(data[0]);
console.log(data[6]);
console.log(data[15]);
console.log(data[47]);
