const fs = require('fs')
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')

const file = path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('/* ============================ pure helpers ============================ */')
const end = source.indexOf('/* ========================== /pure helpers ============================ */')
if (start < 0 || end < 0) throw new Error('helper markers not found')
const helpers = source.slice(start, end)
const factory = new Function(helpers + '\nreturn { analyzeTimestamp, formatLocal, isoFromMs, parseDateTimeInput, parseJson, printJson, escapeString, generateStrings, snippetFor, relativeText, secondsFromMs, localTimeZone, aesRoundKeys, aesEncryptBlock, aesDecryptBlock, aesEncryptBytes, aesDecryptBytes, aesTransform, hexToBytes, bytesToHex, bytesToBase64, base64ToBytes }')
const api = factory()

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    console.error('FAIL  ' + name)
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
}

console.log('TZ=' + process.env.TZ + ' zone=' + api.localTimeZone())
const isShanghai = /Shanghai/.test(api.localTimeZone())
const isNewYork = /New_York/.test(api.localTimeZone())

check('formatLocal epoch in +08:00', () => {
  if (!isShanghai) return
  assert.strictEqual(api.formatLocal(0), '1970-01-01 08:00:00')
  assert.strictEqual(api.formatLocal(1700000000000), '2023-11-15 06:13:20')
})

check('isoFromMs', () => {
  assert.strictEqual(api.isoFromMs(0), '1970-01-01T00:00:00Z')
  assert.strictEqual(api.isoFromMs(1700000000000), '2023-11-14T22:13:20Z')
})

check('analyze seconds vs milliseconds', () => {
  if (!isShanghai) return
  const seconds = api.analyzeTimestamp('1700000000', 'auto')
  assert.ok(seconds.ok)
  assert.strictEqual(seconds.unit, 's')
  assert.strictEqual(seconds.ms, 1700000000000)
  assert.strictEqual(seconds.local, '2023-11-15 06:13:20')

  const millis = api.analyzeTimestamp('1700000000000', 'auto')
  assert.ok(millis.ok)
  assert.strictEqual(millis.unit, 'ms')
  assert.strictEqual(millis.ms, 1700000000000)

  const forcedSeconds = api.analyzeTimestamp('1700000000000', 's')
  assert.strictEqual(forcedSeconds.ok, false)
  assert.strictEqual(forcedSeconds.code, 'out-of-range')
})

check('analyze rejects garbage and out of range', () => {
  assert.strictEqual(api.analyzeTimestamp('', 'auto').code, 'empty')
  assert.strictEqual(api.analyzeTimestamp('12a', 'auto').code, 'invalid-number')
  assert.strictEqual(api.analyzeTimestamp('1'.repeat(17), 'auto').code, 'too-many-digits')
  assert.strictEqual(api.analyzeTimestamp('999999999999999', 'ms').code, 'out-of-range')
  assert.strictEqual(api.analyzeTimestamp('-999999999999999', 'ms').code, 'out-of-range')
})

check('analyze negative timestamp', () => {
  const value = api.analyzeTimestamp('-1', 's')
  assert.ok(value.ok)
  assert.strictEqual(value.ms, -1000)
  if (isShanghai) assert.strictEqual(value.local, '1970-01-01 07:59:59')
  assert.strictEqual(value.iso, '1969-12-31T23:59:59Z')
})

check('parseDateTimeInput local', () => {
  if (!isShanghai) return
  const value = api.parseDateTimeInput('2023-11-15 06:13:20')
  assert.ok(value.ok)
  assert.strictEqual(value.ms, 1700000000000)
  assert.strictEqual(value.seconds, '1700000000')
  assert.strictEqual(value.zoned, false)
})

check('parseDateTimeInput zoned', () => {
  assert.strictEqual(api.parseDateTimeInput('2023-11-14T22:13:20Z').ms, 1700000000000)
  assert.strictEqual(api.parseDateTimeInput('2023-11-15 06:13:20+08:00').ms, 1700000000000)
  assert.strictEqual(api.parseDateTimeInput('2023-11-14 17:13:20-05:00').ms, 1700000000000)
  assert.strictEqual(api.parseDateTimeInput('2023-11-15T06:13:20.123+08:00').ms, 1700000000123)
  if (isShanghai) assert.strictEqual(api.parseDateTimeInput('2023-11-15T06:13').ms, 1699999980000)
})

check('parseDateTimeInput rejects bad values', () => {
  assert.strictEqual(api.parseDateTimeInput('').code, 'empty')
  assert.strictEqual(api.parseDateTimeInput('2023/11/15 06:13:20').code, 'format')
  assert.strictEqual(api.parseDateTimeInput('2023-02-29 00:00:00').code, 'range')
  assert.strictEqual(api.parseDateTimeInput('2023-13-01 00:00:00').code, 'range')
  assert.strictEqual(api.parseDateTimeInput('2023-11-15 24:00:00').code, 'range')
  assert.strictEqual(api.parseDateTimeInput('0000-01-01 00:00:00').code, 'range')
})

check('parseDateTimeInput round trip', () => {
  if (!isShanghai) return
  for (const input of ['2023-11-15 06:13:20', '0001-01-02 12:00:00', '9999-12-30 12:00:00', '2024-02-29 12:34:56']) {
    const value = api.parseDateTimeInput(input)
    assert.ok(value.ok, input + ' should parse')
    assert.strictEqual(api.formatLocal(value.ms), input)
  }
  // Local midnight on 0001-01-02 in a positive offset falls before the UTC floor.
  const tooEarly = api.parseDateTimeInput('0001-01-01 00:00:00')
  assert.strictEqual(tooEarly.ok, false)
  assert.strictEqual(tooEarly.code, 'range')
})

check('parseDateTimeInput rejects DST gap', () => {
  if (!isNewYork) return
  const gap = api.parseDateTimeInput('2024-03-10 02:30:00')
  assert.strictEqual(gap.ok, false)
  assert.strictEqual(gap.code, 'dst')
  assert.ok(api.parseDateTimeInput('2024-11-03 01:30:00').ok)
})

check('parseJson valid values', () => {
  for (const text of ['null', 'true', 'false', '0', '-0', '1.25', '1e10', '-2.5E-3', '"x"', '[]', '{}', '{"a":[1,{"b":null}]}']) {
    const parsed = api.parseJson(text)
    assert.ok(parsed.ok, text + ' should parse: ' + JSON.stringify(parsed.error))
  }
})

check('parseJson rejects invalid values', () => {
  const cases = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['{"a":1,}', 'expected-key'],
    ['{"a" 1}', 'expected-colon'],
    ['{"a":1 "b":2}', 'expected-comma-object'],
    ['[1 2]', 'expected-comma-array'],
    ['{"a":01}', 'invalid-number'],
    ["{'a':1}", 'expected-key'],
    ['{"a":1', 'unexpected-eof'],
    ['{"a":"\\x"}', 'invalid-escape'],
    ['{"a":"\\u12"}', 'invalid-unicode'],
    ['{"a":"line\nbreak"}', 'control-char'],
    ['{"a":1} extra', 'trailing'],
    ['[', 'unexpected-eof'],
    ['{"a":}', 'bad-value'],
  ]
  for (const [text, code] of cases) {
    const parsed = api.parseJson(text)
    assert.strictEqual(parsed.ok, false, text + ' should fail')
    assert.strictEqual(parsed.error.code, code, text + ' expected ' + code + ' got ' + parsed.error.code)
  }
})

check('parseJson reports positions', () => {
  const parsed = api.parseJson('{\n  "a": 1,\n  "b": }')
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, 'bad-value')
  assert.strictEqual(parsed.error.line, 3)
  assert.strictEqual(parsed.error.column, 8)
})

check('parseJson rejects too deep nesting', () => {
  const text = '['.repeat(600) + ']'.repeat(600)
  const parsed = api.parseJson(text)
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, 'too-deep')
})

check('parseJson strips BOM', () => {
  const parsed = api.parseJson('\uFEFF{"a":1}')
  assert.ok(parsed.ok)
})

check('printJson compact matches Gson', () => {
  const parsed = api.parseJson('{"a":1,"b":[true,null,"x<y"],"c":{},"d":[],"e":1.0,"f":1e5}')
  assert.ok(parsed.ok)
  const compact = api.printJson(parsed.ast, { indentUnit: '', gson: true })
  assert.strictEqual(compact, '{"a":1,"b":[true,null,"x\\u003cy"],"c":{},"d":[],"e":1.0,"f":1e5}')
})

check('printJson pretty matches Gson', () => {
  const parsed = api.parseJson('{"a":1,"b":[true,null],"c":{}}')
  assert.ok(parsed.ok)
  const pretty = api.printJson(parsed.ast, { indentUnit: '  ', gson: true })
  assert.strictEqual(
    pretty,
    '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ],\n  "c": {}\n}'
  )
})

check('printJson 4 spaces and tabs', () => {
  const parsed = api.parseJson('{"a":1}')
  assert.strictEqual(api.printJson(parsed.ast, { indentUnit: '    ', gson: true }), '{\n    "a": 1\n}')
  assert.strictEqual(api.printJson(parsed.ast, { indentUnit: '\t', gson: true }), '{\n\t"a": 1\n}')
})

check('escapeString Gson html safe', () => {
  assert.strictEqual(api.escapeString('<> & = \' " \\ \n \t', true), '"\\u003c\\u003e \\u0026 \\u003d \\u0027 \\" \\\\ \\n \\t"')
  assert.strictEqual(api.escapeString('<>', false), '"<>"')
  assert.strictEqual(api.escapeString('\u2028\u2029', false), '"\\u2028\\u2029"')
  assert.strictEqual(api.escapeString('\u0001', false), '"\\u0001"')
})

check('printJson escapes keys', () => {
  const parsed = api.parseJson('{"<k>":1}')
  assert.ok(parsed.ok)
  assert.strictEqual(api.printJson(parsed.ast, { indentUnit: '  ', gson: true }), '{\n  "\\u003ck\\u003e": 1\n}')
})

check('snippetFor marks the error', () => {
  const snip = api.snippetFor('{\n  "a": 1,\n  "b": }', { line: 3, column: 8 })
  assert.strictEqual(snip.line, '  "b": }')
  assert.strictEqual(snip.caret, '       ^')
})

check('snippetFor expands tabs', () => {
  const snip = api.snippetFor('\t"a": }', { line: 1, column: 7 })
  assert.strictEqual(snip.line, '  "a": }')
  assert.strictEqual(snip.caret, '       ^')
})

check('generateStrings length, count and alphabet', () => {
  const items = api.generateStrings({ length: 24, count: 7, upper: true, lower: true, digit: true, requireAll: true })
  assert.strictEqual(items.length, 7)
  for (const item of items) {
    assert.strictEqual(item.length, 24)
    assert.match(item, /^[A-Za-z0-9]+$/)
    assert.match(item, /[A-Z]/)
    assert.match(item, /[a-z]/)
    assert.match(item, /[0-9]/)
  }
})

check('generateStrings respects class toggles', () => {
  const digits = api.generateStrings({ length: 12, count: 3, upper: false, lower: false, digit: true })
  assert.strictEqual(digits.length, 3)
  for (const item of digits) assert.match(item, /^[0-9]+$/)
  assert.deepStrictEqual(api.generateStrings({ length: 8, count: 2, upper: false, lower: false, digit: false }), [])
})

check('generateStrings clamps options', () => {
  const items = api.generateStrings({ length: 999, count: 999, upper: true, lower: false, digit: false })
  assert.strictEqual(items.length, 100)
  assert.strictEqual(items[0].length, 256)
})

check('relativeText', () => {
  const text = api.relativeText(Date.now() - 3 * 86400000, Date.now(), 'en')
  assert.match(text, /3 days ago|3 days/)
  const zh = api.relativeText(Date.now() - 3 * 86400000, Date.now(), 'zh')
  assert.ok(zh.length > 0)
})

check('secondsFromMs trims zeros', () => {
  assert.strictEqual(api.secondsFromMs(1700000000000), '1700000000')
  assert.strictEqual(api.secondsFromMs(1500), '1.5')
  assert.strictEqual(api.secondsFromMs(1), '0.001')
  assert.strictEqual(api.secondsFromMs(0), '0')
})

check('AES block matches the FIPS-197 vector', () => {
  const key = api.hexToBytes('000102030405060708090a0b0c0d0e0f').bytes
  const block = api.hexToBytes('00112233445566778899aabbccddeeff').bytes
  const schedule = api.aesRoundKeys(key)
  assert.strictEqual(schedule.rounds, 10)
  const encrypted = api.aesEncryptBlock(block, schedule)
  assert.strictEqual(api.bytesToHex(encrypted, false), '69c4e0d86a7b0430d8cdb78070b4c55a')
  assert.deepStrictEqual(Array.from(api.aesDecryptBlock(encrypted, schedule)), Array.from(block))
})

check('AES matches Node crypto for every mode and key size', () => {
  const modes = ['ECB', 'CBC', 'CFB', 'OFB', 'CTR']
  for (const keySize of [16, 24, 32]) {
    for (const mode of modes) {
      const key = crypto.randomBytes(keySize)
      const iv = mode === 'ECB' ? null : crypto.randomBytes(16)
      const size = mode === 'ECB' || mode === 'CBC' ? 64 : 71
      const input = crypto.randomBytes(size)
      const algorithm = 'aes-' + keySize * 8 + '-' + mode.toLowerCase()
      const cipher = crypto.createCipheriv(algorithm, key, iv)
      cipher.setAutoPadding(false)
      const expected = Buffer.concat([cipher.update(input), cipher.final()])
      const actual = Buffer.from(
        api.aesEncryptBytes(
          Uint8Array.from(input),
          Uint8Array.from(key),
          iv ? Uint8Array.from(iv) : null,
          mode
        )
      )
      assert.deepStrictEqual(actual, expected, mode + ' ' + keySize * 8 + ' encrypt')
      const decrypted = Buffer.from(
        api.aesDecryptBytes(
          Uint8Array.from(actual),
          Uint8Array.from(key),
          iv ? Uint8Array.from(iv) : null,
          mode
        )
      )
      assert.deepStrictEqual(decrypted, input, mode + ' ' + keySize * 8 + ' decrypt')
    }
  }
})

check('AES base64 helpers round-trip', () => {
  for (const size of [0, 1, 2, 3, 16, 31, 64]) {
    const bytes = Uint8Array.from(crypto.randomBytes(size))
    const parsed = api.base64ToBytes(api.bytesToBase64(bytes))
    assert.ok(parsed.ok)
    assert.deepStrictEqual(Buffer.from(parsed.bytes), Buffer.from(bytes))
  }
})

check('aesTransform round-trips text for every mode and padding', () => {
  const modes = ['ECB', 'CBC', 'CFB', 'OFB', 'CTR']
  const text = '你好，DeepSeek AES toolbox! 🚀'
  const key = api.bytesToHex(crypto.randomBytes(32), false)
  const iv = api.bytesToHex(crypto.randomBytes(16), false)
  for (const mode of modes) {
    for (const padding of ['PKCS7', 'ZeroPadding', 'NoPadding']) {
      const streamMode = mode === 'CFB' || mode === 'OFB' || mode === 'CTR'
      if (streamMode && padding !== 'PKCS7') continue
      const payload = padding === 'NoPadding' ? '0123456789abcdef' : text
      for (const format of ['base64', 'hex']) {
        const encrypted = api.aesTransform({
          direction: 'encrypt',
          text: payload,
          key,
          iv,
          mode,
          padding,
          format,
          hexKey: true,
          upper: true,
        })
        assert.ok(encrypted.ok, mode + '/' + padding + '/' + format + ' encrypt: ' + encrypted.code)
        const decrypted = api.aesTransform({
          direction: 'decrypt',
          text: encrypted.text,
          key,
          iv,
          mode,
          padding,
          format,
          hexKey: true,
        })
        assert.ok(decrypted.ok, mode + '/' + padding + '/' + format + ' decrypt: ' + decrypted.code)
        assert.strictEqual(decrypted.text, payload, mode + '/' + padding + '/' + format)
      }
    }
  }
})

check('aesTransform reports validation codes', () => {
  const base = { direction: 'encrypt', text: 'x', key: 'k'.repeat(16), iv: 'i'.repeat(16), mode: 'CBC', padding: 'PKCS7', format: 'base64' }
  assert.strictEqual(api.aesTransform({ ...base, text: 'x', key: '' }).code, 'key-empty')
  assert.strictEqual(api.aesTransform({ ...base, key: 'short' }).code, 'key-length')
  assert.strictEqual(api.aesTransform({ ...base, text: '' }).code, 'empty-input')
  assert.strictEqual(api.aesTransform({ ...base, hexKey: true, key: 'zz' }).code, 'key-format')
  assert.strictEqual(api.aesTransform({ ...base, iv: 'short' }).code, 'iv-length')
  assert.strictEqual(api.aesTransform({ ...base, padding: 'NoPadding', text: 'abc' }).code, 'plain-length')
  assert.strictEqual(api.aesTransform({ ...base, direction: 'decrypt', text: 'not-base64!!' }).code, 'cipher-format')
  assert.strictEqual(api.aesTransform({ ...base, direction: 'decrypt', text: 'AAAA' }).code, 'cipher-length')
  assert.strictEqual(api.aesTransform({ ...base, direction: 'decrypt', text: '' }).code, 'empty-cipher')
})

check('aesTransform ECB needs no IV and rejects a wrong key', () => {
  const encrypted = api.aesTransform({
    direction: 'encrypt',
    text: 'ecb payload',
    key: 'k'.repeat(16),
    mode: 'ECB',
    padding: 'PKCS7',
    format: 'base64',
  })
  assert.ok(encrypted.ok)
  const wrong = api.aesTransform({
    direction: 'decrypt',
    text: encrypted.text,
    key: 'j'.repeat(16),
    mode: 'ECB',
    padding: 'PKCS7',
    format: 'base64',
  })
  assert.strictEqual(wrong.ok, false)
  assert.ok(['padding', 'cipher-format'].includes(wrong.code), 'unexpected code ' + wrong.code)
})

console.log('\n' + passed + ' checks passed')
if (process.exitCode) process.exit(process.exitCode)
