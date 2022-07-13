import { effect, trigger, track } from './effect';
import { KeyVal } from './type';
export function computed<T>(getter: () => T) {
  // val缓存计算属性结果
  let val: T, dirty: boolean = true;
  const effectFn = effect(getter, {
    lazy: true,
    scheduler() {
      // 每次getter中的依赖项改变时, 都会执行trigger, 进而执行scheduler,
      // 那么将dirty变为true的工作就写在这里就行
      dirty = true
      // 触发obj.value所依赖的effectFn
      trigger(obj, "value")
    }
  })
  const obj = {
    // 当读取到.value时才去执行effectFn()
    get value() {
      if (dirty) {
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
    set value(val) {
      console.error("计算属性不允许set");
    }
  }
  return obj;
}

export function watch<T>(
  source: T | {():T}, 
  cb: (newVal: T, oldVal: T, onInvalidate: (fn: ()=>void)=>void) => void,
  options: {immediate?:boolean} = {}
) {
  let getter: ()=>T;
  // 添加getter方式调用支持
  if(typeof source === "function"){
    // source是函数, 则说明用户传递的是getter
    getter = source as ()=>T
  } else {
    getter = () => traverse(source)
  }

  // watch和computed中所谓的缓存, 是通过闭包来实现的
  let oldVal: T, newVal : T;
  // 使用cleanup来存储用户传递的过期回调
  let cleanup: ()=>void;
  function _onInvalidate(fnCalledWhenInvalid/* 过期回调 */: ()=>void){
    cleanup = fnCalledWhenInvalid
  }

  const job = ()=>{
    // 2. 当依赖的响应式数据发生变化之后, 在trigger里面会调用scheduler
    //    这时拿到的值就是新值
    newVal = effectFn() as T;

    // 在第二次调用cb之前, 先执行过期回调
    // 过期回调中存放着用户自定义的"在新一次执行cb之前, 怎么处理上一次cb中的数据"这样的逻辑
    // 比如打印一下日志啊, 修改一下闭包变量之类的. 
    cleanup && cleanup();

    // 当数据发生变化时, 执行scheduler, 进而执行cb
    // 其实scheduler更像是用于覆盖默认行为的一个选项
    cb(newVal, oldVal, _onInvalidate);

    // 用户提供的cb掉完之后别忘了替换
    oldVal = newVal;
  }

  const effectFn = effect(getter, {
    // 这里为什么一定要标识lazy: true ?
    // 当不是懒执行时, 会多执行一次不必要的getter() 
    lazy: true,
    scheduler: job
  })

  if(options.immediate){
    // 如果用户设置了立即执行, 就立即执行用户的cb函数
    // 注意此时的oldVal为undefined
    job();
  } else {
    // 1. 先手动调用副作用函数, 拿到的值是旧值
    oldVal = effectFn() as T;
  }
}

// 通用的读取操作
// 当读取时activeEffect会成为响应式对象和其上的所有key的依赖
function traverse(value: any, seen = new Set()) {
  // 如果读取的数据是原始值, 或者已经被读取过了, 就停止
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  value = value as KeyVal
  // 避免响应式对象循环引用在这里导致死循环, 如
  // obj = {
  //   foo: {
  //     bar: obj.bar
  //   },
  //   bar: {
  //     foo: obj.foo
  //   }
  // }
  seen.add(value)
  for (let item in value) {
    traverse(value[item], seen)
  }
  return value
}
