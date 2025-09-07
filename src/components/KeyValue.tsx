export function KeyValue({k, v}:{k:string; v: string | number | undefined}) {
  return (
    <div className="row" style={{justifyContent:'space-between'}}>
      <div className="muted">{k}</div>
      <div><strong>{v ?? '-'}</strong></div>
    </div>
  )
}
