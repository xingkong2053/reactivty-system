import * as jobQueue from "./job-queue"
import { effect, reactive } from "./effect"
import { computed, watch } from "./computed"

// 响应式系统的作用及实现
// ts-node vuejs-design-and-implement/reactive-system
const obj = reactive({
  ok: true,
  msg: "hello effect",
  cnt: 1,
  foo: 1,
})

effect(()=>{
  console.log(`[e1] data.msg changed: ${obj.msg}`);
})

effect(()=>{
  // 这个函数会同时作为ok,msg连个键的副作用
  // 但是当ok = false时, 无论msg的值变为多少, 都不会影响函数的执行
  // 也就是当ok = false时, msg的变化不应该再触发该副作用的执行
  // 这就涉及到分支切换和cleanup
  console.log(`[e2] `, obj.ok?("true "+obj.msg):"ok is false");
})

effect(()=>{
  // 在一个effect中对同一个key(cnt)的读取和设置
  // 这会造成死循环, 为什么?
  // 1. 当读取obj.cnt时, 会触发trace函数, 此时activeEffect 设置为 该箭头函数对应的effectFn
  //    并收集effectFn
  // 2. 当设置obj.cnt时(此时activeEffect并没有变), 会把所有相关的effectFn拿出来执行, 其中就包括该effectFn
  // 然后又会重复执行1 ,2 造成死循环
  // 解决方案: 在trigger中对执行effectFn进行过滤
  const tmp = obj.cnt + 1;
  console.log("[e3]", tmp);
  obj.cnt = tmp;
  
})

effect(()=>{
  console.log("[e4]", obj.foo)
}, {
  // 可调度性:  当trigger触发副作用执行时, 用户可以决定副作用执行的时机
  scheduler(fn){
    // 交由宏任务进行处理
    // 这样会当所有的同步任务执行完毕后, 在执行副作用
    // setTimeout(()=>fn())
    // 使用jobQueue可以省去同步代码的"中间状态"
    jobQueue.addJob(fn)
    jobQueue.flushJob()
  }
})

obj.ok = false

setTimeout(()=>{
  obj.msg = "hello world";
}, 3000)

for(let i=0; i<10; i++){
  obj.foo ++ ;
}

const bar = computed(()=>obj.foo + obj.cnt)
// 当访问一个计算属性.value时, 才第一次触发effectFn
console.log(bar.value)

watch(obj, ()=>{
  console.log("数据发生了变化");
})

// watch使用getter调用的一种方式
watch(
  ()=>obj.foo,
  ()=>{
    console.log("obj.foo 值变化了");
  }
)

watch(
  ()=>obj.foo as number,
  (newVal, oldVal)=>{
    console.log(`obj.foo 值变化了, 新值 ${newVal}, 旧值 ${oldVal}`);
  }
)

function someAsyncFunc(): Promise<string>{
  return new Promise(resolve=>{
    setTimeout(()=>{
      resolve("ok")
    }, 3000)
  })
}

let data: string = "";
watch(
  ()=>obj.foo as number,
  async (newVal, oldVal, onInvalidate) => {
    // 维护一个闭包变量来标识该副作用是否过期
    let expire = false;
    onInvalidate(()=>{
      expire = true
    });
    const res = await someAsyncFunc();
    if(!expire){
      data = res
    }
  }
)

obj.foo ++; 

effect(()=>{
  // 使用has拦截in操作符
  console.log(`foo in obj: ${'foo' in obj}`)
})

delete obj.foo;

console.log("end. ")