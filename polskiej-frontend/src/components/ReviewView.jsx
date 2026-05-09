import { useState, useEffect, useRef, Component, useCallback } from 'react'
import { FixedSizeList } from 'react-window'
import { emit } from '../eventBus'

class ErrBound extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(e) { return { err: e } }
  componentDidCatch(e, info) { console.error('[ReviewView Error]', e, info) }
  render() {
    if (this.state.err) return (
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:16 }}>
        <div style={{ fontSize:13,color:'var(--outline)' }}>渲染出错：{this.state.err.message}</div>
        <button onClick={()=>this.setState({err:null})} style={{ background:'var(--tertiary)',color:'#fff',border:'none',borderRadius:8,padding:'8px 20px',fontWeight:700,cursor:'pointer',fontFamily:'inherit' }}>重试</button>
      </div>
    )
    return this.props.children
  }
}

const DIM_KEYS = [['consistency','一致性'],['slang','口语化'],['internetSlang','网络用语'],['tense','时态'],['accuracy','准确度'],['declension','变格'],['grammar','语法']]

function ScoreBadge({ score }) {
  if (score==null) return null
  const color = score>=80?'var(--tertiary)':score>=60?'#f59e0b':'var(--error)'
  const bg = score>=80?'rgba(0,93,187,0.08)':score>=60?'rgba(245,158,11,0.08)':'rgba(159,64,61,0.08)'
  return <span style={{ background:bg,color,padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:700,fontFamily:'var(--font-mono)' }}>{score}分</span>
}

// A2: DiffView — 带大文本保护（超过 2000 词时降级显示，避免主线程卡死）
const DIFF_WORD_LIMIT = 2000
function DiffView({ original, suggested }) {
  // 极端输入保护：空值、纯空格
  const a = (original || '').trim()
  const b = (suggested || '').trim()
  if (!a && !b) return <div style={{fontSize:13,color:'var(--outline)'}}>（无内容）</div>

  const wordsA = a.split(/(\s+)/)
  const wordsB = b.split(/(\s+)/)

  // 超大文本降级：不跑 LCS，直接展示两段并标注
  if (wordsA.length + wordsB.length > DIFF_WORD_LIMIT) {
    return (
      <div style={{fontSize:13,color:'var(--on-surface)',lineHeight:1.8}}>
        <div style={{fontSize:11,color:'#f59e0b',fontWeight:700,marginBottom:8}}>
          ⚠ 文本过长（{wordsA.length + wordsB.length} 词），已使用简洁对比模式
        </div>
        <div style={{marginBottom:8}}>
          <del style={{color:'var(--error)',background:'rgba(159,64,61,0.10)',borderRadius:3,padding:'2px 6px'}}>原译文</del>
          <span style={{marginLeft:8,wordBreak:'break-all'}}>{a.slice(0, 500)}{a.length>500?'…':''}</span>
        </div>
        <div>
          <ins style={{color:'#16a34a',background:'rgba(22,163,74,0.10)',borderRadius:3,padding:'2px 6px',textDecoration:'none'}}>AI建议</ins>
          <span style={{marginLeft:8,wordBreak:'break-all'}}>{b.slice(0, 500)}{b.length>500?'…':''}</span>
        </div>
      </div>
    )
  }

  const m = wordsA.length, n = wordsB.length
  const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0))
  for (let i=m-1;i>=0;i--) for (let j=n-1;j>=0;j--)
    dp[i][j] = wordsA[i]===wordsB[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1])
  const parts=[]
  let i=0,j=0
  while(i<m||j<n){
    if(i<m&&j<n&&wordsA[i]===wordsB[j]){ parts.push({t:'eq',v:wordsA[i]});i++;j++ }
    else if(j<n&&(i>=m||dp[i+1]?.[j]<=(dp[i]?.[j+1]??0))){ parts.push({t:'add',v:wordsB[j]});j++ }
    else { parts.push({t:'del',v:wordsA[i]});i++ }
  }
  return (
    <div style={{fontSize:14,lineHeight:1.85,wordBreak:'break-all'}}>
      {parts.map((p,idx)=>{
        // React 默认转义文本内容，此处无 XSS 风险
        if(p.t==='eq') return <span key={idx}>{p.v}</span>
        if(p.t==='del') return <del key={idx} style={{color:'var(--error)',background:'rgba(159,64,61,0.10)',textDecoration:'line-through',borderRadius:3,padding:'0 2px'}}>{p.v}</del>
        return <ins key={idx} style={{color:'#16a34a',background:'rgba(22,163,74,0.10)',textDecoration:'none',borderRadius:3,padding:'0 2px'}}>{p.v}</ins>
      })}
    </div>
  )
}

function EditableTarget({ seg, api, project, onUpdate, box, lbl }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const [saving, setSaving] = useState(false)
  const current = seg.fixed ? seg.fixedTarget : seg.target

  function startEdit() { setVal(current); setEditing(true) }
  async function saveEdit() {
    if (val === current) { setEditing(false); return }
    setSaving(true)
    const updated = { ...seg, target: val, fixed: false }
    await api.dbSaveSegment({ ...updated, projectId: project.projectId })
    onUpdate(updated)
    setSaving(false)
    setEditing(false)
  }
  function onKeyDown(e) {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveEdit() }
    if (e.key==='Escape') setEditing(false)
  }

  return (
    <div>
      <div style={{ ...lbl, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span>当前波兰语译文</span>
        {!editing && <button onClick={startEdit} style={{background:'transparent',border:'none',color:'var(--outline)',fontSize:11,fontWeight:700,cursor:'pointer',padding:0,fontFamily:'inherit'}}>✏ 编辑</button>}
      </div>
      {editing ? (
        <div style={{marginTop:8}}>
          <textarea value={val} onChange={e=>setVal(e.target.value)} onKeyDown={onKeyDown} autoFocus
            style={{width:'100%',minHeight:100,resize:'vertical',...box,border:'1.5px solid var(--tertiary)',outline:'none',color:'var(--on-surface)',fontWeight:500,boxSizing:'border-box'}}/>
          <div style={{display:'flex',gap:8,marginTop:6}}>
            <button onClick={saveEdit} disabled={saving} style={{background:'var(--tertiary)',color:'#fff',border:'none',borderRadius:6,padding:'5px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{saving?'保存中...':'保存 (⌘S)'}</button>
            <button onClick={()=>setEditing(false)} style={{background:'var(--surface-container)',color:'var(--on-surface-variant)',border:'none',borderRadius:6,padding:'5px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>取消</button>
          </div>
        </div>
      ) : (
        <div onClick={startEdit} title="点击编辑" style={{...box,marginTop:8,color:'var(--on-surface)',fontWeight:500,cursor:'text'}}>{current}</div>
      )}
    </div>
  )
}

function StatusChip({ seg }) {
  const b = { padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:700 }
  if (seg.status==='error') return <span style={{ ...b,background:'rgba(159,64,61,0.08)',color:'var(--error)' }}>错误</span>
  if (seg.fixed) return <span style={{ ...b,background:'rgba(0,93,187,0.08)',color:'var(--tertiary)' }}>已纠错</span>
  if (seg.status==='done'&&seg.errors?.length) return <span style={{ ...b,background:'rgba(159,64,61,0.08)',color:'var(--error)' }}>{seg.errors.length}处问题</span>
  if (seg.status==='done') return <span style={{ ...b,background:'rgba(0,93,187,0.08)',color:'var(--tertiary)' }}>已审核</span>
  if (seg.status==='translated'||seg.status==='in_review') return <span style={{ ...b,background:'rgba(168,85,247,0.08)',color:'#a855f7' }}>{seg.status==='in_review'?'审核中':'待审核'}</span>
  return <span style={{ ...b,background:'var(--surface-container)',color:'var(--outline)' }}>未翻译</span>
}

/* 右侧详情 */
function DetailPane({ seg, idx, api, toast, settings, project, onUpdate, bgRunning, currentId }) {
  const [busy,setBusy]=useState(false)
  const [showDims,setShowDims]=useState(false)
  const [history,setHistory]=useState([])
  const [showHist,setShowHist]=useState(false)
  const [memHints,setMemHints]=useState([])
  useEffect(()=>{ setShowDims(false);setShowHist(false);setHistory([]);setMemHints([]) },[seg?.id])

  // B3: 自动查询相似翻译记忆
  useEffect(()=>{
    if (!seg?.source) return
    api.dbSearchMemory(seg.source).then(r=>{
      if (r.success && r.items?.length) setMemHints(r.items.slice(0,3))
    })
  },[seg?.id])

  if (!seg) return (
    <div style={{ width:'45%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--surface-container-lowest)',borderLeft:'1px solid var(--surface-container)' }}>
      <div style={{ textAlign:'center',color:'var(--outline)',fontSize:13,fontWeight:600 }}>← 选择句段查看详情</div>
    </div>
  )

  async function review() {
    if (!settings.apiKey) { toast('请先在设置中配置接口密钥','error'); return }
    setBusy(true)
    try {
      const glossaryRes = await api.glossaryGet(project.projectId)
      // C1: 注入前后5条上下文
      const allSegs = project.segments || []
      const curIdx = allSegs.findIndex(s => s.id === seg.id)
      const ctxBefore = allSegs.slice(Math.max(0, curIdx - 5), curIdx).map(s => s.source).join('\n')
      const ctxAfter = allSegs.slice(curIdx + 1, Math.min(allSegs.length, curIdx + 6)).map(s => s.source).join('\n')
      const res = await api.deepseekReview({
        apiModel:settings.apiModel, apiKey:settings.apiKey,
        source:seg.source, target:seg.target, sourceLang:settings.sourceLang,
        speakerGender:seg.gender||'male',
        guidelineText:project.guidelineText, globalContext:project.globalContext||settings.globalContext,
        customPrompt:settings.customPrompt,
        contextBefore:ctxBefore, contextAfter:ctxAfter,
        glossaryItems:glossaryRes.success?glossaryRes.items:[]
      })
      if (!res.success) { toast(res.error,'error'); return }
      const updated={ ...seg,status:'done',score:res.result.score,errors:res.result.errors||[],dimensions:res.result.dimensions||{},fixedTarget:res.result.fixedTarget }
      await api.dbSaveSegment({ ...updated,projectId:project.projectId })
      onUpdate(updated)
      toast(`审核完成，质量评分：${res.result.score}`,res.result.score>=80?'success':'info')
    } catch(e){ toast(e.message,'error') }
    finally { setBusy(false) }
  }

  async function applyFix() {
    const updated={ ...seg,target:seg.fixedTarget,fixed:true }
    await api.dbSaveSegment({ ...updated,projectId:project.projectId })
    onUpdate(updated); toast('已应用修改建议','success')
  }

  async function loadHistory() {
    const res=await api.dbGetSegmentHistory({ segmentId:seg.id,projectId:project.projectId })
    if (res.success) { setHistory(res.history);setShowHist(true) }
  }


  const dims = (seg.dimensions && typeof seg.dimensions === 'object') ? seg.dimensions : {}
  const lbl={ fontSize:11,fontWeight:700,color:'var(--outline)',textTransform:'uppercase',letterSpacing:'0.08em' }
  const box={ background:'var(--surface-container-low)',borderRadius:10,padding:'14px 16px',fontSize:14,lineHeight:1.85,color:'var(--on-surface-variant)' }
  const isProcessing = currentId===seg.id

  return (
    <div style={{ width:'45%',flexShrink:0,display:'flex',flexDirection:'column',background:'var(--surface-container-lowest)',borderLeft:'1px solid var(--surface-container)' }}>
      <div style={{ padding:'16px 24px',borderBottom:'1px solid var(--surface-container)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--outline)' }}>#{String(idx+1).padStart(3,'0')}</span>
          <StatusChip seg={seg}/><ScoreBadge score={seg.score}/>
          <span style={{ fontSize:11,fontWeight:700,color:seg.gender==='female'?'#c2185b':'var(--tertiary)',background:seg.gender==='female'?'rgba(194,24,91,0.08)':'rgba(0,93,187,0.08)',padding:'2px 8px',borderRadius:20 }}>{seg.gender==='female'?'女':'男'}</span>
          {isProcessing&&<span style={{ fontSize:11,color:'var(--tertiary)',fontWeight:700,animation:'pulse 1s infinite' }}>后台分析中...</span>}
        </div>
        <button onClick={review} disabled={busy||bgRunning}
          style={{ background:busy?'var(--surface-container)':'var(--tertiary)',color:busy?'var(--outline)':'#fff',border:'none',padding:'7px 14px',borderRadius:8,fontWeight:700,fontSize:12,cursor:busy?'not-allowed':'pointer',fontFamily:'inherit' }}>
          {busy?'分析中...':'单条审核'}
        </button>
      </div>
      <div style={{ flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',gap:20 }}>
        <div><div style={lbl}>源文</div><div style={{ ...box,marginTop:8 }}>{seg.source}</div></div>
        <EditableTarget seg={seg} api={api} project={project} onUpdate={onUpdate} box={box} lbl={lbl}/>
        {seg.fixedTarget&&seg.fixedTarget!==seg.target&&!seg.fixed&&(
          <div>
            <div style={{ ...lbl,color:'var(--tertiary)',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
              <span>AI 修改建议 <span style={{fontWeight:400,color:'var(--outline)',textTransform:'none',letterSpacing:0,fontSize:10}}>(— <del style={{color:'var(--error)'}}>\u5220除</del> / <ins style={{color:'#16a34a',textDecoration:'none'}}>新增</ins>)</span></span>
              <button onClick={applyFix} style={{ background:'var(--tertiary)',color:'#fff',border:'none',padding:'4px 12px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit' }}>一键应用</button>
            </div>
            <div style={{ ...box,background:'rgba(0,93,187,0.03)',border:'1.5px solid rgba(0,93,187,0.15)' }}>
              <DiffView original={seg.target} suggested={seg.fixedTarget}/>
            </div>
          </div>
        )}
        {seg.errors?.length>0&&(
          <div>
            <div style={{ ...lbl,color:'var(--error)',marginBottom:10 }}>问题（{seg.errors.length}处）</div>
            {seg.errors.map((e,i)=>(
              <div key={i} style={{ background:'var(--surface-container-lowest)',border:'1px solid rgba(159,64,61,0.15)',borderRadius:10,padding:14,marginBottom:8 }}>
                <div style={{ fontSize:11,fontWeight:700,color:'var(--error)',marginBottom:6 }}>{e.type}</div>
                <div style={{ fontSize:13,color:'var(--outline)',textDecoration:'line-through',lineHeight:1.7 }}>{e.original}</div>
                <div style={{ fontSize:13,color:'var(--on-surface)',fontWeight:600,lineHeight:1.7 }}>→ {e.suggested}</div>
                <div style={{ fontSize:12,color:'var(--on-surface-variant)',marginTop:4,lineHeight:1.6 }}>{e.explanation}</div>
              </div>
            ))}
          </div>
        )}
        {dims && typeof dims === 'object' && Object.values(dims).some(Boolean)&&(
          <div>
            <button onClick={()=>setShowDims(v=>!v)} style={{ background:'transparent',border:'none',fontSize:12,color:'var(--outline)',fontWeight:700,cursor:'pointer',padding:0,fontFamily:'inherit' }}>
              {showDims?'收起':'展开'} 七维度分析
            </button>
            {showDims&&(
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10 }}>
                {DIM_KEYS.map(([k,label])=>dims[k]?(
                  <div key={k} style={{ background:'var(--surface-container-low)',borderRadius:8,padding:'10px 12px' }}>
                    <div style={{ fontSize:10,fontWeight:700,color:'var(--outline)',textTransform:'uppercase',marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:12,color:'var(--on-surface)',lineHeight:1.5 }}>{dims[k]}</div>
                  </div>
                ):null)}
              </div>
            )}
          </div>
        )}
        <div>
          <button onClick={loadHistory} style={{ background:'transparent',border:'none',color:'var(--outline)',cursor:'pointer',fontSize:12,fontWeight:600,padding:0,fontFamily:'inherit' }}>查看历史版本 →</button>
          {showHist&&history.map((h,i)=>(
            <div key={i} style={{ marginTop:8,padding:12,background:'var(--surface-container-low)',borderRadius:8 }}>
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:6 }}>
                <span style={{ fontSize:11,color:'var(--outline)' }}>{h.saved_at}</span><ScoreBadge score={h.score}/>
              </div>
              <div style={{ fontSize:13,color:'var(--on-surface)',lineHeight:1.7 }}>{h.target}</div>
            </div>
          ))}
        </div>
        {/* B3: 相似翻译记忆提示 */}
        {memHints.length>0&&(
          <div>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--outline)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:10 }}>相似翻译记忆（{memHints.length}条）</div>
            {memHints.map((m,i)=>(
              <div key={i} style={{ background:'var(--surface-container-low)',borderRadius:8,padding:'10px 12px',marginBottom:8,cursor:'pointer' }}
                onClick={()=>{
                  // L2: 埋点 — 记录该记忆条目被应用
                  api.logUsageEvent({ eventType:'memory_applied', segmentId:seg?.id, metadata: String(m.id) })
                  onUpdate({...seg,fixedTarget:m.target})
                }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
                  <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                    <span style={{ fontSize:10,color:'var(--outline)' }}>点击应用</span>
                    {/* L3: 展示个人使用频次 */}
                    {m.accept_count>0&&<span style={{ fontSize:10,fontWeight:700,color:'var(--tertiary)',background:'rgba(0,93,187,0.08)',borderRadius:20,padding:'1px 7px' }}>已用{m.accept_count}次</span>}
                  </div>
                  <ScoreBadge score={m.score}/>
                </div>
                <div style={{ fontSize:12,color:'var(--on-surface)',lineHeight:1.6 }}>{m.target}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

/* 列表行中的7维度迷你展示 */
function DimMini({ dims, expanded, onToggle }) {
  if (!dims||typeof dims !== 'object'||!Object.values(dims).some(Boolean)) return null
  return (
    <div style={{ gridColumn:'span 1' }}>
      <button onClick={e=>{ e.stopPropagation();onToggle() }}
        style={{ background:expanded?'var(--on-surface)':'var(--surface-container-low)',color:expanded?'#fff':'var(--outline)',border:'none',borderRadius:6,padding:'3px 10px',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap' }}>
        七维度{expanded?'▲':'▼'}
      </button>
      {expanded&&(
        <div style={{ marginTop:6,display:'flex',flexDirection:'column',gap:4 }}>
          {DIM_KEYS.map(([k,label])=>dims[k]?(
            <div key={k} style={{ fontSize:10,lineHeight:1.5 }}>
              <span style={{ color:'var(--outline)',fontWeight:700 }}>{label}：</span>
              <span style={{ color:'var(--on-surface-variant)' }}>{dims[k].slice(0,40)}{dims[k].length>40?'…':''}</span>
            </div>
          ):null)}
        </div>
      )}
    </div>
  )
}

function ReviewViewInner({ api, toast, project, settings, updateSegment, setProject }) {
  const [selected,setSelected]=useState(null)
  const [filter,setFilter]=useState('all')
  const [search,setSearch]=useState('')
  const [bgRunning,setBgRunning]=useState(false)
  const [bgPaused,setBgPaused]=useState(false)
  const [bgPhase,setBgPhase]=useState('idle')
  const [bgProgress,setBgProgress]=useState(null)
  const [currentId,setCurrentId]=useState(null)
  const [saving,setSaving]=useState(false)
  const [saveName,setSaveName]=useState('')
  const [showSaveBox,setShowSaveBox]=useState(false)
  const [expandedDims,setExpandedDims]=useState({})
  const [showResetConfirm,setShowResetConfirm]=useState(false)
  const [resetting,setResetting]=useState(false)
  const [showPhaseModal,setShowPhaseModal]=useState(false)
  const [applying,setApplying]=useState(false)
  // G4: 分页已被 P1 虚拟滚动取代
  const listRef = useRef(null)
  const [showExport,setShowExport]=useState(false)
  const [exporting,setExporting]=useState(false)
  const [exportOpts,setExportOpts]=useState({
    useFixed:true, includeSource:true, includeTarget:true,
    includeScore:true, includeErrors:false
  })

  const cfg = () => ({
    projectId:project.projectId, apiKey:settings.apiKey,
    apiModel:settings.apiModel, modelName:settings.modelName||'deepseek-chat',
    sourceLang:settings.sourceLang, customPrompt:settings.customPrompt||'',
    guidelineText:project.guidelineText||'',
    globalContext:project.globalContext||settings.globalContext||''
  })

  // 用 ref 保持最新 projectId，避免 useEffect 闭包中引用初始值
  const projectRef = useRef(null)
  const progressCountRef = useRef(0)
  useEffect(() => { projectRef.current = project?.projectId ?? null }, [project?.projectId])

  useEffect(()=>{
    if (!api.onReviewProgress) return
    const u1=api.onReviewProgress(d=>{
      setBgRunning(d.running); setBgPaused(!!d.paused)
      setBgPhase(d.phase||'idle'); setCurrentId(d.currentId); setBgProgress(d)
      progressCountRef.current++
      // 审核/翻译完成时通知其他模块刷新
      if (!d.running && progressCountRef.current > 1) emit('review:completed')
      const pid = projectRef.current
      // P2: 增量合并 — 如果后端发来了 updatedSegments，直接 merge
      if (pid && d.updatedSegments?.length && setProject) {
        const updates = new Map(d.updatedSegments.map(s => [s.id, {
          ...s,
          errors: typeof s.errors === 'string' ? JSON.parse(s.errors || '[]') : (s.errors || []),
          dimensions: typeof s.dimensions === 'string' ? JSON.parse(s.dimensions || '{}') : (s.dimensions || {}),
          fixedTarget: s.fixed_target || s.fixedTarget || '',
          projectId: s.project_id || pid
        }]))
        setProject(p => ({
          ...p,
          segments: p.segments.map(s => updates.has(s.id) ? { ...s, ...updates.get(s.id) } : s)
        }))
      }
      // 仅在任务完全停止时全量刷新（确保数据一致）
      if (pid && !d.running && progressCountRef.current > 1)
        api.dbLoadProjectById(pid).then(r=>{ if(r.success&&setProject) setProject(r) })
    })
    const u2=api.onPhaseComplete?.((d)=>{
      if (d.phase==='translate') {
        const pid = projectRef.current
        if (pid)
          api.dbLoadProjectById(pid).then(r=>{ if(r.success&&setProject) setProject(r) })
        setShowPhaseModal(true)
      }
    })
    api.syncReviewStatus?.().then(s=>{
      setBgRunning(s.running); setBgPaused(!!s.paused)
      setBgPhase(s.phase||'idle'); setCurrentId(s.currentId); setBgProgress(s)
      const pid = projectRef.current
      // 如果后端残留运行状态但当前项目为空，自动停止
      if (s.running && !pid) {
        api.stopBackgroundReview?.()
        setBgRunning(false); setBgPaused(false); setBgPhase('idle'); setBgProgress(null)
      }
    })
    return ()=>{ if(typeof u1==='function')u1(); if(typeof u2==='function')u2() }
  },[])

  if (!project) return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12,color:'var(--on-surface-variant)' }}>
      <div style={{ fontSize:18,fontWeight:800,color:'var(--on-surface)' }}>尚未加载项目</div>
      <div style={{ fontSize:14 }}>请前往「项目资料库」导入或打开文件</div>
    </div>
  )

  // 键盘快捷键：↑/↓ 切换句段，并随页跟当前选中项
  useEffect(()=>{
    function onKey(e){
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return
      const flt=project.segments.filter(s=>{
        if(filter==='pending'&&s.status!=='pending') return false
        if(filter==='translated'&&s.status!=='translated'&&s.status!=='in_review') return false
        if(filter==='done'&&s.status!=='done') return false
        if(filter==='error'&&s.status!=='error'&&!s.errors?.length) return false
        if(filter==='issues'&&!(s.status==='done'&&s.errors?.length>0&&!s.fixed)) return false
        if(filter==='low'&&!(s.score!=null&&s.score<60)) return false
        if(search&&!s.source.includes(search)&&!(s.target||'').includes(search)) return false
        return true
      })
      if(!flt.length) return
      const curIdx=flt.findIndex(s=>s.id===selected)
      let nextId = null
      if(e.key==='ArrowDown'){
        e.preventDefault()
        const next=curIdx<flt.length-1?curIdx+1:0
        nextId = flt[next].id
      } else if(e.key==='ArrowUp'){
        e.preventDefault()
        const prev=curIdx>0?curIdx-1:flt.length-1
        nextId = flt[prev].id
      }
      if (nextId !== null) {
        setSelected(nextId)
        // P1: 虚拟滚动自动定位到选中项
        const nextIdx = flt.findIndex(s=>s.id===nextId)
        listRef.current?.scrollToItem(nextIdx, 'smart')
      }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[selected,filter,search,project])

  const segs=project.segments
  const nPending=segs.filter(s=>s.status==='pending').length
  const nTranslated=segs.filter(s=>s.status==='translated'||s.status==='in_review').length
  const nDone=segs.filter(s=>s.status==='done').length
  const nError=segs.filter(s=>s.status==='error').length
  const total=segs.length
  const pct=total>0?Math.round((nDone+nTranslated)/total*100):0
  const reviewPct=total>0?Math.round(nDone/total*100):0
  const hasUntranslated=segs.some(s=>s.status==='pending'&&(!s.target||!s.target.trim()))
  const hasTranslated=nTranslated>0

  const filtered=segs.filter(s=>{
    if (filter==='pending'&&s.status!=='pending') return false
    if (filter==='translated'&&s.status!=='translated'&&s.status!=='in_review') return false
    if (filter==='done'&&s.status!=='done') return false
    if (filter==='error'&&s.status!=='error'&&!s.errors?.length) return false
    if (filter==='issues'&&!(s.status==='done'&&s.errors?.length>0&&!s.fixed)) return false
    if (filter==='low'&&!(s.score!=null&&s.score<60)) return false
    if (search&&!s.source.includes(search)&&!(s.target||'').includes(search)) return false
    return true
  })
  // P1: 虚拟滚动 — 不再需要分页切片
  const selSeg=segs.find(s=>s.id===selected)||null

  async function toggleGender(seg){
    const g=seg.gender==='female'?'male':'female'
    await api.dbBatchUpdateGender({projectId:project.projectId,fromId:seg.id,gender:g})
    setProject(p=>({...p,segments:p.segments.map(s=>s.id>=seg.id?{...s,gender:g}:s)}))
  }
  async function startTranslate(){
    if(!settings.apiKey){toast('请先配置接口密钥','error');return}
    if(!hasUntranslated){toast('没有待翻译句段','info');return}
    const r=await api.startTranslateQueue(cfg())
    if(r.success){setBgRunning(true);setBgPhase('translate');toast('① 批量翻译已启动（每7条/批）','success')}
    else toast(r.error||'启动失败','error')
  }
  async function startReview(){
    if(!settings.apiKey){toast('请先配置接口密钥','error');return}
    if(!hasTranslated){toast('没有待审核句段','info');return}
    const r=await api.startReviewQueue(cfg())
    if(r.success){setBgRunning(true);setBgPhase('review');setShowPhaseModal(false);toast('② 七维度审核已启动','success')}
    else toast(r.error||'启动失败','error')
  }
  async function stopBg(){await api.stopBackgroundReview();setBgRunning(false);setBgPaused(false);setBgPhase('idle');toast('已停止','info')}
  async function pauseBg(){await api.pauseBackgroundReview();setBgPaused(true);toast('已暂停','info')}
  async function resumeBg(){await api.resumeBackgroundReview();setBgPaused(false);toast('已继续','success')}
  async function doReset(){
    if(!project?.projectId)return
    setResetting(true)
    const r=await api.resetProjectFull(project.projectId)
    setResetting(false);setShowResetConfirm(false)
    if(r.success){
      setBgRunning(false);setBgPaused(false);setBgPhase('idle');setBgProgress(null)
      const p=await api.dbLoadProjectById(project.projectId)
      if(p.success&&setProject)setProject(p)
      toast('已重置，所有句段恢复为未翻译','success')
    }else toast(r.error||'重置失败','error')
  }
  async function saveToLib(){
    if(!saveName.trim()){toast('请输入名称','error');return}
    setSaving(true)
    const r=await api.dbSaveProjectName({projectId:project.projectId,name:saveName.trim()})
    setSaving(false)
    if(r.success){toast(`已保存为「${saveName.trim()}」`,'success');setShowSaveBox(false);setSaveName('')}
    else toast(r.error,'error')
  }
  async function batchApply(){
    if(!project?.projectId)return
    setApplying(true)
    const r=await api.batchApplyFixes(project.projectId)
    setApplying(false)
    if(r.success){
      if(r.count===0){toast('没有可应用的修改建议','info');return}
      const p=await api.dbLoadProjectById(project.projectId)
      if(p.success&&setProject)setProject(p)
      toast(`已应用 ${r.count} 条修改建议，译文已自动替换`,'success')
    }else toast(r.error||'应用失败','error')
  }
  async function doExport(){
    if(!project?.projectId)return
    setExporting(true)
    const r=await api.exportProjectExcel(project.projectId,exportOpts)
    setExporting(false)
    if(r.success){setShowExport(false);toast(`已导出 ${r.count} 条到 ${r.filePath.split('/').pop()}`,'success')}
    else if(r.error!=='Cancelled')toast(r.error||'导出失败','error')
  }

  const phaseColor=bgPhase==='translate'?'#a855f7':'var(--tertiary)'
  const B={border:'none',borderRadius:8,padding:'7px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}
  const nIssues=segs.filter(s=>s.status==='done'&&s.errors?.length>0&&!s.fixed).length
  const nLow=segs.filter(s=>s.score!=null&&s.score<60).length
  const filterOpts=[
    {v:'all',l:`全部(${total})`},{v:'pending',l:`未翻译(${nPending})`},
    {v:'translated',l:`待审核(${nTranslated})`},{v:'done',l:`完成(${nDone})`},
    {v:'issues',l:`有问题(${nIssues})`},{v:'low',l:`低分<60(${nLow})`},{v:'error',l:`错误(${nError})`}
  ]
  // G4: 过滤器切换时重置虚拟列表滚动
  function changeFilter(v) { setFilter(v); listRef.current?.scrollTo(0) }
  // P6: 防抖搜索
  const searchTimerRef = useRef(null)
  const changeSearch = useCallback((v) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { setSearch(v); listRef.current?.scrollTo(0) }, 300)
  }, [])

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'var(--surface)'}}>

      {/* 翻译完成弹窗 */}
      {showPhaseModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface-container-lowest)',border:'1px solid var(--surface-container)',borderRadius:20,padding:'36px 40px',maxWidth:420,width:'90%',boxShadow:'0 32px 80px rgba(0,0,0,0.35)'}}>
            <div style={{fontSize:14,fontWeight:800,textAlign:'center',marginBottom:12,color:'#10b981'}}>ALL DONE</div>
            <div style={{fontSize:17,fontWeight:800,color:'var(--on-surface)',textAlign:'center',marginBottom:10}}>第一阶段翻译完成！</div>
            <div style={{fontSize:13,color:'var(--on-surface-variant)',lineHeight:1.75,textAlign:'center',marginBottom:28}}>
              现在可以开始<strong>第二阶段：七维度质量审核</strong>。
            </div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setShowPhaseModal(false)} style={{...B,background:'var(--surface-container)',color:'var(--on-surface-variant)',fontWeight:600}}>稍后手动开始</button>
              <button onClick={startReview} style={{...B,background:'var(--tertiary)',color:'#fff',padding:'9px 24px',fontSize:13}}>立即开始审核 →</button>
            </div>
          </div>
        </div>
      )}

      {/* 重置确认弹窗 */}
      {showResetConfirm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface-container-lowest)',border:'1px solid var(--surface-container)',borderRadius:16,padding:'32px 36px',maxWidth:400,width:'90%',boxShadow:'0 24px 64px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'var(--on-surface)',marginBottom:12}}>确认重置项目？</div>
            <div style={{fontSize:13,color:'var(--on-surface-variant)',lineHeight:1.7,marginBottom:24}}>
              所有译文、评分、审核结果将全部清除，此操作<strong style={{color:'var(--error)'}}>不可撤销</strong>。
            </div>
            <div style={{display:'flex',gap:12,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowResetConfirm(false)} style={{...B,background:'var(--surface-container)',color:'var(--on-surface-variant)',fontWeight:600}}>取消</button>
              <button onClick={doReset} disabled={resetting} style={{...B,background:'var(--error)',color:'#fff',cursor:resetting?'not-allowed':'pointer'}}>{resetting?'重置中...':'确认重置'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 导出选项弹窗 */}
      {showExport&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface-container-lowest)',border:'1px solid var(--surface-container)',borderRadius:18,padding:'32px 36px',maxWidth:380,width:'90%',boxShadow:'0 32px 80px rgba(0,0,0,0.35)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'var(--on-surface)',marginBottom:20}}>导出选项</div>
            {[['useFixed','使用 AI 修复版本（推荐）'],['includeSource','包含源文列'],['includeTarget','包含译文列'],['includeScore','包含评分列'],['includeErrors','包含错误摘要列']
            ].map(([k,label])=>(
              <label key={k} style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,cursor:'pointer'}}>
                <input type="checkbox" checked={exportOpts[k]} onChange={e=>setExportOpts(o=>({...o,[k]:e.target.checked}))}
                  style={{width:16,height:16,accentColor:'var(--tertiary)',cursor:'pointer'}}/>
                <span style={{fontSize:13,color:'var(--on-surface)',fontWeight:500}}>{label}</span>
              </label>
            ))}
            <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
              <button onClick={()=>setShowExport(false)} style={{...B,background:'var(--surface-container)',color:'var(--on-surface-variant)',fontWeight:600}}>取消</button>
              <button onClick={doExport} disabled={exporting} style={{...B,background:'var(--tertiary)',color:'#fff',cursor:exporting?'not-allowed':'pointer'}}>{exporting?'导出中...':'确认导出'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div style={{background:'var(--surface-container-lowest)',padding:'10px 24px',display:'flex',alignItems:'center',gap:12,flexShrink:0,borderBottom:'1px solid var(--surface-container)',flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:6}}>
          {filterOpts.map(({v,l})=>(
            <button key={v} onClick={()=>changeFilter(v)} style={{background:filter===v?'var(--on-surface)':'var(--surface-container-low)',color:filter===v?'#fff':'var(--on-surface-variant)',borderRadius:20,padding:'5px 12px',fontWeight:600,border:'none',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>{l}</button>
          ))}
        </div>
        <input placeholder="搜索..." value={search} onChange={e=>changeSearch(e.target.value)}
          style={{background:'var(--surface-container-low)',border:'none',borderRadius:20,padding:'7px 14px',color:'var(--on-surface)',fontSize:12,outline:'none',width:150,fontFamily:'inherit'}}/>
        <div style={{flex:1}}/>
        {bgProgress?.error&&<span style={{fontSize:11,color:'var(--error)',fontWeight:600}}>⚠ {bgProgress.error.slice(0,40)}</span>}
        {showSaveBox?(
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input value={saveName} onChange={e=>setSaveName(e.target.value)} placeholder="项目名称"
              onKeyDown={e=>{if(e.key==='Enter')saveToLib();if(e.key==='Escape')setShowSaveBox(false)}}
              autoFocus style={{background:'var(--surface-container-low)',border:'1px solid var(--tertiary)',borderRadius:8,padding:'6px 12px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--on-surface)',width:150}}/>
            <button onClick={saveToLib} disabled={saving} style={{...B,background:'var(--tertiary)',color:'#fff',padding:'6px 14px'}}>{saving?'保存中...':'保存'}</button>
            <button onClick={()=>setShowSaveBox(false)} style={{...B,background:'var(--surface-container)',color:'var(--on-surface-variant)',fontWeight:600,padding:'6px 12px'}}>取消</button>
          </div>
        ):(
          <button onClick={()=>setShowSaveBox(true)} style={{...B,background:'var(--surface-container-low)',color:'var(--on-surface-variant)',border:'1px solid var(--surface-container)',fontWeight:600,padding:'6px 12px'}}>保存</button>
        )}
        {/* ── 始终常驻：一键应用 + 导出 ── */}
        {nDone>0&&(
          <button onClick={batchApply} disabled={applying}
            title="将所有 AI 修改建议一键应用到译文"
            style={{...B,background:applying?'var(--surface-container)':'#10b981',color:applying?'var(--outline)':'#fff',cursor:applying?'not-allowed':'pointer'}}>
            {applying?'应用中...':'一键应用建议'}
          </button>
        )}
        {total>0&&(
          <button onClick={()=>setShowExport(true)}
            style={{...B,background:'var(--surface-container-low)',color:'var(--on-surface)',border:'1px solid var(--surface-container-high)',fontWeight:600}}>
            导出
          </button>
        )}

        {bgRunning&&(
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:11,fontWeight:700,color:phaseColor,background:bgPhase==='translate'?'rgba(168,85,247,0.08)':'rgba(0,93,187,0.08)',padding:'3px 10px',borderRadius:20}}>
              {bgPaused?'⏸ 已暂停':`● ${bgPhase==='translate'?'翻译中':'审核中'}`} {bgProgress?`${bgProgress.done}/${bgProgress.total}`:''}
            </span>
            {bgPaused
              ?<button onClick={resumeBg} style={{...B,background:'#f59e0b',color:'#fff'}}>继续</button>
              :<button onClick={pauseBg} style={{...B,background:'var(--surface-container)',color:'var(--on-surface)',border:'1px solid var(--surface-container-high)',fontWeight:600}}>暂停</button>
            }
            <button onClick={stopBg} style={{...B,background:'var(--error)',color:'#fff'}}>停止</button>
          </div>
        )}
        <div style={{display:'flex',gap:8}}>
          <button onClick={startTranslate} disabled={bgRunning||!hasUntranslated} style={{...B,background:(!bgRunning&&hasUntranslated)?'#a855f7':'var(--surface-container)',color:(!bgRunning&&hasUntranslated)?'#fff':'var(--outline)',cursor:(!bgRunning&&hasUntranslated)?'pointer':'not-allowed',opacity:(!bgRunning&&hasUntranslated)?1:0.5}}>① 开始翻译</button>
          <button onClick={startReview} disabled={bgRunning||!hasTranslated} style={{...B,background:(!bgRunning&&hasTranslated)?'var(--tertiary)':'var(--surface-container)',color:(!bgRunning&&hasTranslated)?'#fff':'var(--outline)',cursor:(!bgRunning&&hasTranslated)?'pointer':'not-allowed',opacity:(!bgRunning&&hasTranslated)?1:0.5}}>② 开始审核</button>
          {!hasUntranslated&&!hasTranslated&&nDone>0&&<span style={{fontSize:12,color:'var(--tertiary)',fontWeight:600,padding:'8px 0'}}>✓ 全部完成</span>}
          <button onClick={()=>setShowResetConfirm(true)} disabled={bgRunning} style={{...B,background:'transparent',color:'var(--outline)',border:'1px solid var(--surface-container-high)',fontWeight:600,padding:'7px 12px',opacity:bgRunning?0.5:1,cursor:bgRunning?'not-allowed':'pointer'}}>重置</button>
        </div>
      </div>


      {/* 工作区 */}
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <div style={{width:'55%',display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* 双进度条 */}
          <div style={{padding:'8px 24px',background:'var(--surface-container-lowest)',borderBottom:'1px solid var(--surface-container)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:700,color:'#a855f7',width:52}}>翻译</span>
              <div style={{flex:1,height:4,background:'var(--surface-container-high)',borderRadius:99,overflow:'hidden'}}>
                <div style={{height:'100%',background:'#a855f7',borderRadius:99,transformOrigin:'left',transform:`scaleX(${pct/100})`,transition:'transform 0.4s'}}/>
              </div>
              <span style={{fontSize:11,fontWeight:700,color:'var(--on-surface-variant)',fontFamily:'var(--font-mono)',width:60,textAlign:'right'}}>
                {nTranslated+nDone}/{total}{bgPhase==='translate'&&!bgPaused&&<span style={{color:'#a855f7',marginLeft:4}}>●</span>}
              </span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:10,fontWeight:700,color:'var(--tertiary)',width:52}}>审核</span>
              <div style={{flex:1,height:4,background:'var(--surface-container-high)',borderRadius:99,overflow:'hidden'}}>
                <div style={{height:'100%',background:'var(--tertiary)',borderRadius:99,transformOrigin:'left',transform:`scaleX(${reviewPct/100})`,transition:'transform 0.4s'}}/>
              </div>
              <span style={{fontSize:11,fontWeight:700,color:'var(--on-surface-variant)',fontFamily:'var(--font-mono)',width:60,textAlign:'right'}}>
                {nDone}/{total}{bgPhase==='review'&&!bgPaused&&<span style={{color:'var(--tertiary)',marginLeft:4}}>●</span>}
              </span>
            </div>
          </div>

          {/* 表头 */}
          <div style={{display:'grid',gridTemplateColumns:'44px 44px 1fr 90px 80px',gap:8,padding:'8px 24px',background:'var(--surface-container-lowest)',borderBottom:'1px solid var(--surface-container)',color:'var(--outline)',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',flexShrink:0}}>
            <div>序号</div><div>性别</div><div>源文</div><div>状态</div><div>七维度</div>
          </div>

          {/* P1: 虚拟滚动列表 */}
          <div style={{flex:1,overflow:'hidden'}}>
            {filtered.length === 0 ? (
              <div style={{textAlign:'center',padding:'60px 0',color:'var(--outline)',fontSize:13,fontWeight:600}}>无匹配句段</div>
            ) : (
              <FixedSizeList
                ref={listRef}
                height={600}
                itemCount={filtered.length}
                itemSize={56}
                width="100%"
                style={{overflowX:'hidden'}}
                overscanCount={10}
              >
                {({ index, style }) => {
                  const s = filtered[index]
                  const isActive = currentId === s.id
                  const rowNum = project ? project.segments.findIndex(x => x.id === s.id) + 1 : index + 1
                  return (
                    <div style={{...style, padding:'0 24px'}}>
                      <div id={`seg-${s.id}`} onClick={() => setSelected(s.id)}
                        style={{display:'grid',gridTemplateColumns:'44px 44px 1fr 90px 80px',gap:8,padding:'12px 14px',cursor:'pointer',borderRadius:10,
                          background:isActive?'rgba(168,85,247,0.05)':selected===s.id?'var(--surface-container-lowest)':'transparent',
                          border:selected===s.id?'1px solid var(--surface-container-high)':'1px solid transparent',transition:'all 0.12s',height:52}}>
                        <span style={{fontSize:11,fontFamily:'var(--font-mono)',fontWeight:700,color:isActive?'#a855f7':'var(--outline)',paddingTop:2}}>{String(rowNum).padStart(3,'0')}</span>
                        <div onClick={e=>{e.stopPropagation();toggleGender(s)}}
                          style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:34,height:20,borderRadius:10,fontSize:11,fontWeight:700,cursor:'pointer',userSelect:'none',
                            background:s.gender==='female'?'rgba(194,24,91,0.1)':'rgba(0,93,187,0.08)',
                            color:s.gender==='female'?'#c2185b':'var(--tertiary)',
                            border:'1px solid '+(s.gender==='female'?'rgba(194,24,91,0.2)':'rgba(0,93,187,0.15)'),fontFamily:'inherit'}}>
                          {s.gender==='female'?'女':'男'}
                        </div>
                        <div style={{fontSize:13,lineHeight:1.7,color:'var(--on-surface-variant)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.source}</div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:4}}>
                          <StatusChip seg={s}/><ScoreBadge score={s.score}/>
                        </div>
                        <DimMini dims={s.dimensions||{}} expanded={false} onToggle={()=>{}}/>
                      </div>
                    </div>
                  )
                }}
              </FixedSizeList>
            )}
            <div style={{padding:'8px 24px',fontSize:11,color:'var(--outline)',fontWeight:600,textAlign:'center',borderTop:'1px solid var(--surface-container)'}}>
              共 {filtered.length} 条{filter !== 'all' ? `（筛选自 ${total} 条）` : ''}
            </div>
          </div>
        </div>

        <DetailPane seg={selSeg} idx={selSeg ? project.segments.findIndex(x=>x.id===selSeg.id) : -1} api={api} toast={toast} settings={settings} project={project}
          bgRunning={bgRunning} currentId={currentId}
          onUpdate={seg=>{updateSegment(seg);setSelected(seg.id)}}/>
      </div>
    </div>
  )
}

export default function ReviewView(props) {
  return <ErrBound><ReviewViewInner {...props}/></ErrBound>
}
