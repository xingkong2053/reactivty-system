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

export function watch(source: any, cb: () => void) {
  let getter;
  // 添加getter方式调用支持
  if(typeof source === "function"){
    // source是函数, 则说明用户传递的是getter
    getter = source
  } else {
    getter = () => traverse(source)
  }
  effect(getter, {
    scheduler() {
      // 当数据发生变化时, 执行scheduler, 进而执行cb
      // 其实scheduler更像是用于覆盖默认行为的一个选项
      cb()
    }
  })
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
