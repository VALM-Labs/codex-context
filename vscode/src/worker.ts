import { parentPort, workerData } from 'node:worker_threads'
import { CodexStore } from './codex/store'
import { record, string } from './codex/parser'

const port=parentPort!
const store=new CodexStore(workerData.home)
port.on('message',async message=>{
  const m=record(message),args=record(m.args)
  try{
    let value:unknown
    switch(m.method){
      case 'list':value={sessions:await store.list(args.force===true),compressed:store.compressed};break
      case 'bundle':value=await store.get(string(args.sessionId));break
      case 'rows':value=await store.sessionRows(string(args.sessionId));break
      case 'page':value=await store.page(string(args.sessionId),Number(args.seq));break
      case 'route':value=await store.route(string(args.route),record(args.body),(done,total)=>port.postMessage({progress:{done,total}}));break
      default:throw new Error('Unknown request')
    }
    port.postMessage({id:m.id,value})
  }catch(error){port.postMessage({id:m.id,error:error instanceof Error?error.message:'Read failed'})}
})
