const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');

function extractFunction(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = js.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} has a closing brace`);
  return js.slice(start, end + 2);
}

test('preview key changes when markup configuration changes', () => {
  const context = vm.createContext({ JSON });
  vm.runInContext(extractFunction('markupMasterKey'), context);
  const base = { mode: 'rasio', umum: 1.25, nakes: 1.1, mutasi: 1, pembulatan: 0 };
  const changed = { ...base, umum: 1.32 };
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(changed, '', ['umum']));
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(base, 'adem', ['umum']));
  assert.equal(context.markupMasterKey(base, '', ['nakes', 'umum']), context.markupMasterKey(base, '', ['umum', 'nakes']));
});

test('Master markup invalidates stale preview and accumulates actual RPC results', () => {
  assert.match(js, /tandaiPreviewMarkupMasterKotor/);
  assert.match(js, /Nilai berubah\. Klik Pratinjau kembali sebelum menerapkan/);
  assert.match(js, /preview\.textContent = 'Pratinjau'/);
  assert.match(js, /markupMasterKey\(cfgMarkupMaster\(\)/);
  assert.match(js, /hasil\.berubah \+= Number\(r && r\.berubah\)/);
  assert.match(js, /hasil\.dilewati \+= Number\(r && r\.dilewati\)/);
  assert.match(js, /Harga berubah: .*dilewati:/);
});

test('Master markup ignores late responses from an older preview request', () => {
  assert.match(js, /request = \+\+MARKUP_MASTER_PREVIEW_REQUEST/);
  assert.match(js, /if \(request !== MARKUP_MASTER_PREVIEW_REQUEST\) return/);
});
