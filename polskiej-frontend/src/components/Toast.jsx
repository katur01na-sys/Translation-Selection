export default function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.type==='success'?'✅':t.type==='error'?'❌':'ℹ️'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
