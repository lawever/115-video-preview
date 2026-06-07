// 构建脚本
// 用法:
//   npm install              (首次安装依赖)
//   npm run build            (压缩 JS + 打 zip + 条件打 crx)
//   npm run gen-key          (生成 CRX 签名私钥，生成后 build 自动打 crx)
//
// 产物:
//   dist/115-video-preview.zip    (加载用，dev 模式也能用)
//   dist/115-video-preview.crx    (有 key.pem 时才会生成，CRX3 安装包)
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const archiver = require('archiver');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const STAGING = path.join(DIST, '_staging');
const KEY_FILE = path.join(ROOT, 'key.pem');

const ZIP_OUT = path.join(DIST, '115-video-preview.zip');
const CRX_OUT = path.join(DIST, '115-video-preview.crx');

const JS_FILES = [
  ['content/content.js', 'content/content.js'],
  ['background.js',      'background.js'],
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function minifyFile(src, dst) {
  const code = fs.readFileSync(src, 'utf8');
  const result = await minify(code, {
    compress: { passes: 2, drop_console: false },
    mangle: true,
    format: { comments: false },
  });
  fs.writeFileSync(dst, result.code);
  const before = code.length, after = result.code.length;
  const pct = (100 * after / before).toFixed(1);
  console.log('  minify ' + path.relative(ROOT, src) + ': ' + before + ' -> ' + after + ' bytes (' + pct + '%)');
}

function zipDir(srcDir, outFile) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      console.log('  zip     ' + path.relative(ROOT, outFile) + ' (' + archive.pointer() + ' bytes)');
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

async function buildCrx(stagingDir, zipFile, crxFile) {
  if (!fs.existsSync(KEY_FILE)) {
    console.log('  crx     skipped (no key.pem; run: npm run gen-key)');
    return;
  }
  let crx;
  try { crx = require('crx'); }
  catch (e) {
    console.log('  crx     skipped (crx package not installed; npm install)');
    return;
  }
  const builder = new crx({
    privateKey: fs.readFileSync(KEY_FILE),
    codebaseOutput: zipFile,
  });
  await builder.loadStaging(stagingDir);
  const buf = await builder.pack();
  fs.writeFileSync(crxFile, buf);
  console.log('  crx     ' + path.relative(ROOT, crxFile) + ' (' + buf.length + ' bytes)');
}

(async () => {
  console.log('Build start...');
  rmrf(DIST);
  fs.mkdirSync(STAGING, { recursive: true });

  console.log('Copy static files:');
  copyFile(path.join(ROOT, 'manifest.json'), path.join(STAGING, 'manifest.json'));
  copyDir(path.join(ROOT, 'icons'), path.join(STAGING, 'icons'));
  console.log('  manifest.json + icons/');

  console.log('Minify JS:');
  for (const [src, rel] of JS_FILES) {
    await minifyFile(path.join(ROOT, src), path.join(STAGING, rel));
  }

  console.log('Build packages:');
  await zipDir(STAGING, ZIP_OUT);
  await buildCrx(STAGING, ZIP_OUT, CRX_OUT);

  rmrf(STAGING);
  console.log('Build done. Output: ' + path.relative(ROOT, DIST) + '/');
})().catch(e => { console.error(e); process.exit(1); });
