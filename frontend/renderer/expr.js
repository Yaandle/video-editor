// expr.js — a small, safe maths expression language for plots: y = f(x).
// Parsed to an AST once (never eval'd), evaluated as a pure function.
//
//   numbers, x, pi, e
//   + - * / ^ (right-assoc), unary −, parentheses, implicit products: 2x, 2(x+1), 3pi
//   sin cos tan asin acos atan sinh cosh tanh exp log ln log10 sqrt abs floor ceil sign
//   sigmoid relu softplus, min(a,b) max(a,b) pow(a,b)

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, ln: Math.log,
  log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  sigmoid: (v) => 1 / (1 + Math.exp(-v)), relu: (v) => Math.max(0, v), softplus: (v) => Math.log1p(Math.exp(v)),
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function lex(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/gy;
  let m, i = 0;
  const s = String(src).replace(/σ/g, 'sigmoid').replace(/π/g, 'pi').replace(/·|×/g, '*').replace(/−/g, '-');
  while (i < s.length) {
    re.lastIndex = i;
    m = re.exec(s);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(s.slice(i))) break;          // only trailing whitespace left
      throw new Error(`unexpected "${s[i]}" at ${i}`);
    }
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
    i = re.lastIndex;
  }
  return out;
}

/** Parse to an AST; throws a readable Error on bad input. */
export function parse(src) {
  const tk = lex(src);
  let i = 0;
  const peek = () => tk[i];
  const take = (v) => { const t = tk[i]; if (!t || (v && t.v !== v)) throw new Error(`expected "${v ?? 'value'}"`); i++; return t; };
  const startsAtom = (t) => t && (t.t === 'num' || t.t === 'id' || t.v === '(');
  function primary() {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') { i++; return { k: 'num', v: t.v }; }
    if (t.v === '(') { i++; const e = sum(); take(')'); return e; }
    if (t.t === 'id') {
      i++;
      if (FUNCS[t.v] && peek()?.v === '(') {
        i++;
        const args = [sum()];
        while (peek()?.v === ',') { i++; args.push(sum()); }
        take(')');
        return { k: 'call', f: t.v, args };
      }
      if (t.v === 'x') return { k: 'x' };
      if (t.v in CONSTS) return { k: 'num', v: CONSTS[t.v] };
      throw new Error(`unknown name "${t.v}"`);
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  function power() {
    const b = primary();
    if (peek()?.v === '^') { i++; return { k: 'bin', op: '^', a: b, b: unary() }; }
    return b;
  }
  function unary() {
    if (peek()?.v === '-') { i++; return { k: 'neg', a: unary() }; }
    if (peek()?.v === '+') { i++; return unary(); }
    return power();
  }
  function product() {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.v === '*' || t?.v === '/') { i++; a = { k: 'bin', op: t.v, a, b: unary() }; }
      else if (startsAtom(t)) a = { k: 'bin', op: '*', a, b: power() };      // implicit product
      else return a;
    }
  }
  function sum() {
    let a = product();
    while (peek()?.v === '+' || peek()?.v === '-') { const op = take().v; a = { k: 'bin', op, a, b: product() }; }
    return a;
  }
  const ast = sum();
  if (i < tk.length) throw new Error(`unexpected "${tk[i].v}"`);
  return ast;
}

function ev(n, x) {
  switch (n.k) {
    case 'num': return n.v;
    case 'x': return x;
    case 'neg': return -ev(n.a, x);
    case 'call': return FUNCS[n.f](...n.args.map((a) => ev(a, x)));
    default: {
      const a = ev(n.a, x), b = ev(n.b, x);
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b);
    }
  }
}

const COMPILED = new Map();
/** f(x) for an expression string (memoized); invalid input → { error }. */
export function compile(src) {
  if (!COMPILED.has(src)) {
    let entry;
    try { const ast = parse(src); entry = { f: (x) => ev(ast, x), error: null }; }
    catch (e) { entry = { f: () => NaN, error: e.message }; }
    if (COMPILED.size > 500) COMPILED.clear();
    COMPILED.set(src, entry);
  }
  return COMPILED.get(src);
}
