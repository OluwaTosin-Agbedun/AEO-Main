/**
 * Genuine Firestore Rules v2 Parser & Evaluator for Local CI / Sandbox Verification
 *
 * Parses the actual `firestore.rules` source file directly (functions, match blocks,
 * allow clauses, CEL expressions, path interpolations, `exists()`, `get()`, `is`, `in`,
 * `.keys().hasAll()`, `.keys().hasOnly()`, `.size()`, `.matches()`) and evaluates
 * read/write/get/list/create/update/delete requests against an in-memory Firestore store.
 *
 * Used to verify `firestore.rules` behavior genuinely when the Java-based Firebase Local
 * Emulator cannot run in a Java-less sandbox.
 */

export type FirestoreOperation = 'get' | 'list' | 'create' | 'update' | 'delete';

export interface FirestoreAuthContext {
  uid: string;
  token?: Record<string, any>;
}

export interface FirestoreRequest {
  operation: FirestoreOperation;
  /** Document path relative to `/databases/{database}/documents`, e.g. `dcm_daily_publications/dcm-daily-2026-11-19` */
  path: string;
  auth: FirestoreAuthContext | null;
  /** Incoming document payload for create / update operations */
  incomingData?: Record<string, any>;
  /** Database ID (defaults to `(default)`) */
  database?: string;
}

export interface ParsedFunction {
  name: string;
  params: string[];
  bodyExpr: string;
}

export interface ParsedAllowRule {
  operations: Set<FirestoreOperation>;
  conditionExpr: string;
}

export interface ParsedMatchBlock {
  pattern: string;
  allows: ParsedAllowRule[];
  children: ParsedMatchBlock[];
}

export interface ParsedRuleset {
  functions: Map<string, ParsedFunction>;
  rootMatches: ParsedMatchBlock[];
}

function stripLineComments(src: string): string {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (!inSingle && !inDouble && ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === "'" && !inDouble && src[i - 1] !== '\\') inSingle = !inSingle;
    if (ch === '"' && !inSingle && src[i - 1] !== '\\') inDouble = !inDouble;
    out += ch;
  }
  return out;
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && !inDouble && src[i - 1] !== '\\') inSingle = !inSingle;
    else if (ch === '"' && !inSingle && src[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  throw new Error(`Unmatched '{' at index ${openIdx}`);
}

function expandAllowOps(rawOps: string[]): Set<FirestoreOperation> {
  const ops = new Set<FirestoreOperation>();
  for (const op of rawOps) {
    const clean = op.trim();
    if (clean === 'read') {
      ops.add('get');
      ops.add('list');
    } else if (clean === 'write') {
      ops.add('create');
      ops.add('update');
      ops.add('delete');
    } else if (
      clean === 'get' ||
      clean === 'list' ||
      clean === 'create' ||
      clean === 'update' ||
      clean === 'delete'
    ) {
      ops.add(clean);
    } else {
      throw new Error(`Unsupported Firestore allow operation: ${clean}`);
    }
  }
  return ops;
}

function parseBlockBody(
  body: string,
  functions: Map<string, ParsedFunction>
): { allows: ParsedAllowRule[]; children: ParsedMatchBlock[] } {
  const allows: ParsedAllowRule[] = [];
  const children: ParsedMatchBlock[] = [];
  let i = 0;

  const skipWs = () => {
    while (i < body.length && /\s/.test(body[i])) i++;
  };

  while (i < body.length) {
    skipWs();
    if (i >= body.length) break;

    if (body.startsWith('function ', i)) {
      const headerMatch = /^function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*\{/.exec(body.slice(i));
      if (!headerMatch) throw new Error(`Invalid function declaration near: ${body.slice(i, i + 80)}`);
      const name = headerMatch[1];
      const params = headerMatch[2]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const openBrace = i + headerMatch[0].length - 1;
      const closeBrace = findMatchingBrace(body, openBrace);
      const fnBody = body.slice(openBrace + 1, closeBrace).trim();
      const returnMatch = /^return\s+([\s\S]*);$/.exec(fnBody);
      if (!returnMatch) {
        throw new Error(`Function ${name} must have a single return statement, got: ${fnBody}`);
      }
      functions.set(name, { name, params, bodyExpr: returnMatch[1].trim() });
      i = closeBrace + 1;
      continue;
    }

    if (body.startsWith('match ', i)) {
      const matchHeader = /^match\s+(\S+)\s*\{/.exec(body.slice(i));
      if (!matchHeader) throw new Error(`Invalid match declaration near: ${body.slice(i, i + 80)}`);
      const pattern = matchHeader[1];
      const openBrace = i + matchHeader[0].length - 1;
      const closeBrace = findMatchingBrace(body, openBrace);
      const inner = body.slice(openBrace + 1, closeBrace);
      const parsed = parseBlockBody(inner, functions);
      children.push({ pattern, allows: parsed.allows, children: parsed.children });
      i = closeBrace + 1;
      continue;
    }

    if (body.startsWith('allow ', i)) {
      const semi = body.indexOf(';', i);
      if (semi === -1) throw new Error(`Missing ';' in allow rule near: ${body.slice(i, i + 80)}`);
      const stmt = body.slice(i, semi).trim();
      const allowMatch = /^allow\s+([a-z,\s]+)\s*:\s*if\s+([\s\S]+)$/.exec(stmt);
      if (!allowMatch) throw new Error(`Invalid allow rule: ${stmt}`);
      const ops = expandAllowOps(allowMatch[1].split(','));
      allows.push({ operations: ops, conditionExpr: allowMatch[2].trim() });
      i = semi + 1;
      continue;
    }

    throw new Error(`Unexpected token in Firestore rules block near: ${body.slice(i, i + 60)}`);
  }

  return { allows, children };
}

export function parseFirestoreRules(rulesSource: string): ParsedRuleset {
  const clean = stripLineComments(rulesSource);
  const serviceMatch = /service\s+cloud\.firestore\s*\{/.exec(clean);
  if (!serviceMatch) throw new Error('Missing `service cloud.firestore {` block');
  const serviceOpen = serviceMatch.index + serviceMatch[0].length - 1;
  const serviceClose = findMatchingBrace(clean, serviceOpen);
  const serviceBody = clean.slice(serviceOpen + 1, serviceClose);

  const functions = new Map<string, ParsedFunction>();
  const parsed = parseBlockBody(serviceBody, functions);
  return { functions, rootMatches: parsed.children };
}

// ============================================================================
// CEL-Subset Tokenizer & Recursive-Descent Expression Evaluator
// ============================================================================

type TokenType =
  | 'IDENT'
  | 'STRING'
  | 'NUMBER'
  | 'PATH'
  | 'OP'
  | 'PUNCT'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenizeExpr(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Firestore path literal starting with /databases/
    if (ch === '/' && expr.startsWith('/databases/', i)) {
      let end = i;
      while (end < expr.length && !/[\s,)]/.test(expr[end])) {
        if (expr[end] === '$' && expr[end + 1] === '(') {
          let depth = 1;
          end += 2;
          while (end < expr.length && depth > 0) {
            if (expr[end] === '(') depth++;
            else if (expr[end] === ')') depth--;
            end++;
          }
          continue;
        }
        end++;
      }
      tokens.push({ type: 'PATH', value: expr.slice(i, end) });
      i = end;
      continue;
    }

    // String literals ('...' or "...")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let val = '';
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          val += expr[i + 1];
          i += 2;
        } else {
          val += expr[i++];
        }
      }
      if (expr[i] !== quote) throw new Error(`Unterminated string literal in: ${expr}`);
      i++;
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let end = i;
      while (end < expr.length && /[0-9.]/.test(expr[end])) end++;
      tokens.push({ type: 'NUMBER', value: expr.slice(i, end) });
      i = end;
      continue;
    }

    // Multi-char operators
    const two = expr.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      tokens.push({ type: 'OP', value: two });
      i += 2;
      continue;
    }

    // Single-char operators & punctuation
    if (['!', '<', '>', '?', ':'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }
    if (['(', ')', '[', ']', ',', '.'].includes(ch)) {
      tokens.push({ type: 'PUNCT', value: ch });
      i++;
      continue;
    }

    // Identifiers & keyword operators (in, is, true, false, null)
    if (/[a-zA-Z_]/.test(ch)) {
      let end = i;
      while (end < expr.length && /[a-zA-Z0-9_]/.test(expr[end])) end++;
      tokens.push({ type: 'IDENT', value: expr.slice(i, end) });
      i = end;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' in expression: ${expr.slice(i, i + 30)}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

interface EvalEnv {
  ruleset: ParsedRuleset;
  store: Map<string, Record<string, any>>;
  database: string;
  vars: Record<string, any>;
}

class ExprEvaluator {
  private tokens: Token[];
  private pos = 0;
  private env: EvalEnv;

  constructor(expr: string, env: EvalEnv) {
    this.tokens = tokenizeExpr(expr);
    this.env = env;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(expectedValue?: string): Token {
    const tok = this.tokens[this.pos];
    if (expectedValue !== undefined && tok.value !== expectedValue) {
      throw new Error(`Expected '${expectedValue}', got '${tok.value}' (${tok.type})`);
    }
    this.pos++;
    return tok;
  }

  public evaluate(): any {
    const val = this.parseTernary();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected trailing token '${this.peek().value}'`);
    }
    return val;
  }

  private parseTernary(): any {
    const cond = this.parseOr();
    if (this.peek().type === 'OP' && this.peek().value === '?') {
      this.consume('?');
      const thenBranch = this.parseTernaryOrSkip(Boolean(cond));
      this.consume(':');
      const elseBranch = this.parseTernaryOrSkip(!Boolean(cond));
      return cond ? thenBranch : elseBranch;
    }
    return cond;
  }

  private parseTernaryOrSkip(shouldEval: boolean): any {
    if (shouldEval) return this.parseTernary();
    // Skip balanced tokens until matching ':' or ')' / 'EOF' at depth 0
    let depth = 0;
    let qDepth = 0;
    while (this.peek().type !== 'EOF') {
      const tok = this.peek();
      if (tok.value === '(' || tok.value === '[') depth++;
      else if (tok.value === ')' || tok.value === ']') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && tok.value === '?') qDepth++;
      else if (depth === 0 && tok.value === ':') {
        if (qDepth === 0) break;
        qDepth--;
      }
      this.pos++;
    }
    return undefined;
  }

  private parseOr(): any {
    let left = this.parseAnd();
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.consume('||');
      if (left === true) {
        this.skipRightOperand(['||', '?', ':', ')', ']', ',']);
        left = true;
      } else {
        const right = this.parseAnd();
        left = Boolean(left) || Boolean(right);
      }
    }
    return left;
  }

  private parseAnd(): any {
    let left = this.parseEquality();
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.consume('&&');
      if (left === false) {
        this.skipRightOperand(['&&', '||', '?', ':', ')', ']', ',']);
        left = false;
      } else {
        const right = this.parseEquality();
        left = Boolean(left) && Boolean(right);
      }
    }
    return left;
  }

  private skipRightOperand(stopValues: string[]) {
    let depth = 0;
    while (this.peek().type !== 'EOF') {
      const tok = this.peek();
      if (tok.value === '(' || tok.value === '[') depth++;
      else if (tok.value === ')' || tok.value === ']') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && stopValues.includes(tok.value)) {
        break;
      }
      this.pos++;
    }
  }

  private parseEquality(): any {
    let left = this.parseComparison();
    while (this.peek().type === 'OP' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.consume().value;
      const right = this.parseComparison();
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }

  private parseComparison(): any {
    let left = this.parseUnary();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && ['<', '<=', '>', '>='].includes(tok.value)) {
        const op = this.consume().value;
        const right = this.parseUnary();
        if (op === '<') left = left < right;
        else if (op === '<=') left = left <= right;
        else if (op === '>') left = left > right;
        else left = left >= right;
      } else if (tok.type === 'IDENT' && tok.value === 'in') {
        this.consume('in');
        const right = this.parseUnary();
        if (Array.isArray(right)) left = right.includes(left);
        else if (right && typeof right === 'object') left = Object.prototype.hasOwnProperty.call(right, String(left));
        else throw new Error(`Invalid RHS for 'in' operator`);
      } else if (tok.type === 'IDENT' && tok.value === 'is') {
        this.consume('is');
        const typeName = this.consume().value;
        if (typeName === 'string') left = typeof left === 'string';
        else if (typeName === 'int') left = typeof left === 'number' && Number.isInteger(left);
        else if (typeName === 'number') left = typeof left === 'number';
        else if (typeName === 'bool') left = typeof left === 'boolean';
        else if (typeName === 'list') left = Array.isArray(left);
        else if (typeName === 'map') left = Boolean(left) && typeof left === 'object' && !Array.isArray(left);
        else throw new Error(`Unsupported Firestore type check: is ${typeName}`);
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): any {
    if (this.peek().type === 'OP' && this.peek().value === '!') {
      this.consume('!');
      return !Boolean(this.parseUnary());
    }
    return this.parsePostfix();
  }

  private parsePostfix(): any {
    let val = this.parsePrimary();
    while (this.peek().type === 'PUNCT' && this.peek().value === '.') {
      this.consume('.');
      const prop = this.consume().value;
      if (this.peek().type === 'PUNCT' && this.peek().value === '(') {
        const args = this.parseArgList();
        val = this.invokeMethod(val, prop, args);
      } else {
        if (val === null || val === undefined || typeof val !== 'object') {
          throw new Error(`Cannot read property '${prop}' of ${String(val)}`);
        }
        if (!(prop in val)) {
          throw new Error(`Missing field '${prop}' on map`);
        }
        val = val[prop];
      }
    }
    return val;
  }

  private invokeMethod(target: any, method: string, args: any[]): any {
    if (method === 'size') {
      if (typeof target === 'string' || Array.isArray(target)) return target.length;
      if (target && typeof target === 'object') return Object.keys(target).length;
      throw new Error(`.size() called on unsupported value`);
    }
    if (method === 'matches') {
      if (typeof target !== 'string' || typeof args[0] !== 'string') {
        throw new Error(`.matches() requires string target and regex argument`);
      }
      const pattern = args[0];
      const anchored = pattern.startsWith('^') && pattern.endsWith('$') ? pattern : `^(?:${pattern})$`;
      return new RegExp(anchored).test(target);
    }
    if (method === 'keys') {
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error(`.keys() called on non-map value`);
      }
      return { __firestoreKeySet: true, keys: Object.keys(target) };
    }
    if (method === 'hasAll') {
      const keySet: string[] = target?.__firestoreKeySet ? target.keys : target;
      if (!Array.isArray(keySet) || !Array.isArray(args[0])) {
        throw new Error(`.hasAll() requires a key set and list argument`);
      }
      return args[0].every((k) => keySet.includes(k));
    }
    if (method === 'hasOnly') {
      const keySet: string[] = target?.__firestoreKeySet ? target.keys : target;
      if (!Array.isArray(keySet) || !Array.isArray(args[0])) {
        throw new Error(`.hasOnly() requires a key set and list argument`);
      }
      return keySet.every((k) => args[0].includes(k));
    }
    throw new Error(`Unsupported method .${method}()`);
  }

  private parseArgList(): any[] {
    this.consume('(');
    const args: any[] = [];
    if (!(this.peek().type === 'PUNCT' && this.peek().value === ')')) {
      while (true) {
        args.push(this.parseTernary());
        if (this.peek().type === 'PUNCT' && this.peek().value === ',') {
          this.consume(',');
        } else {
          break;
        }
      }
    }
    this.consume(')');
    return args;
  }

  private resolvePathLiteral(rawPath: string): string {
    const resolved = rawPath.replace(/\$\(([^)]+)\)/g, (_m, innerExpr) => {
      const val = new ExprEvaluator(innerExpr, this.env).evaluate();
      return String(val);
    });
    const prefix = `/databases/${this.env.database}/documents/`;
    if (!resolved.startsWith(prefix)) {
      throw new Error(`Resolved Firestore path outside database prefix: ${resolved}`);
    }
    return resolved.slice(prefix.length);
  }

  private parsePrimary(): any {
    const tok = this.peek();

    if (tok.type === 'PUNCT' && tok.value === '(') {
      this.consume('(');
      const v = this.parseTernary();
      this.consume(')');
      return v;
    }

    if (tok.type === 'PUNCT' && tok.value === '[') {
      this.consume('[');
      const items: any[] = [];
      if (!(this.peek().type === 'PUNCT' && this.peek().value === ']')) {
        while (true) {
          items.push(this.parseTernary());
          if (this.peek().type === 'PUNCT' && this.peek().value === ',') {
            this.consume(',');
          } else {
            break;
          }
        }
      }
      this.consume(']');
      return items;
    }

    if (tok.type === 'STRING') {
      this.consume();
      return tok.value;
    }

    if (tok.type === 'NUMBER') {
      this.consume();
      return Number(tok.value);
    }

    if (tok.type === 'PATH') {
      this.consume();
      return this.resolvePathLiteral(tok.value);
    }

    if (tok.type === 'IDENT') {
      const name = this.consume().value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;

      // Function call?
      if (this.peek().type === 'PUNCT' && this.peek().value === '(') {
        const args = this.parseArgList();
        if (name === 'exists') {
          return this.env.store.has(String(args[0]));
        }
        if (name === 'get') {
          const docPath = String(args[0]);
          const data = this.env.store.get(docPath);
          if (!data) throw new Error(`Document not found for get(${docPath})`);
          return { data };
        }
        const fn = this.env.ruleset.functions.get(name);
        if (!fn) throw new Error(`Unknown Firestore rules function: ${name}`);
        if (args.length !== fn.params.length) {
          throw new Error(`Function ${name} expects ${fn.params.length} args, got ${args.length}`);
        }
        const childVars: Record<string, any> = { ...this.env.vars };
        fn.params.forEach((p, idx) => {
          childVars[p] = args[idx];
        });
        return new ExprEvaluator(fn.bodyExpr, { ...this.env, vars: childVars }).evaluate();
      }

      if (name in this.env.vars) {
        return this.env.vars[name];
      }
      throw new Error(`Undefined variable '${name}'`);
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type})`);
  }
}

// ============================================================================
// Path Matcher & Ruleset Evaluator
// ============================================================================

function matchSegments(
  patternSegments: string[],
  pathSegments: string[],
  pIdx: number,
  tIdx: number,
  captures: Record<string, string>
): Record<string, string> | null {
  if (pIdx === patternSegments.length && tIdx === pathSegments.length) {
    return captures;
  }
  if (pIdx >= patternSegments.length) return null;

  const pat = patternSegments[pIdx];
  const wildcardMulti = /^\{([a-zA-Z0-9_]+)=\*\*\}$/.exec(pat);
  if (wildcardMulti) {
    if (pIdx !== patternSegments.length - 1) {
      throw new Error(`Multi-segment wildcard must be final segment: ${pat}`);
    }
    if (tIdx >= pathSegments.length) return null;
    return { ...captures, [wildcardMulti[1]]: pathSegments.slice(tIdx).join('/') };
  }

  if (tIdx >= pathSegments.length) return null;

  const wildcardSingle = /^\{([a-zA-Z0-9_]+)\}$/.exec(pat);
  if (wildcardSingle) {
    return matchSegments(
      patternSegments,
      pathSegments,
      pIdx + 1,
      tIdx + 1,
      { ...captures, [wildcardSingle[1]]: pathSegments[tIdx] }
    );
  }

  if (pat === pathSegments[tIdx]) {
    return matchSegments(patternSegments, pathSegments, pIdx + 1, tIdx + 1, captures);
  }

  return null;
}

function collectMatchingRules(
  blocks: ParsedMatchBlock[],
  parentPattern: string,
  fullPathSegments: string[],
  out: Array<{ rule: ParsedAllowRule; captures: Record<string, string>; pattern: string }>
) {
  for (const block of blocks) {
    const combinedPattern = `${parentPattern.replace(/\/$/, '')}/${block.pattern.replace(/^\//, '')}`;
    const patternSegments = combinedPattern.split('/').filter(Boolean);
    const captures = matchSegments(patternSegments, fullPathSegments, 0, 0, {});
    if (captures) {
      for (const allow of block.allows) {
        out.push({ rule: allow, captures, pattern: combinedPattern });
      }
    }
    if (block.children.length > 0) {
      collectMatchingRules(block.children, combinedPattern, fullPathSegments, out);
    }
  }
}

export interface RulesEvalResult {
  allowed: boolean;
  matchedPatterns: string[];
  errors: string[];
}

export function evaluateFirestoreRequest(
  ruleset: ParsedRuleset,
  store: Map<string, Record<string, any>>,
  req: FirestoreRequest
): RulesEvalResult {
  const database = req.database || '(default)';
  const normalizedDocPath = req.path.replace(/^\/+/, '');
  const fullPathSegments = ['databases', database, 'documents', ...normalizedDocPath.split('/').filter(Boolean)];

  const candidates: Array<{ rule: ParsedAllowRule; captures: Record<string, string>; pattern: string }> = [];
  collectMatchingRules(ruleset.rootMatches, '', fullPathSegments, candidates);

  const existingDoc = store.get(normalizedDocPath);
  const matchedPatterns: string[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    if (!candidate.rule.operations.has(req.operation)) continue;
    matchedPatterns.push(candidate.pattern);

    const vars: Record<string, any> = {
      ...candidate.captures,
      database,
      request: {
        auth: req.auth,
        resource: req.incomingData ? { data: req.incomingData } : null
      },
      resource: existingDoc ? { data: existingDoc } : null
    };

    try {
      const result = new ExprEvaluator(candidate.rule.conditionExpr, {
        ruleset,
        store,
        database,
        vars
      }).evaluate();
      if (result === true) {
        return { allowed: true, matchedPatterns, errors };
      }
    } catch (err: any) {
      // Per Firestore security rules semantics, runtime evaluation errors deny that rule
      errors.push(`${candidate.pattern}: ${err?.message || String(err)}`);
    }
  }

  return { allowed: false, matchedPatterns, errors };
}
