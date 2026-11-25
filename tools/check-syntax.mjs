// 零依赖语法检查：本项目没有打包步骤，构不成 tsc/vite 的检查入口。
// 能做的诚实检查就一条 —— 每个模块都能被 Node 解析为 ES 模块。
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

const files = [...await collect(join(ROOT, 'src')), join(ROOT, 'serve.mjs')];
const failures = [];

for (const file of files) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (error) {
    failures.push(`${file.replace(ROOT, '')}\n${error.stderr ?? error.message}`);
  }
}

if (failures.length) {
  console.error(`语法检查失败 ${failures.length}/${files.length}`);
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`语法检查通过 ${files.length}/${files.length}`);
