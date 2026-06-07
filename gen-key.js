// 生成 CRX 签名用的 RSA 私钥
// 用法: npm run gen-key  (生成 key.pem)
//       生成的 key.pem 必须保密，绝不提交到 git
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, 'key.pem');

if (fs.existsSync(KEY_FILE)) {
  console.log('key.pem already exists at ' + KEY_FILE);
  console.log('Delete it first if you want to regenerate.');
  process.exit(0);
}

console.log('Generating 2048-bit RSA private key for CRX3 signing...');
try {
  execSync('openssl genrsa -out "' + KEY_FILE + '" 2048', { stdio: 'inherit' });
  console.log('');
  console.log('Generated: ' + KEY_FILE);
  console.log('KEEP THIS FILE PRIVATE. Do not commit to git (.gitignore already excludes it).');
  console.log('With this key, build.js will produce 115-video-preview.crx ready to install.');
} catch (e) {
  console.error('Failed to generate key. Is openssl installed?');
  console.error('On Windows: install Git for Windows or use WSL.');
  process.exit(1);
}
