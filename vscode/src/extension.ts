import * as vscode from 'vscode'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'

type Obj=Record<string,unknown>
const record=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
const string=(v:unknown):string=>typeof v==='string'?v:''
interface Session { id:string; title:string; cwd:string; parentId?:string; updatedAt:number }

export class WorkerClient implements vscode.Disposable {
  private readonly worker:Worker
  private sequence=0
  private readonly pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>()
  constructor(home:string,root:string,onProgress:(value:Obj)=>void){
    this.worker=new Worker(path.join(root,'dist','worker.cjs'),{workerData:{home}})
    this.worker.on('message',m=>{
      if(m.progress){onProgress(m.progress);return}
      const request=this.pending.get(m.id)
      if(!request)return
      this.pending.delete(m.id)
      if(m.error)request.reject(new Error(m.error));else request.resolve(m.value)
    })
    this.worker.on('error',error=>{for(const p of this.pending.values())p.reject(error);this.pending.clear()})
  }
  call(method:string,args:Obj={}):Promise<unknown>{
    return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,method,args})})
  }
  dispose():void{for(const p of this.pending.values())p.reject(new Error('Extension disposed'));this.pending.clear();void this.worker.terminate()}
}

class Dashboard implements vscode.WebviewViewProvider,vscode.Disposable {
  private readonly views=new Set<vscode.Webview>()
  private panel:vscode.WebviewPanel|undefined
  private selected=''
  private readonly worker:WorkerClient
  private timer:ReturnType<typeof setInterval>|undefined
  private polling=false
  private revision=0
  private diagnostics:Obj={sidebar:{ready:false},editor:{ready:false}}
  constructor(private readonly context:vscode.ExtensionContext){
    const configured=vscode.workspace.getConfiguration('codex-context').get<string>('codexHome')
    const home=configured||process.env.CODEX_HOME||path.join(os.homedir(),'.codex')
    this.selected=context.workspaceState.get<string>('selectedSession','')
    this.worker=new WorkerClient(home,context.extensionPath,value=>{for(const v of this.views)void v.postMessage({type:'progress',...value})})
    this.timer=setInterval(()=>{if(!this.polling&&this.views.size){this.polling=true;void this.refresh().catch(error=>this.fail(error)).finally(()=>{this.polling=false})}},vscode.workspace.getConfiguration('codex-context').get<number>('refreshInterval',5)*1000)
  }
  resolveWebviewView(view:vscode.WebviewView):void{
    const webview=view.webview
    this.attach(webview,true)
    view.onDidDispose(()=>this.views.delete(webview))
    view.onDidChangeVisibility(()=>{if(view.visible)void this.refresh().catch(error=>this.fail(error))})
  }
  open():void{
    if(this.panel){this.panel.reveal();return}
    const panel=vscode.window.createWebviewPanel('codex-context.dashboard','codex-context',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,'dist')]})
    const webview=panel.webview
    this.panel=panel;this.attach(webview,false)
    panel.onDidDispose(()=>{this.views.delete(webview);if(this.panel===panel)this.panel=undefined;this.diagnostics.editor={ready:false}})
  }
  private attach(view:vscode.Webview,sidebar:boolean):void{
    this.views.add(view)
    view.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,'dist')]}
    const nonce=randomBytes(18).toString('hex')
    const resource=(name:string):string=>view.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'dist',name)).toString()
    const lang=vscode.workspace.getConfiguration('codex-context').get<string>('language','zh')
    view.html=`<!doctype html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.cspSource} data:; style-src ${view.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${view.cspSource} data:; connect-src 'none';"><link rel="stylesheet" href="${resource('webview.css')}"></head><body data-ds-dark-theme><div id="root"></div><script nonce="${nonce}">window.CODEX_CONTEXT_BOOT=${JSON.stringify({sidebar,language:lang})};</script><script nonce="${nonce}" src="${resource('webview.js')}"></script></body></html>`
    view.onDidReceiveMessage(async raw=>{
      const message=record(raw)
      if(message.type==='ready'){void this.refresh().catch(error=>this.fail(error));return}
      if(message.type==='diagnostics'){this.diagnostics[sidebar?'sidebar':'editor']=record(message.value);return}
      if(message.type==='select'){this.selected=string(message.id);await this.context.workspaceState.update('selectedSession',this.selected);void this.refresh().catch(error=>this.fail(error));return}
      if(message.type==='open'){this.open();return}
      if(message.type!=='request'||typeof message.id!=='number')return
      try{
        const value=await this.handle(string(message.method),record(message.args))
        await view.postMessage({type:'response',id:message.id,value})
      }catch(error){await view.postMessage({type:'response',id:message.id,error:error instanceof Error?error.message:'Request failed'})}
    })
  }
  private async handle(method:string,args:Obj):Promise<unknown>{
    if(method==='prices'){
      try{return JSON.parse(await readFile(path.join(this.context.extensionPath,'dist','model-prices.json'),'utf8'))}catch{return {}}
    }
    if(method==='refresh'){await this.refresh();return true}
    if(method==='page')return this.worker.call('page',args)
    if(method==='route')return this.worker.call('route',args)
    if(method==='openPath'){
      const raw=string(args.path)
      if(!raw||raw.includes('\0'))throw new Error('Invalid path')
      const file=path.resolve(raw)
      const roots=vscode.workspace.workspaceFolders?.map(f=>path.resolve(f.uri.fsPath))??[]
      if(!roots.some(root=>{const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative))}))throw new Error('File is outside the open workspace')
      const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(file));await vscode.window.showTextDocument(doc,{preview:true,preserveFocus:true});return true
    }
    if(method==='settings'){await vscode.commands.executeCommand('workbench.action.openSettings','codex-context');return true}
    throw new Error('Unsupported method')
  }
  async choose():Promise<void>{
    const result=record(await this.worker.call('list',{force:true}))
    const sessions=result.sessions as Session[]??[]
    const picked=await vscode.window.showQuickPick(sessions.map(s=>({label:s.title,description:s.cwd,detail:s.parentId?'Subagent':'',id:s.id})),{placeHolder:'codex-context: Select a Codex session',matchOnDescription:true})
    if(picked){this.selected=picked.id;await this.context.workspaceState.update('selectedSession',picked.id);await this.refresh()}
  }
  async refresh():Promise<void>{
    const revision=++this.revision
    const result=record(await this.worker.call('list'))
    if(revision!==this.revision)return
    const sessions=(result.sessions as Session[]|undefined)??[]
    const workspace=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.toLowerCase()
    if(!sessions.some(s=>s.id===this.selected))this.selected=(sessions.find(s=>!s.parentId&&s.cwd.toLowerCase()===workspace)??sessions.find(s=>!s.parentId)??sessions[0])?.id??''
    const selected=this.selected
    const data=selected?await this.worker.call('bundle',{sessionId:selected}):null
    const rows=await this.worker.call('rows',{sessionId:selected})
    if(revision!==this.revision||selected!==this.selected)return
    const group=new Map<string,string[]>()
    for(const s of sessions){if(!group.has(s.cwd))group.set(s.cwd,[]);group.get(s.cwd)!.push(s.id)}
    const workspaces={items:[...group].map(([title,sessionIds])=>({title,sessionIds})),archivedSessionIds:sessions.filter(s=>record(s).archived===true).map(s=>s.id)}
    const state={type:'state',sessions:sessions.map(({id,title,cwd,parentId,updatedAt})=>({id,title,cwd,parentId,updatedAt})),selected,bundle:data,rows,workspaces,compressed:result.compressed}
    for(const view of this.views)void view.postMessage(state)
  }
  private fail(error:unknown):void{for(const view of this.views)void view.postMessage({type:'error',message:error instanceof Error?error.message:'Unable to read Codex logs'})}
  getDiagnostics():Obj{return this.diagnostics}
  dispose():void{if(this.timer)clearInterval(this.timer);this.worker.dispose();this.panel?.dispose();this.views.clear()}
}

export function activate(context:vscode.ExtensionContext):{diagnostics:()=>Obj}{
  const dashboard=new Dashboard(context)
  context.subscriptions.push(dashboard,
    vscode.window.registerWebviewViewProvider('codex-context.sidebar',dashboard,{webviewOptions:{retainContextWhenHidden:true}}),
    vscode.commands.registerCommand('codex-context.open',()=>dashboard.open()),
    vscode.commands.registerCommand('codex-context.refresh',()=>dashboard.refresh()),
    vscode.commands.registerCommand('codex-context.selectSession',()=>dashboard.choose()))
  return {diagnostics:()=>dashboard.getDiagnostics()}
}
