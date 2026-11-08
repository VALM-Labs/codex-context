import { estimateTextTokens, estimateSystemTokens } from '../../../src/shared/estimate'
import type { ActivityDay, CommandRecord, ContextActivity, ContextHeaders, ContextPressure, ContextTimeline, FleetDetail, HeaderTool, RequestRecord, SurfaceNode, TokenUsage, TimingSpan } from '../../../src/shared/types'

type Obj = Record<string, unknown>
export interface Usage { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number; total_tokens: number }
export interface Ref { offset: number; bytes: number; callSeq?: number }
export interface Call { seq: number; time: number; name: string; input: string; turn: number; command?: CommandRecord; skill?: string }
interface Turn { id: string; start: number; end?: number; duration?: number; ttft?: number }
export const record = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {}
export const string = (v: unknown): string => typeof v === 'string' ? v : ''
const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0
const values = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const text = (v: unknown): string => typeof v === 'string' ? v : JSON.stringify(v ?? '')
const at = (v: unknown): number => typeof v === 'number' ? v * 1000 : Date.parse(string(v)) || 0
const emptyUsage = (): Usage => ({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 })
const fields = Object.keys(emptyUsage()) as (keyof Usage)[]
const normalizeUsage = (v: unknown): Usage => Object.fromEntries(fields.map(k => [k, number(record(v)[k])])) as unknown as Usage
const blank = (): ContextTimeline['current'] => ({ system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 0 })
const sum = (v: ContextTimeline['current']): number => v.system + v.tools + v.user + v.inject + v.skill + v.assistant + v.tool
const day = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export interface Parsed {
  id: string; cwd: string; parent?: string; model: string; effort: string; provider: string; window?: number
  offset: number; tail: Buffer; seq: number; malformed: number; refs: Map<number,Ref>
  usage: Usage; baseline: Usage; modern: boolean; seen: Set<string>; current: ContextTimeline['current']
  headers: ContextHeaders; systems: NonNullable<ContextTimeline['systems']>; nodes: SurfaceNode[]; archive: SurfaceNode[]
  requests: RequestRecord[]; events: ContextTimeline['events']; pending: Map<string,Call>; callByResult: Map<number,number>
  toolTally: Record<string,number>; turns: Map<string,Turn>; turn: number; turnId: string; previousUsageAt: number
  calls: number; answers: number; humanInputs: number; lastUser: string; generatedAnswers: number; generatedCalls: number
  intervals: { start: number; end: number; turn: string; name: string }[]; commands: CommandRecord[]; fileOps: NonNullable<ContextTimeline['fileOps']>
  activity: ContextActivity; fleet: FleetDetail; knownModel: string; toolDefinitions: HeaderTool[]; rates?: unknown
  outgoing: {to:string;seq:number;time:number;text:string}[]
}

export function createParsed(): Parsed {
  return { id:'', cwd:'', model:'', effort:'', provider:'openai', offset:0, tail:Buffer.alloc(0), seq:0, malformed:0,
    refs:new Map(), usage:emptyUsage(), baseline:emptyUsage(), modern:false, seen:new Set(), current:blank(), headers:{headers:[]}, systems:[],
    nodes:[], archive:[], requests:[], events:[], pending:new Map(), callByResult:new Map(), toolTally:{}, turns:new Map(), turn:0, turnId:'', previousUsageAt:0,
    calls:0, answers:0, humanInputs:0, lastUser:'', generatedAnswers:0, generatedCalls:0, intervals:[], commands:[], fileOps:[],
    activity:{days:{}}, fleet:{messages:[],truncated:false}, knownModel:'', toolDefinitions:[],outgoing:[] }
}

function activity(s: Parsed, time: number): ActivityDay {
  return s.activity.days[day(time)] ??= { tokens:0, requests:0, turns:0, toolCalls:0, wallMs:0, toolsMs:0, tools:{} }
}

function node(s: Parsed, n: SurfaceNode): void {
  s.nodes.push(n)
  s.current[n.cat] += n.tokens
  s.current.total = sum(s.current)
}

export function toolsOf(value: unknown, prefix = ''): { name: string; description?: string; schema?: unknown }[] {
  const result: { name: string; description?: string; schema?: unknown }[] = []
  for (const entry of values(value)) {
    const r = record(entry)
    if (Array.isArray(r.tools)) { result.push(...toolsOf(r.tools, prefix + string(r.name) + '.')); continue }
    const f = Object.keys(record(r.function)).length ? record(r.function) : r
    const name = string(f.name)
    if (name) result.push({ name:prefix+name, description:string(f.description), schema:entry })
  }
  return result
}

function header(s: Parsed, time: number): void {
  s.headers.headers.push({ seq:s.seq, time, systemTokens:s.current.system, tools:s.toolDefinitions.slice() })
}

function usage(s: Parsed, raw: unknown, time: number): void {
  const u = normalizeUsage(raw)
  if (!u.total_tokens) u.total_tokens = u.input_tokens + u.output_tokens
  for (const k of fields) s.usage[k] += u[k]
  const turn = s.turns.get(s.turnId)
  const from = s.previousUsageAt || turn?.start || time
  const c = s.current
  s.requests.push({ seq:s.seq, time, turn:s.turn, step:s.requests.filter(r=>r.turn===s.turn).length+1,
    total:u.input_tokens+u.output_tokens, prompt:u.input_tokens, output:u.output_tokens, cacheRead:u.cached_input_tokens,
    system:c.system, tools:c.tools, user:c.user, inject:c.inject, skill:c.skill, assistant:c.assistant, tool:c.tool,
    activeMs:Math.max(0,time-from) })
  const a = activity(s,time)
  a.tokens += u.input_tokens+u.output_tokens
  a.requests++
  const costs = a.cost ??= {}
  const models = costs[s.provider] ??= {}
  const model = models[s.model || 'unknown'] ??= {}
  const b = model.off ??= { uncached:0, cacheRead:0, cacheWrite:0, output:0 }
  b.uncached += Math.max(0,u.input_tokens-u.cached_input_tokens)
  b.cacheRead += u.cached_input_tokens
  b.output += u.output_tokens
  s.previousUsageAt = time
}

function parseArgs(raw: string): Obj {
  try { return record(JSON.parse(raw)) } catch { return {} }
}

function fileOps(s: Parsed, call: Call, input: string): void {
  const add = (p: string, kind: 'read'|'write'|'search', detail?: string): void => {
    if (!p || p.includes('\n') || p.includes('://')) return
    s.fileOps.push({ seq:call.seq, time:call.time, path:p, kind, tool:call.name, err:false, added:0, removed:0, ...(detail?{detail}: {}) })
  }
  if (/apply_patch/.test(call.name) || input.includes('*** Begin Patch')) {
    for (const m of input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) add(m[1].trim(),'write')
  }
  const a = parseArgs(input)
  if (/read|view_image/.test(call.name)) add(string(a.path ?? a.file_path),'read')
  const command = string(a.cmd ?? a.command)
  if (command) {
    for (const m of command.matchAll(/(?:-LiteralPath\s+|\bcat\s+|\btype\s+)["']([^"']+)["']/gi)) add(m[1],'read')
    for (const m of command.matchAll(/\brg\s+(?:-[\w-]+\s+)*["']?([^\r\n;]+?)(?:$|;)/gm)) {
      const args = m[1].match(/["']([^"']+)["']|\S+/g) ?? []
      const p = args.at(-1)?.replace(/^["']|["']$/g,'')
      if (p && args.length>1) add(p,'search',command)
    }
  }
}

export function fold(s: Parsed, row: unknown): void {
  const r = record(row), p = record(r.payload), time = at(r.timestamp)
  const type = string(r.type), kind = string(p.type)
  if (type === 'session_meta') {
    s.id = string(p.id ?? p.session_id); s.cwd = string(p.cwd); s.parent = string(p.parent_thread_id)||undefined
    s.provider = string(p.model_provider)||'openai'; s.window = number(p.context_window)||undefined
    const base = p.base_instructions
    if (base) { s.current.system=estimateSystemTokens(string(record(base).text)||text(base));s.systems.push({seq:s.seq,time,tokens:s.current.system});header(s,time) }
    s.current.total=sum(s.current)
    return
  }
  if (type === 'turn_context') {
    s.cwd=string(p.cwd)||s.cwd; s.model=string(p.model)||s.model; s.effort=string(p.effort)||s.effort
    s.turnId=string(p.turn_id)||s.turnId
    if (s.knownModel && s.knownModel!==s.model) s.events.push({seq:s.seq,time,kind:'model',from:s.knownModel,to:s.model})
    s.knownModel=s.model
    return
  }
  if (type === 'compacted') {
    for (const n of s.nodes) s.archive.push({...n,gone:s.seq})
    s.nodes=[]; const c=blank(); c.system=s.current.system; c.tools=s.current.tools;s.current=c
    const summary=string(p.message)
    if(summary) node(s,{seq:s.seq,time,cat:'inject',tokens:estimateTextTokens(summary),form:'compaction',text:summary.slice(0,200)})
    s.events.push({seq:s.seq,time,kind:'compaction',turn:s.turn,detail:'Codex context compaction'})
    return
  }
  if (type === 'token_usage_record') {
    if (p.thread_id && p.thread_id!==s.id) return
    const id=string(p.response_id)
    if(id && s.seen.has(id)) return
    if(id) s.seen.add(id)
    if(!s.modern) {
      s.usage=emptyUsage();s.requests=[];s.previousUsageAt=0
      for(const a of Object.values(s.activity.days)){a.tokens=0;a.requests=0;delete a.cost}
    }
    s.modern=true; s.turnId=string(p.turn_id)||s.turnId
    usage(s,p.usage,time)
    return
  }
  if(type === 'event_msg') {
    if(kind==='task_started') {
      const id=string(p.turn_id??p.root_turn_id)||String(s.seq)
      s.turnId=id
      if(!s.turns.has(id)){s.turn++;s.turns.set(id,{id,start:at(p.started_at)||time});activity(s,time).turns!++}
      s.window=number(p.model_context_window)||s.window;s.previousUsageAt=0
    }
    if(kind==='task_complete'||kind==='turn_aborted') {
      const t=s.turns.get(string(p.turn_id)||s.turnId)
      if(t && t.end===undefined){t.end=at(p.completed_at)||time;t.duration=number(p.duration_ms)||Math.max(0,t.end-t.start);t.ttft=typeof p.time_to_first_token_ms==='number'?number(p.time_to_first_token_ms):undefined;activity(s,time).wallMs!+=t.duration}
      const reply=string(p.last_agent_message)
      if(reply) s.fleet.lastReply={time,text:reply}
    }
    if(kind==='user_message') {s.lastUser=string(p.message).slice(0,200);s.humanInputs++}
    if(kind==='token_count') {
      s.rates=p.rate_limits??s.rates
      const info=record(p.info);s.window=number(info.model_context_window)||s.window
      if(!s.modern && info.total_token_usage) {
        const cumulative=normalizeUsage(info.total_token_usage)
        const delta=Object.fromEntries(fields.map(k=>[k,Math.max(0,cumulative[k]-s.baseline[k])]))
        if(s.turns.size || !s.parent) if(number(delta.input_tokens)||number(delta.output_tokens)) usage(s,delta,time)
        for(const k of fields)s.baseline[k]=Math.max(s.baseline[k],cumulative[k])
      }
    }
    return
  }
  if(type!=='response_item') return
  if(kind==='additional_tools') {
    s.toolDefinitions=toolsOf(p.tools).map(t=>({name:t.name,tokens:estimateTextTokens(text(t.schema)),plugin:'codex'}))
    s.current.tools=s.toolDefinitions.reduce((n,t)=>n+t.tokens,0);s.current.total=sum(s.current);header(s,time)
    return
  }
  if(kind==='reasoning'){
    const summary=values(p.summary).map(v=>string(record(v).text)).filter(Boolean).join('\n')
    if(summary){const tokens=estimateTextTokens(summary);node(s,{seq:s.seq,time,cat:'assistant',tokens,reasoning:tokens,form:'assistant',text:summary.slice(0,200)});s.current.assistantReasoning=(s.current.assistantReasoning??0)+tokens}
    return
  }
  if(kind==='message') {
    const role=string(p.role)
    const content=values(p.content).map(record).map(b=>string(b.text)).join('\n')
    if(!content)return
    const cat=role==='assistant'?'assistant':role==='user'?'user':'inject'
    const skill=/<skill>|^#.*SKILL\.md/.test(content)
    const tokens=estimateTextTokens(content)
    node(s,{seq:s.seq,time,cat:skill?'skill':cat,tokens,text:content.slice(0,200),form:cat==='assistant'?'assistant':cat==='user'?'user':'developer',...(cat==='assistant'?{answerTokens:tokens}:{})})
    if(cat==='assistant'){s.answers++;s.generatedAnswers+=tokens;s.current.assistantAnswerTokens=(s.current.assistantAnswerTokens??0)+tokens}
    if(!s.fleet.initialPrompt && cat==='user')s.fleet.initialPrompt=content
    if(cat==='inject')s.events.push({seq:s.seq,time,kind:'inject',tokens,form:'developer',turn:s.turn})
  }
  if(kind==='function_call'||kind==='custom_tool_call') {
    const name=string(p.name)||'tool', input=text(p.arguments??p.input??'')
    const call:Call={seq:s.seq,time,name,input:input.length<240000?input:input.slice(0,240000),turn:s.turn}
    const args=parseArgs(input)
    const skillPath=string(args.cmd??args.command??args.path)
    if(/SKILL\.md/i.test(skillPath))call.skill=skillPath.match(/([^\\/"']+)[\\/]SKILL\.md/i)?.[1]??'SKILL.md'
    s.pending.set(string(p.call_id??p.id)||String(s.seq),call);s.calls++;s.toolTally[name]=(s.toolTally[name]??0)+1
    const a=activity(s,time);a.toolCalls!++;const tools=a.tools??={};const tally=tools[name]??={n:0,last:0};tally.n++;tally.last=time
    const tokens=estimateTextTokens(input)
    node(s,{seq:s.seq,time,cat:'assistant',tokens,callTokens:tokens,calls:[name],form:'assistant'})
    s.generatedCalls+=tokens;s.current.assistantCallTokens=(s.current.assistantCallTokens??0)+tokens
    const command=string(args.cmd??args.command)||(name==='exec'||name==='functions.exec'?input:'')
    if(command){
      const code=name==='exec'||name==='functions.exec'
      const entry:CommandRecord={seq:s.seq,time,tool:code?'run_code':'pwsh',cmd:command,cwd:string(args.workdir)||s.cwd,start:time,status:'running',err:false,turn:s.turn,...(code?{codeMode:true as const}:{})}
      call.command=entry;s.commands.push(entry)
    }
    fileOps(s,call,input)
    if(/spawn_agent/.test(name))s.fleet.delegations??=[]
    if(/send_message|followup_task/.test(name)){
      const to=string(args.id??args.target??args.agent_id),message=string(args.message)
      if(to&&message)s.outgoing.push({to,seq:s.seq,time,text:message})
    }
  }
  if(kind==='function_call_output'||kind==='custom_tool_call_output') {
    const call=s.pending.get(string(p.call_id))
    const output=text(p.output), tokens=estimateTextTokens(output), err=record(p.output).isError===true
    if(call){
      s.callByResult.set(s.seq,call.seq)
      if(time>=call.time)s.intervals.push({start:call.time,end:time,turn:s.turnId,name:call.name})
      const a=activity(s,time);a.toolsMs!+=Math.max(0,time-call.time)
      if(call.command){
        call.command.resultSeq=s.seq;call.command.end=time;call.command.status=err?'failed':'completed';call.command.err=err
        const match=output.match(/(?:exit_code["']?\s*:\s*|Process exited with code\s+)(-?\d+)/)
        if(match){call.command.exit=Number(match[1]);if(call.command.exit!==0){call.command.err=true;call.command.status='failed'}}
        call.command.outChars=output.length
      }
      if(call.skill){const skills=a.skills??={};const tally=skills[call.skill]??={n:0,last:0};tally.n++;tally.last=time}
      if(/spawn_agent/.test(call.name)){
        const result=parseArgs(output),to=string(result.agent_id??result.id)
        if(to){const args=parseArgs(call.input);(s.fleet.delegations??=[]).push({seq:call.seq,time:call.time,to,mode:'continuable',label:string(args.task_name??args.agent_type)||undefined})}
      }
      s.pending.delete(string(p.call_id))
    }
    node(s,{seq:s.seq,time,cat:call?.skill?'skill':'tool',tokens,tool:call?.name??'tool',err,...(call?.skill?{skill:call.skill,name:call.skill}:{})})
  }
}

export function union(intervals: {start:number;end:number}[]): {start:number;end:number}[] {
  const rows=intervals.filter(i=>i.end>i.start).sort((a,b)=>a.start-b.start), result:{start:number;end:number}[]=[]
  for(const row of rows){const last=result.at(-1);if(last && row.start<=last.end)last.end=Math.max(last.end,row.end);else result.push({...row})}
  return result
}

export function bundle(s: Parsed): { timeline:ContextTimeline; headers:ContextHeaders; pressure:ContextPressure; usage:TokenUsage; activity:ContextActivity; fleet:FleetDetail; outgoing:Parsed['outgoing']; coverage:Obj } {
  let wallMs=0,ttftMs=0,toolsMs=0,ttftCoverage=0
  const spans:TimingSpan[]=[]
  const byTurn=new Map<string,Parsed['intervals']>()
  for(const interval of s.intervals){if(!byTurn.has(interval.turn))byTurn.set(interval.turn,[]);byTurn.get(interval.turn)!.push(interval)}
  for(const t of s.turns.values()){
    if(t.end===undefined)continue
    const duration=t.duration??Math.max(0,t.end-t.start),end=t.start+duration,firstEnd=t.start+Math.min(t.ttft??0,duration)
    wallMs+=duration;ttftMs+=firstEnd-t.start;if(t.ttft!==undefined)ttftCoverage++
    if(firstEnd>t.start)spans.push({kind:'ttft',start:t.start,end:firstEnd})
    const tool=union((byTurn.get(t.id)??[]).map(i=>({start:Math.max(firstEnd,i.start),end:Math.min(end,i.end)})))
    let cursor=firstEnd
    for(const i of tool){if(i.start>cursor)spans.push({kind:'other',start:cursor,end:i.start});spans.push({kind:'tools',...i});toolsMs+=i.end-i.start;cursor=i.end}
    if(end>cursor)spans.push({kind:'other',start:cursor,end})
  }
  const u=s.usage
  const toolTotals=Object.fromEntries(Object.entries(s.toolTally).map(([name,calls])=>[name,{calls,ms:s.intervals.filter(i=>i.name===name).reduce((n,i)=>n+i.end-i.start,0)}]))
  const costs:NonNullable<ContextTimeline['cost']>={}
  for(const d of Object.values(s.activity.days))for(const [provider,models]of Object.entries(d.cost??{}))for(const [model,value]of Object.entries(models)){
    const target=((costs[provider]??={})[model]??={}).off??={uncached:0,cacheRead:0,cacheWrite:0,output:0}
    if(value.off){target.uncached+=value.off.uncached;target.cacheRead+=value.off.cacheRead;target.output+=value.off.output}
  }
  const current={...s.current,total:sum(s.current)}
  const timeline:ContextTimeline={ok:true,model:s.model,provider:s.provider,reasoningEffort:s.effort,contextWindow:s.window,
    current,requests:s.requests,events:s.events,nodes:s.nodes,archive:s.archive,droppedNodes:0,systems:s.systems,
    counts:{turns:s.turns.size,steps:s.requests.length,injects:s.events.filter(e=>e.kind==='inject').length,compactions:s.events.filter(e=>e.kind==='compaction').length,prunes:0,skills:new Set(s.nodes.filter(n=>n.skill).map(n=>n.skill)).size},
    last:s.requests.length?{seq:s.requests.at(-1)!.seq,total:s.requests.at(-1)!.total,prompt:s.requests.at(-1)!.prompt}:undefined,
    generatedReasoning:u.reasoning_output_tokens,generatedAnswerTokens:s.generatedAnswers,generatedCallTokens:s.generatedCalls,
    toolCalls:s.calls,toolTally:s.toolTally,humanInputs:s.humanInputs,answers:s.answers,lastUser:s.lastUser,cost:costs,
    timing:{wallMs,ttftMs,genMs:0,calls:s.requests.length,toolsMs,toolBusyMs:toolsMs,toolCalls:s.calls,tools:toolTotals},
    fileOps:s.fileOps,commands:s.commands,commandStats:{runs:s.commands.length,failed:s.commands.filter(c=>c.err).length,ms:s.commands.reduce((n,c)=>n+Math.max(0,(c.end??c.start)-c.start),0),bg:0},spans}
  return {timeline,headers:s.headers,pressure:{projectedTokens:s.requests.at(-1)?.total,contextWindow:s.window},
    usage:{uncachedInputTokens:Math.max(0,u.input_tokens-u.cached_input_tokens),cacheReadTokens:Math.min(u.input_tokens,u.cached_input_tokens),outputTokens:u.output_tokens,cacheWriteTokens:0},
    activity:s.activity,fleet:s.fleet,outgoing:s.outgoing,coverage:{source:s.modern?'token_usage_record':'token_count',malformed:s.malformed,ttftCoverage,completedTurns:[...s.turns.values()].filter(t=>t.end!==undefined).length,contentEstimated:true,hiddenReasoningUnavailable:true}}
}
