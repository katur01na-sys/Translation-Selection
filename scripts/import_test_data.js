const XLSX = require('./polskiej-chinese-src/node_modules/xlsx')
const fs = require('fs')
const { execSync } = require('child_process')
const os = require('os')
const path = require('path')

const filePath = path.join(os.homedir(), 'Desktop', '测试翻译文件.xlsx')
const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'polish-chiny', 'ch-pl-lqa', 'lqa.db')

// 读取 Excel
const buf = fs.readFileSync(filePath)
const wb = XLSX.read(buf, { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
const dataRows = rows.slice(1).filter(r => r[0]) // 跳过表头，过滤空行

console.log(`读取到 ${dataRows.length} 条句段`)

// 插入项目
const fpEsc = filePath.replace(/'/g, "''")
execSync(`sqlite3 "${dbPath}" "INSERT OR IGNORE INTO projects (file_path, project_name, created_at, updated_at) VALUES ('${fpEsc}', '测试翻译文件.xlsx', datetime('now'), datetime('now'))"`)
const projectId = execSync(`sqlite3 "${dbPath}" "SELECT id FROM projects WHERE file_path = '${fpEsc}'"`, {encoding: 'utf8'}).trim()
console.log('项目ID:', projectId)

// 清空旧句段
execSync(`sqlite3 "${dbPath}" "DELETE FROM segments WHERE project_id = ${projectId}"`)

// 逐行插入（使用 heredoc 避免引号问题）
let ok = 0
for (let i = 0; i < dataRows.length; i++) {
  const src = String(dataRows[i][0] || '').replace(/'/g, "''")
  const tgt = String(dataRows[i][1] || '').replace(/'/g, "''")
  try {
    execSync(`sqlite3 "${dbPath}" "INSERT INTO segments (project_id, source, target, original_target, status, gender) VALUES (${projectId}, '${src}', '${tgt}', '${tgt}', 'pending', 'male')"`)
    ok++
  } catch(e) {
    console.warn(`第${i+1}行写入失败:`, e.message.slice(0,60))
  }
}

const count = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM segments WHERE project_id = ${projectId}"`, {encoding:'utf8'}).trim()
console.log(`✅ 成功写入 ${count} 条句段到项目 ${projectId}`)
