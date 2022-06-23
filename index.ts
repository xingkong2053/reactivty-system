// 响应式系统的作用及实现
// ts-node vuejs-design-and-implement/reactive-system

type Effect = {
  (): void,
  deps: EffectSet[]
};
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
function effect(fn: ()=>void){
  const effectFn = ()=>{
    // 调用cleanup函数完成清除工作
    cleanup(effectFn)
    activeEffect = effectFn;
    effectStack.push(effectFn)
    fn();  // 触发依赖收集
    effectStack.pop()
    activeEffect = effectStack[effectStack.length - 1]
  }
  // 用于存储与该副作用相关联的[依赖]集合
  effectFn.deps = [] as EffectSet[]
  effectFn();
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
}

const obj = new Proxy(data, {
  get(target, key){
    if(!activeEffect) return;
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

obj.ok = false

setTimeout(()=>{
  obj.msg = "hello world";
}, 3000)

// 读取数据时追踪依赖(副作用)
function track(target: KeyVal, key: string | symbol){
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
    effectFn()
  })
}