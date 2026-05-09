import { useState, useEffect } from 'react'
import { on } from '../eventBus'

function DonutChart({ pct, score }) {
  const r = 44, c = 2 * Math.PI * r
  const dash = (pct / 100) * c
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={110} height={110} viewBox="0 0 110 110">
      <circle cx={55} cy={55} r={r} fill="none" stroke="var(--surface-container-high)" strokeWidth={9} />
      <circle cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={9}
        strokeDasharray={`${dash} ${c}`} strokeDashoffset={c / 4} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s' }} />
      <text x={55} y={50} textAnchor="middle" fontSize={20} fontWeight={800} fill={color} fontFamily="monospace">{score ?? '—'}</text>
      <text x={55} y={68} textAnchor="middle" fontSize={10} fill="var(--outline)" fontFamily="inherit">{pct}%</text>
    </svg>
  )
}

function ScoreBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.round(value / max * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-variant)', width: 80, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--surface-container)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: 'monospace', minWidth: 24, textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  )
}

export default function StatsView({ api, toast, onProjectDeleted, projects, refreshProjects, isVisible }) {
  const [allStats, setAllStats] = useState(null)
  const [memStats, setMemStats] = useState(null)
  const [selId, setSelId] = useState(null)
  const [projStats, setProjStats] = useState(null)
  const [memItems, setMemItems] = useState([])
  const [memQuery, setMemQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [minedProjects, setMinedProjects] = useState(new Set()) // 已挖掘的项目ID

  // P0: 切换可见时自动刷新统计数据
  useEffect(() => {
    if (!isVisible) return
    api.dbGetAllStats().then(r => { if (r?.success) setAllStats(r) })
    api.dbGetMemoryStats().then(r => { if (r?.success) setMemStats(r.stats) })
    api.getAppPref?.('term_mine_history').then(r => {
      if (r?.success && Array.isArray(r.value)) {
        const names = new Set(r.value.map(h => h.projectName))
        setMinedProjects(names)
      }
    })
  }, [isVisible])

  // P1: 其他模块完成操作后自动刷新统计
  useEffect(() => {
    const u1 = on('review:completed', () => {
      refreshProjects?.()
      api.dbGetAllStats().then(r => { if (r?.success) setAllStats(r) })
    })
    return u1
  }, [])

  async function selectProject(id) {
    setSelId(id)
    setMemQuery('')
    setProjStats(null)
    setMemItems([])
    // 加载该项目统计
    const sr = await api.dbGetProjectStats(id)
    if (sr?.success) setProjStats(sr)
    // 加载该项目的记忆条目（已审核的句段）
    const db = await api.dbLoadProjectById(id)
    if (db?.success && db.segments) {
      const reviewed = db.segments
        .filter(s => s.status === 'done' && s.score != null)
        .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
        .slice(0, 100)
      setMemItems(reviewed)
    }
  }

  async function handleSearch() {
    if (!memQuery.trim()) {
      // 重新加载当前项目数据
      if (selId) selectProject(selId)
      return
    }
    setSearching(true)
    const res = await api.dbSearchMemory(memQuery.trim())
    if (res.success) {
      setMemItems(res.items)
      if (res.items.length === 0) toast?.('未找到匹配条目', 'info')
    }
    setSearching(false)
  }

  const pct = allStats && allStats.total > 0 ? Math.round(allStats.done / allStats.total * 100) : 0
  const fixRate = allStats && allStats.done > 0 ? Math.round((allStats.fixedCount || 0) / allStats.done * 100) : 0
  const selProj = projects.find(p => p.id === selId)
  const selName = selProj ? (selProj.project_name || selProj.file_path.split('/').pop()) : ''

  // 检查项目是否已挖掘
  function isProjectMined(p) {
    const name = p.project_name || p.file_path.split('/').pop()
    return minedProjects.has(name)
  }
  const [exporting, setExporting] = useState(false)
  async function handleExportReport() {
    setExporting(true)
    const r = await api.exportStatsReport()
    setExporting(false)
    if (r.success) toast?.(`报告已导出：${r.filePath.split('/').pop()}`, 'success')
    else if (r.error !== 'Cancelled') toast?.(r.error || '导出失败', 'error')
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ═══ 第一列：总统计概览 ═══ */}
      <div style={{ width: 220, minWidth: 220, borderRight: '1px solid var(--surface-container)', overflowY: 'auto', background: 'var(--surface-container-lowest)', padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <DonutChart pct={pct} score={allStats?.avgScore} />
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>综合评分</div>
        <button onClick={handleExportReport} disabled={exporting} style={{ display:'block', width:'100%', marginBottom:16, border:'none', borderRadius:8, padding:'8px 0', background:'var(--tertiary)', color:'#fff', fontWeight:700, fontSize:12, cursor:exporting?'not-allowed':'pointer', fontFamily:'inherit' }}>
          {exporting ? '导出中...' : '导出质量报告'}
        </button>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>累计统计</div>
        {[
          { label: '总句段', value: allStats?.total ?? '—' },
          { label: '已审核', value: allStats?.done ?? '—' },
          { label: '完成率', value: allStats ? `${pct}%` : '—' },
          { label: '已纠错', value: allStats?.fixedCount ?? '—' },
          { label: '纠错率', value: allStats ? `${fixRate}%` : '—' },
          { label: '记忆库条数', value: memStats?.total ?? '—' },
          { label: '历史均分', value: memStats?.avgScore ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px dashed var(--surface-container)' }}>
            <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'monospace' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* ═══ 第二列：项目文件列表 ═══ */}
      <div style={{ width: 240, minWidth: 240, borderRight: '1px solid var(--surface-container)', overflowY: 'auto', background: 'var(--surface-container-low)' }}>
        <div style={{ padding: '16px 16px 10px', fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>项目文件</div>
        {projects.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--outline)', fontSize: 13 }}>暂无项目</div>
        ) : projects.map(p => {
          const name = p.project_name || p.file_path.split('/').pop()
          const total = p.segment_count || 0
          const done = p.done_count || 0
          const pp = total > 0 ? Math.round(done / total * 100) : 0
          const isActive = p.id === selId
          const mined = isProjectMined(p)
          return (
            <div key={p.id} onClick={() => selectProject(p.id)} style={{
              padding: '12px 16px', cursor: 'pointer',
              borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent',
              background: isActive ? 'rgba(59,130,246,0.06)' : 'transparent',
              borderBottom: '1px solid var(--surface-container)', transition: 'all 0.15s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? '#3b82f6' : 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{name}</span>
                {mined && <span style={{ fontSize: 9, fontWeight: 700, color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>已挖掘</span>}
                {deletingId === p.id ? (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={async () => { const r = await api.dbDeleteProject(p.id); if (r.success) { toast('已删除', 'success'); onProjectDeleted?.(p.id); if (selId === p.id) { setSelId(null); setProjStats(null); setMemItems([]) } api.dbGetAllStats().then(r => { if (r?.success) setAllStats(r) }) } else toast(r.error, 'error'); setDeletingId(null) }}
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
              <div style={{ height: 3, background: 'var(--surface-container-high)', borderRadius: 99, marginBottom: 4 }}>
                <div style={{ width: `${pp}%`, height: '100%', background: pp === 100 ? '#10b981' : '#3b82f6', borderRadius: 99 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--outline)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{done}/{total}</span><span>{p.updated_at?.slice(0, 10)}</span>
              </div>
              {/* 工作流阶段指示 */}
              <div style={{ display: 'flex', gap: 2, marginTop: 6, alignItems: 'center' }}>
                {[
                  { label: '导入', ok: total > 0 },
                  { label: '审核', ok: pp === 100 },
                  { label: '挖掘', ok: mined },
                ].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {i > 0 && <span style={{ fontSize: 8, color: 'var(--outline)', margin: '0 1px' }}>→</span>}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                      background: step.ok ? 'rgba(16,185,129,0.1)' : 'var(--surface-container)',
                      color: step.ok ? '#10b981' : 'var(--outline)',
                    }}>{step.ok ? '✓' : '○'} {step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══ 第三列：项目详情 + 可视化 + 记忆表格 ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--outline)', fontSize: 13 }}>
            从左侧选择项目文件查看详情
          </div>
        ) : (<>
          {/* 项目标题 + 搜索 */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--surface-container)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, background: 'var(--surface-container-low)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selName}</span>
            <input
              style={{ background: 'var(--surface-container)', border: 'none', borderRadius: 6, color: 'var(--on-surface)', padding: '5px 12px', fontSize: 12, outline: 'none', width: 180, fontFamily: 'inherit' }}
              placeholder="检索记忆库..."
              value={memQuery} onChange={e => setMemQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button onClick={handleSearch} disabled={searching} style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
              padding: '5px 14px', fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
            }}>{searching ? '...' : '检索'}</button>
          </div>

          {/* 项目统计可视化 */}
          {projStats && (
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--surface-container)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
                {[
                  { label: '总句段', value: projStats.total, color: 'var(--on-surface)' },
                  { label: '已审核', value: projStats.done, color: '#3b82f6' },
                  { label: '问题句段', value: projStats.lowScore?.length ?? 0, color: '#ef4444' },
                  { label: '已纠错', value: projStats.fixedCount ?? 0, color: '#10b981' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ flex: 1, background: 'var(--surface-container-low)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color, fontFamily: 'monospace' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* 审核前后分数对比 */}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>AI 审核前后分数对比</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                <ScoreBar label="未纠错均分" value={projStats.unfixedAvgScore ?? projStats.avgScore ?? 0} max={100} color="#f59e0b" />
                <ScoreBar label="纠错原始均分" value={projStats.fixedAvgScore ?? 0} max={100} color="#ef4444" />
                <ScoreBar label="综合均分" value={projStats.avgScore ?? 0} max={100} color="#10b981" />
              </div>

              {/* 错误类型 TOP */}
              {projStats.errorTypes && Object.keys(projStats.errorTypes).length > 0 && (<>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>错误类型分布</div>
                {Object.entries(projStats.errorTypes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type, count]) => {
                  const mx = Math.max(...Object.values(projStats.errorTypes))
                  return (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-variant)', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type}</span>
                      <div style={{ flex: 1, height: 6, background: 'var(--surface-container)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(count / mx * 100)}%`, height: '100%', background: 'rgba(239,68,68,0.6)', borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', minWidth: 20, textAlign: 'right' }}>{count}</span>
                    </div>
                  )
                })}
              </>)}
            </div>
          )}

          {/* 记忆条目表格 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {memItems.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--outline)', fontSize: 13 }}>该项目暂无翻译记忆条目</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-container-low)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '9px 20px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>源文</th>
                    <th style={{ padding: '9px 20px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>译文</th>
                    <th style={{ padding: '9px 16px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', width: 60 }}>评分</th>
                  </tr>
                </thead>
                <tbody>
                  {memItems.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--surface-container)' }}>
                      <td style={{ padding: '10px 20px', color: 'var(--on-surface-variant)', lineHeight: 1.5, verticalAlign: 'top' }}>{item.source}</td>
                      <td style={{ padding: '10px 20px', color: 'var(--on-surface)', fontWeight: 600, lineHeight: 1.5, verticalAlign: 'top' }}>{item.target || item.fixed_target}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', verticalAlign: 'top' }}>
                        {item.score != null && (
                          <span style={{ background: item.score >= 80 ? 'rgba(16,185,129,0.1)' : item.score >= 60 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: item.score >= 80 ? '#10b981' : item.score >= 60 ? '#f59e0b' : '#ef4444', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                            {item.score}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}
      </div>
    </div>
  )
}
