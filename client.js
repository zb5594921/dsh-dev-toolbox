/**
 * Developer Toolbox for DeepSeek Harness.
 *
 * A single sidebar panel bundling three small offline utilities:
 *   - timestamp conversion (seconds / milliseconds -> local + ISO date time)
 *   - Gson-compatible JSON formatting and format validation
 *   - random string generation (uppercase / lowercase / digits)
 *
 * All work happens in the browser. The host half (index.js) is intentionally
 * empty; the panel is mounted through the Web client slot registry.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-dev-toolbox',
  factory(require) {
    'use strict'

    const React = require('react')
    const NS = 'dsh-dev-toolbox'
    const h = React.createElement

    /* ============================ pure helpers ============================ */

    const MAX_JSON_CHARS = 2000000
    const MAX_JSON_DEPTH = 512

    const UPPER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const LOWER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
    const DIGIT_ALPHABET = '0123456789'

    function pad(value, width) {
      let out = String(value)
      while (out.length < width) out = '0' + out
      return out
    }

    function trimZeros(text) {
      if (text.indexOf('.') === -1) return text
      return text.replace(/0+$/, '').replace(/\.$/, '')
    }

    function utcMs(year, month, day, hour, minute, second, millis) {
      const date = new Date(0)
      date.setUTCFullYear(year, month - 1, day)
      date.setUTCHours(hour || 0, minute || 0, second || 0, millis || 0)
      return date.getTime()
    }

    // Keep the supported range inside years 0001..9999 for every time zone, so
    // that local formatting never produces year 0 or a five digit year.
    const MIN_EPOCH_MS = utcMs(1, 1, 2, 0, 0, 0, 0)
    const MAX_EPOCH_MS = utcMs(9999, 12, 30, 23, 59, 59, 999)

    function formatLocal(ms) {
      if (!Number.isFinite(ms)) return ''
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      return (
        pad(date.getFullYear(), 4) +
        '-' + pad(date.getMonth() + 1, 2) +
        '-' + pad(date.getDate(), 2) +
        ' ' + pad(date.getHours(), 2) +
        ':' + pad(date.getMinutes(), 2) +
        ':' + pad(date.getSeconds(), 2)
      )
    }

    function isoFromMs(ms) {
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      return (
        pad(date.getUTCFullYear(), 4) +
        '-' + pad(date.getUTCMonth() + 1, 2) +
        '-' + pad(date.getUTCDate(), 2) +
        'T' + pad(date.getUTCHours(), 2) +
        ':' + pad(date.getUTCMinutes(), 2) +
        ':' + pad(date.getUTCSeconds(), 2) +
        'Z'
      )
    }

    function secondsFromMs(ms) {
      return trimZeros((ms / 1000).toFixed(3))
    }

    function localTimeZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      } catch (error) {
        return ''
      }
    }

    function analyzeTimestamp(raw, unit) {
      const text = String(raw == null ? '' : raw).trim()
      if (!text) return { ok: false, code: 'empty' }
      if (!/^[+-]?\d+$/.test(text)) return { ok: false, code: 'invalid-number' }
      if (text.replace(/^[+-]/, '').length > 16) return { ok: false, code: 'too-many-digits' }
      const value = Number(text)
      if (!Number.isFinite(value)) return { ok: false, code: 'invalid-number' }
      let resolved = unit === 's' || unit === 'ms' ? unit : 'auto'
      if (resolved === 'auto') resolved = Math.abs(value) >= 100000000000 ? 'ms' : 's'
      const ms = resolved === 's' ? value * 1000 : value
      if (!Number.isFinite(ms) || ms < MIN_EPOCH_MS || ms > MAX_EPOCH_MS) {
        return { ok: false, code: 'out-of-range' }
      }
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return { ok: false, code: 'out-of-range' }
      return {
        ok: true,
        unit: resolved,
        ms,
        seconds: resolved === 's' ? String(value) : secondsFromMs(ms),
        local: formatLocal(ms),
        iso: isoFromMs(ms),
      }
    }

    function daysInMonth(year, month) {
      const date = new Date(0)
      date.setUTCFullYear(year, month, 0)
      return date.getUTCDate()
    }

    function parseDateTimeInput(text) {
      const source = String(text == null ? '' : text).trim()
      if (!source) return { ok: false, code: 'empty' }
      const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(source)
      if (!match) return { ok: false, code: 'format' }

      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const hour = Number(match[4])
      const minute = Number(match[5])
      const second = match[6] === undefined ? 0 : Number(match[6])
      const millis = match[7] === undefined ? 0 : Number((match[7] + '000').slice(0, 3))
      const zone = match[8]

      if (year < 1 || year > 9999) return { ok: false, code: 'range' }
      if (month < 1 || month > 12) return { ok: false, code: 'range' }
      if (day < 1 || day > daysInMonth(year, month)) return { ok: false, code: 'range' }
      if (hour > 23 || minute > 59 || second > 59) return { ok: false, code: 'range' }

      let ms
      let zoned = false
      if (zone !== undefined) {
        let offsetMinutes = 0
        if (zone !== 'Z') {
          const hours = Number(zone.slice(1, 3))
          const minutes = Number(zone.slice(4, 6))
          if (hours > 14 || minutes > 59) return { ok: false, code: 'range' }
          offsetMinutes = (zone.charAt(0) === '-' ? -1 : 1) * (hours * 60 + minutes)
        }
        ms = utcMs(year, month, day, hour, minute, second, millis) - offsetMinutes * 60000
        zoned = true
      } else {
        const date = new Date(2000, month - 1, day, hour, minute, second, millis)
        date.setFullYear(year)
        ms = date.getTime()
        if (
          date.getFullYear() !== year ||
          date.getMonth() !== month - 1 ||
          date.getDate() !== day ||
          date.getHours() !== hour ||
          date.getMinutes() !== minute ||
          date.getSeconds() !== second ||
          date.getMilliseconds() !== millis
        ) {
          return { ok: false, code: 'dst' }
        }
      }

      if (!Number.isFinite(ms)) return { ok: false, code: 'range' }
      if (ms < MIN_EPOCH_MS || ms > MAX_EPOCH_MS) return { ok: false, code: 'range' }
      return { ok: true, ms, seconds: secondsFromMs(ms), zoned }
    }

    function relativeParts(ms, now) {
      const diff = ms - now
      const abs = Math.abs(diff)
      if (abs < 45000) return { value: Math.round(diff / 1000), unit: 'second' }
      if (abs < 2700000) return { value: Math.round(diff / 60000), unit: 'minute' }
      if (abs < 79200000) return { value: Math.round(diff / 3600000), unit: 'hour' }
      if (abs < 2246400000) return { value: Math.round(diff / 86400000), unit: 'day' }
      if (abs < 27648000000) return { value: Math.round(diff / 2592000000), unit: 'month' }
      return { value: Math.round(diff / 31557600000), unit: 'year' }
    }

    function relativeText(ms, now, locale) {
      const parts = relativeParts(ms, now)
      try {
        const formatter = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' })
        return formatter.format(parts.value, parts.unit)
      } catch (error) {
        return ''
      }
    }

    function hex4(code) {
      return ('000' + code.toString(16)).slice(-4)
    }

    function escapeString(value, gson) {
      let out = '"'
      for (let index = 0; index < value.length; index += 1) {
        const ch = value.charAt(index)
        const code = value.charCodeAt(index)
        if (ch === '"') out += '\\"'
        else if (ch === '\\') out += '\\\\'
        else if (code === 8) out += '\\b'
        else if (code === 9) out += '\\t'
        else if (code === 10) out += '\\n'
        else if (code === 12) out += '\\f'
        else if (code === 13) out += '\\r'
        else if (code < 0x20) out += '\\u' + hex4(code)
        else if (code === 0x2028) out += '\\u2028'
        else if (code === 0x2029) out += '\\u2029'
        else if (gson && (ch === '<' || ch === '>' || ch === '&' || ch === '=' || ch === "'")) {
          out += '\\u' + hex4(code)
        } else out += ch
      }
      return out + '"'
    }

    function printJson(node, options) {
      const settings = options || {}
      const indentUnit = typeof settings.indentUnit === 'string' ? settings.indentUnit : '  '
      const gson = settings.gson !== false
      const pretty = indentUnit.length > 0
      const parts = []

      function write(current, depth) {
        if (current.type === 'null') {
          parts.push('null')
          return
        }
        if (current.type === 'boolean') {
          parts.push(current.value ? 'true' : 'false')
          return
        }
        if (current.type === 'number') {
          parts.push(current.raw)
          return
        }
        if (current.type === 'string') {
          parts.push(escapeString(current.value, gson))
          return
        }
        if (current.type === 'array') {
          if (current.items.length === 0) {
            parts.push('[]')
            return
          }
          if (!pretty) {
            parts.push('[')
            for (let index = 0; index < current.items.length; index += 1) {
              if (index > 0) parts.push(',')
              write(current.items[index], depth + 1)
            }
            parts.push(']')
            return
          }
          parts.push('[\n')
          for (let index = 0; index < current.items.length; index += 1) {
            if (index > 0) parts.push(',\n')
            parts.push(indentUnit.repeat(depth + 1))
            write(current.items[index], depth + 1)
          }
          parts.push('\n' + indentUnit.repeat(depth) + ']')
          return
        }
        if (current.members.length === 0) {
          parts.push('{}')
          return
        }
        if (!pretty) {
          parts.push('{')
          for (let index = 0; index < current.members.length; index += 1) {
            if (index > 0) parts.push(',')
            const member = current.members[index]
            parts.push(escapeString(member.key, gson), ':', '')
            write(member.value, depth + 1)
          }
          parts.push('}')
          return
        }
        parts.push('{\n')
        for (let index = 0; index < current.members.length; index += 1) {
          if (index > 0) parts.push(',\n')
          const member = current.members[index]
          parts.push(indentUnit.repeat(depth + 1), escapeString(member.key, gson), ': ')
          write(member.value, depth + 1)
        }
        parts.push('\n' + indentUnit.repeat(depth) + '}')
      }

      write(node, 0)
      return parts.join('')
    }

    function locate(text, index) {
      let line = 1
      let column = 1
      const end = Math.min(Math.max(index, 0), text.length)
      for (let cursor = 0; cursor < end; cursor += 1) {
        if (text.charCodeAt(cursor) === 10) {
          line += 1
          column = 1
        } else {
          column += 1
        }
      }
      return { line, column }
    }

    function parseJson(source) {
      const text = String(source == null ? '' : source).replace(/^\uFEFF/, '')
      let cursor = 0
      const length = text.length
      let depth = 0

      function fail(code, index) {
        const position = locate(text, index)
        const error = new Error('JSON parse error: ' + code + ' at ' + position.line + ':' + position.column)
        error.code = code
        error.index = index
        error.line = position.line
        error.column = position.column
        throw error
      }

      function skipWhitespace() {
        while (cursor < length) {
          const code = text.charCodeAt(cursor)
          if (code === 32 || code === 9 || code === 10 || code === 13) cursor += 1
          else break
        }
      }

      function parseString() {
        cursor += 1
        let out = ''
        while (true) {
          if (cursor >= length) fail('unterminated-string', cursor)
          const ch = text.charAt(cursor)
          const code = text.charCodeAt(cursor)
          if (ch === '"') {
            cursor += 1
            return out
          }
          if (ch === '\\') {
            cursor += 1
            if (cursor >= length) fail('unterminated-string', cursor)
            const escaped = text.charAt(cursor)
            if (escaped === '"') out += '"'
            else if (escaped === '\\') out += '\\'
            else if (escaped === '/') out += '/'
            else if (escaped === 'b') out += '\b'
            else if (escaped === 'f') out += '\f'
            else if (escaped === 'n') out += '\n'
            else if (escaped === 'r') out += '\r'
            else if (escaped === 't') out += '\t'
            else if (escaped === 'u') {
              const hex = text.slice(cursor + 1, cursor + 5)
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid-unicode', cursor)
              out += String.fromCharCode(parseInt(hex, 16))
              cursor += 4
            } else fail('invalid-escape', cursor)
            cursor += 1
            continue
          }
          if (code < 0x20) fail('control-char', cursor)
          out += ch
          cursor += 1
        }
      }

      function isDigit(ch) {
        return ch >= '0' && ch <= '9'
      }

      function parseNumber() {
        const start = cursor
        if (text.charAt(cursor) === '-') cursor += 1
        if (cursor >= length) fail('invalid-number', cursor)
        if (text.charAt(cursor) === '0') {
          cursor += 1
          if (isDigit(text.charAt(cursor))) fail('invalid-number', cursor)
        } else if (text.charAt(cursor) >= '1' && text.charAt(cursor) <= '9') {
          cursor += 1
          while (isDigit(text.charAt(cursor))) cursor += 1
        } else {
          fail('invalid-number', cursor)
        }
        if (text.charAt(cursor) === '.') {
          cursor += 1
          if (!isDigit(text.charAt(cursor))) fail('invalid-number', cursor)
          while (isDigit(text.charAt(cursor))) cursor += 1
        }
        const exponent = text.charAt(cursor)
        if (exponent === 'e' || exponent === 'E') {
          cursor += 1
          const sign = text.charAt(cursor)
          if (sign === '+' || sign === '-') cursor += 1
          if (!isDigit(text.charAt(cursor))) fail('invalid-number', cursor)
          while (isDigit(text.charAt(cursor))) cursor += 1
        }
        return { type: 'number', raw: text.slice(start, cursor) }
      }

      function parseObject() {
        cursor += 1
        depth += 1
        if (depth > MAX_JSON_DEPTH) fail('too-deep', cursor)
        const members = []
        skipWhitespace()
        if (text.charAt(cursor) === '}') {
          cursor += 1
          depth -= 1
          return { type: 'object', members }
        }
        while (true) {
          skipWhitespace()
          if (text.charAt(cursor) !== '"') fail('expected-key', cursor)
          const key = parseString()
          skipWhitespace()
          if (text.charAt(cursor) !== ':') fail('expected-colon', cursor)
          cursor += 1
          const value = parseValue()
          members.push({ key, value })
          skipWhitespace()
          const ch = text.charAt(cursor)
          if (ch === ',') {
            cursor += 1
            continue
          }
          if (ch === '}') {
            cursor += 1
            depth -= 1
            return { type: 'object', members }
          }
          if (cursor >= length) fail('unexpected-eof', cursor)
          fail('expected-comma-object', cursor)
        }
      }

      function parseArray() {
        cursor += 1
        depth += 1
        if (depth > MAX_JSON_DEPTH) fail('too-deep', cursor)
        const items = []
        skipWhitespace()
        if (text.charAt(cursor) === ']') {
          cursor += 1
          depth -= 1
          return { type: 'array', items }
        }
        while (true) {
          items.push(parseValue())
          skipWhitespace()
          const ch = text.charAt(cursor)
          if (ch === ',') {
            cursor += 1
            continue
          }
          if (ch === ']') {
            cursor += 1
            depth -= 1
            return { type: 'array', items }
          }
          if (cursor >= length) fail('unexpected-eof', cursor)
          fail('expected-comma-array', cursor)
        }
      }

      function parseValue() {
        skipWhitespace()
        if (cursor >= length) fail('unexpected-eof', cursor)
        const ch = text.charAt(cursor)
        if (ch === '{') return parseObject()
        if (ch === '[') return parseArray()
        if (ch === '"') return { type: 'string', value: parseString() }
        if (ch === '-' || isDigit(ch)) return parseNumber()
        if (ch === 't' && text.startsWith('true', cursor)) {
          cursor += 4
          return { type: 'boolean', value: true }
        }
        if (ch === 'f' && text.startsWith('false', cursor)) {
          cursor += 5
          return { type: 'boolean', value: false }
        }
        if (ch === 'n' && text.startsWith('null', cursor)) {
          cursor += 4
          return { type: 'null' }
        }
        fail('bad-value', cursor)
      }

      try {
        if (text.trim() === '') fail('empty', 0)
        const ast = parseValue()
        skipWhitespace()
        if (cursor < length) fail('trailing', cursor)
        return { ok: true, ast }
      } catch (error) {
        if (error && typeof error.code === 'string') return { ok: false, error }
        return { ok: false, error: { code: 'unknown', index: 0, line: 1, column: 1 } }
      }
    }

    function snippetFor(source, error) {
      const lines = String(source == null ? '' : source).split(/\r?\n/)
      const raw = lines[(error.line || 1) - 1] || ''
      const expanded = raw.replace(/\t/g, '  ')
      const before = raw.slice(0, Math.max(0, (error.column || 1) - 1))
      const caretAt = before.replace(/\t/g, '  ').length
      let start = 0
      if (expanded.length > 200) start = Math.max(0, caretAt - 80)
      const visible = expanded.slice(start, start + 200)
      const caret = Math.max(0, Math.min(visible.length, caretAt - start))
      const prefix = start > 0 ? '…' : ''
      const suffix = start + 200 < expanded.length ? '…' : ''
      return {
        line: prefix + visible + suffix,
        caret: ' '.repeat(caret + (prefix ? 1 : 0)) + '^',
      }
    }

    function randomIndex(max) {
      if (!(max > 0)) return 0
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
          const limit = Math.floor(4294967296 / max) * max
          const buffer = new Uint32Array(1)
          let value
          do {
            crypto.getRandomValues(buffer)
            value = buffer[0]
          } while (value >= limit)
          return value % max
        }
      } catch (error) {
        // Fall through to Math.random when the crypto API is unavailable.
      }
      return Math.floor(Math.random() * max)
    }

    function randomChar(alphabet) {
      return alphabet.charAt(randomIndex(alphabet.length))
    }

    function generateStrings(options) {
      const settings = options || {}
      const length = Math.max(1, Math.min(256, Number(settings.length) || 1))
      const count = Math.max(1, Math.min(100, Number(settings.count) || 1))
      const classes = []
      if (settings.upper) classes.push(UPPER_ALPHABET)
      if (settings.lower) classes.push(LOWER_ALPHABET)
      if (settings.digit) classes.push(DIGIT_ALPHABET)
      if (classes.length === 0) return []
      const alphabet = classes.join('')
      const requireAll = Boolean(settings.requireAll) && length >= classes.length
      const result = []
      for (let index = 0; index < count; index += 1) {
        const chars = []
        if (requireAll) {
          for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
            chars.push(randomChar(classes[classIndex]))
          }
        }
        while (chars.length < length) chars.push(randomChar(alphabet))
        for (let position = chars.length - 1; position > 0; position -= 1) {
          const swap = randomIndex(position + 1)
          const tmp = chars[position]
          chars[position] = chars[swap]
          chars[swap] = tmp
        }
        result.push(chars.join(''))
      }
      return result
    }

    /* ------------------------------- AES -------------------------------- */

    const AES_BLOCK = 16
    const AES_MODES = ['CBC', 'ECB', 'CFB', 'OFB', 'CTR']
    const AES_PADDINGS = ['PKCS7', 'ZeroPadding', 'NoPadding']
    const AES_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const AES_MAX_CHARS = 2000000

    let aesTableCache = null

    function aesRotateLeft8(value, shift) {
      return ((value << shift) | (value >>> (8 - shift))) & 0xff
    }

    function aesTables() {
      if (aesTableCache) return aesTableCache
      const sbox = new Uint8Array(256)
      const inv = new Uint8Array(256)
      let p = 1
      let q = 1
      do {
        p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xff
        if (q & 0x80) q ^= 0x09
        const x =
          q ^ aesRotateLeft8(q, 1) ^ aesRotateLeft8(q, 2) ^ aesRotateLeft8(q, 3) ^ aesRotateLeft8(q, 4)
        sbox[p] = (x ^ 0x63) & 0xff
      } while (p !== 1)
      sbox[0] = 0x63
      for (let index = 0; index < 256; index += 1) inv[sbox[index]] = index
      aesTableCache = { sbox, inv }
      return aesTableCache
    }

    function aesMultiply(a, b) {
      let result = 0
      let left = a
      let right = b
      while (right) {
        if (right & 1) result ^= left
        left = ((left << 1) ^ (left & 0x80 ? 0x1b : 0)) & 0xff
        right >>= 1
      }
      return result
    }

    function aesSubWord(word, box) {
      return (
        ((box[word >>> 24] << 24) |
          (box[(word >>> 16) & 0xff] << 16) |
          (box[(word >>> 8) & 0xff] << 8) |
          box[word & 0xff]) >>>
        0
      )
    }

    function aesRoundKeys(key) {
      const tables = aesTables()
      const nk = key.length >> 2
      const rounds = nk + 6
      const words = new Uint32Array(4 * (rounds + 1))
      for (let index = 0; index < nk; index += 1) {
        words[index] =
          ((key[index * 4] << 24) |
            (key[index * 4 + 1] << 16) |
            (key[index * 4 + 2] << 8) |
            key[index * 4 + 3]) >>>
          0
      }
      let rcon = 1
      for (let index = nk; index < words.length; index += 1) {
        let temp = words[index - 1]
        if (index % nk === 0) {
          temp = ((temp << 8) | (temp >>> 24)) >>> 0
          temp = (aesSubWord(temp, tables.sbox) ^ (rcon << 24)) >>> 0
          rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff
        } else if (nk > 6 && index % nk === 4) {
          temp = aesSubWord(temp, tables.sbox)
        }
        words[index] = (words[index - nk] ^ temp) >>> 0
      }
      const bytes = new Uint8Array(words.length * 4)
      for (let index = 0; index < words.length; index += 1) {
        bytes[index * 4] = (words[index] >>> 24) & 0xff
        bytes[index * 4 + 1] = (words[index] >>> 16) & 0xff
        bytes[index * 4 + 2] = (words[index] >>> 8) & 0xff
        bytes[index * 4 + 3] = words[index] & 0xff
      }
      return { bytes, rounds }
    }

    function aesAddRoundKey(state, keys, offset) {
      for (let index = 0; index < AES_BLOCK; index += 1) state[index] ^= keys[offset + index]
    }

    function aesSubBytes(state, box) {
      for (let index = 0; index < AES_BLOCK; index += 1) state[index] = box[state[index]]
    }

    function aesShiftRows(state) {
      const copy = Uint8Array.from(state)
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          state[column * 4 + row] = copy[((column + row) & 3) * 4 + row]
        }
      }
    }

    function aesInverseShiftRows(state) {
      const copy = Uint8Array.from(state)
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          state[column * 4 + row] = copy[((column - row + 4) & 3) * 4 + row]
        }
      }
    }

    function aesMixColumns(state) {
      for (let column = 0; column < 4; column += 1) {
        const offset = column * 4
        const a0 = state[offset]
        const a1 = state[offset + 1]
        const a2 = state[offset + 2]
        const a3 = state[offset + 3]
        state[offset] = aesMultiply(a0, 2) ^ aesMultiply(a1, 3) ^ a2 ^ a3
        state[offset + 1] = a0 ^ aesMultiply(a1, 2) ^ aesMultiply(a2, 3) ^ a3
        state[offset + 2] = a0 ^ a1 ^ aesMultiply(a2, 2) ^ aesMultiply(a3, 3)
        state[offset + 3] = aesMultiply(a0, 3) ^ a1 ^ a2 ^ aesMultiply(a3, 2)
      }
    }

    function aesInverseMixColumns(state) {
      for (let column = 0; column < 4; column += 1) {
        const offset = column * 4
        const a0 = state[offset]
        const a1 = state[offset + 1]
        const a2 = state[offset + 2]
        const a3 = state[offset + 3]
        state[offset] =
          aesMultiply(a0, 14) ^ aesMultiply(a1, 11) ^ aesMultiply(a2, 13) ^ aesMultiply(a3, 9)
        state[offset + 1] =
          aesMultiply(a0, 9) ^ aesMultiply(a1, 14) ^ aesMultiply(a2, 11) ^ aesMultiply(a3, 13)
        state[offset + 2] =
          aesMultiply(a0, 13) ^ aesMultiply(a1, 9) ^ aesMultiply(a2, 14) ^ aesMultiply(a3, 11)
        state[offset + 3] =
          aesMultiply(a0, 11) ^ aesMultiply(a1, 13) ^ aesMultiply(a2, 9) ^ aesMultiply(a3, 14)
      }
    }

    function aesEncryptBlock(block, schedule) {
      const tables = aesTables()
      const state = Uint8Array.from(block)
      aesAddRoundKey(state, schedule.bytes, 0)
      for (let round = 1; round < schedule.rounds; round += 1) {
        aesSubBytes(state, tables.sbox)
        aesShiftRows(state)
        aesMixColumns(state)
        aesAddRoundKey(state, schedule.bytes, round * AES_BLOCK)
      }
      aesSubBytes(state, tables.sbox)
      aesShiftRows(state)
      aesAddRoundKey(state, schedule.bytes, schedule.rounds * AES_BLOCK)
      return state
    }

    function aesDecryptBlock(block, schedule) {
      const tables = aesTables()
      const state = Uint8Array.from(block)
      aesAddRoundKey(state, schedule.bytes, schedule.rounds * AES_BLOCK)
      for (let round = schedule.rounds - 1; round >= 1; round -= 1) {
        aesInverseShiftRows(state)
        aesSubBytes(state, tables.inv)
        aesAddRoundKey(state, schedule.bytes, round * AES_BLOCK)
        aesInverseMixColumns(state)
      }
      aesInverseShiftRows(state)
      aesSubBytes(state, tables.inv)
      aesAddRoundKey(state, schedule.bytes, 0)
      return state
    }

    function aesIncrementCounter(counter) {
      for (let index = counter.length - 1; index >= 0; index -= 1) {
        counter[index] = (counter[index] + 1) & 0xff
        if (counter[index] !== 0) return
      }
    }

    function aesCryptBytes(input, key, iv, mode, decrypting) {
      const schedule = aesRoundKeys(key)
      const output = new Uint8Array(input.length)
      if (mode === 'ECB') {
        for (let offset = 0; offset < input.length; offset += AES_BLOCK) {
          const block = input.subarray(offset, offset + AES_BLOCK)
          const result = decrypting ? aesDecryptBlock(block, schedule) : aesEncryptBlock(block, schedule)
          output.set(result, offset)
        }
        return output
      }
      if (mode === 'CBC') {
        let previous = iv.slice()
        for (let offset = 0; offset < input.length; offset += AES_BLOCK) {
          const block = input.subarray(offset, offset + AES_BLOCK)
          if (decrypting) {
            const result = aesDecryptBlock(block, schedule)
            for (let index = 0; index < AES_BLOCK; index += 1) {
              output[offset + index] = result[index] ^ previous[index]
            }
            previous = Uint8Array.from(block)
          } else {
            const mixed = new Uint8Array(AES_BLOCK)
            for (let index = 0; index < AES_BLOCK; index += 1) mixed[index] = block[index] ^ previous[index]
            const result = aesEncryptBlock(mixed, schedule)
            output.set(result, offset)
            previous = result
          }
        }
        return output
      }
      let feedback = iv.slice()
      const counter = iv.slice()
      for (let offset = 0; offset < input.length; offset += AES_BLOCK) {
        let stream
        if (mode === 'CTR') {
          stream = aesEncryptBlock(counter, schedule)
          aesIncrementCounter(counter)
        } else {
          stream = aesEncryptBlock(feedback, schedule)
        }
        const limit = Math.min(AES_BLOCK, input.length - offset)
        for (let index = 0; index < limit; index += 1) {
          output[offset + index] = input[offset + index] ^ stream[index]
        }
        if (mode === 'OFB') feedback = stream
        if (mode === 'CFB') {
          const next = new Uint8Array(AES_BLOCK)
          next.set(input.subarray(offset, offset + limit))
          feedback = decrypting ? next : Uint8Array.from(output.subarray(offset, offset + limit))
          if (feedback.length !== AES_BLOCK) {
            const padded = new Uint8Array(AES_BLOCK)
            padded.set(feedback)
            feedback = padded
          }
        }
      }
      return output
    }

    function aesEncryptBytes(plain, key, iv, mode) {
      return aesCryptBytes(plain, key, iv, mode, false)
    }

    function aesDecryptBytes(cipher, key, iv, mode) {
      return aesCryptBytes(cipher, key, iv, mode, true)
    }

    function aesPad(bytes, padding) {
      if (padding === 'NoPadding') {
        if (bytes.length % AES_BLOCK !== 0) return { ok: false, code: 'plain-length' }
        return { ok: true, bytes }
      }
      if (padding === 'ZeroPadding') {
        const rest = bytes.length % AES_BLOCK
        if (rest === 0) return { ok: true, bytes }
        const padded = new Uint8Array(bytes.length + AES_BLOCK - rest)
        padded.set(bytes)
        return { ok: true, bytes: padded }
      }
      const amount = AES_BLOCK - (bytes.length % AES_BLOCK)
      const padded = new Uint8Array(bytes.length + amount)
      padded.set(bytes)
      padded.fill(amount, bytes.length)
      return { ok: true, bytes: padded }
    }

    function aesUnpad(bytes, padding) {
      if (padding === 'NoPadding') return { ok: true, bytes }
      if (padding === 'ZeroPadding') {
        let end = bytes.length
        while (end > 0 && bytes[end - 1] === 0) end -= 1
        return { ok: true, bytes: bytes.subarray(0, end) }
      }
      if (bytes.length === 0) return { ok: false, code: 'padding' }
      const amount = bytes[bytes.length - 1]
      if (amount < 1 || amount > AES_BLOCK || amount > bytes.length) return { ok: false, code: 'padding' }
      for (let index = bytes.length - amount; index < bytes.length; index += 1) {
        if (bytes[index] !== amount) return { ok: false, code: 'padding' }
      }
      return { ok: true, bytes: bytes.subarray(0, bytes.length - amount) }
    }

    function aesUtf8Encode(text) {
      return new TextEncoder().encode(text)
    }

    function aesUtf8Decode(bytes) {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    }

    function bytesToHex(bytes, upper) {
      const digits = upper ? '0123456789ABCDEF' : '0123456789abcdef'
      let out = ''
      for (let index = 0; index < bytes.length; index += 1) {
        out += digits.charAt(bytes[index] >> 4) + digits.charAt(bytes[index] & 15)
      }
      return out
    }

    function hexToBytes(text) {
      const clean = String(text == null ? '' : text).replace(/[\s:-]/g, '')
      if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return { ok: false }
      const bytes = new Uint8Array(clean.length / 2)
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16)
      }
      return { ok: true, bytes }
    }

    function bytesToBase64(bytes) {
      let out = ''
      for (let index = 0; index < bytes.length; index += 3) {
        const a = bytes[index]
        const b = index + 1 < bytes.length ? bytes[index + 1] : 0
        const c = index + 2 < bytes.length ? bytes[index + 2] : 0
        out += AES_B64.charAt(a >> 2)
        out += AES_B64.charAt(((a & 3) << 4) | (b >> 4))
        out += index + 1 < bytes.length ? AES_B64.charAt(((b & 15) << 2) | (c >> 6)) : '='
        out += index + 2 < bytes.length ? AES_B64.charAt(c & 63) : '='
      }
      return out
    }

    function base64ToBytes(text) {
      const clean = String(text == null ? '' : text)
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return { ok: false }
      const body = clean.replace(/=+$/, '')
      if (body.length % 4 === 1) return { ok: false }
      const bytes = []
      for (let index = 0; index < body.length; index += 4) {
        const c0 = AES_B64.indexOf(body.charAt(index))
        const c1 = AES_B64.indexOf(body.charAt(index + 1))
        const c2 = index + 2 < body.length ? AES_B64.indexOf(body.charAt(index + 2)) : -1
        const c3 = index + 3 < body.length ? AES_B64.indexOf(body.charAt(index + 3)) : -1
        if (c0 < 0 || c1 < 0) return { ok: false }
        bytes.push((c0 << 2) | (c1 >> 4))
        if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2))
        if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3)
      }
      return { ok: true, bytes: Uint8Array.from(bytes) }
    }

    function aesParseKey(text, hexMode) {
      const raw = String(text == null ? '' : text)
      if (!raw.trim()) return { ok: false, code: 'key-empty' }
      let bytes
      if (hexMode) {
        const parsed = hexToBytes(raw)
        if (!parsed.ok) return { ok: false, code: 'key-format' }
        bytes = parsed.bytes
      } else {
        bytes = aesUtf8Encode(raw)
      }
      if (bytes.length !== 16 && bytes.length !== 24 && bytes.length !== 32) {
        return { ok: false, code: 'key-length' }
      }
      return { ok: true, bytes }
    }

    function aesParseIv(text, hexMode) {
      const raw = String(text == null ? '' : text)
      const bytes = hexMode ? hexToBytes(raw) : { ok: true, bytes: aesUtf8Encode(raw) }
      if (!bytes.ok) return { ok: false, code: 'iv-format' }
      if (bytes.bytes.length !== AES_BLOCK) return { ok: false, code: 'iv-length' }
      return { ok: true, bytes: bytes.bytes }
    }

    function aesTransform(options) {
      const settings = options || {}
      const direction = settings.direction === 'decrypt' ? 'decrypt' : 'encrypt'
      const mode = AES_MODES.indexOf(settings.mode) >= 0 ? settings.mode : 'CBC'
      const padding = AES_PADDINGS.indexOf(settings.padding) >= 0 ? settings.padding : 'PKCS7'
      const format = settings.format === 'hex' ? 'hex' : 'base64'
      const hexKey = Boolean(settings.hexKey)
      const streamMode = mode === 'CFB' || mode === 'OFB' || mode === 'CTR'
      const text = String(settings.text == null ? '' : settings.text)
      if (!text) return { ok: false, code: direction === 'encrypt' ? 'empty-input' : 'empty-cipher' }
      if (text.length > AES_MAX_CHARS) return { ok: false, code: 'too-large' }
      const keyInfo = aesParseKey(settings.key, hexKey)
      if (!keyInfo.ok) return keyInfo
      let iv = null
      if (mode !== 'ECB') {
        const ivInfo = aesParseIv(settings.iv, hexKey)
        if (!ivInfo.ok) return ivInfo
        iv = ivInfo.bytes
      }
      if (direction === 'encrypt') {
        let bytes = aesUtf8Encode(text)
        if (!streamMode) {
          const padded = aesPad(bytes, padding)
          if (!padded.ok) return padded
          bytes = padded.bytes
        }
        const cipher = aesEncryptBytes(bytes, keyInfo.bytes, iv, mode)
        return {
          ok: true,
          text: format === 'hex' ? bytesToHex(cipher, settings.upper !== false) : bytesToBase64(cipher),
          bytes: cipher.length,
        }
      }
      let cipherBytes
      if (format === 'hex') {
        const parsed = hexToBytes(text)
        if (!parsed.ok) return { ok: false, code: 'cipher-format' }
        cipherBytes = parsed.bytes
      } else {
        const parsed = base64ToBytes(text)
        if (!parsed.ok) return { ok: false, code: 'cipher-format' }
        cipherBytes = parsed.bytes
      }
      if (cipherBytes.length === 0) return { ok: false, code: 'empty-cipher' }
      if (!streamMode && cipherBytes.length % AES_BLOCK !== 0) {
        return { ok: false, code: 'cipher-length' }
      }
      let plain = aesDecryptBytes(cipherBytes, keyInfo.bytes, iv, mode)
      if (!streamMode) {
        const unpadded = aesUnpad(plain, padding)
        if (!unpadded.ok) return unpadded
        plain = unpadded.bytes
      }
      return { ok: true, text: aesUtf8Decode(plain), bytes: plain.length }
    }

    function aesRandomBytes(length) {
      const bytes = new Uint8Array(length)
      try {
        if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
          crypto.getRandomValues(bytes)
          return bytes
        }
      } catch (error) {
        // Fall through to Math.random when the crypto API is unavailable.
      }
      for (let index = 0; index < length; index += 1) bytes[index] = randomIndex(256)
      return bytes
    }

    function aesRandomText(length) {
      const generated = generateStrings({
        length,
        count: 1,
        upper: true,
        lower: true,
        digit: true,
        requireAll: true,
      })
      return generated.length ? generated[0] : ''
    }

    /* ========================== /pure helpers ============================ */

    const SAMPLE_JSON =
      '{"id":1001,"name":"DeepSeek <Harness> & toolbox","tags":["dsh","gson","toolbox"],' +
      '"enabled":true,"score":98.5,"meta":{"owner":"z","createdAt":"2026-11-12T10:06:53+08:00"},' +
      '"empty":{},"list":[],"note":"it\'s ready"}'

    const DICTS = {
      en: {
        title: 'Developer Toolbox',
        subtitle: 'Convert timestamps, format JSON, generate random strings and encrypt with AES.',
        'tab.time': 'Timestamp',
        'tab.json': 'JSON / Gson',
        'tab.aes': 'AES',
        'tab.random': 'Random string',
        'footer.local': 'Everything runs locally in your browser. Nothing is uploaded.',

        'copy': 'Copy',
        'copy.done': 'Copied',
        'copy.failed': 'Copy failed',

        'time.title': 'Timestamp → date time',
        'time.desc': 'Seconds and milliseconds are detected automatically; a unit can also be forced.',
        'time.input': 'Timestamp',
        'time.placeholder': 'e.g. 1700000000 or 1700000000000',
        'time.unit': 'Unit',
        'time.unit.auto': 'Auto',
        'time.unit.s': 'Seconds (s)',
        'time.unit.ms': 'Milliseconds (ms)',
        'time.now': 'Now',
        'time.local': 'Local time',
        'time.iso': 'ISO 8601 (UTC)',
        'time.seconds': 'Unix seconds',
        'time.millis': 'Unix milliseconds',
        'time.relative': 'Relative',
        'time.detected.s': 'Detected: seconds',
        'time.detected.ms': 'Detected: milliseconds',
        'time.empty': 'Enter a timestamp to convert',
        'time.invalid': 'Use digits only (an optional leading minus sign is allowed)',
        'time.tooManyDigits': 'Too many digits to convert safely (16 max)',
        'time.outOfRange': 'Out of range (0001-01-01 to 9999-12-31)',

        'time.reverseTitle': 'Date time → timestamp',
        'time.reverseDesc': 'Parsed in the browser local time zone; append Z or +08:00 to be explicit.',
        'time.reversePlaceholder': 'yyyy-MM-dd HH:mm:ss',
        'time.reverseFormat': 'Expected format: yyyy-MM-dd HH:mm:ss',
        'time.reverseRange': 'That date or time is outside the valid range',
        'time.reverseDst': 'This local time does not exist (daylight saving gap); add an explicit offset',
        'time.reverseZoned': 'Parsed using the time zone in the text',
        'time.reverseHint': 'Enter a date time to get its Unix timestamp',

        'json.title': 'JSON formatting & validation',
        'json.desc': 'Gson-compatible output: 2-space indent, a space after colons and HTML-safe escaping.',
        'json.input': 'Input',
        'json.output': 'Output',
        'json.inputPlaceholder': 'Paste JSON, for example {"a":1}',
        'json.outputPlaceholder': 'Formatted output appears here',
        'json.format': 'Format',
        'json.validate': 'Validate',
        'json.minify': 'Minify',
        'json.sample': 'Sample',
        'json.clear': 'Clear',
        'json.indent': 'Indent',
        'json.indent2': '2 spaces',
        'json.indent4': '4 spaces',
        'json.indentTab': 'Tab',
        'json.gson': 'Gson escaping',
        'json.gsonTip': 'On: matches Gson defaults, escaping < > & = \' as \\uXXXX. Off: only JSON-required escapes.',
        'json.auto': 'Auto format',
        'json.idle': 'Waiting for input',
        'json.ok': 'Valid JSON',
        'json.valid': 'Valid JSON, but not standard format',
        'json.standard': 'Valid JSON, already standard format',
        'json.formatted': 'Formatted',
        'json.minified': 'Minified',
        'json.invalid': 'Invalid JSON',
        'json.outputEmpty': 'Nothing to show yet',
        'json.stat': '{lines} lines · {chars} chars',
        'json.chars': '{n} chars',
        'json.position': 'Line {line}, column {column}',
        'json.err.unknown': 'Could not parse this JSON',
        'json.err.empty': 'Paste or type JSON first',
        'json.err.expectedKey': 'Object keys must be double-quoted strings',
        'json.err.expectedColon': 'Missing colon between a key and its value',
        'json.err.expectedCommaObject': 'Missing comma between members, or the object is not closed',
        'json.err.expectedCommaArray': 'Missing comma between elements, or the array is not closed',
        'json.err.badValue': 'Unrecognized value: strings must use double quotes',
        'json.err.unexpectedEof': 'The JSON ended unexpectedly; a bracket may be missing',
        'json.err.invalidNumber': 'Invalid number format',
        'json.err.unterminatedString': 'A string is missing its closing quote',
        'json.err.invalidEscape': 'A string contains an invalid escape sequence',
        'json.err.invalidUnicode': 'Invalid Unicode escape; 4 hex digits are required',
        'json.err.controlChar': 'A string contains an unescaped control character',
        'json.err.tooDeep': 'Nesting exceeds 512 levels',
        'json.err.tooLarge': 'Content is too large to parse',
        'json.err.trailing': 'Unexpected content after the JSON value',

        'aes.title': 'AES encrypt / decrypt',
        'aes.desc': 'AES-128/192/256 with CBC, ECB, CFB, OFB and CTR; the key length picks the variant.',
        'aes.plain': 'Plaintext',
        'aes.cipher': 'Ciphertext',
        'aes.plainPlaceholder': 'Text to encrypt (UTF-8)',
        'aes.cipherPlaceholder': 'Base64 or hex ciphertext to decrypt',
        'aes.mode': 'Mode',
        'aes.padding': 'Padding',
        'aes.format': 'Output',
        'aes.options': 'Options',
        'aes.format.base64': 'Base64',
        'aes.format.hex': 'Hex',
        'aes.upper': 'Uppercase hex',
        'aes.key': 'Key',
        'aes.keyPlaceholder': '16, 24 or 32 bytes',
        'aes.keySize': 'Key length',
        'aes.iv': 'IV',
        'aes.ivPlaceholder': '16 bytes',
        'aes.ivUnused': 'ECB does not use an IV',
        'aes.generate': 'Generate',
        'aes.hexKey': 'Hex key / IV',
        'aes.encrypt': 'Encrypt',
        'aes.decrypt': 'Decrypt',
        'aes.swap': 'Swap',
        'aes.clear': 'Clear',
        'aes.idle': 'Ready',
        'aes.failed': 'Failed',
        'aes.ready': 'Enter text, then encrypt or decrypt',
        'aes.encrypted': 'Encrypted · {n} bytes → {m} chars',
        'aes.decrypted': 'Decrypted · {n} bytes',
        'aes.variant': 'AES-{bits}',
        'aes.stream': 'CFB/OFB/CTR ignore padding',
        'aes.err.keyEmpty': 'Enter a key',
        'aes.err.keyFormat': 'The key is not valid hex',
        'aes.err.keyLength': 'The key must be 16, 24 or 32 bytes (AES-128/192/256)',
        'aes.err.ivFormat': 'The IV is not valid hex',
        'aes.err.ivLength': 'The IV must be 16 bytes',
        'aes.err.emptyInput': 'Enter plaintext to encrypt',
        'aes.err.emptyCipher': 'Enter ciphertext to decrypt',
        'aes.err.cipherFormat': 'Ciphertext is not valid Base64 or hex',
        'aes.err.cipherLength': 'Ciphertext must be a whole number of 16-byte blocks',
        'aes.err.plainLength': 'NoPadding needs plaintext that is a multiple of 16 bytes',
        'aes.err.padding': 'Padding is invalid — check the key, IV, mode and padding',
        'aes.err.tooLarge': 'Input is too large to transform',

        'random.title': 'Random string generator',
        'random.desc': 'Uses the system crypto source. Pick character classes and set length and count.',
        'random.upper': 'Uppercase',
        'random.lower': 'Lowercase',
        'random.digit': 'Digits',
        'random.length': 'Length',
        'random.count': 'Count',
        'random.mixed': 'Every string contains all selected classes',
        'random.mixedShort': 'Length is smaller than the number of selected classes',
        'random.generate': 'Generate',
        'random.copyAll': 'Copy all',
        'random.total': '{n} chars',
        'random.empty': 'No strings generated yet',
        'random.errClasses': 'Select at least one character class',
        'random.output': 'Generated strings',
      },
      zh: {
        title: '开发者工具箱',
        subtitle: '时间戳转换、JSON 格式化、随机字符串与 AES 加解密，一处搞定。',
        'tab.time': '时间戳',
        'tab.json': 'JSON / Gson',
        'tab.aes': 'AES 加解密',
        'tab.random': '随机字符串',
        'footer.local': '所有处理都在本地浏览器内完成，不会上传任何内容。',

        'copy': '复制',
        'copy.done': '已复制',
        'copy.failed': '复制失败',

        'time.title': '时间戳 → 日期时间',
        'time.desc': '自动识别秒与毫秒，也可以手动指定单位。',
        'time.input': '时间戳',
        'time.placeholder': '例如 1700000000 或 1700000000000',
        'time.unit': '单位',
        'time.unit.auto': '自动识别',
        'time.unit.s': '秒 (s)',
        'time.unit.ms': '毫秒 (ms)',
        'time.now': '当前时间',
        'time.local': '本地时间',
        'time.iso': 'ISO 8601 (UTC)',
        'time.seconds': 'Unix 秒',
        'time.millis': 'Unix 毫秒',
        'time.relative': '相对当前',
        'time.detected.s': '识别为秒',
        'time.detected.ms': '识别为毫秒',
        'time.empty': '请输入要转换的时间戳',
        'time.invalid': '请输入纯数字（允许开头带负号）',
        'time.tooManyDigits': '数字位数过多，无法安全转换（最多 16 位）',
        'time.outOfRange': '超出可转换范围（0001-01-01 至 9999-12-31）',

        'time.reverseTitle': '日期时间 → 时间戳',
        'time.reverseDesc': '按浏览器本地时区解析；也可以在末尾加 Z 或 +08:00 指定时区。',
        'time.reversePlaceholder': 'yyyy-MM-dd HH:mm:ss',
        'time.reverseFormat': '格式应为 yyyy-MM-dd HH:mm:ss',
        'time.reverseRange': '日期或时间不在有效范围内',
        'time.reverseDst': '该本地时间不存在（夏令时跳变），请附加明确的时区偏移',
        'time.reverseZoned': '已按文本中的时区解析',
        'time.reverseHint': '输入日期时间以换算为时间戳',

        'json.title': 'JSON 格式化与校验',
        'json.desc': '输出与 Gson 默认风格一致：2 空格缩进、冒号后空格、HTML 安全转义。',
        'json.input': '输入',
        'json.output': '输出',
        'json.inputPlaceholder': '粘贴 JSON，例如 {"a":1}',
        'json.outputPlaceholder': '格式化结果会显示在这里',
        'json.format': '格式化',
        'json.validate': '校验格式',
        'json.minify': '压缩',
        'json.sample': '示例',
        'json.clear': '清空',
        'json.indent': '缩进',
        'json.indent2': '2 空格',
        'json.indent4': '4 空格',
        'json.indentTab': 'Tab',
        'json.gson': 'Gson 转义',
        'json.gsonTip': '开启：与 Gson 默认输出一致，将 < > & = \' 转义为 \\uXXXX；关闭：仅保留 JSON 必需转义。',
        'json.auto': '自动格式化',
        'json.idle': '等待输入',
        'json.ok': 'JSON 合法',
        'json.valid': 'JSON 合法，但格式未标准化',
        'json.standard': 'JSON 合法，且已是标准格式',
        'json.formatted': '已格式化',
        'json.minified': '已压缩',
        'json.invalid': 'JSON 不合法',
        'json.outputEmpty': '暂无内容',
        'json.stat': '{lines} 行 · {chars} 字符',
        'json.chars': '{n} 字符',
        'json.position': '第 {line} 行 · 第 {column} 列',
        'json.err.unknown': '无法解析该 JSON',
        'json.err.empty': '请先粘贴或输入 JSON',
        'json.err.expectedKey': '对象的键必须是双引号字符串',
        'json.err.expectedColon': '键与值之间缺少冒号',
        'json.err.expectedCommaObject': '对象成员之间缺少逗号，或对象未闭合',
        'json.err.expectedCommaArray': '数组元素之间缺少逗号，或数组未闭合',
        'json.err.badValue': '无法识别的值：字符串必须使用双引号',
        'json.err.unexpectedEof': 'JSON 意外结束，可能缺少括号',
        'json.err.invalidNumber': '数字格式不合法',
        'json.err.unterminatedString': '字符串缺少结束引号',
        'json.err.invalidEscape': '字符串中包含无效的转义字符',
        'json.err.invalidUnicode': '无效的 Unicode 转义，需要 4 位十六进制',
        'json.err.controlChar': '字符串中包含未转义的控制字符',
        'json.err.tooDeep': '嵌套层级超过 512 层',
        'json.err.tooLarge': '内容过大，已停止解析',
        'json.err.trailing': 'JSON 结束后仍有多余内容',

        'aes.title': 'AES 加密 / 解密',
        'aes.desc': '支持 AES-128/192/256 与 CBC、ECB、CFB、OFB、CTR 模式，按密钥字节数自动选择强度。',
        'aes.plain': '明文',
        'aes.cipher': '密文',
        'aes.plainPlaceholder': '输入待加密文本（UTF-8）',
        'aes.cipherPlaceholder': '粘贴 Base64 或十六进制密文以解密',
        'aes.mode': '模式',
        'aes.padding': '填充',
        'aes.format': '输出',
        'aes.options': '选项',
        'aes.format.base64': 'Base64',
        'aes.format.hex': '十六进制',
        'aes.upper': '大写十六进制',
        'aes.key': '密钥',
        'aes.keyPlaceholder': '16、24 或 32 字节',
        'aes.keySize': '密钥长度',
        'aes.iv': '偏移量',
        'aes.ivPlaceholder': '16 字节',
        'aes.ivUnused': 'ECB 模式不使用偏移量',
        'aes.generate': '生成',
        'aes.hexKey': 'Hex 密钥/偏移量',
        'aes.encrypt': '加密',
        'aes.decrypt': '解密',
        'aes.swap': '交换',
        'aes.clear': '清空',
        'aes.idle': '就绪',
        'aes.failed': '失败',
        'aes.ready': '输入内容后执行加密或解密',
        'aes.encrypted': '加密完成 · {n} 字节 → {m} 字符',
        'aes.decrypted': '解密完成 · {n} 字节',
        'aes.variant': 'AES-{bits}',
        'aes.stream': 'CFB/OFB/CTR 不使用填充',
        'aes.err.keyEmpty': '请输入密钥',
        'aes.err.keyFormat': '密钥不是合法的十六进制',
        'aes.err.keyLength': '密钥必须为 16、24 或 32 字节（AES-128/192/256）',
        'aes.err.ivFormat': '偏移量不是合法的十六进制',
        'aes.err.ivLength': '偏移量必须为 16 字节',
        'aes.err.emptyInput': '请输入要加密的明文',
        'aes.err.emptyCipher': '请输入要解密的密文',
        'aes.err.cipherFormat': '密文不是合法的 Base64 或十六进制',
        'aes.err.cipherLength': '密文长度必须是 16 字节的整数倍',
        'aes.err.plainLength': 'NoPadding 要求明文长度为 16 字节的整数倍',
        'aes.err.padding': '填充校验失败，请检查密钥、偏移量、模式与填充方式',
        'aes.err.tooLarge': '内容过大，无法处理',

        'random.title': '随机字符串生成器',
        'random.desc': '使用系统加密随机源；可选择字符类型并自定义长度与数量。',
        'random.upper': '大写字母',
        'random.lower': '小写字母',
        'random.digit': '数字',
        'random.length': '长度',
        'random.count': '数量',
        'random.mixed': '每条都包含全部所选类型',
        'random.mixedShort': '长度小于所选类型数量',
        'random.generate': '生成',
        'random.copyAll': '复制全部',
        'random.total': '共 {n} 个字符',
        'random.empty': '尚未生成字符串',
        'random.errClasses': '请至少选择一种字符类型',
        'random.output': '生成结果',
      },
    }

    const JSON_ERROR_KEYS = {
      'unknown': 'json.err.unknown',
      'empty': 'json.err.empty',
      'expected-key': 'json.err.expectedKey',
      'expected-colon': 'json.err.expectedColon',
      'expected-comma-object': 'json.err.expectedCommaObject',
      'expected-comma-array': 'json.err.expectedCommaArray',
      'bad-value': 'json.err.badValue',
      'unexpected-eof': 'json.err.unexpectedEof',
      'invalid-number': 'json.err.invalidNumber',
      'unterminated-string': 'json.err.unterminatedString',
      'invalid-escape': 'json.err.invalidEscape',
      'invalid-unicode': 'json.err.invalidUnicode',
      'control-char': 'json.err.controlChar',
      'too-deep': 'json.err.tooDeep',
      'too-large': 'json.err.tooLarge',
      'trailing': 'json.err.trailing',
    }

    const AES_ERROR_KEYS = {
      'key-empty': 'aes.err.keyEmpty',
      'key-format': 'aes.err.keyFormat',
      'key-length': 'aes.err.keyLength',
      'iv-format': 'aes.err.ivFormat',
      'iv-length': 'aes.err.ivLength',
      'empty-input': 'aes.err.emptyInput',
      'empty-cipher': 'aes.err.emptyCipher',
      'cipher-format': 'aes.err.cipherFormat',
      'cipher-length': 'aes.err.cipherLength',
      'plain-length': 'aes.err.plainLength',
      'padding': 'aes.err.padding',
      'too-large': 'aes.err.tooLarge',
    }

    const CSS = `
.dtb-root {
  --dtb-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.55;
}
.dtb-root *, .dtb-root *::before, .dtb-root *::after { box-sizing: border-box; }
.dtb-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.dtb-wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 28px 32px 36px; display: flex; flex-direction: column; gap: 18px; }
.dtb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.dtb-head-main { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.dtb-badge { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 11px; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dtb-title { margin: 0; font-size: 21px; line-height: 1.25; font-weight: 650; letter-spacing: -0.015em; }
.dtb-sub { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dtb-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); }
.dtb-tab { border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; line-height: 1; padding: 7px 13px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
.dtb-tab:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dtb-tab[data-active="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); font-weight: 600; }
.dtb-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dtb-panel[hidden] { display: none; }
.dtb-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dtb-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dtb-card-title { margin: 0; font-size: 13.5px; font-weight: 650; letter-spacing: -0.005em; }
.dtb-card-desc { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; max-width: 64ch; }
.dtb-chips { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dtb-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; white-space: nowrap; }
.dtb-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 14px; align-items: start; }
.dtb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dtb-row > .dtb-input { flex: 1 1 160px; }
.dtb-input, .dtb-select, .dtb-textarea { font: inherit; color: inherit; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 10px; min-width: 0; outline: none; }
.dtb-input:hover, .dtb-select:hover, .dtb-textarea:hover { border-color: var(--dsw-alias-border-l2); }
.dtb-input:focus-visible, .dtb-select:focus-visible, .dtb-textarea:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dtb-input-mono { font-family: var(--dtb-mono); font-size: 13px; }
.dtb-input::placeholder, .dtb-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.85; }
.dtb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 550; line-height: 1; white-space: nowrap; padding: 8px 12px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
.dtb-btn:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.dtb-btn:active { transform: translateY(0.5px); }
.dtb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dtb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dtb-btn-primary { background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dtb-btn-primary:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); }
.dtb-btn-quiet { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 8px; font-weight: 500; }
.dtb-btn-quiet:hover { background: var(--dsw-alias-bg-layer-2); border-color: transparent; color: var(--dsw-alias-label-primary); }
.dtb-results { display: flex; flex-direction: column; gap: 8px; }
.dtb-result { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid transparent; min-width: 0; }
.dtb-result-hero { border-color: var(--dsw-alias-border-l1); padding: 11px 12px; }
.dtb-result-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.dtb-result-label { font-size: 11px; color: var(--dsw-alias-label-secondary); letter-spacing: 0.03em; }
.dtb-result-value { font-family: var(--dtb-mono); font-size: 13px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.dtb-result-value-lg { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.dtb-result-hero .dtb-result-value { color: var(--dsw-alias-brand-primary); }
.dtb-hint { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dtb-alert { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border-left: 3px solid var(--dsw-alias-state-error-primary); font-size: 12.5px; }
.dtb-alert-text { color: var(--dsw-alias-label-primary); }
.dtb-alert-pos { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dtb-snippet { margin: 2px 0 0; padding: 8px 10px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; font-family: var(--dtb-mono); font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre; color: var(--dsw-alias-label-secondary); }
.dtb-switches { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.dtb-switch { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
.dtb-switch input, .dtb-check input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.dtb-track { position: relative; width: 30px; height: 17px; border-radius: 99px; background: var(--dsw-alias-border-l2); transition: background 0.15s ease; flex: none; }
.dtb-thumb { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform 0.15s ease, background 0.15s ease; }
.dtb-switch input:checked + .dtb-track { background: var(--dsw-alias-brand-primary); }
.dtb-switch input:checked + .dtb-track .dtb-thumb { transform: translateX(13px); background: var(--dsw-alias-bg-base); }
.dtb-switch input:focus-visible + .dtb-track { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dtb-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dtb-inline .dtb-select { padding: 5px 8px; font-size: 12px; }
.dtb-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dtb-actions-main, .dtb-actions-side { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dtb-json-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.dtb-pane { display: flex; flex-direction: column; min-width: 0; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; }
.dtb-pane-head { display: flex; align-items: center; gap: 10px; padding: 5px 7px 5px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); min-height: 38px; }
.dtb-pane-label { font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.dtb-pane-meta { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dtb-textarea { width: 100%; min-height: 320px; max-height: 52vh; resize: none; border: 0; border-radius: 0; background: transparent; padding: 12px 14px; font-family: var(--dtb-mono); font-size: 12.5px; line-height: 1.65; white-space: pre; overflow: auto; tab-size: 2; }
.dtb-textarea:focus-visible { outline: none; }
.dtb-pre { margin: 0; min-height: 320px; max-height: 52vh; overflow: auto; padding: 12px 14px; font-family: var(--dtb-mono); font-size: 12.5px; line-height: 1.65; white-space: pre; tab-size: 2; }
.dtb-empty { display: flex; align-items: center; justify-content: center; min-height: 320px; padding: 20px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.dtb-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dtb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: none; }
.dtb-status[data-kind="ok"] .dtb-dot, .dtb-status[data-kind="standard"] .dtb-dot, .dtb-status[data-kind="formatted"] .dtb-dot, .dtb-status[data-kind="minified"] .dtb-dot { background: var(--dsw-alias-state-success-primary); }
.dtb-status[data-kind="valid"] .dtb-dot { background: var(--dsw-alias-state-warn-primary); }
.dtb-status[data-kind="error"] .dtb-dot { background: var(--dsw-alias-state-error-primary); }
.dtb-status-strong { color: var(--dsw-alias-label-primary); }
.dtb-status[data-kind="error"] .dtb-status-strong { color: var(--dsw-alias-state-error-primary); }
.dtb-status-sep { opacity: 0.5; }
.dtb-status-meta { font-variant-numeric: tabular-nums; }
.dtb-status-wrap { display: flex; flex-direction: column; gap: 7px; }
.dtb-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; align-items: end; }
.dtb-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dtb-field-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-weight: 550; }
.dtb-field .dtb-input { width: 100%; font-family: var(--dtb-mono); }
.dtb-field-sm { width: 116px; }
.dtb-push { margin-left: auto; }
.dtb-checks { display: flex; gap: 8px; flex-wrap: wrap; }
.dtb-check { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); font-size: 12px; cursor: pointer; user-select: none; }
.dtb-check:hover { border-color: var(--dsw-alias-border-l2); }
.dtb-check-box { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l2); font-size: 10px; line-height: 1; color: var(--dsw-alias-bg-base); background: var(--dsw-alias-bg-base); flex: none; }
.dtb-check input:checked + .dtb-check-box { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dtb-check input:focus-visible + .dtb-check-box { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dtb-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 420px; overflow-y: auto; }
.dtb-line { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 6px; min-width: 0; }
.dtb-line:hover { background: var(--dsw-alias-bg-layer-2); }
.dtb-line-no { width: 26px; flex: none; text-align: right; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dtb-line-text { flex: 1; min-width: 0; font-family: var(--dtb-mono); font-size: 13px; overflow-wrap: anywhere; user-select: all; }
.dtb-foot { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
@media (max-width: 880px) {
  .dtb-wrap { padding: 20px 18px 28px; }
  .dtb-grid, .dtb-json-grid { grid-template-columns: minmax(0, 1fr); }
}
`

    /* ================================ icon =============================== */

    function ClockIcon(props) {
      const size = props && props.size ? props.size : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M7.25 3.5H6.4A2.9 2.9 0 0 0 3.5 6.4v2.1c0 1.1-.6 1.8-1.5 2.1v.8c.9.3 1.5 1 1.5 2.1v2.1a2.9 2.9 0 0 0 2.9 2.9h.85',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M16.75 3.5h.85a2.9 2.9 0 0 1 2.9 2.9v2.1c0 1.1.6 1.8 1.5 2.1v.8c-.9.3-1.5 1-1.5 2.1v2.1a2.9 2.9 0 0 1-2.9 2.9h-.85',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 12, cy: 12, r: 3.6, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', {
          d: 'M12 10.2v2.1l1.4.9',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })
      )
    }

    /* =============================== helpers ============================== */

    function currentLocaleId(ctx) {
      try {
        const info = ctx.locale.getLocale()
        if (info && typeof info.active === 'string') return info.active
      } catch (error) {
        // Ignore and fall back to the browser default locale.
      }
      return ''
    }

    function useLocaleTick(ctx) {
      const state = React.useState(0)
      const setVersion = state[1]
      React.useEffect(() => {
        if (!ctx || !ctx.locale || typeof ctx.locale.subscribe !== 'function') return undefined
        let active = true
        const dispose = ctx.locale.subscribe(() => {
          if (active) setVersion((value) => value + 1)
        })
        return () => {
          active = false
          if (typeof dispose === 'function') dispose()
        }
      }, [ctx])
    }

    function useCopy() {
      const copiedState = React.useState('')
      const failedState = React.useState('')
      const copied = copiedState[0]
      const failed = failedState[0]
      const setCopied = copiedState[1]
      const setFailed = failedState[1]
      const timer = React.useRef(0)

      React.useEffect(() => {
        return () => {
          if (timer.current) clearTimeout(timer.current)
        }
      }, [])

      const copy = React.useCallback((key, text) => {
        const settle = (ok) => {
          setCopied(ok ? key : '')
          setFailed(ok ? '' : key)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            setCopied('')
            setFailed('')
          }, 1400)
        }
        if (!text) return
        let pending = null
        try {
          if (
            typeof navigator !== 'undefined' &&
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === 'function'
          ) {
            pending = navigator.clipboard.writeText(text)
          }
        } catch (error) {
          pending = null
        }
        if (!pending) {
          settle(false)
          return
        }
        pending.then(() => settle(true), () => settle(false))
      }, [])

      return [copied, failed, copy]
    }

    function clampInt(value, min, max, fallback) {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed)) return fallback
      return Math.max(min, Math.min(max, parsed))
    }

    function Toggle(props) {
      return h(
        'label',
        { className: 'dtb-switch', title: props.title },
        h('input', {
          type: 'checkbox',
          checked: Boolean(props.checked),
          onChange: (event) => props.onChange(event.target.checked),
        }),
        h('span', { className: 'dtb-track', 'aria-hidden': 'true' }, h('span', { className: 'dtb-thumb' })),
        h('span', null, props.label)
      )
    }

    function ResultRow(props) {
      const t = props.t
      const isCopied = props.copied === props.copyKey
      const isFailed = props.failed === props.copyKey
      return h(
        'div',
        { className: 'dtb-result' + (props.hero ? ' dtb-result-hero' : '') },
        h(
          'div',
          { className: 'dtb-result-main' },
          h('span', { className: 'dtb-result-label' }, props.label),
          h(
            'span',
            {
              className: 'dtb-result-value' + (props.hero ? ' dtb-result-value-lg' : ''),
              title: props.value,
            },
            props.value
          )
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dtb-btn dtb-btn-quiet',
            disabled: !props.value,
            onClick: () => props.onCopy(props.copyKey, props.value),
            'aria-label': t('copy') + ' ' + props.label,
          },
          isFailed ? t('copy.failed') : isCopied ? t('copy.done') : t('copy')
        )
      )
    }

    /* ============================ time panel ============================= */

    function TimePanel(props) {
      const t = props.t
      const localeId = props.localeId || ''
      const rawState = React.useState(() => String(Date.now()))
      const unitState = React.useState('auto')
      const dateState = React.useState(() => formatLocal(Date.now()))
      const raw = rawState[0]
      const setRaw = rawState[1]
      const unit = unitState[0]
      const setUnit = unitState[1]
      const dateText = dateState[0]
      const setDateText = dateState[1]
      const copiedState = useCopy()
      const copied = copiedState[0]
      const failed = copiedState[1]
      const copy = copiedState[2]
      const now = Date.now()

      const result = React.useMemo(() => analyzeTimestamp(raw, unit), [raw, unit])
      const reversed = React.useMemo(() => parseDateTimeInput(dateText), [dateText])
      const zone = localTimeZone()

      function setNow() {
        const stamp = Date.now()
        setRaw(String(stamp))
        setDateText(formatLocal(stamp))
      }

      let inputBody
      if (result.ok) {
        const relative = relativeText(result.ms, now, localeId)
        inputBody = h(
          'div',
          { className: 'dtb-results' },
          h(ResultRow, {
            t,
            label: t('time.local'),
            value: result.local,
            hero: true,
            copyKey: 'local',
            copied,
            failed,
            onCopy: copy,
          }),
          h(ResultRow, {
            t,
            label: t('time.iso'),
            value: result.iso,
            copyKey: 'iso',
            copied,
            failed,
            onCopy: copy,
          }),
          h(ResultRow, {
            t,
            label: t('time.seconds'),
            value: result.seconds,
            copyKey: 'seconds',
            copied,
            failed,
            onCopy: copy,
          }),
          h(ResultRow, {
            t,
            label: t('time.millis'),
            value: String(result.ms),
            copyKey: 'millis',
            copied,
            failed,
            onCopy: copy,
          }),
          relative
            ? h(ResultRow, {
                t,
                label: t('time.relative'),
                value: relative,
                copyKey: 'relative',
                copied,
                failed,
                onCopy: copy,
              })
            : null
        )
      } else if (result.code === 'empty') {
        inputBody = h('div', { className: 'dtb-hint' }, t('time.empty'))
      } else {
        const errorKey =
          result.code === 'too-many-digits'
            ? 'time.tooManyDigits'
            : result.code === 'out-of-range'
              ? 'time.outOfRange'
              : 'time.invalid'
        inputBody = h(
          'div',
          { className: 'dtb-alert', role: 'alert' },
          h('span', { className: 'dtb-alert-text' }, t(errorKey))
        )
      }

      let reverseBody
      if (reversed.ok) {
        reverseBody = h(
          'div',
          { className: 'dtb-results' },
          h(ResultRow, {
            t,
            label: t('time.millis'),
            value: String(reversed.ms),
            hero: true,
            copyKey: 'rev-millis',
            copied,
            failed,
            onCopy: copy,
          }),
          h(ResultRow, {
            t,
            label: t('time.seconds'),
            value: reversed.seconds,
            copyKey: 'rev-seconds',
            copied,
            failed,
            onCopy: copy,
          }),
          reversed.zoned ? h('div', { className: 'dtb-hint' }, t('time.reverseZoned')) : null
        )
      } else if (reversed.code === 'empty') {
        reverseBody = h('div', { className: 'dtb-hint' }, t('time.reverseHint'))
      } else {
        const errorKey =
          reversed.code === 'format'
            ? 'time.reverseFormat'
            : reversed.code === 'dst'
              ? 'time.reverseDst'
              : 'time.reverseRange'
        reverseBody = h(
          'div',
          { className: 'dtb-alert', role: 'alert' },
          h('span', { className: 'dtb-alert-text' }, t(errorKey))
        )
      }

      return h(
        'div',
        { className: 'dtb-grid' },
        h(
          'section',
          { className: 'dtb-card' },
          h(
            'div',
            { className: 'dtb-card-head' },
            h(
              'div',
              null,
              h('h2', { className: 'dtb-card-title' }, t('time.title')),
              h('p', { className: 'dtb-card-desc' }, t('time.desc'))
            ),
            h(
              'div',
              { className: 'dtb-chips' },
              zone ? h('span', { className: 'dtb-chip' }, zone) : null,
              result.ok
                ? h(
                    'span',
                    { className: 'dtb-chip' },
                    t(result.unit === 's' ? 'time.detected.s' : 'time.detected.ms')
                  )
                : null
            )
          ),
          h(
            'div',
            { className: 'dtb-row' },
            h('input', {
              className: 'dtb-input dtb-input-mono',
              value: raw,
              onChange: (event) => setRaw(event.target.value),
              placeholder: t('time.placeholder'),
              'aria-label': t('time.input'),
              inputMode: 'numeric',
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
            }),
            h(
              'select',
              {
                className: 'dtb-select',
                value: unit,
                onChange: (event) => setUnit(event.target.value),
                'aria-label': t('time.unit'),
              },
              h('option', { value: 'auto' }, t('time.unit.auto')),
              h('option', { value: 's' }, t('time.unit.s')),
              h('option', { value: 'ms' }, t('time.unit.ms'))
            ),
            h('button', { type: 'button', className: 'dtb-btn', onClick: setNow }, t('time.now'))
          ),
          inputBody
        ),
        h(
          'section',
          { className: 'dtb-card' },
          h(
            'div',
            { className: 'dtb-card-head' },
            h(
              'div',
              null,
              h('h2', { className: 'dtb-card-title' }, t('time.reverseTitle')),
              h('p', { className: 'dtb-card-desc' }, t('time.reverseDesc'))
            )
          ),
          h(
            'div',
            { className: 'dtb-row' },
            h('input', {
              className: 'dtb-input dtb-input-mono',
              value: dateText,
              onChange: (event) => setDateText(event.target.value),
              placeholder: t('time.reversePlaceholder'),
              'aria-label': t('time.reverseTitle'),
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
            }),
            h('button', { type: 'button', className: 'dtb-btn', onClick: setNow }, t('time.now'))
          ),
          reverseBody
        )
      )
    }

    /* ============================ json panel ============================= */

    const INITIAL_JSON = (() => {
      const parsed = parseJson(SAMPLE_JSON)
      const formatted = parsed.ok ? printJson(parsed.ast, { indentUnit: '  ', gson: true }) : ''
      return {
        output: formatted,
        status: formatted
          ? { kind: 'ok', chars: formatted.length, lines: formatted.split('\n').length }
          : { kind: 'idle' },
      }
    })()

    function JsonStatus(props) {
      const t = props.t
      const status = props.status
      if (status.kind === 'error') {
        const error = status.error || { code: 'unknown', line: 1, column: 1 }
        const snippet = error.code === 'too-large' ? null : snippetFor(props.source, error)
        return h(
          'div',
          { className: 'dtb-status-wrap' },
          h(
            'div',
            { className: 'dtb-status', 'data-kind': 'error' },
            h('span', { className: 'dtb-dot' }),
            h('span', { className: 'dtb-status-strong' }, t('json.invalid')),
            h('span', { className: 'dtb-status-sep' }, '·'),
            h('span', null, t(JSON_ERROR_KEYS[error.code] || 'json.err.unknown')),
            error.line
              ? h(
                  'span',
                  { className: 'dtb-status-meta' },
                  t('json.position', { line: error.line, column: error.column })
                )
              : null
          ),
          snippet ? h('pre', { className: 'dtb-snippet' }, snippet.line + '\n' + snippet.caret) : null
        )
      }
      const keys = {
        idle: 'json.idle',
        ok: 'json.ok',
        valid: 'json.valid',
        standard: 'json.standard',
        formatted: 'json.formatted',
        minified: 'json.minified',
      }
      const showStat = status.chars != null
      return h(
        'div',
        { className: 'dtb-status', 'data-kind': status.kind },
        h('span', { className: 'dtb-dot' }),
        h('span', { className: 'dtb-status-strong' }, t(keys[status.kind] || 'json.idle')),
        showStat ? h('span', { className: 'dtb-status-sep' }, '·') : null,
        showStat
          ? h('span', { className: 'dtb-status-meta' }, t('json.stat', { lines: status.lines, chars: status.chars }))
          : null
      )
    }

    function JsonPanel(props) {
      const t = props.t
      const inputState = React.useState(SAMPLE_JSON)
      const gsonState = React.useState(true)
      const indentState = React.useState('2')
      const autoState = React.useState(true)
      const outputState = React.useState(INITIAL_JSON.output)
      const statusState = React.useState(INITIAL_JSON.status)
      const copiedState = useCopy()

      const input = inputState[0]
      const setInput = inputState[1]
      const gson = gsonState[0]
      const setGson = gsonState[1]
      const indent = indentState[0]
      const setIndent = indentState[1]
      const auto = autoState[0]
      const setAuto = autoState[1]
      const output = outputState[0]
      const setOutput = outputState[1]
      const status = statusState[0]
      const setStatus = statusState[1]
      const copied = copiedState[0]
      const failed = copiedState[1]
      const copy = copiedState[2]

      const indentUnit = indent === 'tab' ? '\t' : ' '.repeat(indent === '4' ? 4 : 2)

      function format() {
        const source = input
        if (!source.trim()) {
          setStatus({ kind: 'idle' })
          return
        }
        if (source.length > MAX_JSON_CHARS) {
          setStatus({ kind: 'error', error: { code: 'too-large', line: 1, column: 1 } })
          return
        }
        const parsed = parseJson(source)
        if (!parsed.ok) {
          setStatus({ kind: 'error', error: parsed.error })
          return
        }
        const formatted = printJson(parsed.ast, { indentUnit, gson })
        setOutput(formatted)
        setStatus({ kind: 'ok', chars: formatted.length, lines: formatted.split('\n').length })
      }

      function validate() {
        const source = input.trim()
        if (!source) {
          setStatus({ kind: 'idle' })
          return
        }
        if (source.length > MAX_JSON_CHARS) {
          setStatus({ kind: 'error', error: { code: 'too-large', line: 1, column: 1 } })
          return
        }
        const parsed = parseJson(source)
        if (!parsed.ok) {
          setStatus({ kind: 'error', error: parsed.error })
          return
        }
        const standard = printJson(parsed.ast, { indentUnit, gson })
        setStatus({
          kind: source === standard ? 'standard' : 'valid',
          chars: source.length,
          lines: source.split('\n').length,
        })
      }

      function minify() {
        const source = input
        if (!source.trim()) {
          setStatus({ kind: 'idle' })
          return
        }
        if (source.length > MAX_JSON_CHARS) {
          setStatus({ kind: 'error', error: { code: 'too-large', line: 1, column: 1 } })
          return
        }
        const parsed = parseJson(source)
        if (!parsed.ok) {
          setStatus({ kind: 'error', error: parsed.error })
          return
        }
        const compact = printJson(parsed.ast, { indentUnit: '', gson })
        setOutput(compact)
        setStatus({ kind: 'minified', chars: compact.length, lines: 1 })
      }

      function loadSample() {
        setInput(SAMPLE_JSON)
        const parsed = parseJson(SAMPLE_JSON)
        if (!parsed.ok) return
        const formatted = printJson(parsed.ast, { indentUnit, gson })
        setOutput(formatted)
        setStatus({ kind: 'ok', chars: formatted.length, lines: formatted.split('\n').length })
      }

      function clear() {
        setInput('')
        setOutput('')
        setStatus({ kind: 'idle' })
      }

      React.useEffect(() => {
        if (!auto) return undefined
        const source = input
        if (!source.trim()) {
          setStatus({ kind: 'idle' })
          return undefined
        }
        if (source.length > MAX_JSON_CHARS) {
          setStatus({ kind: 'error', error: { code: 'too-large', line: 1, column: 1 } })
          return undefined
        }
        const timer = setTimeout(() => {
          const parsed = parseJson(source)
          if (!parsed.ok) {
            setStatus({ kind: 'error', error: parsed.error })
            return
          }
          const formatted = printJson(parsed.ast, { indentUnit, gson })
          setOutput(formatted)
          setStatus({ kind: 'ok', chars: formatted.length, lines: formatted.split('\n').length })
        }, 280)
        return () => clearTimeout(timer)
      }, [input, auto, gson, indentUnit])

      const copyLabel =
        failed === 'out' ? t('copy.failed') : copied === 'out' ? t('copy.done') : t('copy')

      const inputPane = h(
        'div',
        { className: 'dtb-pane' },
        h(
          'div',
          { className: 'dtb-pane-head' },
          h('span', { className: 'dtb-pane-label' }, t('json.input')),
          h('div', { className: 'dtb-pane-meta' }, h('span', null, t('json.chars', { n: input.length })))
        ),
        h('textarea', {
          className: 'dtb-textarea',
          value: input,
          onChange: (event) => setInput(event.target.value),
          placeholder: t('json.inputPlaceholder'),
          'aria-label': t('json.input'),
          spellCheck: false,
          autoCapitalize: 'off',
          autoCorrect: 'off',
          wrap: 'off',
        })
      )

      const outputPane = h(
        'div',
        { className: 'dtb-pane' },
        h(
          'div',
          { className: 'dtb-pane-head' },
          h('span', { className: 'dtb-pane-label' }, t('json.output')),
          h(
            'div',
            { className: 'dtb-pane-meta' },
            output ? h('span', null, t('json.chars', { n: output.length })) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dtb-btn dtb-btn-quiet',
                disabled: !output,
                onClick: () => copy('out', output),
              },
              copyLabel
            )
          )
        ),
        output
          ? h('pre', { className: 'dtb-pre' }, output)
          : h('div', { className: 'dtb-empty' }, t('json.outputEmpty'))
      )

      return h(
        'section',
        { className: 'dtb-card' },
        h(
          'div',
          { className: 'dtb-card-head' },
          h(
            'div',
            null,
            h('h2', { className: 'dtb-card-title' }, t('json.title')),
            h('p', { className: 'dtb-card-desc' }, t('json.desc'))
          ),
          h(
            'div',
            { className: 'dtb-switches' },
            h(Toggle, {
              checked: gson,
              onChange: setGson,
              label: t('json.gson'),
              title: t('json.gsonTip'),
            }),
            h(Toggle, { checked: auto, onChange: setAuto, label: t('json.auto') }),
            h(
              'label',
              { className: 'dtb-inline' },
              t('json.indent'),
              h(
                'select',
                {
                  className: 'dtb-select',
                  value: indent,
                  onChange: (event) => setIndent(event.target.value),
                  'aria-label': t('json.indent'),
                },
                h('option', { value: '2' }, t('json.indent2')),
                h('option', { value: '4' }, t('json.indent4')),
                h('option', { value: 'tab' }, t('json.indentTab'))
              )
            )
          )
        ),
        h(
          'div',
          { className: 'dtb-actions' },
          h(
            'div',
            { className: 'dtb-actions-main' },
            h('button', { type: 'button', className: 'dtb-btn dtb-btn-primary', onClick: format }, t('json.format')),
            h('button', { type: 'button', className: 'dtb-btn', onClick: validate }, t('json.validate')),
            h('button', { type: 'button', className: 'dtb-btn', onClick: minify }, t('json.minify'))
          ),
          h(
            'div',
            { className: 'dtb-actions-side' },
            h('button', { type: 'button', className: 'dtb-btn dtb-btn-quiet', onClick: loadSample }, t('json.sample')),
            h('button', { type: 'button', className: 'dtb-btn dtb-btn-quiet', onClick: clear }, t('json.clear'))
          )
        ),
        h('div', { className: 'dtb-json-grid' }, inputPane, outputPane),
        h(JsonStatus, { t, status, source: input })
      )
    }

    /* ============================== aes panel ============================= */

    function AesStatus(props) {
      const t = props.t
      const status = props.status
      if (status.kind === 'error') {
        return h(
          'div',
          { className: 'dtb-status', 'data-kind': 'error' },
          h('span', { className: 'dtb-dot' }),
          h('span', { className: 'dtb-status-strong' }, t('aes.failed')),
          h('span', { className: 'dtb-status-sep' }, '·'),
          h('span', null, t(AES_ERROR_KEYS[status.code] || 'aes.err.padding'))
        )
      }
      if (status.kind === 'ok') {
        return h(
          'div',
          { className: 'dtb-status', 'data-kind': 'ok' },
          h('span', { className: 'dtb-dot' }),
          h('span', { className: 'dtb-status-strong' }, status.label)
        )
      }
      return h(
        'div',
        { className: 'dtb-status', 'data-kind': 'idle' },
        h('span', { className: 'dtb-dot' }),
        h('span', { className: 'dtb-status-strong' }, t('aes.idle')),
        h('span', { className: 'dtb-status-sep' }, '·'),
        h('span', null, t('aes.ready'))
      )
    }

    function AesPanel(props) {
      const t = props.t
      const modeState = React.useState('CBC')
      const paddingState = React.useState('PKCS7')
      const formatState = React.useState('base64')
      const upperState = React.useState(true)
      const hexKeysState = React.useState(false)
      const keySizeState = React.useState('16')
      const keyState = React.useState(() => aesRandomText(16))
      const ivState = React.useState(() => aesRandomText(16))
      const inputState = React.useState('')
      const outputState = React.useState('')
      const statusState = React.useState({ kind: 'idle' })
      const copiedState = useCopy()

      const mode = modeState[0]
      const setMode = modeState[1]
      const padding = paddingState[0]
      const setPadding = paddingState[1]
      const format = formatState[0]
      const setFormat = formatState[1]
      const upper = upperState[0]
      const setUpper = upperState[1]
      const hexKeys = hexKeysState[0]
      const setHexKeys = hexKeysState[1]
      const keySize = keySizeState[0]
      const setKeySize = keySizeState[1]
      const keyText = keyState[0]
      const setKeyText = keyState[1]
      const ivText = ivState[0]
      const setIvText = ivState[1]
      const input = inputState[0]
      const setInput = inputState[1]
      const output = outputState[0]
      const setOutput = outputState[1]
      const status = statusState[0]
      const setStatus = statusState[1]
      const copied = copiedState[0]
      const failed = copiedState[1]
      const copy = copiedState[2]

      const streamMode = mode === 'CFB' || mode === 'OFB' || mode === 'CTR'
      const ecbMode = mode === 'ECB'
      const keyInfo = aesParseKey(keyText, hexKeys)
      const bits = keyInfo.ok ? keyInfo.bytes.length * 8 : Number(keySize) * 8

      function generateKey(sizeText) {
        const size = Number(sizeText || keySize)
        setKeySize(String(size))
        setKeyText(hexKeys ? bytesToHex(aesRandomBytes(size), true) : aesRandomText(size))
        resetStatus()
      }

      function generateIv() {
        setIvText(hexKeys ? bytesToHex(aesRandomBytes(16), true) : aesRandomText(16))
        resetStatus()
      }

      function toggleHexKeys(next) {
        if (next === hexKeys) return
        if (next) {
          const keyBytes = aesUtf8Encode(keyText)
          if (keyBytes.length === 16 || keyBytes.length === 24 || keyBytes.length === 32) {
            setKeyText(bytesToHex(keyBytes, true))
          } else {
            setKeyText(bytesToHex(aesRandomBytes(Number(keySize)), true))
          }
          const ivBytes = aesUtf8Encode(ivText)
          if (ivBytes.length === 16) setIvText(bytesToHex(ivBytes, true))
          else setIvText(bytesToHex(aesRandomBytes(16), true))
        } else {
          const parsedKey = hexToBytes(keyText)
          const keyLengthOk =
            parsedKey.ok &&
            (parsedKey.bytes.length === 16 ||
              parsedKey.bytes.length === 24 ||
              parsedKey.bytes.length === 32)
          const decodedKey = keyLengthOk ? aesUtf8Decode(parsedKey.bytes) : ''
          if (keyLengthOk && aesUtf8Encode(decodedKey).length === parsedKey.bytes.length) {
            setKeyText(decodedKey)
          } else {
            setKeyText(aesRandomText(Number(keySize)))
          }
          const parsedIv = hexToBytes(ivText)
          const ivLengthOk = parsedIv.ok && parsedIv.bytes.length === 16
          const decodedIv = ivLengthOk ? aesUtf8Decode(parsedIv.bytes) : ''
          if (ivLengthOk && aesUtf8Encode(decodedIv).length === parsedIv.bytes.length) {
            setIvText(decodedIv)
          } else {
            setIvText(aesRandomText(16))
          }
        }
        setHexKeys(next)
        setStatus({ kind: 'idle' })
      }

      function transform(direction) {
        const result = aesTransform({
          text: direction === 'encrypt' ? input : output || input,
          key: keyText,
          iv: ivText,
          mode,
          padding,
          format,
          hexKey: hexKeys,
          upper,
          direction,
        })
        if (!result.ok) {
          setStatus({ kind: 'error', code: result.code })
          return
        }
        if (direction === 'encrypt') {
          setOutput(result.text)
          setStatus({
            kind: 'ok',
            label: t('aes.encrypted', { n: result.bytes, m: result.text.length }),
          })
        } else {
          setInput(result.text)
          setStatus({ kind: 'ok', label: t('aes.decrypted', { n: result.bytes }) })
        }
      }

      function swap() {
        setInput(output)
        setOutput(input)
        setStatus({ kind: 'idle' })
      }

      function clear() {
        setInput('')
        setOutput('')
        setStatus({ kind: 'idle' })
      }

      function editInput(value) {
        setInput(value)
        setStatus({ kind: 'idle' })
      }

      function editOutput(value) {
        setOutput(value)
        setStatus({ kind: 'idle' })
      }

      function resetStatus() {
        setStatus({ kind: 'idle' })
      }

      const copyLabel =
        failed === 'cipher' ? t('copy.failed') : copied === 'cipher' ? t('copy.done') : t('copy')
      const plainCopyLabel =
        failed === 'plain' ? t('copy.failed') : copied === 'plain' ? t('copy.done') : t('copy')

      function selectField(label, value, onChange, options, disabled) {
        return h(
          'label',
          { className: 'dtb-field' },
          h('span', { className: 'dtb-field-label' }, label),
          h(
            'select',
            {
              className: 'dtb-select',
              value,
              onChange: (event) => onChange(event.target.value),
              'aria-label': label,
              disabled: Boolean(disabled),
            },
            options.map((option) =>
              h('option', { key: option[0], value: option[0] }, option[1])
            )
          )
        )
      }

      const plainPane = h(
        'div',
        { className: 'dtb-pane' },
        h(
          'div',
          { className: 'dtb-pane-head' },
          h('span', { className: 'dtb-pane-label' }, t('aes.plain')),
          h(
            'div',
            { className: 'dtb-pane-meta' },
            h('span', null, t('json.chars', { n: input.length })),
            h(
              'button',
              {
                type: 'button',
                className: 'dtb-btn dtb-btn-quiet',
                disabled: !input,
                onClick: () => copy('plain', input),
              },
              plainCopyLabel
            )
          )
        ),
        h('textarea', {
          className: 'dtb-textarea',
          value: input,
          onChange: (event) => editInput(event.target.value),
          placeholder: t('aes.plainPlaceholder'),
          'aria-label': t('aes.plain'),
          spellCheck: false,
          autoCapitalize: 'off',
          autoCorrect: 'off',
          wrap: 'off',
        })
      )

      const cipherPane = h(
        'div',
        { className: 'dtb-pane' },
        h(
          'div',
          { className: 'dtb-pane-head' },
          h('span', { className: 'dtb-pane-label' }, t('aes.cipher')),
          h(
            'div',
            { className: 'dtb-pane-meta' },
            output ? h('span', null, t('json.chars', { n: output.length })) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dtb-btn dtb-btn-quiet',
                disabled: !output,
                onClick: () => copy('cipher', output),
              },
              copyLabel
            )
          )
        ),
        h('textarea', {
          className: 'dtb-textarea',
          value: output,
          onChange: (event) => editOutput(event.target.value),
          placeholder: t('aes.cipherPlaceholder'),
          'aria-label': t('aes.cipher'),
          spellCheck: false,
          autoCapitalize: 'off',
          autoCorrect: 'off',
          wrap: 'off',
        })
      )

      return h(
        'section',
        { className: 'dtb-card' },
        h(
          'div',
          { className: 'dtb-card-head' },
          h(
            'div',
            null,
            h('h2', { className: 'dtb-card-title' }, t('aes.title')),
            h('p', { className: 'dtb-card-desc' }, t('aes.desc'))
          ),
          h(
            'div',
            { className: 'dtb-chips' },
            h('span', { className: 'dtb-chip' }, t('aes.variant', { bits })),
            h('span', { className: 'dtb-chip' }, 'UTF-8'),
            streamMode ? h('span', { className: 'dtb-chip' }, t('aes.stream')) : null
          )
        ),
        h(
          'div',
          { className: 'dtb-opts' },
          selectField(t('aes.mode'), mode, (value) => {
            setMode(value)
            resetStatus()
          }, AES_MODES.map((value) => [value, value])),
          selectField(
            t('aes.padding'),
            padding,
            (value) => {
              setPadding(value)
              resetStatus()
            },
            AES_PADDINGS.map((value) => [value, value]),
            streamMode
          ),
          selectField(t('aes.format'), format, (value) => {
            setFormat(value)
            resetStatus()
          }, [
            ['base64', t('aes.format.base64')],
            ['hex', t('aes.format.hex')],
          ]),
          h(
            'div',
            { className: 'dtb-field' },
            h('span', { className: 'dtb-field-label' }, t('aes.options')),
            h(
              'div',
              { className: 'dtb-row' },
              format === 'hex'
                ? h(Toggle, {
                    checked: upper,
                    onChange: (value) => {
                      setUpper(value)
                      resetStatus()
                    },
                    label: t('aes.upper'),
                    title: t('aes.upper'),
                  })
                : null,
              h(Toggle, {
                checked: hexKeys,
                onChange: toggleHexKeys,
                label: t('aes.hexKey'),
                title: t('aes.hexKey'),
              })
            )
          )
        ),
        h(
          'div',
          { className: 'dtb-field' },
          h('span', { className: 'dtb-field-label' }, t('aes.key')),
          h(
            'div',
            { className: 'dtb-row' },
            h('input', {
              className: 'dtb-input dtb-input-mono',
              value: keyText,
              onChange: (event) => {
                setKeyText(event.target.value)
                resetStatus()
              },
              placeholder: t('aes.keyPlaceholder'),
              'aria-label': t('aes.key'),
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
            }),
            h(
              'select',
              {
                className: 'dtb-select',
                value: keySize,
                onChange: (event) => generateKey(event.target.value),
                'aria-label': t('aes.keySize'),
              },
              h('option', { value: '16' }, 'AES-128'),
              h('option', { value: '24' }, 'AES-192'),
              h('option', { value: '32' }, 'AES-256')
            ),
            h('button', { type: 'button', className: 'dtb-btn', onClick: () => generateKey(keySize) }, t('aes.generate'))
          )
        ),
        h(
          'div',
          { className: 'dtb-field' },
          h('span', { className: 'dtb-field-label' }, t('aes.iv')),
          h(
            'div',
            { className: 'dtb-row' },
            h('input', {
              className: 'dtb-input dtb-input-mono',
              value: ecbMode ? '' : ivText,
              onChange: (event) => {
                setIvText(event.target.value)
                resetStatus()
              },
              placeholder: ecbMode ? t('aes.ivUnused') : t('aes.ivPlaceholder'),
              'aria-label': t('aes.iv'),
              disabled: ecbMode,
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
            }),
            h(
              'button',
              { type: 'button', className: 'dtb-btn', onClick: generateIv, disabled: ecbMode },
              t('aes.generate')
            )
          )
        ),
        h(
          'div',
          { className: 'dtb-actions' },
          h(
            'div',
            { className: 'dtb-actions-main' },
            h(
              'button',
              { type: 'button', className: 'dtb-btn dtb-btn-primary', onClick: () => transform('encrypt') },
              t('aes.encrypt')
            ),
            h(
              'button',
              { type: 'button', className: 'dtb-btn', onClick: () => transform('decrypt') },
              t('aes.decrypt')
            ),
            h('button', { type: 'button', className: 'dtb-btn', onClick: swap }, t('aes.swap'))
          ),
          h(
            'div',
            { className: 'dtb-actions-side' },
            h('button', { type: 'button', className: 'dtb-btn dtb-btn-quiet', onClick: clear }, t('aes.clear'))
          )
        ),
        h('div', { className: 'dtb-json-grid' }, plainPane, cipherPane),
        h(AesStatus, { t, status })
      )
    }

    /* =========================== random panel ============================ */

    function RandomPanel(props) {
      const t = props.t
      const lengthState = React.useState(16)
      const countState = React.useState(5)
      const upperState = React.useState(true)
      const lowerState = React.useState(true)
      const digitState = React.useState(true)
      const mixedState = React.useState(true)
      const itemsState = React.useState(() =>
        generateStrings({ length: 16, count: 5, upper: true, lower: true, digit: true, requireAll: true })
      )
      const copiedState = useCopy()

      const length = lengthState[0]
      const setLength = lengthState[1]
      const count = countState[0]
      const setCount = countState[1]
      const upper = upperState[0]
      const setUpper = upperState[1]
      const lower = lowerState[0]
      const setLower = lowerState[1]
      const digit = digitState[0]
      const setDigit = digitState[1]
      const mixed = mixedState[0]
      const setMixed = mixedState[1]
      const items = itemsState[0]
      const setItems = itemsState[1]
      const copied = copiedState[0]
      const failed = copiedState[1]
      const copy = copiedState[2]

      const classCount = (upper ? 1 : 0) + (lower ? 1 : 0) + (digit ? 1 : 0)
      const canGenerate = classCount > 0

      function generate() {
        if (!canGenerate) return
        setItems(generateStrings({ length, count, upper, lower, digit, requireAll: mixed }))
      }

      function checkBox(label, checked, onChange) {
        return h(
          'label',
          { className: 'dtb-check' },
          h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
          h('span', { className: 'dtb-check-box', 'aria-hidden': 'true' }, checked ? '✓' : ''),
          h('span', null, label)
        )
      }

      const copyAllLabel =
        failed === 'all' ? t('copy.failed') : copied === 'all' ? t('copy.done') : t('random.copyAll')

      return h(
        'div',
        { className: 'dtb-grid' },
        h(
          'section',
          { className: 'dtb-card' },
          h(
            'div',
            { className: 'dtb-card-head' },
            h(
              'div',
              null,
              h('h2', { className: 'dtb-card-title' }, t('random.title')),
              h('p', { className: 'dtb-card-desc' }, t('random.desc'))
            )
          ),
          h(
            'div',
            { className: 'dtb-checks' },
            checkBox(t('random.upper'), upper, setUpper),
            checkBox(t('random.lower'), lower, setLower),
            checkBox(t('random.digit'), digit, setDigit)
          ),
          h(
            'div',
            { className: 'dtb-row' },
            h(
              'label',
              { className: 'dtb-field dtb-field-sm' },
              h('span', { className: 'dtb-field-label' }, t('random.length')),
              h('input', {
                type: 'number',
                className: 'dtb-input',
                min: 1,
                max: 256,
                value: length,
                onChange: (event) => setLength(clampInt(event.target.value, 1, 256, 1)),
              })
            ),
            h(
              'label',
              { className: 'dtb-field dtb-field-sm' },
              h('span', { className: 'dtb-field-label' }, t('random.count')),
              h('input', {
                type: 'number',
                className: 'dtb-input',
                min: 1,
                max: 100,
                value: count,
                onChange: (event) => setCount(clampInt(event.target.value, 1, 100, 1)),
              })
            ),
            h(Toggle, { checked: mixed, onChange: setMixed, label: t('random.mixed') }),
            h(
              'button',
              {
                type: 'button',
                className: 'dtb-btn dtb-btn-primary dtb-push',
                disabled: !canGenerate,
                onClick: generate,
              },
              t('random.generate')
            )
          ),
          !canGenerate
            ? h(
                'div',
                { className: 'dtb-alert', role: 'alert' },
                h('span', { className: 'dtb-alert-text' }, t('random.errClasses'))
              )
            : null,
          mixed && length < classCount
            ? h('div', { className: 'dtb-hint' }, t('random.mixedShort'))
            : null
        ),
        h(
          'section',
          { className: 'dtb-card' },
          h(
            'div',
            { className: 'dtb-card-head' },
            h('div', null, h('h2', { className: 'dtb-card-title' }, t('random.output'))),
            h(
              'div',
              { className: 'dtb-chips' },
              h(
                'span',
                { className: 'dtb-chip' },
                t('random.total', { n: items.reduce((sum, item) => sum + item.length, 0) })
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dtb-btn',
                  disabled: items.length === 0,
                  onClick: () => copy('all', items.join('\n')),
                },
                copyAllLabel
              )
            )
          ),
          items.length
            ? h(
                'ol',
                { className: 'dtb-lines' },
                items.map((item, index) =>
                  h(
                    'li',
                    { key: index, className: 'dtb-line' },
                    h('span', { className: 'dtb-line-no' }, index + 1),
                    h('code', { className: 'dtb-line-text' }, item),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dtb-btn dtb-btn-quiet',
                        onClick: () => copy(String(index), item),
                      },
                      failed === String(index)
                        ? t('copy.failed')
                        : copied === String(index)
                          ? t('copy.done')
                          : t('copy')
                    )
                  )
                )
              )
            : h('div', { className: 'dtb-hint' }, t('random.empty'))
        )
      )
    }


    /* =============================== sidebar ============================= */

    function SidebarButton(props) {
      return h(ClockIcon, { size: props && props.size ? props.size : 18 })
    }

    /* ================================ plugin ============================= */

    function apply(ctx) {
      const boundT = ctx.locale.bind(NS)

      function ToolboxPage(props) {
        useLocaleTick(ctx)
        const t = props.t || boundT
        const localeId = currentLocaleId(ctx)
        const tabState = React.useState('time')
        const tab = tabState[0]
        const setTab = tabState[1]
        const tabs = [
          ['time', 'tab.time'],
          ['json', 'tab.json'],
          ['aes', 'tab.aes'],
          ['random', 'tab.random'],
        ]

        return h(
          'div',
          { className: 'dtb-root' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h(
            'div',
            { className: 'dtb-scroll' },
            h(
              'div',
              { className: 'dtb-wrap' },
              h(
                'header',
                { className: 'dtb-head' },
                h(
                  'div',
                  { className: 'dtb-head-main' },
                  h('span', { className: 'dtb-badge' }, h(ClockIcon, { size: 20 })),
                  h(
                    'div',
                    null,
                    h('h1', { className: 'dtb-title' }, t('title')),
                    h('p', { className: 'dtb-sub' }, t('subtitle'))
                  )
                ),
                h(
                  'div',
                  { className: 'dtb-tabs', role: 'tablist', 'aria-label': t('title') },
                  tabs.map(([id, key]) =>
                    h(
                      'button',
                      {
                        key: id,
                        type: 'button',
                        role: 'tab',
                        id: 'dtb-tab-' + id,
                        className: 'dtb-tab',
                        'data-active': String(tab === id),
                        'aria-selected': tab === id,
                        'aria-controls': 'dtb-panel-' + id,
                        onClick: () => setTab(id),
                      },
                      t(key)
                    )
                  )
                )
              ),
              h(
                'div',
                {
                  className: 'dtb-panel',
                  id: 'dtb-panel-time',
                  role: 'tabpanel',
                  'aria-labelledby': 'dtb-tab-time',
                  hidden: tab !== 'time',
                },
                h(TimePanel, { t, localeId })
              ),
              h(
                'div',
                {
                  className: 'dtb-panel',
                  id: 'dtb-panel-json',
                  role: 'tabpanel',
                  'aria-labelledby': 'dtb-tab-json',
                  hidden: tab !== 'json',
                },
                h(JsonPanel, { t })
              ),
              h(
                'div',
                {
                  className: 'dtb-panel',
                  id: 'dtb-panel-aes',
                  role: 'tabpanel',
                  'aria-labelledby': 'dtb-tab-aes',
                  hidden: tab !== 'aes',
                },
                h(AesPanel, { t })
              ),
              h(
                'div',
                {
                  className: 'dtb-panel',
                  id: 'dtb-panel-random',
                  role: 'tabpanel',
                  'aria-labelledby': 'dtb-tab-random',
                  hidden: tab !== 'random',
                },
                h(RandomPanel, { t })
              ),
              h(
                'footer',
                { className: 'dtb-foot' },
                h(ClockIcon, { size: 14 }),
                h('span', null, t('footer.local'))
              )
            )
          )
        )
      }

      function registerDictionaries() {
        try {
          const dispose = ctx.locale.register(NS, DICTS)
          return typeof dispose === 'function' ? dispose : () => {}
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[dsh-dev-toolbox] bulk dictionary registration failed; retrying per locale', error)
          }
          const disposers = []
          Object.keys(DICTS).forEach((localeId) => {
            try {
              const dispose = ctx.locale.register(NS, localeId, DICTS[localeId])
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch (nested) {
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('[dsh-dev-toolbox] dictionary registration failed for ' + localeId, nested)
              }
            }
          })
          return () => {
            disposers.forEach((dispose) => dispose())
          }
        }
      }

      ctx.effect(registerDictionaries, 'dsh-dev-toolbox: dictionaries')

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: NS, locale: NS }, ToolboxPage)
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: NS,
            order: 30,
            label: () => boundT('title'),
            locale: NS,
          },
          SidebarButton
        )
      )

      return { ToolboxPage }
    }

    return { name: NS, inject: ['slots', 'locale'], apply }
  },
})
