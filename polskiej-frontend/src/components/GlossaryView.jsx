import { useState, useEffect, useRef, useCallback } from 'react'
import { on } from '../eventBus'

const S = {
  card: { background: 'var(--surface-container-lowest)', borderRadius: '16px', border: '1px solid var(--surface-container)', overflow: 'hidden', marginBottom: 20 },
  cardHeader: { padding: '18px 28px', borderBottom: '1px solid var(--surface-container)', fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-container-low)' },
  input: { background: 'var(--surface-container-low)', border: 'none', borderRadius: '8px', color: 'var(--on-surface)', padding: '10px 14px', fontSize: '14px', outline: 'none', width: '100%', fontFamily: 'inherit' },
  btn: { border: 'none', borderRadius: '10px', padding: '10px 20px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
}

function ScopeBadge({ projectId }) {
  if (!projectId) return <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: 20 }}>全局</span>
  return <span style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: 20 }}>项目</span>
}

export default function GlossaryView({ api, toast, projects }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ source: '', target: '', chinese: '', notes: '' })
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [category, setCategory] = useState('all')  // 分类筛选
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  // 项目列表 + 范围选择
  const [scope, setScope] = useState('all')           // 'all' | 'global' | projectId(number)
  const [addScope, setAddScope] = useState('global')   // 手动添加 / 文件导入时的目标范围
  const searchTimer = useRef(null) // P3: 防抖计时器

  useEffect(() => {
    loadItems()
    return on('glossary:updated', () => loadItems())
  }, [])

  function loadItems() {
    // 始终加载全部，前端筛选
    api.glossaryGet(null).then(r => { if (r.success) setItems(r.items) })
  }

  // 固定领域筛选 Tab（与生成页保持一致）
  const DOMAIN_FILTERS = [
    { value: 'all',    label: '全部' },
    { value: 'idiom',  label: '成语/俚语', keywords: ['idiom', 'slang', '成语', '俚语', '俗语', '文化负载词', 'colloquial'] },
    { value: 'general',label: '日常',      keywords: ['日常', 'general', '口语', '感叹'] },
    { value: 'game',   label: '游戏',      keywords: ['游戏', 'game', '动作'] },
    { value: 'legal',  label: '法律',      keywords: ['法律', 'legal', '合同', 'formal'] },
    { value: 'emotion',label: '情感',      keywords: ['情感', 'emotion', '心理'] },
    { value: 'tech',   label: '专业',      keywords: ['专业', 'technical', 'terminology', '术语'] },
  ]

  // 前端筛选
  const filtered = items.filter(item => {
    if (scope === 'all') { /* pass */ } else if (scope === 'global') { if (item.project_id) return false } else { if (item.project_id !== Number(scope)) return false }
    if (category !== 'all') {
      const domainDef = DOMAIN_FILTERS.find(d => d.value === category)
      const n = (item.notes || '').toLowerCase()
      if (domainDef?.keywords && !domainDef.keywords.some(kw => n.includes(kw.toLowerCase()))) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!(item.source_term||'').toLowerCase().includes(q) && !(item.target_term||'').toLowerCase().includes(q) && !(item.chinese_meaning||'').toLowerCase().includes(q)) return false
    }
    return true
  })

  async function addItem() {
    if (!form.source.trim() || !form.target.trim()) { toast('请填写源词和目标词', 'error'); return }
    setLoading(true)
    const projectId = addScope === 'global' ? null : Number(addScope)
    const res = await api.glossaryAdd({
      projectId,
      sourceTerm: form.source.trim(), targetTerm: form.target.trim(), chineseMeaning: form.chinese.trim(), notes: form.notes.trim()
    })
    if (res.success) {
      setItems(prev => [...prev, { id: res.id, project_id: projectId, source_term: form.source.trim(), target_term: form.target.trim(), chinese_meaning: form.chinese.trim(), notes: form.notes.trim() }])
      setForm({ source: '', target: '', chinese: '', notes: '' })
      toast(projectId ? '已添加为项目专属术语' : '已添加为全局术语', 'success')
    } else toast(res.error, 'error')
    setLoading(false)
  }

  async function importFile() {
    setImporting(true)
    const projectId = addScope === 'global' ? null : Number(addScope)
    const res = await api.glossaryImport({ projectId })
    if (res.success) {
      toast(`从 ${res.fileName} 导入 ${res.added} 条术语`, 'success')
      loadItems()
    } else if (res.error !== '已取消') toast(res.error, 'error')
    setImporting(false)
  }

  async function bulkImport() {
    setBatchImporting(true)
    const filePath = await api.openFileDialog('excel')
    if (!filePath) { setBatchImporting(false); return }
    const xlsRes = await api.readExcel({ filePath })
    if (!xlsRes.success) { toast(xlsRes.error || '读取失败', 'error'); setBatchImporting(false); return }
    const rows = xlsRes.rows
    if (!rows || rows.length === 0) { toast('文件为空', 'error'); setBatchImporting(false); return }
    // 取前4列：source_term, target_term, chinese_meaning, notes
    const parsed = rows.map(r => ({
      source: String(r[0] ?? '').trim(),
      target: String(r[1] ?? '').trim(),
      notes: String(r[3] ?? '').trim()
    })).filter(r => r.source && r.target)
    if (parsed.length === 0) { toast('未找到有效数据（需第1列=源词，第2列=译词）', 'error'); setBatchImporting(false); return }
    const projectId = addScope === 'global' ? null : Number(addScope)
    const res = await api.glossaryBatchImport({ projectId, rows: parsed })
    if (res.success) { toast(`批量导入 ${res.count} 条术语`, 'success'); loadItems() }
    else toast(res.error || '导入失败', 'error')
    setBatchImporting(false)
  }

  async function delItem(id) {
    const res = await api.glossaryDelete(id)
    if (res.success) { loadItems(); toast('已删除', 'info') }
    else toast(res.error, 'error')
  }

  async function saveEdit() {
    if (!editing) return
    const res = await api.glossaryUpdate({ id: editing.id, sourceTerm: editing.source_term, targetTerm: editing.target_term, chineseMeaning: editing.chinese_meaning, notes: editing.notes })
    if (res.success) { setEditing(null); loadItems(); toast('已保存', 'info') }
    else toast(res.error, 'error')
  }

  async function exportFile() {
    const pid = scope === 'all' ? null : scope === 'global' ? null : Number(scope)
    const res = await api.glossaryExport({ projectId: pid })
    if (res.success) toast(`已导出 ${res.count} 条术语`, 'info')
    else if (res.error !== '已取消') toast(res.error, 'error')
  }


  function getProjectName(pid) {
    if (!pid) return '全局'
    const p = projects.find(x => x.id === pid)
    return p ? (p.project_name || p.file_path.split('/').pop()) : `项目#${pid}`
  }

  return (
    <div style={{ overflowY: "auto", padding: "40px 48px 80px", flex: 1 }}>
    <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 80 }}>
      <div style={{ textAlign: 'center', padding: '24px 0 32px' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--on-surface)', marginBottom: 8 }}>术语表管理</h1>
        <p style={{ fontSize: '1rem', color: 'var(--on-surface-variant)' }}>全局 + 项目专属术语库，AI 审核时自动注入对应术语</p>
      </div>

      {/* 范围选择 + 添加 */}
      <div style={S.card}>
        <div style={{ ...S.cardHeader, justifyContent: 'space-between' }}>
          <span>添加术语</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase' }}>适用范围</span>
            <select value={addScope} onChange={e => setAddScope(e.target.value)}
              style={{ ...S.input, width: 'auto', padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>
              <option value="global">🌐 全局（所有项目生效）</option>
              {projects.map(p => {
                const name = p.project_name || p.file_path.split('/').pop()
                return <option key={p.id} value={p.id}>📁 {name}</option>
              })}
            </select>
          </div>
        </div>
        <div style={{ padding: '20px 28px' }}>
          {/* 手动添加行 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>英文 / 原文</label>
              <input style={S.input} placeholder="如：mate" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>中文含义</label>
              <input style={S.input} placeholder="如：朋友，哥们" value={form.chinese} onChange={e => setForm(f => ({ ...f, chinese: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>波兰语译词</label>
              <input style={S.input} placeholder="如：kumpel" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>备注说明（可选）</label>
              <input style={S.input} placeholder="如：俚语、文化负载词" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <button onClick={addItem} disabled={loading} style={{
              ...S.btn, background: 'var(--tertiary)', color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', alignSelf: 'flex-end'
            }}>
              添加
            </button>
          </div>

          {/* 文件导入 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0 0', borderTop: '1px solid var(--surface-container)', flexWrap: 'wrap' }}>
            <button onClick={importFile} disabled={importing} style={{
              ...S.btn, background: 'var(--surface-container-low)', color: 'var(--on-surface)',
              border: '1px solid var(--surface-container-high)',
              cursor: importing ? 'not-allowed' : 'pointer'
            }}>
              {importing ? '导入中...' : '从文件导入'}
            </button>
            <button onClick={bulkImport} disabled={batchImporting} style={{
              ...S.btn, background: 'var(--surface-container-low)', color: 'var(--on-surface)',
              border: '1px solid var(--surface-container-high)',
              cursor: batchImporting ? 'not-allowed' : 'pointer'
            }}>
              {batchImporting ? '导入中...' : '批量导入 Excel'}
            </button>
            <button onClick={exportFile} disabled={items.length === 0} style={{
              ...S.btn, background: 'var(--surface-container-low)', color: 'var(--on-surface)',
              border: '1px solid var(--surface-container-high)',
              cursor: items.length === 0 ? 'not-allowed' : 'pointer'
            }}>
              导出 Excel
            </button>
            <span style={{ fontSize: 12, color: 'var(--outline)', lineHeight: 1.5 }}>
              支持 Excel (.xlsx) 或 CSV 文件。格式：第1列 = 源词，第2列 = 译词，第3列 = 中文解释，第4列 = 备注
            </span>
          </div>
        </div>
      </div>

      {/* 术语列表 */}
      <div style={S.card}>
        <div style={{ ...S.cardHeader, justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>术语列表</span>
            <select value={scope} onChange={e => { setScope(e.target.value); setPage(0) }}
              style={{ ...S.input, width: 'auto', padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'var(--surface-container)' }}>
              <option value="all">全部</option>
              <option value="global">仅全局</option>
              {projects.map(p => {
                const name = p.project_name || p.file_path.split('/').pop()
                return <option key={p.id} value={p.id}>{name}</option>
              })}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--outline)', fontWeight: 500 }}>
              {scope === 'all' && category === 'all' ? `共 ${items.length} 条` : `筛选 ${filtered.length} / ${items.length} 条`}
            </span>
            {/* 领域 Tab 按钮 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {DOMAIN_FILTERS.map(d => (
                <button
                  key={d.value}
                  onClick={() => { setCategory(d.value); setPage(0) }}
                  style={{
                    border: 'none', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: category === d.value ? 'var(--tertiary)' : 'var(--surface-container)',
                    color: category === d.value ? '#fff' : 'var(--on-surface-variant)',
                  }}
                >{d.label}</button>
              ))}
            </div>
            {/* P3: 防抖搜索 */}
            <input placeholder="搜索术语..." defaultValue={search} onChange={e => {
              const v = e.target.value
              if (searchTimer.current) clearTimeout(searchTimer.current)
              searchTimer.current = setTimeout(() => { setSearch(v); setPage(0) }, 300)
            }}
              style={{ ...S.input, width: 140, padding: '6px 12px', fontSize: 12 }} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '56px', textAlign: 'center', color: 'var(--on-surface-variant)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>暂无术语</div>
            <div style={{ fontSize: 13 }}>使用上方表单添加或从文件批量导入</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['中文含义', '波兰语译词', '英文 / 原文', '范围', '备注说明', ''].map(h => (
                  <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em', background: 'var(--surface-container-low)', borderBottom: '1px solid var(--surface-container)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => {
                const isEd = editing?.id === item.id
                const edS = { ...S.input, padding: '4px 8px', fontSize: 13, width: '100%' }
                return (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--surface-container)' }}>
                  {/* 中文 */}
                  <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--on-surface)', minWidth: 80 }}>
                    {isEd ? <input style={edS} value={editing.chinese_meaning} onChange={e => setEditing({...editing, chinese_meaning: e.target.value})} /> : (item.chinese_meaning || <span style={{ color: 'var(--outline)', fontWeight: 400 }}>—</span>)}
                  </td>
                  {/* 波兰语 */}
                  <td style={{ padding: '14px 20px', color: 'var(--tertiary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {isEd ? <input style={edS} value={editing.target_term} onChange={e => setEditing({...editing, target_term: e.target.value})} /> : (item.target_term || <span style={{ color: 'var(--outline)', fontWeight: 400 }}>—</span>)}
                  </td>
                  {/* 英文/原文 - 纯中文内容视为空 */}
                  <td style={{ padding: '14px 20px', color: 'var(--on-surface-variant)', fontWeight: 500 }}>
                    {isEd ? <input style={edS} value={editing.source_term} onChange={e => setEditing({...editing, source_term: e.target.value})} /> : (item.source_term && !/^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s，。、！？：；""''（）]+$/.test(item.source_term) ? item.source_term : <span style={{ color: 'var(--outline)', fontWeight: 400 }}>—</span>)}
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    <ScopeBadge projectId={item.project_id} />
                    {item.project_id && <span style={{ fontSize: 10, color: 'var(--outline)', marginLeft: 6 }}>{getProjectName(item.project_id)}</span>}
                  </td>
                  <td style={{ padding: '14px 20px', color: 'var(--on-surface-variant)', fontSize: 13 }}>
                    {isEd ? <input style={edS} value={editing.notes} onChange={e => setEditing({...editing, notes: e.target.value})} /> : (item.notes || <span style={{ color: 'var(--outline)' }}>—</span>)}
                  </td>
                  <td style={{ padding: '14px 20px', textAlign: 'right', display: 'flex', gap: 6 }}>
                    {isEd ? (
                      <>
                        <button onClick={saveEdit} style={{ background: 'rgba(0,93,187,0.08)', color: 'var(--tertiary)', border: 'none', borderRadius: '8px', padding: '6px 16px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>保存</button>
                        <button onClick={() => setEditing(null)} style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing({ id: item.id, source_term: item.source_term || '', target_term: item.target_term || '', chinese_meaning: item.chinese_meaning || '', notes: item.notes || '' })} style={{ background: 'rgba(0,93,187,0.06)', color: 'var(--tertiary)', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>编辑</button>
                        <button onClick={() => delItem(item.id)} style={{ background: 'rgba(159,64,61,0.08)', color: 'var(--error)', border: 'none', borderRadius: '8px', padding: '6px 16px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>删除</button>
                      </>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}

        {/* 分页控制栏 */}
        {filtered.length > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 20px', borderTop: '1px solid var(--surface-container)' }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ ...S.btn, background: 'var(--surface-container)', color: 'var(--on-surface-variant)', padding: '6px 14px', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>
              ‹ 上一页
            </button>
            <span style={{ fontSize: 12, color: 'var(--outline)', fontWeight: 600 }}>
              {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)} 页 · 共 {filtered.length} 条
            </span>
            <button onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))} disabled={page >= Math.ceil(filtered.length / PAGE_SIZE) - 1}
              style={{ ...S.btn, background: 'var(--surface-container)', color: 'var(--on-surface-variant)', padding: '6px 14px', fontSize: 12, cursor: page >= Math.ceil(filtered.length / PAGE_SIZE) - 1 ? 'not-allowed' : 'pointer', opacity: page >= Math.ceil(filtered.length / PAGE_SIZE) - 1 ? 0.5 : 1 }}>
              下一页 ›
            </button>
          </div>
        )}
      </div>

      {/* 使用说明 */}
      <div style={{ padding: '16px 24px', background: 'var(--surface-container-low)', borderRadius: 12, fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.8 }}>
        <b style={{ color: 'var(--on-surface)' }}>术语表如何生效？</b><br />
        • <b>全局术语</b>：对所有项目的 AI 审核自动生效，无需额外操作<br />
        • <b>项目专属术语</b>：仅在对应项目审核时生效，其他项目不会使用<br />
        • AI 审核每条句段时，系统自动注入「全局 + 当前项目」的术语到 Prompt 中<br />
        • 如果译文违反术语表，AI 会标记 <span style={{ color: 'var(--error)', fontWeight: 700 }}>TERM_INCONSISTENCY</span> 错误并扣分
      </div>
    </div>
    </div>
  )
}
