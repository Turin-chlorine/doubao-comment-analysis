// Dependency-free browser smoke test for the offline report (Windows Edge).
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = resolve('qa_cdp_profile');
const port = 9248;
const browser = spawn(edge, [
  '--headless=new','--disable-gpu','--disable-gpu-sandbox','--no-sandbox',
  '--remote-allow-origins=*',`--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'
], {stdio:'ignore'});

async function waitForTarget() {
  for(let i=0;i<80;i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const tab = tabs.find(t=>t.type==='page');
      if(tab) return tab;
    } catch {}
    await new Promise(r=>setTimeout(r,150));
  }
  throw new Error('Edge debugging endpoint did not start');
}

let ws, serial=0;
const pending=new Map();
function send(method,params={}) {
  const id=++serial;
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
}
async function evaluate(expression) {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}
function check(value,message) { if(!value)throw new Error(message); console.log('PASS',message); }
async function pause(ms=250){await new Promise(r=>setTimeout(r,ms))}

try {
  const tab=await waitForTarget();
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result)}};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  await send('Page.enable');await send('Runtime.enable');
  const url=pathToFileURL(resolve('index.html')).href;
  await send('Page.navigate',{url});await pause(450);
  await evaluate('localStorage.clear()');
  await evaluate(`(()=>{const d=JSON.parse(document.querySelector('#report-data').textContent),key='doubao-pain-edits:'+d.meta.package+':'+d.meta.as_of+':'+d.items.length;localStorage.setItem(key,JSON.stringify({'yyb-894886768864948032':['智能体下线与去留','智能体查找与创建','账号与登录限制'],'yyb-950866208039919936':['功能冗余','账号与登录限制'],'yyb-930326179311812544':['功能冗余']}))})()`);
  await send('Page.reload',{ignoreCache:true});await pause(450);
  check(await evaluate(`(()=>{const d=JSON.parse(document.querySelector('#report-data').textContent),key='doubao-pain-edits:'+d.meta.package+':'+d.meta.as_of+':'+d.items.length+':v2',s=JSON.parse(localStorage.getItem(key)),a=s['yyb-894886768864948032'].pain_points,f=s['yyb-950866208039919936'].pain_points,u=s['yyb-930326179311812544'].pain_points;return a.includes('智能体下线与创建')&&a.includes('账号与登录限制')&&!a.some(x=>x==='智能体下线与去留'||x==='智能体查找与创建')&&f.includes('功能冗余或缺失')&&f.includes('账号与登录限制')&&!f.includes('功能冗余')&&u.includes('更新时间间隔')&&u.includes('功能冗余或缺失')})()`),'legacy pain labels migrate and retain newly added annotations');
  await evaluate('localStorage.clear()');
  await send('Page.reload',{ignoreCache:true});await pause(450);
  const desktopShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('preview-desktop.png',Buffer.from(desktopShot.data,'base64'));
  check(await evaluate(`JSON.parse(document.querySelector('#report-data').textContent).items.length`)===500,'all 500 comments are embedded offline');
  check(await evaluate(`JSON.parse(document.querySelector('#report-data').textContent).items.every(x=>x.id.startsWith('yyb-'))`),'all embedded comments come from Yingyongbao');
  check(!await evaluate(`document.querySelector('#sourceFilter, #sourceBars')!==null`),'single-source report has no source comparison');
  check(await evaluate(`document.querySelectorAll('.evidence-card').length`)===24,'evidence list is paginated');
  check(await evaluate(`document.querySelector('#topPrevPage').disabled && document.querySelector('#prevPage').disabled`),'both previous-page controls are disabled on page 1');
  await evaluate(`document.querySelector('#nextPage').click()`);
  check(await evaluate(`document.querySelector('#pageStatus').textContent.includes('第 2 /')`),'next-page control works');
  check(await evaluate(`document.querySelector('#topPageStatus').textContent.startsWith('2 /')`),'top and bottom page status stay in sync');
  const scrollBefore=await evaluate(`(scrollTo({top:1000,behavior:'instant'}),scrollY)`);
  await evaluate(`document.querySelector('#topPrevPage').click()`);
  check(await evaluate(`document.querySelector('#topPageStatus').textContent.startsWith('1 /') && scrollY===${scrollBefore}`),'top pagination returns to page 1 without scrolling');
  await evaluate(`document.querySelector('#pageJump').value='21';document.querySelector('#pageJumpForm').requestSubmit()`);
  check(await evaluate(`document.querySelector('#topNextPage').disabled && document.querySelector('#nextPage').disabled && scrollY===${scrollBefore}`),'page jump reaches the last page without scrolling');
  await evaluate(`document.querySelector('#ratingFilter').value='1';document.querySelector('#ratingFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`(()=>{const pages=Math.ceil(JSON.parse(document.querySelector('#report-data').textContent).items.filter(x=>x.rating===1).length/24);return document.querySelector('#topPageStatus').textContent==='1 / '+pages+' 页'&&document.querySelector('#pageStatus').textContent.includes('第 1 / '+pages+' 页')})()`),'filtering resets to a valid page and synchronizes both controls');
  await evaluate(`document.querySelector('#resetFilters').click()`);
  await evaluate(`document.querySelector('#ratingFilter').value='1';document.querySelector('#ratingFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).items.filter(x=>x.rating===1).length`),'rating filter updates evidence');
  await evaluate(`document.querySelector('#resetFilters').click()`);
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('#sceneFilter').value='智能体与角色';document.querySelector('#sceneFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)>70`),'scene filter handles multi-label comments');
  await evaluate(`document.querySelector('#painFilter').value='智能体下线与创建';document.querySelector('#painFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)>30`),'pain filter combines with scene');
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('[data-bar-kind="rating"][data-bar-value="5"]').click()`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).items.filter(x=>x.rating===5).length`),'rating chart links to matching review records');
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('[data-bar-kind="pain"][data-bar-value="智能体下线与创建"]').click()`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).counts.pains['智能体下线与创建']`),'pain chart links to counted review records');
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('#painFilter').value='未明确痛点';document.querySelector('#painFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).items.filter(x=>x.pain_points.length===0).length&&document.querySelector('.evidence-card .tag').textContent.includes('未明确痛点')`),'unclassified pain filter indexes only reviews without pain labels');
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('[data-bar-kind="pain"][data-bar-value="未明确痛点"]').click()`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).items.filter(x=>x.pain_points.length===0).length`),'unclassified pain chart bar links to unlabelled reviews');
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('#painFilter').value='更新时间间隔';document.querySelector('#painFilter').dispatchEvent(new Event('change'))`);
  check(await evaluate(`Number(document.querySelector('#matchCount').textContent)===JSON.parse(document.querySelector('#report-data').textContent).counts.pains['更新时间间隔']`),'update-interval pain filter indexes the new category');
  await evaluate(`document.querySelector('#resetFilters').click()`);
  await evaluate(`document.querySelector('#resetFilters').click()`);
  await evaluate(`document.querySelector('#resetFilters').click();document.querySelector('.evidence-card').click()`);
  check(await evaluate(`document.querySelector('#drawer').classList.contains('open') && document.querySelector('#drawerContent a[href^="https://"]')!==null`),'evidence drawer opens with public source link');
  const originalAgent=await evaluate(`JSON.parse(document.querySelector('#report-data').textContent).counts.pains['智能体下线与创建']`);
  const originalFirstLabels=await evaluate(`JSON.parse(document.querySelector('#report-data').textContent).items[0].pain_points.length`);
  const originalSentiment=await evaluate(`JSON.parse(document.querySelector('#report-data').textContent).items[0].sentiment`);
  check(await evaluate(`Array.from(document.querySelectorAll('#drawerContent input[name="sentimentChoice"]')).map(x=>x.value).join(',')==='正向,负向,混合'`),'sentiment editor offers positive, negative, and mixed');
  const revisedSentiment=originalSentiment==='正向'?'负向':'正向';
  await evaluate(`document.querySelector('#sentimentEditTrigger').click();document.querySelector('input[name="sentimentChoice"][value="${revisedSentiment}"]').checked=true;document.querySelector('[data-save-sentiment]').click()`);
  check(await evaluate(`document.querySelector('#sentimentEditTrigger').textContent.includes('${revisedSentiment}')&&document.querySelector('.evidence-card .tag').textContent.includes('${revisedSentiment}')&&document.querySelector('.evidence-card .tag').classList.contains('${revisedSentiment==='负向'?'negative':'positive'}')`),'sentiment edit updates drawer and evidence card immediately');
  check(await evaluate(`(()=>{const d=JSON.parse(document.querySelector('#report-data').textContent),key='doubao-pain-edits:'+d.meta.package+':'+d.meta.as_of+':'+d.items.length+':v2',s=JSON.parse(localStorage.getItem(key));return s[d.items[0].id].sentiment==='${revisedSentiment}'})()`),'sentiment edit is saved locally by review ID');
  await evaluate(`document.querySelector('#painEditTrigger').click()`);
  check(await evaluate(`document.querySelectorAll('#painEditor input[name="painChoice"]').length===12 && document.querySelectorAll('#painEditor input[name="painChoice"]:checked').length===${originalFirstLabels}`),'editor shows all 12 pain labels and existing selection');
  await evaluate(`Array.from(document.querySelectorAll('#painEditor input')).find(x=>x.value==='智能体下线与创建').checked=true;document.querySelector('[data-save-pain]').click()`);
  check(await evaluate(`Number(document.querySelector('#agentCount').textContent)===${originalAgent+1} && document.querySelector('#editStatus').textContent.includes('本地修订统计')`),'multi-label edit updates overview and marks local statistics');
  check(await evaluate(`document.querySelector('#opportunities .metric-row span').textContent.includes('${originalAgent+1} / 500') && Array.from(document.querySelectorAll('#painBars .bar-row')).find(x=>x.dataset.barValue==='智能体下线与创建').querySelector('.bar-value').textContent==='${originalAgent+1}'`),'opportunity frequency and pain chart recompute from edited labels');
  await send('Page.reload',{ignoreCache:true});await pause(450);
  check(await evaluate(`Number(document.querySelector('#agentCount').textContent)===${originalAgent+1} && document.querySelector('#editStatus').textContent.includes('已调整 1 条')`),'local edits survive a file-page reload');
  const emptyReview=await evaluate(`(()=>{const data=JSON.parse(document.querySelector('#report-data').textContent);return data.items.slice(0,24).find(x=>x.pain_points.length===0).id})()`);
  await evaluate(`document.querySelector('[data-review="${emptyReview}"]').click();document.querySelector('#painEditTrigger').click()`);
  check(await evaluate(`document.querySelectorAll('#painEditor input:checked').length===0`),'unlabelled review opens with no pain selected');
  await evaluate(`Array.from(document.querySelectorAll('#painEditor input')).find(x=>x.value==='智能体下线与创建').checked=true;document.querySelector('[data-save-pain]').click();document.querySelector('#painEditTrigger').click();document.querySelector('#painEditor input:checked').checked=false;document.querySelector('[data-save-pain]').click()`);
  check(await evaluate(`document.querySelector('#painEditTrigger').textContent.includes('无明确痛点') && Number(document.querySelector('#agentCount').textContent)===${originalAgent+1}`),'labels can be added to and cleared from an originally unlabelled review');
  await evaluate(`Storage.prototype.setItem=()=>{throw new Error('storage disabled')};document.querySelector('#painEditTrigger').click();Array.from(document.querySelectorAll('#painEditor input')).find(x=>x.value==='智能体下线与创建').checked=true;document.querySelector('[data-save-pain]').click()`);
  check(await evaluate(`document.querySelector('#editStatus').textContent.includes('无法保存本地修改')`),'storage failure is explained on the page');
  await send('Page.reload',{ignoreCache:true});await pause(450);
  check(await evaluate(`Number(document.querySelector('#agentCount').textContent)===${originalAgent+1}`),'an unsaved edit disappears after reload while saved edits remain');
  await evaluate(`document.querySelector('.evidence-card').click()`);
  await evaluate(`document.querySelector('#drawerClose').click();document.querySelector('#assetNext').click()`);
  check((await evaluate(`document.querySelector('#assetTitle').textContent`)).includes('选择'),'asset prototype enters selection');
  await evaluate(`document.querySelector('#chooseDialogue').click();document.querySelector('#assetNext').click()`);
  check((await evaluate(`document.querySelector('#assetNotice').textContent`)).includes('不是实际导出'),'prototype explains simulated result');
  await evaluate(`document.querySelector('#assetBack').click()`);
  check((await evaluate(`document.querySelector('#assetTitle').textContent`)).includes('选择'),'asset prototype back navigation works');
  await evaluate(`document.querySelector('#demoBtn').click()`);
  check(await evaluate(`document.body.classList.contains('demo')`),'interview mode opens');
  await evaluate(`document.querySelector('#demoNext').click();document.querySelector('#demoExit').click()`);
  check(!await evaluate(`document.body.classList.contains('demo')`),'interview mode advances and exits');
  await send('Emulation.setEmulatedMedia',{media:'print'});
  check(await evaluate(`getComputedStyle(document.querySelector('.masthead')).display`) === 'none','print layout hides navigation');
  check(await evaluate(`getComputedStyle(document.querySelector('#printEvidence')).display`) === 'block','print layout includes reviewed core quotes');
  check(await evaluate(`Number(document.querySelector('#agentCount').textContent)===${originalAgent+1} && getComputedStyle(document.querySelector('#editStatus')).display!=='none'`),'print layout keeps revised counts and the local-edit disclosure');
  await send('Emulation.setEmulatedMedia',{media:'screen'});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.reload',{ignoreCache:true});await pause(550);
  const width=await evaluate(`({viewport:innerWidth,scroll:document.documentElement.scrollWidth})`);
  check(width.scroll<=width.viewport+1,`mobile layout has no horizontal overflow (${width.scroll}/${width.viewport})`);
  await evaluate(`document.querySelector('.evidence-card').click();document.querySelector('#painEditTrigger').click()`);
  check(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && getComputedStyle(document.querySelector('.evidence-top')).flexWrap==='wrap'`),'mobile pain editor and top pager fit the viewport');
  await evaluate(`document.querySelector('#drawerClose').click()`);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('qa_mobile_cdp.png',Buffer.from(shot.data,'base64'));
  await writeFile('preview-mobile.png',Buffer.from(shot.data,'base64'));
  console.log('Mobile screenshot: qa_mobile_cdp.png');
  await evaluate(`document.querySelector('#map').scrollIntoView({behavior:'instant'})`);await pause(180);
  const mapShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('qa_map.png',Buffer.from(mapShot.data,'base64'));
  await evaluate(`document.querySelector('#prototype').scrollIntoView({behavior:'instant'})`);await pause(180);
  const protoShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('qa_prototype.png',Buffer.from(protoShot.data,'base64'));
  await evaluate(`document.querySelector('.asset-phone').scrollIntoView({behavior:'instant',block:'center'})`);await pause(180);
  const phoneShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('qa_phone.png',Buffer.from(phoneShot.data,'base64'));
} finally {
  if(ws)ws.close();
  browser.kill();
}
