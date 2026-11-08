type Obj=Record<string,unknown>
interface VSCode { postMessage(message:unknown):void; getState():unknown; setState(value:unknown):void }
declare function acquireVsCodeApi():VSCode
export const vscode=acquireVsCodeApi()
let sequence=0
const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
export function request(method:string,args:Obj={}):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    const id=++sequence
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The local log reader did not respond. Use Refresh to retry.'))},180000)
    pending.set(id,{resolve,reject,timer});vscode.postMessage({type:'request',id,method,args})
  })
}
window.addEventListener('message',event=>{
  const m=event.data
  if(m?.type!=='response')return
  const p=pending.get(m.id);if(!p)return
  pending.delete(m.id);clearTimeout(p.timer)
  if(m.error)p.reject(new Error(m.error));else p.resolve(m.value)
})
const nativeFetch=globalThis.fetch?.bind(globalThis)
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const route=typeof input==='string'?input:input instanceof URL?input.toString():input.url
  if(route.startsWith('api/dsh-context/')){
    let body:Obj={}
    try{body=JSON.parse(typeof init?.body==='string'?init.body:'{}')}catch{}
    const value=await request('route',{route,body})
    return new Response(JSON.stringify({ok:true,value}),{status:200,headers:{'content-type':'application/json'}})
  }
  if(route.startsWith('data:')&&nativeFetch)return nativeFetch(input,init)
  throw new Error('External network requests are disabled in this local dashboard')
}) as typeof fetch
