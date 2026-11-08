import './bridge'
import './design-platform.css'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextView, FleetView, Overview, Settings, boot, navigate, publish, settings, t, useChat, useContextSettings, useProjection, useSessions, useStateStore, useWorkspaces, type State } from './runtime'
import { labels } from './labels'
import { request, vscode } from './bridge'
import '../../../src/client/styles/tailwind.css'
import '../../../src/client/styles/base.css'
import '../../../src/client/styles/stats.css'
import '../../../src/client/styles/jump.css'
import '../../../src/client/styles/settings.css'
import '../../../src/client/styles/stackedBar.css'
import '../../../src/client/styles/trendChart.css'
import '../../../src/client/styles/requestDetail.css'
import '../../../src/client/styles/events.css'
import '../../../src/client/styles/fileCard.css'
import '../../../src/client/styles/commandPanel.css'
import '../../../src/client/styles/modal.css'
import '../../../src/client/styles/browser.css'
import '../../../src/client/styles/detailSections.css'
import '../../../src/client/styles/attachments.css'
import '../../../src/client/styles/agentGraph.css'
import '../../../src/client/styles/fleet.css'
import '../../../src/client/styles/pulse.css'
import '../../../src/client/styles/overview.css'
import '../../../src/client/styles/dateRange.css'
import '../../../src/client/styles/recom.css'
import './shell.css'

const errors:string[]=[]
const l=labels[boot.language]??labels.en
window.addEventListener('error',event=>{errors.push(event.message);diagnostics()})
window.addEventListener('unhandledrejection',event=>{errors.push(String(event.reason));diagnostics()})
function diagnostics():void{vscode.postMessage({type:'diagnostics',value:{ready:document.querySelectorAll('.lc-card').length>0,cards:document.querySelectorAll('.lc-card').length,charts:document.querySelectorAll('svg').length,errors:[...errors],tab:document.querySelector('[role="tab"][aria-selected="true"]')?.textContent}})}
function App(){
  const state=useStateStore(),[tab,setTab]=useState('context'),[error,setError]=useState(''),[progress,setProgress]=useState('')
  const prefs=useContextSettings(s=>s)
  useEffect(()=>{if((tab==='fleet'&&prefs.fleetTab==='hide')||(tab==='overview'&&prefs.insightsEntry==='hide'))setTab('context')},[tab,prefs.fleetTab,prefs.insightsEntry])
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      const m=event.data
      if(m?.type==='state'){publish(m as State);setError('')}
      if(m?.type==='error')setError(m.message)
      if(m?.type==='progress')setProgress(m.done>=m.total?'':`${m.done} / ${m.total}`)
    }
    const change=(event:Event)=>setTab((event as CustomEvent<string>).detail)
    window.addEventListener('message',receive);window.addEventListener('codex-context-tab',change)
    vscode.postMessage({type:'ready'})
    return()=>{window.removeEventListener('message',receive);window.removeEventListener('codex-context-tab',change)}
  },[])
  useEffect(()=>{const timer=setTimeout(diagnostics,500);return()=>clearTimeout(timer)},[state,tab])
  const props={sessionId:state.selected,useProjection,useChat,...(boot.sidebar?{host:'sidebar' as const}:{})}
  return <div className={boot.sidebar?'cc-shell cc-sidebar':'cc-shell'}>
    <header className="cc-toolbar"><select aria-label={l.select} value={state.selected} onChange={e=>navigate(e.target.value)}><option value="">{l.select}</option>{state.sessions.map(s=><option value={s.id} key={s.id}>{s.parentId?'↳ ':''}{s.title}</option>)}</select><button title={l.refresh} onClick={()=>{void request('refresh').catch(e=>setError(String(e)))}}>↻</button>{boot.sidebar&&<button title={l.open} onClick={()=>vscode.postMessage({type:'open'})}>↗</button>}</header>
    <nav className="cc-tabs" role="tablist">{[['context',t('tab.context')],...(prefs.fleetTab==='hide'?[]:[['fleet',t('tab.fleet')]]),...(prefs.insightsEntry==='hide'?[]:[['overview',l.insights]]),['settings',l.settings]].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <details className="cc-coverage"><summary>{l.data}</summary><p>{l.details}</p>{state.compressed>0&&<p>{state.compressed} · {l.compressed}</p>}</details>
    {error&&<div role="alert" className="cc-error">{error}</div>}
    {progress&&<div role="status" className="cc-progress">{l.indexing} {progress}</div>}
    <div className="cc-page" data-conversation-scroll>
      {tab==='overview'?<Overview useSessions={useSessions} useWorkspaces={useWorkspaces}/>:tab==='settings'?<div className="lc-root cc-preferences"><p className="cc-coverage">{l.prompts}</p><Settings useContextSettings={useContextSettings} set={(field,value)=>{if(field!=='promptPrefix'&&field!=='promptSuffix')settings.set(field,value)}}/></div>:!state.bundle?<div className="cc-empty">{state.sessions.length?l.loading:l.empty}</div>:tab==='fleet'?<FleetView {...props}/>:<ContextView {...props}/>}
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App/> )
