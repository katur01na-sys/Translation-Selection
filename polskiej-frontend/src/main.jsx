import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// G3: 全局 ErrorBoundary — 任何子组件崩溃时显示恢复 UI，而不是白屏
class GlobalErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e, info) { console.error('[GlobalErrorBoundary]', e, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--surface,#0f1117)',color:'var(--on-surface,#e3e6f0)',gap:16,padding:32 }}>
        <div style={{ fontSize:32 }}>⚠️</div>
        <div style={{ fontSize:17,fontWeight:800 }}>界面遇到未知错误</div>
        <div style={{ fontSize:12,color:'#888',maxWidth:480,textAlign:'center',lineHeight:1.7 }}>{this.state.error.message}</div>
        <button onClick={()=>this.setState({error:null})}
          style={{ marginTop:8,border:'none',borderRadius:10,padding:'9px 28px',background:'var(--tertiary,#005DBB)',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer' }}>
          重新加载
        </button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </React.StrictMode>
)
