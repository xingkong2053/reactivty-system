import * as jobQueue from "./job-queue"

// 响应式系统的作用及实现
// ts-node vuejs-design-and-implement/reactive-system

type Effect = {
  (): void,
  deps: EffectSet[],
  options: EffectOptions,
};

type EffectOptions = {
  scheduler?: (fn: ()=>void)=>void,
  // 懒执行
  lazy?: boolean,
}

type EffectSet = Set<Effect>;

type KeyVal = {[key: string | symbol]: any}

// 存放副作用的桶
const bucket = new WeakMap<KeyVal, Map<string | symbol, EffectSet>>()

let activeEffect: Effect;
// 用于存放activeEffect的栈
// 用于解决在嵌套调用effect(fn)时, activeEffect与当前所读取的key不匹配问题, 如
// effect(()=>{
//   console.log("e1")
//   effect(()=>{
//     console.log("e2")
//     obj.foo
//   })
//   obj.bar
// })
// 在上例中如果没用activeEffect栈, 
// 那么当读取obj.bar时, activeEffect将会是e2而不是e1
const effectStack: Effect[] = []
function effect(fn: ()=>unknown, options: EffectOptions = {}){
  const effectFn = ()=>{
    // 调用cleanup函数完成清除工作
    cleanup(effectFn)
    activeEffect = effectFn;
    effectStack.push(effectFn)
    // 将值返回出来,给计算属性调用
    // const effectFn = effect(()=>obj.cnt + obj.foo, {lazy: true})
    // const value = effectFn()
    const res = fn();  // 触发依赖收集
    effectStack.pop()
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }
  effectFn.options = options
  // 用于存储与该副作用相关联的[依赖]集合
  effectFn.deps = [] as EffectSet[];
  if(!options.lazy){
    effectFn();
  }
  return effectFn
}

function cleanup(effectFn: Effect){
  // 在每次副作用执行前, 把该副作用从所有与之相关联的依赖集合中删除
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  // 重置deps数组
  effectFn.deps.length = 0
}

const data: KeyVal = {
  ok: true,
  msg: "hello effect",
  cnt: 1,
  foo: 1,
}

function computed<T>(getter: ()=>T){
  // val缓存计算属性结果
  let val: T, dirty: boolean = true;
  const effectFn = effect(getter,{
    lazy: true,
    scheduler(){
      // 每次getter中的依赖项改变时, 都会执行trigger, 进而执行scheduler,
      // 那么将dirty变为true的工作就写在这里就行
      dirty = true
      // 触发obj.value所依赖的effectFn
      trigger(obj, "value")
    }
  })


  const obj = {
    // 当读取到.value时才去执行effectFn()
    get value(){
      if(dirty){
        val = effectFn() as T;
        dirty = false;
      }
      // 当在一个副作用函数时调用computed时, 如
      // effect(()=>{
      //   const bar = computed(()=>obj.cnt + obj.foo)
      //   console.log(bar.value)
      // })
      // 我们希望这个副作用函数会成为obj.cnt和obj.foo的依赖,
      // 但是现实并不会如此, 以为上边的代码本质上就是effect函数嵌套
      // 在读取内层obj的值时, 并不会把外层的effect作为其依赖
      // 解决方法: 
      // 当读取计算属性的值时, 调用trace追踪value
      // 当value改变时(这里是dirty = true), 调用trigger触发响应
      // 这是的activeEffect是外层的effectFn
      track(obj, "value")
      return val;
    },
    set value(val){
      console.error("计算属性不允许set");
    }
  }
  return obj;
}

const obj = new Proxy(data, {
  get(target, key){
    track(target, key)
    return target[key]
  },
  set(target, key, newVal){
    target[key] = newVal
    trigger(target, key)
    return true
  }
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

console.log("end. ")

// 读取数据时追踪依赖(副作用)
function track(target: KeyVal, key: string | symbol){
  if(!activeEffect) return;
  // depsMap:  key --> effects
  let depsMap = bucket.get(target);
  if(!depsMap){
    bucket.set(target, (depsMap = new Map()));
  }

  // deps 用于存储effects
  let deps = depsMap.get(key);
  if(!deps){
    depsMap.set(key, (deps = new Set()))
  }
  deps.add(activeEffect)
  // deps就是一个与当前副作用函数存在联系的依赖(也是副作用函数)集合
  activeEffect.deps.push(deps)
}

// 修改数据时触发依赖(副作用)
function trigger(target: KeyVal, key: string | symbol){
  const depsMap = bucket.get(target);
  if(!depsMap) return;
  const effects = depsMap.get(key)
  // 之前是 effects && effects.forEach(effectFn=>effectFn())
  // 但是这会出现一个问题
  // 在依次执行effectFn时, 会依次执行 
  //          effectFn --> 
  //            cleanup -->
  //              deps.delete(target) [1]
  //            fn --> 
  //              get obj[key] --> 
  //                trace --> 
  //                  deps.add(target) [2]
  // 而在调用forEach遍历Set时, 如果一个值已经被访问过了, 但是该值被删除并重新添加到集合
  // 且此时forEach遍历并没有结束, 那么该值会被重新访问
  // 这样就会造成死循环, 解决方法就是将要执行的effects放到临时的新集合中,
  // 并遍历这个新的集合
  const effectsToRun = new Set(effects);
  effectsToRun.forEach(effectFn=>{
    if(effectFn === activeEffect) return;
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    } else {
      effectFn()
    }
  })
}