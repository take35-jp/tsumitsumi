#!/usr/bin/env node
/* .env の値を「中身を見せずに」フォーマットだけチェックするツール
 * 使い方: node local-tools/check-env.js
 */
const fs = require('fs');
const env = fs.readFileSync('local-tools/.env', 'utf8');

const KEYS = [
  { name: 'SUPABASE_URL',              expectLen: 40, expectPrefix: 'https://' },
  { name: 'SUPABASE_ANON_KEY',         expectLen: 219, expectPrefix: 'eyJh' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', expectLen: 219, expectPrefix: 'eyJh' },
  { name: 'AMAZON_PAAPI_ACCESS_KEY',   expectLen: 20,  expectPrefix: 'AKIA' },
  { name: 'AMAZON_PAAPI_SECRET_KEY',   expectLen: 40,  expectPrefix: null },
  { name: 'AMAZON_PARTNER_TAG',        expectLen: 16,  expectPrefix: 'tsumi' },
  { name: 'AMAZON_MARKETPLACE',        expectLen: 17,  expectPrefix: 'www.' },
  { name: 'AMAZON_PAAPI_APP_ID',       expectLen: 27,  expectPrefix: 'tsumi' },
];

console.log('\n=== .env フォーマット診断 ===\n');
for (const k of KEYS) {
  const m = env.match(new RegExp('^' + k.name + '=(.*)$', 'm'));
  if (!m) {
    console.log('❌', k.name, '→ 未設定');
    continue;
  }
  const v = m[1];
  const okLen    = (v.length === k.expectLen) ? '✓' : (Math.abs(v.length - k.expectLen) <= 3 ? '~' : '✗');
  const okPrefix = !k.expectPrefix || v.startsWith(k.expectPrefix);
  const hasSpace = /\s/.test(v);
  const hasQuote = /["']/.test(v);
  const status = (okLen === '✓' && okPrefix && !hasSpace && !hasQuote) ? '✅' : '⚠️';
  console.log(status, k.name);
  console.log('   length      : ' + v.length + ' (期待: ' + k.expectLen + ') ' + okLen);
  console.log('   first 4     : "' + v.slice(0, 4) + '"' + (k.expectPrefix ? ' (期待: "' + k.expectPrefix + '"...)' : ''));
  console.log('   last 4      : "' + v.slice(-4) + '"');
  console.log('   space混入   : ' + (hasSpace ? '❌ あり' : '✓ なし'));
  console.log('   quote混入   : ' + (hasQuote ? '❌ あり' : '✓ なし'));
  console.log('');
}
