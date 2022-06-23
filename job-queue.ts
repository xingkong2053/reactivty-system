
const jobQueue = new Set<any>();
// 使用p.then()将任务添加到微任务队列
const p = Promise.resolve();
let isFlushing = false

export function flushJob(){
  if(isFlushing) return;
  isFlushing = true
  p.then(()=>{
    jobQueue.forEach(job=>job());
  }).finally(()=>{
    isFlushing = false
  })
}

export function addJob(job: any){
  jobQueue.add(job)
}