import { useState, useEffect, useRef } from 'react'
import { emit } from '../eventBus'

const TYPE_LABELS = {
  slang:       { label: '俚语/感叹', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  terminology: { label: '专业术语', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
  culture:     { label: '文化负载', color: '#a855f7', bg: 'rgba(168,85,247,0.08)' },
  proper_noun: { label: '专有名词', color: 'var(--outline)', bg: 'var(--surface-container)' },
}

function TypeBadge({ type }) {
  const t = TYPE_LABELS[type] || { label: type, color: 'var(--outline)', bg: 'var(--surface-container)' }
  return <span style={{ fontSize: 11, fontWeight: 700, color: t.color, background: t.bg, padding: '2px 9px', borderRadius: 20 }}>{t.label}</span>
}

function ConfBadge({ modelCount, confidence }) {
  const isHigh = modelCount >= 2 && confidence >= 0.8
  const isMid  = modelCount >= 2 || confidence >= 0.7
  if (isHigh) return <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.08)', padding: '2px 8px', borderRadius: 20 }}>✓ 双模型</span>
  if (isMid)  return <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: 20 }}>⚠ 待确认</span>
  return <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', background: 'var(--surface-container)', padding: '2px 8px', borderRadius: 20 }}>? 单模型</span>
}

function mergeTerms(incoming) {
  const map = new Map()
  for (const t of incoming) {
    map.set(t.sourceTerm, { ...t, count: t.count || 1, modelCount: t.modelCount || 1 })
  }
  return Array.from(map.values()).sort((a, b) => (b.modelCount * b.confidence) - (a.modelCount * a.confidence))
}

export default function TermMineView({ api, toast, onProjectDeleted, projects, refreshProjects }) {

  // Project selector
  const [selProjectId, setSelProjectId] = useState(null)
  const [selProjectName, setSelProjectName] = useState('')
  const selProjectIdRef = useRef(null)

  // Analysis state
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState(null)  // { done, total }
  const [log, setLog]           = useState([])    // 批次日志行
  const [batchRows, setBatchRows] = useState([])   // [{idx, status, count, dsError, mmError}]
  const [terms, setTerms]       = useState([])
  const [selected, setSelected] = useState(new Set())
  const [adding, setAdding]     = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [history, setHistory]   = useState([])  // 挖掘历史记录

  // 组件挂载时：加载项目列表、挖掘历史、从后端恢复任务状态
  useEffect(() => {
    api.getAppPref?.('term_mine_history').then(async r => {
      if (r?.success && Array.isArray(r.value) && r.value.length > 0) {
        setHistory(r.value)
      } else {
        // 首次：从术语表中恢复 AI 挖掘历史
        const gRes = await api.glossaryGet(null)
        if (gRes?.success && gRes.items?.length) {
          const aiItems = gRes.items.filter(g => g.notes && g.notes.includes('[AI挖掘]'))
          if (aiItems.length > 0) {
            const pRes = await api.dbListProjects()
            const projects = pRes?.success ? pRes.projects : []
            const byProject = {}
            for (const item of aiItems) {
              const pid = item.project_id || 'global'
              if (!byProject[pid]) byProject[pid] = { count: 0 }
              byProject[pid].count++
            }
            const seed = Object.entries(byProject).map(([pid, v]) => {
              const p = projects.find(x => x.id === Number(pid))
              const name = p ? (p.project_name || p.file_path.split('/').pop()) : '全局术语'
              return { projectName: name, date: new Date().toISOString().slice(0, 16).replace('T', ' '), count: v.count }
            })
            setHistory(seed)
            api.setAppPref?.('term_mine_history', seed)
          }
        }
      }
    })
    // 恢复后端运行状态（切换页面后回来时保持进度）
    api.getTermState?.().then(s => {
      if (!s?.success) return
      if (s.running || s.done > 0) {
        if (s.projectId != null) {
          selProjectIdRef.current = s.projectId
          setSelProjectId(s.projectId)
          // 从全局项目列表中查找名称
          const p = projects.find(x => x.id === s.projectId)
          if (p) setSelProjectName(p.project_name || p.file_path.split('/').pop())
        }
        setRunning(s.running)
        setProgress({ done: s.done, total: s.total })
        if (s.batchRows?.length) setBatchRows(s.batchRows)
        if (s.terms?.length)    setTerms(mergeTerms(s.terms))
      }
    })
  }, [])

  useEffect(() => {
    if (!api.onTermProgress) return
    const unsub = api.onTermProgress(d => {
      if (d.projectId !== undefined && d.projectId !== selProjectIdRef.current) return
      if (d.done !== undefined && d.total !== undefined) {
        setProgress({ done: d.done, total: d.total })
        if (d.total > 0) {
          const pct = Math.round(d.done / d.total * 100)
          const count = d.termCount ?? d.terms?.length ?? 0
          setLog(prev => [...prev, `[批次 ${d.done}/${d.total}]  ${pct}% · 累计发现 ${count} 条候选词`])
        }
      }
      if (d.batchRows) setBatchRows(d.batchRows)
      if (d.terms?.length) setTerms(mergeTerms(d.terms))
      if (!d.running) setRunning(false)
      if (d.error) toast(d.error, 'error')
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  async function startAnalysis() {
    if (!selProjectId) { toast('请先选择要分析的项目', 'error'); return }

    setRunning(true)
    setProgress({ done: 0, total: 0 })
    setLog([`▶ 开始分析项目「${selProjectName}」，最多分析 200 条已审核句段`])
    setBatchRows([])
    setTerms([])
    setSelected(new Set())

    const r = await api.analyzeTerms({ projectId: selProjectId, maxSegments: 200 })
    if (!r?.success) {
      toast(r?.error || '启动分析失败', 'error')
      setRunning(false)
    }
  }

  function stopAnalysis() {
    api.stopTermAnalysis?.()
    setRunning(false)
    setLog(prev => [...prev, '■ 用户手动停止分析'])
  }

  function resetState() {
    setRunning(false)
    setProgress(null)
    setLog([])
    setBatchRows([])
    setTerms([])
    setSelected(new Set())
    setSelProjectId(null)
    setSelProjectName('')
    api.stopTermAnalysis?.()
    toast('已重置到初始状态', 'info')
  }

  async function loadFromGlossary() {
    if (!selProjectId) { toast('请先选择项目', 'error'); return }
    const res = await api.glossaryGet(selProjectId)
    if (!res?.success) { toast('加载失败', 'error'); return }
    const aiItems = res.items.filter(g => g.notes && g.notes.includes('[AI挖掘]'))
    if (aiItems.length === 0) { toast('该项目暂无已挖掘的术语记录', 'info'); return }
    const imported = aiItems.map(g => ({
      sourceTerm: g.source_term,
      targetTerm: g.target_term,
      explanation: g.chinese_meaning || '',
      type: (g.notes.match(/\] (\w+)/) || [])[1] || 'terminology',
      confidence: 1.0,
      modelCount: 2,
      count: 1,
    }))
    setTerms(imported)
    setSelected(new Set())
    toast(`已导入 ${imported.length} 条历史挖掘术语`, 'success')
  }


  function toggleSelect(key) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function addToGlossary() {
    if (!selected.size) { toast('请先勾选要入库的术语', 'error'); return }
    const toAdd = terms.filter(t => selected.has(t.sourceTerm))
    setAdding(true)
    let ok = 0, fail = 0
    for (const t of toAdd) {
      const r = await api.glossaryAdd({
        projectId: selProjectId ?? null,
        sourceTerm: t.sourceTerm,
        targetTerm: t.targetTerm,
        chineseMeaning: t.explanation,
        notes: `[AI挖掘] ${t.type} · 置信度${Math.round((t.confidence||0)*100)}% · 出现${t.count}次`
      })
      r.success ? ok++ : fail++
    }
    setAdding(false)
    toast(`已入库 ${ok} 条${fail ? `，${fail} 条失败` : ''}`, ok > 0 ? 'success' : 'error')
    if (ok > 0) {
      setTerms(prev => prev.filter(t => !selected.has(t.sourceTerm)))
      setSelected(new Set())
      // 保存挖掘历史记录
      const record = { projectName: selProjectName, date: new Date().toISOString().slice(0, 16).replace('T', ' '), count: ok }
      const updated = [record, ...history.filter(h => !(h.projectName === selProjectName && h.date === record.date))].slice(0, 50)
      setHistory(updated)
      api.setAppPref?.('term_mine_history', updated)
      emit('glossary:updated')
    }
  }

  const highTerms = terms.filter(t => t.modelCount >= 2 && t.confidence >= 0.8)
  const midTerms  = terms.filter(t => !(t.modelCount >= 2 && t.confidence >= 0.8) && (t.modelCount >= 2 || t.confidence >= 0.7))
  const lowTerms  = terms.filter(t => t.modelCount < 2 && t.confidence < 0.7)

  const card = { background: '#fff', borderRadius: 14, border: '1px solid var(--surface-container)', marginBottom: 20, overflow: 'hidden' }
  const cardHead = { padding: '14px 24px', borderBottom: '1px solid var(--surface-container)', fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-container-low)' }

  const logRef = useRef(null)
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [log])

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* 左侧：项目列表 */}
      <div style={{ width: 240, minWidth: 240, borderRight: '1px solid var(--surface-container)', overflowY: 'auto', background: 'var(--surface-container-lowest)' }}>
        <div style={{ padding: '20px 16px 12px', fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>项目文件列表</div>
        {projects.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 12, color: 'var(--outline)' }}>暂无项目，请先导入</div>
        ) : projects.map(p => {
          const name = p.project_name || p.file_path.split('/').pop()
          const pct = p.segment_count > 0 ? Math.round(p.done_count / p.segment_count * 100) : 0
          const isSel = selProjectId === p.id
          return (
            <div key={p.id} onClick={() => { if (selProjectId !== p.id) { selProjectIdRef.current = p.id; setSelProjectId(p.id); setSelProjectName(name); setBatchRows([]); setTerms([]); setProgress(null); setLog([]); setSelected(new Set()); api.getTermState?.().then(s => { if (s?.success && s.running && s.projectId === p.id) { setRunning(true); setProgress({ done: s.done, total: s.total }); if (s.batchRows?.length) setBatchRows(s.batchRows); if (s.terms?.length) setTerms(mergeTerms(s.terms)) } else { setRunning(false) } }) } }}
              style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--surface-container)',
                background: isSel ? 'rgba(59,130,246,0.08)' : 'transparent',
                borderLeft: isSel ? '3px solid #3b82f6' : '3px solid transparent', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isSel ? '#3b82f6' : 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{name}</div>
                {deletingId === p.id ? (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={async () => { const r = await api.dbDeleteProject(p.id); if (r.success) { toast('已删除', 'success'); onProjectDeleted?.(p.id); if (selProjectId === p.id) { setSelProjectId(null); setSelProjectName('') } } else toast(r.error, 'error'); setDeletingId(null) }}
                      style={{ background: 'var(--error)', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>确认</button>
                    <button onClick={() => setDeletingId(null)}
                      style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDeletingId(p.id) }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--outline)', fontSize: 13, cursor: 'pointer', padding: '2px 4px', flexShrink: 0, lineHeight: 1, opacity: 0.5, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}
                    title="删除项目">✕</button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--outline)', marginTop: 3 }}>{p.done_count}/{p.segment_count} · {pct}%</div>
            </div>
          )
        })}
      </div>

      {/* 右侧：挖掘内容 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 80px' }}>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--on-surface)', marginBottom: 6, letterSpacing: '-0.03em' }}>智能术语挖掘</h1>
        <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', marginBottom: 24 }}>DeepSeek + MiniMax 双模型交叉分析，自动识别俚语、专业术语与文化负载词</p>

        {!selProjectId ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--on-surface-variant)' }}>
            <div style={{ fontSize: 18, marginBottom: 16, color: 'var(--outline)' }}>←</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 6 }}>请从左侧选择一个项目</div>
            <div style={{ fontSize: 13 }}>点击项目文件即可开始术语挖掘分析</div>
          </div>
        ) : (<>
          {/* 分析控制 */}
          <div style={card}>
            <div style={cardHead}><span>分析控制 — {selProjectName}</span></div>
            <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!running ? (
                  <button onClick={startAnalysis} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 28px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>开始分析</button>
                ) : (
                  <button onClick={stopAnalysis} style={{ background: 'var(--error)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>停止</button>
                )}
                <button onClick={loadFromGlossary} style={{ background: '#a855f7', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>导入历史术语</button>
                <button onClick={resetState} style={{ background: 'transparent', border: '1px solid var(--surface-container-high)', color: 'var(--on-surface-variant)', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>重置</button>
                {progress && progress.total > 0 && (
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--on-surface-variant)', fontWeight: 600, marginBottom: 5 }}>
                      <span>{running ? '分析中...' : '已完成'}</span>
                      <span>{progress.done}/{progress.total} 批 · {Math.round(progress.done / progress.total * 100)}%</span>
                    </div>
                    <div style={{ height: 7, background: 'var(--surface-container-high)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(progress.done / progress.total * 100)}%`, height: '100%', background: running ? '#3b82f6' : '#10b981', borderRadius: 99, transition: 'width 0.35s' }} />
                    </div>
                  </div>
                )}
              </div>
              {log.length > 0 && (
                <div ref={logRef} style={{ background: 'var(--surface-container-low)', borderRadius: 8, padding: '10px 14px', maxHeight: 120, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace', color: 'var(--on-surface-variant)', lineHeight: 1.7 }}>
                  {log.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}
              {batchRows.length > 0 && (
                <div style={{ borderRadius: 8, border: '1px solid var(--surface-container)', overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: 'var(--surface-container-low)' }}>
                      {['批次', '状态', '加入到术语表'].map(h => (<th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--outline)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--surface-container)' }}>{h}</th>))}
                    </tr></thead>
                    <tbody>{batchRows.map(row => {
                      const hasErr = row.dsError || row.mmError
                      const si = { waiting: { l: '等待', c: 'var(--outline)', i: '○' }, running: { l: '正在抓取', c: '#3b82f6', i: '⟳' }, done: { l: hasErr ? '部分完成' : '完成', c: hasErr ? '#f59e0b' : '#10b981', i: hasErr ? '⚠' : '✓' }, error: { l: '失败', c: '#ef4444', i: '✗' } }[row.status] || { l: row.status, c: 'var(--outline)', i: '' }
                      return (<tr key={row.idx} style={{ borderBottom: '1px solid var(--surface-container)' }}>
                        <td style={{ padding: '7px 14px' }}><span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'var(--surface-container)', fontSize: 11, fontWeight: 800 }}>{row.idx}</span></td>
                        <td style={{ padding: '7px 14px' }}><span style={{ color: si.c, fontWeight: 700, fontSize: 12 }}>{si.i} {si.l}</span>
                          {row.dsError && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>DS: {row.dsError}</div>}
                          {row.mmError && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 1 }}>MM: {row.mmError}</div>}
                        </td>
                        <td style={{ padding: '7px 14px', fontWeight: 800, fontFamily: 'monospace', color: row.count > 0 ? '#10b981' : 'var(--on-surface-variant)' }}>{row.status === 'waiting' ? '—' : row.status === 'running' ? '...' : row.count}</td>
                      </tr>)
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* 结果列表 */}
          {terms.length > 0 && (
            <div style={card}>
              <div style={cardHead}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span>候选术语列表</span>
                  <span style={{ fontSize: 12, color: 'var(--on-surface-variant)', fontWeight: 600 }}>共 {terms.length} 条 · 高置信 {highTerms.length} · 待确认 {midTerms.length} · 低置信 {lowTerms.length}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setSelected(new Set(terms.map(t => t.sourceTerm)))} style={{ background: 'transparent', border: '1px solid var(--surface-container-high)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--on-surface-variant)', fontFamily: 'inherit' }}>全选</button>
                  <button onClick={() => setSelected(new Set(highTerms.map(t => t.sourceTerm)))} style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#10b981', fontFamily: 'inherit' }}>全选高置信 ({highTerms.length})</button>
                  <button onClick={() => setSelected(new Set())} style={{ background: 'transparent', border: '1px solid var(--surface-container-high)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--on-surface-variant)', fontFamily: 'inherit' }}>取消</button>
                  <button onClick={addToGlossary} disabled={adding || selected.size === 0}
                    style={{ background: selected.size > 0 && !adding ? '#10b981' : 'var(--surface-container)', color: selected.size > 0 && !adding ? '#fff' : 'var(--outline)', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: 13, cursor: selected.size > 0 && !adding ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    {adding ? '入库中...' : `加入术语库 (${selected.size})`}
                  </button>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>
                  {['', '源词（中文）', '建议译词', '类型', '置信度', '出现', '说明'].map((h, i) => (
                    <th key={i} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--surface-container-low)', borderBottom: '1px solid var(--surface-container)' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{terms.map(t => {
                  const isSel = selected.has(t.sourceTerm)
                  return (<tr key={t.sourceTerm} onClick={() => toggleSelect(t.sourceTerm)} style={{ borderBottom: '1px solid var(--surface-container)', cursor: 'pointer', background: isSel ? 'rgba(59,130,246,0.04)' : 'transparent', transition: 'background 0.1s' }}>
                    <td style={{ padding: '11px 16px', width: 36 }}><input type="checkbox" checked={isSel} onChange={() => toggleSelect(t.sourceTerm)} style={{ width: 14, height: 14, accentColor: '#3b82f6', cursor: 'pointer' }} /></td>
                    <td style={{ padding: '11px 16px', fontWeight: 700, color: 'var(--on-surface)', fontSize: 14 }}>{t.sourceTerm}</td>
                    <td style={{ padding: '11px 16px', color: '#3b82f6', fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>{t.targetTerm}</td>
                    <td style={{ padding: '11px 16px' }}><TypeBadge type={t.type} /></td>
                    <td style={{ padding: '11px 16px' }}><ConfBadge modelCount={t.modelCount} confidence={t.confidence} /></td>
                    <td style={{ padding: '11px 16px', textAlign: 'center', fontWeight: 700, color: t.count >= 3 ? '#3b82f6' : 'var(--on-surface-variant)' }}>{t.count}次</td>
                    <td style={{ padding: '11px 16px', color: 'var(--on-surface-variant)', fontSize: 12, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.explanation}</td>
                  </tr>)
                })}</tbody>
              </table>
            </div>
          )}

          {/* 空状态 */}
          {!running && terms.length === 0 && progress && progress.done > 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--on-surface-variant)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: '#10b981' }}>DONE</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--on-surface)', marginBottom: 6 }}>分析完成，未发现需要入库的特殊词汇</div>
              <div style={{ fontSize: 13 }}>本项目的译文基本遵循字面翻译，无明显俚语或术语偏差</div>
            </div>
          )}
        </>)}
      </div>
    </div>
  )
}

