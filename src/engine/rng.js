// 播种随机内核：一个 32 位混合器 + 一个文本哈希 + 一条 mulberry32 流。
//
// 三个导出各有一份职责，不要互相替换：
//   mix32        整数雪崩混合，统计上均匀的 32 位输出
//   hashText     文本 → 稳定整数（FNV-1a 逐字节，非 ASCII 同样稳定）
//   createRng    播种流：next / range / int
//
// 同一份种子必须永远给出同一条序列 —— 程序化几何、纸纹贴图都依赖这一点。
// 因此实现是冻结的：改算法等于改所有生成的形状。

// 32 位雪崩混合：把任意整数打成统计上均匀的 32 位数。
export function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

// FNV-1a 文本哈希，逐字节喂入每个 UTF-16 码元：中文、emoji 种子同样稳定。
// 结尾混入长度是既定语义，不要删。
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193);
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193);
  }
  return mix32(hash ^ text.length);
}

// mulberry32：返回 { next, range, int }，调用方按需取流。
export function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (length) => Math.floor(next() * length),
  };
}

// 裸函数别名，等价于 createRng(seed).next。
// 保留它是因为调用点普遍是 random() 直呼，没必要为形参改名。
export function seededRandom(seed = 1) {
  return createRng(seed).next;
}

// 区间随机：默认走全局 Math.random；需要可复现就传播种流。
export function range(min, max, random = Math.random) {
  return min + random() * (max - min);
}
