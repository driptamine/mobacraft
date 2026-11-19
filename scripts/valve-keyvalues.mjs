// Text Valve KeyValues (KV1), used by Dota item definitions/localization.
export function parseKeyValues(text) {
  const tokens = []; let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s|\uFEFF/.test(c)) { i++; continue; }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) throw new Error('Unclosed KV comment'); i = end + 2; continue; }
    if (c === '{' || c === '}') { tokens.push(c); i++; continue; }
    if (c === '"') {
      i++; let value = '', closed = false;
      while (i < text.length) {
        const next = text[i++];
        if (next === '"') { closed = true; break; }
        if (next === '\\' && i < text.length) {
          const escaped = text[i++];
          value += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[escaped] ?? ('\\' + escaped);
        } else value += next;
      }
      if (!closed) throw new Error('Unclosed KV string');
      tokens.push({ value }); continue;
    }
    const start = i; while (i < text.length && !/[\s{}]/.test(text[i])) i++;
    tokens.push({ value: text.slice(start, i) });
  }
  let cursor = 0;
  function object(nested = false) {
    const result = Object.create(null);
    while (cursor < tokens.length) {
      const key = tokens[cursor++];
      if (key === '}') { if (!nested) throw new Error('Unexpected KV closing brace'); return result; }
      if (typeof key !== 'object') throw new Error('Missing KV key');
      const value = tokens[cursor++];
      if (value === '{') result[key.value] = object(true);
      else if (typeof value === 'object') result[key.value] = value.value;
      else throw new Error(`Missing KV value for ${key.value}`);
    }
    if (nested) throw new Error('Unclosed KV object');
    return result;
  }
  return object();
}
