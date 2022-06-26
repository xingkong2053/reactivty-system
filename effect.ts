import { Effect, EffectOptions, EffectSet, KeyVal } from './type';
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
export function effect(fn: () => unknown, options: EffectOptions = {}) {
  const effectFn = () => {
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
  if (!options.lazy) {
    effectFn();
  }
  return effectFn
}

export function reactive(data: Record<string | symbol, any>){
  return new Proxy(data, {
    get(target, key, receiver) {
      track(target, key)
      // 使用target[key]会带来的问题, 如:
      // let obj = {
      //   foo: 1,
      //   get bar(){
      //     return this.foo
      //   }
      // }
      // let p = reactive(obj)
      // 在上例中我们希望在追踪bar的响应式的时候也会追踪foo,
      // 然而使用target[key]的方式行不通
      // 原因是在执行bar的getter函数时, getter函数里面的this指向的是原对象obj而不是代理对象p
      // 所以我们在获取对象属性时, 要修改这个属性getter函数内部的this值
      // 这就要使用Reflect.get()
      // return target[key]
      return Reflect.get(target, key, receiver /* 指向创建后的代理对象 */)
    },
    has(target, key){
      // 使用has拦截 'foo' in p 操作
      track(target, key)
      return Reflect.has(target,key)
    },
    set(target, key, newVal, receiver) {
      // target[key] = newVal
      Reflect.set(target, key, newVal, receiver)
      trigger(target, key) 
      return true
    }
  })
}

function cleanup(effectFn: Effect) {
  // 在每次副作用执行前, 把该副作用从所有与之相关联的依赖集合中删除
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  // 重置deps数组
  effectFn.deps.length = 0
}

// 读取数据时追踪依赖(副作用)
export function track(target: KeyVal, key: string | symbol) {
  if (!activeEffect) return;
  // depsMap:  key --> effects
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }

  // deps 用于存储effects
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()))
  }
  deps.add(activeEffect)
  // deps就是一个与当前副作用函数存在联系的依赖(也是副作用函数)集合
  activeEffect.deps.push(deps)
}

// 修改数据时触发依赖(副作用)
export function trigger(target: KeyVal, key: string | symbol) {
  const depsMap = bucket.get(target);
  if (!depsMap) return;
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
  effectsToRun.forEach(effectFn => {
    if (effectFn === activeEffect) return;
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn)
    } else {
      effectFn()
    }
  })
}