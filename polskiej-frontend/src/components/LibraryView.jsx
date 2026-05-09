import { useState } from 'react'

const T = {
  wrap: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '40px 56px 80px', gap: 32 },
  section: { background: '#fff', borderRadius: 14, border: '1px solid var(--surface-container)', overflow: 'hidden' },
  sectionHead: { padding: '16px 24px', borderBottom: '1px solid var(--surface-container)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '0.01em' },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--outline)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, display: 'block' },
  select: { width: '100%', background: 'var(--surface-container-low)', border: '1.5px solid var(--surface-container)', borderRadius: 8, color: 'var(--on-surface)', padding: '10px 12px', fontSize: 13, outline: 'none', cursor: 'pointer', fontFamily: 'inherit' },
}

export default function LibraryView({ api, toast, settings, onLoad, projects, refreshProjects }) {
  const [importing, setImporting] = useState(false)
  const [filePath, setFilePath] = useState('')
  const [sheetData, setSheetData] = useState(null)
  const [sheetNames, setSheetNames] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [cols, setCols] = useState({ source: 0, target: 1, header: [] })
  const [step, setStep] = useState('idle')
  const [deletingId, setDeletingId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  async function pickFile() {
    const p = await api.openFileDialog('spreadsheet')
    if (!p) return
    setFilePath(p); setImporting(true); setStep('idle'); setSheetData(null)
    try {
      const res = await api.readExcel({ filePath: p })
      if (!res.success) { toast(res.error || '读取失败', 'error'); return }
      if (res.needSheetSelect) {
        setSheetNames(res.sheetNames); setSelectedSheet(res.defaultSheet); setStep('picked')
      } else if (res.data) {
        setSheetNames(res.sheetNames || []); applySheet(res); setStep('ready')
      } else { toast(res.error || '解析失败', 'error') }
    } catch (e) { toast(e.message, 'error') }
    finally { setImporting(false) }
  }

  async function loadSheet(name) {
    setSelectedSheet(name); setImporting(true)
    try {
      const res = await api.readExcel({ filePath, sheetName: name })
      if (!res.success) { toast(res.error, 'error'); return }
      applySheet(res); setStep('ready')
    } finally { setImporting(false) }
  }

  function applySheet(res) {
    setSheetData(res)
    setCols({ source: res.sourceCol ?? 0, target: res.targetCol ?? 1, gender: res.genderCol ?? -1, header: res.header ?? [] })
  }

  async function doImport() {
    if (!sheetData?.data) { toast('数据未就绪', 'error'); return }
    setImporting(true)
    try {
      const res = await api.dbLoadProject({ filePath, rows: sheetData.data, sourceCol: cols.source, targetCol: cols.target, genderCol: cols.gender })
      if (!res.success) { toast(res.error || '初始化失败', 'error'); return }
      toast(`已加载 ${res.segments.length} 个句段`, 'success')
      onLoad({ ...res, filePath })
      refreshProjects()
    } catch (e) { toast(e.message, 'error') }
    finally { setImporting(false) }
  }

  async function openProject(id) {
    const res = await api.dbLoadProjectById(id)
    if (!res.success) { toast(res.error, 'error'); return }
    // 如果句段为空，尝试重新从文件导入
    if ((!res.segments || res.segments.length === 0) && res.filePath) {
      const excelRes = await api.readExcel({ filePath: res.filePath })
      if (excelRes?.success && excelRes.data) {
        const reloadRes = await api.dbLoadProject({
          filePath: res.filePath,
          rows: excelRes.data,
          sourceCol: excelRes.sourceCol ?? 0,
          targetCol: excelRes.targetCol ?? 1,
          genderCol: excelRes.genderCol ?? -1
        })
        if (reloadRes?.success) {
          toast(`已自动导入 ${reloadRes.segments.length} 个句段`, 'success')
          onLoad({ ...reloadRes, filePath: res.filePath })
          refreshProjects()
          return
        }
      }
      toast('文件不存在或读取失败，请重新导入', 'error')
      return
    }
    onLoad(res)
  }

  async function deleteProject(id) {
    const res = await api.dbDeleteProject(id)
    if (res.success) { toast('已删除', 'success'); refreshProjects() }
    else toast(res.error, 'error')
    setDeletingId(null)
  }

  async function saveRename(id) {
    const res = await api.dbSaveProjectName({ projectId: id, name: renameVal.trim() })
    if (res.success) { toast('已保存', 'success'); refreshProjects() }
    else toast(res.error, 'error')
    setRenamingId(null)
  }

  const fileName = filePath ? filePath.split('/').pop() : ''
  const dot = { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }

  return (
    <div style={T.wrap}>
      <div style={{ maxWidth: 820, width: '100%', alignSelf: 'center' }}>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--on-surface)', marginBottom: 6, letterSpacing: '-0.03em' }}>项目资料库</h1>
        <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', marginBottom: 32 }}>导入新文件或从历史记录中继续工作</p>

        {/* ── 导入新文件 ── */}
        <div style={{ ...T.section, marginBottom: 24 }}>
          <div style={T.sectionHead}>
            <span style={T.sectionTitle}>导入新文件</span>
            {step === 'ready' && (
              <button onClick={doImport} disabled={importing}
                style={{ background: 'var(--tertiary)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: importing ? 'not-allowed' : 'pointer' }}>
                {importing ? '加载中...' : '开始加载'}
              </button>
            )}
          </div>

          <div style={{ padding: 24 }}>
            <div onClick={pickFile} style={{
              border: `1.5px dashed ${step === 'ready' ? 'var(--tertiary)' : 'var(--outline-variant)'}`,
              borderRadius: 12, padding: '36px 24px', textAlign: 'center', cursor: 'pointer',
              background: step === 'ready' ? 'rgba(0,93,187,0.03)' : 'var(--surface-container-low)', transition: 'all 0.2s'
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: step === 'ready' ? 'var(--tertiary)' : 'var(--on-surface)', marginBottom: 4 }}>
                {importing ? '读取中...' : step === 'ready' ? fileName : '点击选择 .xlsx / .xls / .csv 文件'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--outline)' }}>
                {step === 'ready' ? '点击重新选择' : '系统将自动识别 Source 与 Target 列'}
              </div>
            </div>

            {/* 多Sheet选择 */}
            {sheetNames.length > 1 && step !== 'idle' && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--outline)', alignSelf: 'center' }}>选择工作表：</span>
                {sheetNames.map(n => (
                  <button key={n} onClick={() => loadSheet(n)} style={{
                    padding: '5px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    background: selectedSheet === n ? 'var(--on-surface)' : 'var(--surface-container)',
                    color: selectedSheet === n ? '#fff' : 'var(--on-surface-variant)'
                  }}>{n}</button>
                ))}
              </div>
            )}

            {/* 列映射预览 */}
            {sheetData && step === 'ready' && (
              <div style={{ marginTop: 20, display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={T.label}>源语言列</label>
                  <select value={cols.source} onChange={e => setCols(c => ({ ...c, source: +e.target.value }))} style={T.select}>
                    {cols.header.map((h, i) => <option key={i} value={i}>[{i+1}] {h}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={T.label}>目标语言列（波兰语）</label>
                  <select value={cols.target} onChange={e => setCols(c => ({ ...c, target: +e.target.value }))} style={T.select}>
                    {cols.header.map((h, i) => <option key={i} value={i}>[{i+1}] {h}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 历史项目列表 ── */}
        <div style={T.section}>
          <div style={T.sectionHead}>
            <span style={T.sectionTitle}>历史项目（{projects.length}）</span>
            <button onClick={refreshProjects} style={{ background: 'transparent', border: 'none', fontSize: 12, color: 'var(--outline)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>刷新</button>
          </div>

          {projects.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--outline)', fontSize: 13 }}>暂无历史项目，请先导入文件</div>
          ) : (
            <div>
              {projects.map((p, idx) => {
                const name = p.project_name || p.file_path.split('/').pop()
                const total = p.segment_count || 0
                const done = p.done_count || 0
                const pct = total > 0 ? Math.round(done / total * 100) : 0
                const date = p.updated_at ? p.updated_at.slice(0, 10) : ''
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px',
                    borderTop: idx > 0 ? '1px solid var(--surface-container)' : 'none',
                    transition: 'background 0.15s'
                  }}>
                    {/* 状态点 */}
                    <span style={{ ...dot, background: pct === 100 ? 'var(--tertiary)' : pct > 0 ? '#f59e0b' : 'var(--outline-variant)' }} />

                    {/* 名称 / 重命名 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renamingId === p.id ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input value={renameVal} onChange={e => setRenameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveRename(p.id); if (e.key === 'Escape') setRenamingId(null) }}
                            autoFocus style={{ flex: 1, fontSize: 13, fontWeight: 600, background: 'var(--surface-container-low)', border: '1px solid var(--tertiary)', borderRadius: 6, padding: '4px 10px', outline: 'none', fontFamily: 'inherit', color: 'var(--on-surface)' }} />
                          <button onClick={() => saveRename(p.id)} style={{ background: 'var(--tertiary)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>保存</button>
                          <button onClick={() => setRenamingId(null)} style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ fontSize: 11, color: 'var(--outline)', marginTop: 2 }}>{date} · {done}/{total} 句段完成 · {pct}%</div>
                        </>
                      )}
                    </div>

                    {/* 进度条 */}
                    <div style={{ width: 80, height: 3, background: 'var(--surface-container-high)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--tertiary)' : '#f59e0b', borderRadius: 99, transition: 'width 0.4s' }} />
                    </div>

                    {/* 操作按钮 */}
                    {deletingId === p.id ? (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, color: 'var(--on-surface-variant)', alignSelf: 'center' }}>确认删除？</span>
                        <button onClick={() => deleteProject(p.id)} style={{ background: 'var(--error)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>确认</button>
                        <button onClick={() => setDeletingId(null)} style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => { setRenamingId(p.id); setRenameVal(name) }}
                          style={{ background: 'var(--surface-container-low)', color: 'var(--on-surface-variant)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>重命名</button>
                        <button onClick={() => setDeletingId(p.id)}
                          style={{ background: 'transparent', color: 'var(--outline)', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>删除</button>
                        <button onClick={() => openProject(p.id)}
                          style={{ background: 'var(--tertiary)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>打开</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
