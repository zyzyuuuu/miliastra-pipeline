#!/usr/bin/env node
/**
 * compile-sprites.mjs
 *
 * 把带透明通道的 PNG 切成一组彩色矩形，让编辑器能用基础图形控件"画"出原图。
 * 用途：千星沙箱没有"贴一张图"的控件接口，只有矩形 / 圆 / 文本。想显示立绘，
 * 就得自己把图拆成矩形的马赛克，然后用几百上千个 image 控件拼回去。
 *
 * 核心是递归四分：一块区域的颜色方差够小就整块保留，否则对半切开再试。
 * 容差越大、分辨率越低，块数越少，画质越差。这个权衡见 docs/03-精灵编码.md。
 *
 * 用法：
 *   node compile-sprites.mjs --in ./assets --out ./sprites.json \
 *        --spec klee:klee.png:192:38 --spec mora:mora.png:48:28
 *
 * 每个 --spec 是 name:filename:size:tolerance
 *   name       输出 JSON 里的键名
 *   filename   相对 --in 的文件名
 *   size       目标边长（正方形，等比 contain）
 *   tolerance  颜色方差阈值，越小越精细、块数越多
 *
 * 依赖 sharp（可选）：npm i sharp
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { alphaMin: 12, alphaRange: 70 };

function parseArgs(argv) {
  const out = { in: '.', out: 'sprites.json', specs: [], ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--spec') out.specs.push(argv[++i]);
    else if (a === '--alpha-min') out.alphaMin = Number(argv[++i]);
    else if (a === '--alpha-range') out.alphaRange = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`compile-sprites.mjs — PNG 转 UI 矩形

  --in <dir>          图片目录（默认 .）
  --out <file>        输出 JSON（默认 sprites.json）
  --spec k:file:s:t   可重复。name:文件名:边长:容差
  --alpha-min <n>     视为透明的 alpha 上限（默认 ${DEFAULTS.alphaMin}）
  --alpha-range <n>   块内 alpha 极差容忍（默认 ${DEFAULTS.alphaRange}）

例：
  node compile-sprites.mjs --in ./assets --out ./out.json \\
       --spec hero:hero.png:192:38 --spec coin:coin.png:48:28
`);
}

/** 递归四分一块区域，返回矩形列表 [x, y, w, h, r, g, b, a] */
function splitRegion(data, width, height, tolerance, alphaMin, alphaRange) {
  const blocks = [];

  function walk(x, y, w, h) {
    let n = 0;
    const sum = [0, 0, 0, 0];
    const sumSq = [0, 0, 0, 0];
    let lo = 255;
    let hi = 0;

    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const off = (yy * width + xx) * 4;
        const a = data[off + 3];
        if (a < lo) lo = a;
        if (a > hi) hi = a;
        n++;
        for (let k = 0; k < 4; k++) {
          const v = data[off + k];
          sum[k] += v;
          sumSq[k] += v * v;
        }
      }
    }

    // 整块透明，直接丢掉，不产生任何控件
    if (hi < alphaMin) return;

    const avg = sum.map((v) => v / n);
    // 用各通道标准差的最大值作为"这块够不够纯"的判据
    const error = Math.max(
      ...sumSq.map((v, k) => Math.sqrt(Math.max(0, v / n - avg[k] * avg[k])))
    );

    const clean = error <= tolerance && hi - lo <= alphaRange;
    if (clean || (w === 1 && h === 1)) {
      const c = avg.map(Math.round);
      if (c[3] > 10) blocks.push([x, y, w, h, ...c]);
      return;
    }

    // 沿长边切，尽量保持块接近正方形
    if (w >= h && w > 1) {
      const half = Math.floor(w / 2);
      walk(x, y, half, h);
      walk(x + half, y, w - half, h);
    } else if (h > 1) {
      const half = Math.floor(h / 2);
      walk(x, y, w, half);
      walk(x, y + half, w, h - half);
    }
  }

  walk(0, 0, width, height);
  return blocks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.specs.length) {
    console.error('至少给一个 --spec，或者用 --help 看用法。');
    process.exit(1);
  }

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // 有些环境里 sharp 不在当前 node_modules（比如全局装、或者挂在别的运行时下），
    // 用 SHARP_PATH 指到那个目录即可，不用为了一个依赖重装整棵依赖树。
    const alt = process.env.SHARP_PATH;
    if (alt) {
      const { createRequire } = await import('node:module');
      sharp = createRequire(import.meta.url)(alt);
    } else {
      console.error(
        ' 找不到 sharp。两种办法：\n' +
          '   npm i sharp\n' +
          '   或者设环境变量指向已有的 sharp：SHARP_PATH=/path/to/sharp\n'
      );
      process.exit(1);
    }
  }

  const result = {};
  const stats = [];

  for (const spec of args.specs) {
    const [name, file, sizeRaw, tolRaw] = spec.split(':');
    if (!name || !file || !sizeRaw) {
      console.error(`--spec 格式不对：${spec}，应为 name:file:size:tolerance`);
      continue;
    }
    const size = Number(sizeRaw);
    const tolerance = Number(tolRaw ?? 38);
    const filePath = path.join(args.in, file);

    if (!fs.existsSync(filePath)) {
      console.error(`读不到文件：${filePath}`);
      continue;
    }

    const { data, info } = await sharp(filePath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const blocks = splitRegion(
      data,
      info.width,
      info.height,
      tolerance,
      args.alphaMin,
      args.alphaRange
    );

    result[name] = { w: size, h: size, blocks };
    stats.push({ name, size, tolerance, blocks: blocks.length });
  }

  fs.writeFileSync(args.out, JSON.stringify(result));

  // 按实测 1020 字节/控件估算体积，给出预算感受
  const total = stats.reduce((s, x) => s + x.blocks, 0);
  const mib = (total * 1020) / 1024 / 1024;

  console.log('\n  名字          边长   容差   块数');
  console.log('  ' + '-'.repeat(38));
  for (const s of stats) {
    console.log(
      `  ${s.name.padEnd(13)}${String(s.size).padStart(5)}${String(s.tolerance).padStart(7)}${String(s.blocks).padStart(8)}`
    );
  }
  console.log('  ' + '-'.repeat(38));
  console.log(`  合计 ${total} 块，按 1020 B/控件估算约 ${mib.toFixed(1)} MiB`);
  console.log(`  已写入 ${args.out}\n`);
  console.log('  下一步：node budget.mjs --controls ' + total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
