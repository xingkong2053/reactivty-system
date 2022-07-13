export type Effect = {
  (): void,
  deps: EffectSet[],
  options: EffectOptions,
};

export type EffectOptions = {
  scheduler?: (fn: () => void) => void,
  // 懒执行
  lazy?: boolean,
}

export type EffectSet = Set<Effect>;

export type KeyVal = { [key: string | symbol]: any }

export interface ReactiveOptions {
  shallow?: boolean,
  readonly?: boolean,
}