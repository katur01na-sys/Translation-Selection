import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const require = createRequire(import.meta.url)
const XLSX = require('./polskiej-chinese-src/node_modules/xlsx/lib/xlsx.js')
const Database = require('./polskiej-chinese-src/node_modules/better-sqlite3/build/Release/better_sqlite3.node') 

// 改用 better-sqlite3
import { execSync } from 'child_process'

const filePath = path.join(os.homedir(), 'Desktop', '测试翻译文件.xlsx')
const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'polish-chiny', 'ch-pl-lqa', 'lqa.db')

// 读取 Excel
const buf = require('fs').readFileSync(filePath)
const wb = XLSX.read(buf, { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })

console.log(`读取到 ${rows.length - 1} 条句段`)
console.log('前3条:', rows.slice(1, 4))

// 写入数据库
const insertSQL = rows.slice(1).filter(r => r[0]).map((r, i) => {
  const src = (r[0] || '').replace(/'/g, "''")
  const tgt = (r[1] || '').replace(/'/g, "''")
  return `('${src}', '${tgt}', '${tgt}', 'pending', ${i + 1})`
}).join(',\n')

// 先插入项目
execSync(`sqlite3 "${dbPath}" "INSERT OR IGNORE INTO projects (file_path, project_name, created_at, updated_at) VALUES ('${filePath}', '测试翻译文件.xlsx', datetime('now'), datetime('now'))"`)

const projectId = execSync(`sqlite3 "${dbPath}" "SELECT id FROM projects WHERE file_path = '${filePath}'"`, {encoding: 'utf8'}).trim()
console.log('项目ID:', projectId)

// 清空旧句段
execSync(`sqlite3 "${dbPath}" "DELETE FROM segments WHERE project_id = ${projectId}"`)

// 插入句段
const segRows = rows.slice(1).filter(r => r[0])
for (let i = 0; i < segRows.length; i++) {
  const src = segRows[i][0]?.toString().replace(/'/g, "''") || ''
  const tgt = segRows[i][1]?.toString().replace(/'/g, "''") || ''
  execSync(`sqlite3 "${dbPath}" "INSERT INTO segments (project_id, source, target, original_target, status, gender) VALUES (${projectId}, '${src}', '${tgt}', '${tgt}', 'pending', 'male')"`)
}

const count = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM segments WHERE project_id = ${projectId}"`, {encoding:'utf8'}).trim()
console.log(`✅ 成功写入 ${count} 条句段到项目ID ${projectId}`)
