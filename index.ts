// 响应式系统的作用及实现
// ts-node vuejs-design-and-implement/reactive-system

type Effect = ()=>void;
type EffectSet = Set<Effect>;

type KeyVal = {[key: string | symbol]: any}

// 存放副作用的桶
const bucket = new WeakMap<KeyVal, Map<string | symbol, EffectSet>>()

let activeEffect: Effect;
function effect(fn: Effect){
  activeEffect = fn;
  fn();  // 触发依赖收集
}

const data: KeyVal = {
  msg: "hello effect"
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
  console.log(`data.msg changed: ${obj.msg}`);
})

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
}

// 修改数据时触发依赖(副作用)
function trigger(target: KeyVal, key: string | symbol){
  const depsMap = bucket.get(target);
  if(!depsMap) return;
  const effects = depsMap.get(key)
  effects && effects.forEach(fn=>fn())
}