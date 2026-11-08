import { createReadStream } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { bundle, createParsed, fold, record, string, toolsOf, type Parsed, type Ref } from './parser'

export interface SessionInfo { id:string; title:string; cwd:string; parentId?:string; source:string; archived:boolean; updatedAt:number; size:number; file:string }
type Bundle = ReturnType<typeof bundle>
type Json = Record<string,unknown>

export async function update(file: string, s: Parsed): Promise<Parsed> {
  const info=await stat(file)
  if(info.size<s.offset)s=createParsed()
  if(info.size===s.offset)return s
  for await(const chunk of createReadStream(file,{start:s.offset,end:info.size-1,highWaterMark:256*1024})){
    const bytes=chunk as Buffer
    const base=s.offset-s.tail.length
    const data=s.tail.length?Buffer.concat([s.tail,bytes]):bytes
    let start=0,end:number
    while((end=data.indexOf(10,start))!==-1){
      const line=data.subarray(start,end)
      s.seq++
      if(line.length){
        try{
          const row=JSON.parse(line.toString('utf8'))
          s.refs.set(s.seq,{offset:base+start,bytes:end-start,callSeq:undefined})
          fold(s,row)
          const callSeq=s.callByResult.get(s.seq)
          if(callSeq)s.refs.get(s.seq)!.callSeq=callSeq
        }catch{s.malformed++}
      }
      start=end+1
    }
    s.tail=Buffer.from(data.subarray(start));s.offset+=bytes.length
  }
  return s
}

async function header(file:string):Promise<Json> {
  const handle=await open(file,'r')
  try{
    const data=Buffer.alloc(128*1024),result=await handle.read(data,0,data.length,0)
    return record(JSON.parse(data.subarray(0,result.bytesRead).toString('utf8').split('\n')[0]).payload)
  }catch{return {}}finally{await handle.close()}
}

async function readRow(file:string,ref:Ref):Promise<Json> {
  const h=await open(file,'r')
  try{const b=Buffer.alloc(ref.bytes);await h.read(b,0,b.length,ref.offset);return record(JSON.parse(b.toString('utf8')))}finally{await h.close()}
}

const blocks=(content:unknown):unknown[]=>Array.isArray(content)?content.map(b=>{const r=record(b);return r.type==='input_text'||r.type==='output_text'?{type:'text',text:r.text}:r}):[]

export function translated(row:Json,seq:number):Json[] {
  const p=record(row.payload),type=string(row.type),kind=string(p.type)
  if(type==='session_meta')return [{type:'system/message',seq,data:{message:{content:[{type:'text',text:string(record(p.base_instructions).text)||string(p.base_instructions)}]}}}]
  if(type==='compacted')return [{type:'user/message',seq,data:{content:[{type:'text',text:string(p.message)}]}}]
  if(type!=='response_item')return []
  if(kind==='reasoning')return [{type:'assistant/message',seq,data:{message:{content:(Array.isArray(p.summary)?p.summary:[]).map(v=>({type:'reasoning',text:string(record(v).text)}))}}}]
  if(kind==='additional_tools')return [{type:'request/header',seq,data:{header:{tools:toolsOf(p.tools).map(t=>({name:t.name,description:t.description,...record(t.schema)}))}}}]
  if(kind==='message'){
    if(p.role==='assistant')return [{type:'assistant/message',seq,data:{message:{content:blocks(p.content)}}}]
    if(p.role==='system')return [{type:'system/message',seq,data:{message:{content:blocks(p.content)}}}]
    return [{type:'user/message',seq,data:{content:blocks(p.content)}}]
  }
  if(kind==='function_call'||kind==='custom_tool_call'){
    const input=typeof(p.arguments??p.input)==='string'?p.arguments??p.input:JSON.stringify(p.arguments??p.input??'')
    return [{type:'tool/call',seq,data:{callId:p.call_id??p.id,name:p.name,arguments:input}},
      {type:'assistant/message',seq,data:{message:{content:[{type:'tool-call',name:p.name,arguments:input}]}}}]
  }
  if(kind==='function_call_output'||kind==='custom_tool_call_output')return [{type:'tool/result',seq,data:{message:{toolCallId:p.call_id,isError:record(p.output).isError===true,content:[{type:'text',text:typeof p.output==='string'?p.output:JSON.stringify(p.output)}]}}}]
  return []
}

export class CodexStore {
  private files=new Map<string,SessionInfo>()
  private states=new Map<string,Parsed>()
  private jobs=new Map<string,Promise<Parsed>>()
  private heads=new Map<string,{mtime:number;value:Bundle}>()
  private scanned=0
  private entries:SessionInfo[]=[]
  compressed=0
  constructor(readonly home:string){}

  async list(force=false):Promise<SessionInfo[]> {
    if(!force&&Date.now()-this.scanned<4000)return this.entries
    const titles=new Map<string,string>()
    try{for(const line of (await readFile(path.join(this.home,'session_index.jsonl'),'utf8')).split('\n')){try{const r=JSON.parse(line);if(r.id)titles.set(r.id,string(r.thread_name))}catch{}}}catch{}
    const entries=new Map<string,SessionInfo>();this.compressed=0
    const walk=async(dir:string,archived:boolean):Promise<void>=>{
      let children
      try{children=await readdir(dir,{withFileTypes:true})}catch{return}
      for(const child of children){
        const file=path.join(dir,child.name)
        if(child.isDirectory()){await walk(file,archived);continue}
        if(!child.isFile()||!/^rollout-.*\.jsonl(?:\.zst)?$/.test(child.name))continue
        if(child.name.endsWith('.zst')){this.compressed++;continue}
        const info=await stat(file),old=[...this.files.values()].find(f=>f.file===file)
        if(old){entries.set(old.id,{...old,title:titles.get(old.id)||old.title,updatedAt:info.mtimeMs,size:info.size,archived});continue}
        const meta=await header(file),id=string(meta.id??meta.session_id)
        if(!id||entries.has(id))continue
        const cwd=string(meta.cwd),parentId=string(meta.parent_thread_id)||undefined
        const source=typeof meta.source==='string'?meta.source:string(record(record(meta.source).subagent).other)||'subagent'
        entries.set(id,{id,title:titles.get(id)||path.basename(cwd.replaceAll('\\','/'))||id,cwd,parentId,source,archived,updatedAt:info.mtimeMs,size:info.size,file})
      }
    }
    await walk(path.join(this.home,'sessions'),false);await walk(path.join(this.home,'archived_sessions'),true)
    this.entries=[...entries.values()].sort((a,b)=>b.updatedAt-a.updatedAt);this.files=entries;this.scanned=Date.now()
    return this.entries
  }

  private async state(id:string):Promise<Parsed>{
    await this.list()
    const file=this.files.get(id)
    if(!file)throw new Error('Session not found')
    const running=this.jobs.get(id);if(running)return running
    const job=update(file.file,this.states.get(id)??createParsed()).then(s=>{
      this.states.delete(id);this.states.set(id,s)
      while(this.states.size>3)this.states.delete(this.states.keys().next().value!)
      return s
    })
    this.jobs.set(id,job)
    try{return await job}finally{this.jobs.delete(id)}
  }

  async get(id:string):Promise<Bundle>{
    await this.list()
    const info=this.files.get(id),known=this.heads.get(id)
    if(known&&known.mtime===info?.updatedAt&&this.states.has(id))return bundle(this.states.get(id)!)
    const s=await this.state(id),value=bundle(s)
    const summary={...value,timeline:{...value.timeline,nodes:[],archive:[],requests:[],events:[],commands:[],spans:[],fileOps:[]},headers:{headers:[]}}
    this.heads.set(id,{mtime:info!.updatedAt,value:summary})
    return value
  }

  private async head(id:string):Promise<Bundle>{
    await this.list()
    const known=this.heads.get(id)
    return known&&known.mtime===this.files.get(id)?.updatedAt?known.value:this.get(id)
  }

  async sessionRows(selectedId?:string):Promise<Json>{
    const rows=await this.list()
    return {byId:Object.fromEntries(rows.map(row=>{
      const cached=this.heads.get(row.id)?.value
      const projectionValues=cached?{contextTimeline:cached.timeline,contextActivity:cached.activity,contextPressure:cached.pressure,tokenUsage:cached.usage}:{}
      return [row.id,{id:row.id,title:row.title,displayTitle:row.title,cwd:row.cwd,parentId:row.parentId,origin:row.parentId?'subagent':'user',running:Date.now()-row.updatedAt<20000,blank:false,updatedAt:row.updatedAt,projectionValues}]
    })),ids:rows.map(r=>r.id),currentId:selectedId}
  }

  async page(id:string,seq:number):Promise<{records:Json[]}>{
    const s=await this.state(id),ref=s.refs.get(seq),file=this.files.get(id)!.file
    if(!ref)return {records:[]}
    const records:Json[]=[]
    if(ref.callSeq){const call=s.refs.get(ref.callSeq);if(call)records.push(...translated(await readRow(file,call),ref.callSeq))}
    records.push(...translated(await readRow(file,ref),seq))
    return {records}
  }

  async overview(progress?:(completed:number,total:number)=>void):Promise<Json>{
    const rows=await this.list(),result:Json={}
    for(let i=0;i<rows.length;i++){
      const row=rows[i],known=this.heads.get(row.id)
      const value=known?.mtime===row.updatedAt?known.value:await this.get(row.id)
      result[row.id]={contextTimeline:this.heads.get(row.id)?.value.timeline??value.timeline,contextActivity:value.activity}
      progress?.(i+1,rows.length)
    }
    return result
  }

  async route(name:string,args:Json,progress?:(done:number,total:number)=>void):Promise<unknown>{
    const id=string(args.sessionId),action=name.split('/').at(-1)
    if(action==='snapshot')return this.overview(progress)
    if(action==='balance')return {isAvailable:false,balances:[]}
    if(action==='recom')return null
    if(action==='skills')return []
    if(action==='backfill')return {ok:true}
    if(action==='heads'){
      const result:Json={}
      for(const id of Array.isArray(args.ids)?args.ids.filter((x):x is string=>typeof x==='string'):[])result[id]={head:(await this.head(id)).timeline}
      return result
    }
    if(!id)return null
    if(action==='fleet'){
      await this.list()
      const root=(id:string):string=>{const seen=new Set<string>();let item=this.files.get(id);while(item?.parentId&&!seen.has(item.id)){seen.add(item.id);const parent=this.files.get(item.parentId);if(!parent)break;item=parent}return item?.id??id}
      const family=root(id)
      for(const member of this.entries.filter(member=>root(member.id)===family))await this.head(member.id)
      const value=await this.head(id),received=[]
      for(const [from,entry]of this.heads)for(const message of entry.value.outgoing)if(message.to===id)received.push({seq:message.seq,time:message.time,kind:'relay' as const,from,fromName:this.files.get(from)?.title,text:message.text})
      const messages=[...value.fleet.messages,...received]
      return {...value.fleet,messages,messagesTotal:messages.length,truncated:false}
    }
    const value=await this.get(id)
    if(action==='detail')return {rev:0,head:value.timeline,...value.timeline}
    if(action==='commands')return {commands:value.timeline.commands??[],atStart:true,total:value.timeline.commands?.length??0}
    if(action==='facts')return {rev:0,live:true,parts:{head:value.timeline,series:value.timeline.requests,requests:value.timeline.requests,nodes:{nodes:value.timeline.nodes,archive:value.timeline.archive,droppedNodes:0},events:value.timeline.events,files:{fileOps:value.timeline.fileOps},commands:{commands:value.timeline.commands,commandStats:value.timeline.commandStats},spans:value.timeline.spans}}
    return null
  }
}
