#!/usr/bin/env node
/**
 * budget.mjs — 千星关卡控件预算计算器
 *
 * 千星存档有体积上限，而每个控件都要占体积。做立绘时你会需要几千上万个控件，
 * 所以"还能加多少"和"加了会不会卡"是两个必须提前算的问题，不是导入失败之后再猜。
 *
 * 两个模型都是实测标定的，不是估算：
 *
 *   体积   约 1,020 字节/控件（编辑器口径）。实测标定范围 1,010~1,060：
 *            v0.19  7.77 MiB ÷  7,933 = 1,027 B
 *            v0.20 17.77 MiB ÷ 18,415 = 1,012 B
 *          20 MiB 上限、留 10% 余量 = 18 MiB → 约 18,500 个控件，这就是画质的天花板。
 *
 *   初始化 4 次 UI 桥调用/控件，每帧处理 96 个
 *           → 18,415 控件 = 192 帧 ≈ 3.2 秒 @60fps
 *
 * 用法：
 *   node budget.mjs --controls 18415
 *   node budget.mjs --target-mib 20
 *   node budget.mjs --controls 18415 --sprites klee:4686,dori:6565 --margin 10
 *   node budget.mjs --help
 */

const MIB = 1024 * 1024;

const DEFAULTS = {
  limitMib: 20,
  bytesPerControl: 1020,
  callsPerControl: 4,
  perFrame: 96,
  fps: 60,
  margin: 10,
};

function parseArgs(argv) {
  const o = { ...DEFAULTS, sprites: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--controls') o.controls = Number(next());
    else if (a === '--limit-mib') o.limitMib = Number(next());
    else if (a === '--bytes-per-control') o.bytesPerControl = Number(next());
    else if (a === '--calls-per-control') o.callsPerControl = Number(next());
    else if (a === '--per-frame') o.perFrame = Number(next());
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--margin') o.margin = Number(next());
    else if (a === '--target-mib') o.targetMib = Number(next());
    else if (a === '--sprites') {
      for (const part of next().split(',')) {
        const [name, n] = part.split(':');
        if (name && n) o.sprites.push({ name, blocks: Number(n) });
      }
    } else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function help() {
  console.log(`budget.mjs — 控件预算计算器

  --controls <n>            控件总数
  --target-mib <n>          反过来：给定体积上限，最多能塞多少控件
  --limit-mib <n>           存档上限，默认 ${DEFAULTS.limitMib}
  --bytes-per-control <n>   默认 ${DEFAULTS.bytesPerControl}
  --calls-per-control <n>   每次初始化调用的 UI 桥次数，默认 ${DEFAULTS.callsPerControl}
  --per-frame <n>           每帧处理多少个控件，默认 ${DEFAULTS.perFrame}
  --fps <n>                 默认 ${DEFAULTS.fps}
  --margin <pct>            想保留的体积余量百分比，默认 ${DEFAULTS.margin}
  --sprites a:1234,b:5678   拆开看每个精灵占多少

例：
  node budget.mjs --controls 18415 --sprites klee:4686,dori:6565
`);
}

const o = parseArgs(process.argv.slice(2));
if (o.help) {
  help();
  process.exit(0);
}

const bytesPerControl = o.bytesPerControl;
const limitBytes = o.limitMib * MIB;
const usableBytes = limitBytes * (1 - o.margin / 100);

console.log('\n  模型：%d 字节/控件，上限 %d MiB，保留 %d%% 余量',
  bytesPerControl, o.limitMib, o.margin);

// 反向模式：给定体积，算控件
if (o.targetMib != null) {
  const n = Math.floor((o.targetMib * MIB) / bytesPerControl);
  console.log('\n  %d MiB 可以容纳约 %s 个控件', o.targetMib, n.toLocaleString());
  console.log('  （这相当于 %s 次初始化桥调用，约 %.1f 秒 @%dfps）\n',
    (n * o.callsPerControl).toLocaleString(),
    n / o.perFrame / o.fps,
    o.fps);
  process.exit(0);
}

if (o.controls == null) {
  help();
  process.exit(1);
}

const bytes = o.controls * bytesPerControl;
const mib = bytes / MIB;
const pct = (bytes / limitBytes) * 100;
const headroom = usableBytes - bytes;
const calls = o.controls * o.callsPerControl;
const frames = o.controls / o.perFrame;
const seconds = frames / o.fps;

const bar = (p, width = 34) => {
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
  return '[' + '#'.repeat(filled) + '.'.repeat(width - filled) + ']';
};

console.log('\n  控件数      ' + o.controls.toLocaleString());
console.log('  体积        ' + mib.toFixed(2) + ' MiB  ' + bar(pct) + ' ' + pct.toFixed(1) + '%');
console.log('  桥调用      ' + calls.toLocaleString() + ' 次');
console.log('  初始化      ' + Math.ceil(frames) + ' 帧 ≈ ' + seconds.toFixed(1) + ' 秒');

const verdict =
  pct > 100
    ? '超了。减控件，或者降立绘分辨率。'
    : pct > 90
      ? '太满，导入可能报空间不足。建议再留 8% 以上。'
      : pct > 70
        ? '合理区间。'
        : '还有富余，画质可以再往上加。';
console.log('  判断        ' + verdict);

if (headroom > 0) {
  console.log(
    '  余量        ' + (headroom / MIB).toFixed(2) + ' MiB，还能加约 ' +
      Math.floor(headroom / bytesPerControl).toLocaleString() + ' 个控件'
  );
} else {
  console.log('  余量        已超出 ' + (Math.abs(headroom) / MIB).toFixed(2) + ' MiB');
}

if (o.sprites.length) {
  console.log('\n  精灵拆分');
  const sum = o.sprites.reduce((s, x) => s + x.blocks, 0);
  for (const s of o.sprites) {
    const p = (s.blocks / sum) * 100;
    console.log(
      '    ' + s.name.padEnd(14) + String(s.blocks).padStart(7) + ' 块   ' +
        p.toFixed(1).padStart(5) + '%   约 ' +
        ((s.blocks * bytesPerControl) / MIB).toFixed(2) + ' MiB'
    );
  }
  console.log('    ' + '-'.repeat(48));
  console.log('    合计'.padEnd(15) + String(sum).padStart(7) + ' 块');
}

console.log('');
