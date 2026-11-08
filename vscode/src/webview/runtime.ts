import { useSyncExternalStore } from 'react'
import { DICTS } from '../../../src/client/i18n'
import { createContextSettings } from '../../../src/client/settings'
import { makeViewKit } from '../../../src/client/viewkit'
import { makeAgentHeads } from '../../../src/client/agentHeads'
import { makeContextView } from '../../../src/client/components/contextView'
import { makeFleetView } from '../../../src/client/components/fleetView'
import { makeOverviewPanel } from '../../../src/client/components/overviewPanel'
import { makePluginConfigCard } from '../../../src/client/components/settingsCard'
import { watchHistoryFaces } from '../../../src/client/historyPage'
import { setModelPricesLoader } from '../../../src/client/modelPrices'
import type { ClientCtx } from '../../../src/client/services'
import { request, vscode } from './bridge'

export type Obj=Record<string,unknown>
const record=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
export const boot=(window as unknown as {CODEX_CONTEXT_BOOT:{sidebar:boolean;language:keyof typeof DICTS}}).CODEX_CONTEXT_BOOT
export interface State { sessions:{id:string;title:string;cwd:string;parentId?:string}[]; selected:string; bundle:Obj|null; rows:Obj; workspaces:Obj; compressed:number }
let state:State={sessions:[],selected:'',bundle:null,rows:{byId:{},ids:[]},workspaces:{items:[]},compressed:0}
const listeners=new Set<()=>void>()
export const store={subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>state}
export function publish(value:State):void{state=value;for(const listener of listeners)listener()}
export const useStateStore=():State=>useSyncExternalStore(store.subscribe,store.getSnapshot)
export function useProjection(key:string):unknown{
  const value=useStateStore().bundle
  const mapped:Record<string,string>={contextTimeline:'timeline',contextHeaders:'headers',contextPressure:'pressure',tokenUsage:'usage',contextActivity:'activity'}
  return value?.[mapped[key]??key]??null
}
export function useSessions<T>(selector:(value:unknown)=>T):T{return selector(useStateStore().rows)}
export function useWorkspaces<T>(selector:(value:unknown)=>T):T{return selector(useStateStore().workspaces)}
export function useChat<T>(selector:(value:unknown)=>T):T{return selector({legacy:{nodes:[]}})}

const dict=DICTS[boot.language]??DICTS.zh
export const t=(key:string,params?:Record<string,string|number>):string=>{
  const texts=dict as unknown as Record<string,string>
  let result=texts[key]??(DICTS.en as unknown as Record<string,string>)[key]??key
  for(const [k,v]of Object.entries(params??{}))result=result.replaceAll(`{${k}}`,String(v))
  return result.replaceAll('dsh-context','codex-context')
}
const locale={getLocale:()=>({active:boot.language}),subscribe:()=>()=>{},register:()=>()=>{},bind:()=>t}
const sessionList={subscribe:store.subscribe,getSnapshot:()=>state.rows}
export const navigate=(id:string):void=>vscode.postMessage({type:'select',id})
const faces:Record<string,unknown>={
  sessions:{list:sessionList,refresh:()=>request('refresh'),scope:()=>undefined},
  uiWorkspace:{openSession:(id:string)=>{navigate(id);window.dispatchEvent(new CustomEvent('codex-context-tab',{detail:'context'}))}},
  connection:{isLoopback:true,rpc:{call:async(_channel:string,endpoint:string,payload:unknown)=>{
    if(endpoint==='session/canOpenWorkspacePath')return {ok:true,value:true}
    if(endpoint==='session/openWorkspacePath')return {ok:true,value:await request('openPath',{path:record(record(record(payload).args).request).path})}
    return {ok:false}
  }}},
  sidebarRight:{openTab:()=>window.dispatchEvent(new CustomEvent('codex-context-tab',{detail:'fleet'}))},
  pluginNavigation:{openBundle:()=>window.dispatchEvent(new CustomEvent('codex-context-tab',{detail:'settings'}))},
}
const context={
  locale,get:(key:string)=>faces[key],
  remote:{session:{page:async(args:unknown)=>{const value=record(args),address=record(value.address);return request('page',{sessionId:address.childSessionId??address.sessionId,seq:value.throughSeq})}}},
  inject:(_keys:string[],callback:(ctx:unknown)=>unknown)=>callback(context),
  effect:(callback:()=>unknown)=>callback(),
  slots:{entries:()=>[],inject:()=>()=>{},register:()=>()=>{}},
}
export const ctx=context as unknown as ClientCtx
setModelPricesLoader(()=>request('prices'))
watchHistoryFaces(ctx)
export const settings=createContextSettings()
let saved:Obj={}
try{saved=record(vscode.getState()).settings as Obj??{}}catch{}
const prefsListeners=new Set<()=>void>()
settings.attach({getSnapshot:()=>({status:'ready',value:saved,writable:true}),subscribe:fn=>{prefsListeners.add(fn);return()=>prefsListeners.delete(fn)},set:async(field,value)=>{saved={...saved,[field]:value};vscode.setState({...record(vscode.getState()),settings:saved});for(const fn of prefsListeners)fn()}})
export function useContextSettings<T>(selector:(state:ReturnType<typeof settings.store.getSnapshot>)=>T):T{return selector(useSyncExternalStore(settings.store.subscribe,settings.store.getSnapshot))}
export const kit=makeViewKit(t,locale)
const heads=makeAgentHeads()
export const ContextView=makeContextView(ctx,kit,settings,heads)
export const FleetView=makeFleetView(ctx,kit,heads)
export const Overview=makeOverviewPanel(ctx,kit,settings)
export const Settings=makePluginConfigCard(kit)
