const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const vscode=require('vscode')

exports.run=async function(){
  const extension=vscode.extensions.getExtension('VALM-Labs.codex-context')
  assert.ok(extension,'The extension must be discovered by VS Code')
  const api=await extension.activate()
  await vscode.commands.executeCommand('workbench.view.extension.codex-context')
  await vscode.commands.executeCommand('codex-context.open')
  let result
  for(let i=0;i<120;i++){
    await new Promise(resolve=>setTimeout(resolve,500))
    result=api.diagnostics()
    if(result.sidebar?.ready&&result.editor?.ready)break
    if(result.sidebar?.errors?.length||result.editor?.errors?.length)throw new Error(JSON.stringify(result))
  }
  await fs.writeFile(path.join(process.env.CODEX_CONTEXT_TEST_ROOT,'integration-result.json'),JSON.stringify(result,null,2))
  assert.equal(result.sidebar?.ready,true,'The sidebar must render original components')
  assert.equal(result.editor?.ready,true,'The editor Webview must render original components')
  assert.ok(result.editor.cards>=6,'Expected original dashboard cards')
  assert.ok(result.editor.charts>=3,'Expected original SVG charts and icons')
  assert.deepEqual(result.editor.errors,[],'The Webview must not report runtime errors')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await vscode.commands.executeCommand('codex-context.open')
  for(let i=0;i<120&&!api.diagnostics().editor?.ready;i++)await new Promise(resolve=>setTimeout(resolve,500))
  assert.equal(api.diagnostics().editor?.ready,true,'The editor page must reopen after being closed')
  console.log('codex-context VS Code integration passed:',JSON.stringify(result))
}
