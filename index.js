const TokenStream = require('./lib/token-stream');
const AST = require('./lib/taxonomy');

// Type names
const NULL = 'null';
const WORD = 'word';
const IDENT = 'ident';
const PUNCT = 'punct';
const NUMBER = 'number';
const STRING = 'string';
const VARIABLE = 'variable';
const VERSION = 'version';

// End of statement
const eos = is(PUNCT, ';');

// Punctuation
const isComma = is(PUNCT, ',');
const isAssign = is(PUNCT, '=');
const isPeriod = is(PUNCT, '.');
const isLeftParen = is(PUNCT, '(');
const isRightParen = is(PUNCT, ')');

// Type checkers
const isNull = is(NULL);
const isWord = is(WORD);
const isIdent = is(IDENT);
const isPunct = is(PUNCT);
const isValue = is([NULL, NUMBER, STRING, VARIABLE, WORD]);
const isNumber = is(NUMBER);
const isString = is(STRING);
const isLiteral = is([NULL, NUMBER, STRING]);
const isVariable = is(VARIABLE);
const isWordOrIdent = is([WORD, IDENT]);

// Expose AST node types.
Object.assign(exports, AST);

exports.lex =
function lex(input) {
  let toks = new TokenStream(input);
  while (toks.next());
  return toks.array;
};

exports.parse =
function parse(input, opts = {}) {
  const toks = new TokenStream(input);
  const stmts = [];

  // The minimum required version to use the next node(s).
  let version = -1;

  // Statement parsers
  const stmtTypes = {
    CREATE: ['TABLE'],
    CREATE_TABLE() {
      stmt.attrs = {};
      flag(stmt, 'TEMPORARY');
      next(is(WORD, stmt.what), true);
      flag(stmt, 'IF NOT EXISTS');
      stmt.name = next(isWordOrIdent, true).value;

      // Parse column and index definitions.
      stmt.columns = [];
      stmt.indexes = [];
      next(isLeftParen, true);
      until(tok => {
        if (eos(tok)) wtf(tok, 'Missing ) before ;');
        if (isRightParen(tok)) return true;

        if (isWord(tok)) {
          let val = uc(tok.value),
              start = tok.start,
              isPrimary = val == 'PRIMARY',
              isUnique = isPrimary || val == 'UNIQUE';

          if (isUnique) {
            tok = eof(toks.next());
            val = isWord(tok) ? uc(tok.value) : null;
          }
          if (val == 'KEY') {
            let name = isPrimary ? null : next(isWordOrIdent, true).value;

            // Parse the indexed columns.
            let columns = [];
            next(isLeftParen, true);
            until(tok => {
              if (isWordOrIdent(tok)) {
                let column = [tok.value];
                columns.push(column);

                // Prefix length
                if (next(isLeftParen)) {
                  let len = eof(toks.next());
                  if (isNumber(len)) {
                    column[1] = len.value;
                  } else wtf(len, 'Expected a number');
                  next(isRightParen, true);
                }

                tok = eof(toks.next());
                if (isRightParen(tok)) return true;
                if (!isComma(tok)) {
                  wtf(tok, 'Expected a comma or paren');
                }
              }
              else if (isComma(tok)) {
                let tok = eof(toks.peek());
                if (!isWordOrIdent(tok)) {
                  wtf(tok, 'Expected a word or identifier');
                }
              }
            });

            next(isComma);
            stmt.indexes.push({
              __proto__: AST.Index.prototype,
              name,
              columns,
              start,
              end: toks.curr().end,
            });
            return;
          }
          if (isUnique) {
            wtf(tok, 'Missing word KEY');
          }
        }
        else if (!isIdent(tok)) {
          wtf(tok, 'Expected a word or identifier');
        }

        let name = tok.value,
            start = tok.start,
            dataType = lc(next(isWord, true).value);

        // Skip the display width
        if (next(isLeftParen)) {
          next(isNumber, true);
          next(isRightParen, true);
        }

        let attrs = {};
        while (tok = next(isWord)) {
          let attr = uc(tok.value),
              start = tok.start,
              value = true;

          switch (attr) {
            case 'COLLATE':
              value = next(isWord, true).value;
              break;
            case 'DEFAULT':
              value = next(isLiteral, true).value;
              break;
            case 'NOT':
              next(isNull, true);
              attr += '_NULL';
              break;
          }

          attrs[attr] = {
            __proto__: AST.Attribute.prototype,
            name: attr.replace(/_/g, ' '),
            value,
            version,
            start,
            end: toks.curr().end,
          };
        }

        next(isComma);
        stmt.columns.push({
          __proto__: AST.Column.prototype,
          name,
          dataType,
          attrs,
          start,
          end: toks.curr().end,
        });
      });

      // Parse table options.
      until(tok => {
        if (eos(tok)) return false;
        if (!isWord(tok)) {
          wtf(tok, 'Expected a word');
        }
        let attr = uc(tok.value),
            start = tok.start;

        // Consecutive words make up an attribute name.
        while (tok = next(isWord)) {
          attr += '_' + uc(tok.value);
        }

        next(isAssign, true);
        stmt.attrs[attr] = {
          __proto__: AST.Attribute.prototype,
          name: attr.replace(/_/g, ' '),
          value: getValue(next(isValue, true)),
          start,
          end: toks.curr().end,
        };
      });
    },
    INSERT: ['VALUES'],
    INSERT_VALUES() {
      stmt.rows = [];
      until(tok => {
        if (!isLeftParen(tok)) {
          wtf(tok, 'Expected a left paren');
        }
        let values = [];
        next(isRightParen) || until(parseRow, values);
        stmt.rows.push({
          __proto__: AST.Row.prototype,
          values,
          start: tok.start,
          end: toks.curr().end,
        });
        return lastItem();
      });
      function parseRow(tok, values) {
        if (isPunct(tok)) wtf(tok);
        values.push(tok.value);
        tok = eof(toks.next());
        if (isRightParen(tok)) return values;
        if (!isComma(tok)) {
          wtf(tok, 'Expected a comma or right paren');
        }
      }
    },
    ALTER: ['TABLE'],
    ALTER_TABLE() {
      next(is(WORD, stmt.what), true);
      stmt.name = next(isWordOrIdent, true).value;

      // Parse the actions.
      stmt.actions = [];
      until(tok => {
        if (!isWord(tok)) {
          wtf(tok, 'Expected a word');
        }

        let action = {
          __proto__: AST.Action.prototype,
          type: uc(tok.value),
          start: tok.start,
          end: null,
        };

        switch (action.type) {
          case 'ENABLE':
          case 'DISABLE':
            action.what = next(is(WORD, 'KEYS'), true).value;
            break;

          default: wtf(tok, 'Unknown action type ' + action.type);
        }

        action.end = toks.curr().end;
        stmt.actions.push(action);
        return lastItem();
      });
    },
    DROP: ['TABLE'],
    DROP_TABLE() {
      stmt.attrs = {};
      flag(stmt, 'TEMPORARY');
      next(is(WORD, stmt.what), true);
      flag(stmt, 'IF EXISTS');
      stmt.names = [
        next(isWordOrIdent, true).value,
      ];
      let tok; while (tok = next(isWordOrIdent)) {
        stmt.names.push(tok.value);
        if (lastItem()) break;
      }
    },
    LOCK: ['TABLES'],
    LOCK_TABLES() {
      stmt.tables = [];
      let tok; while (tok = next(isWordOrIdent)) {
        let table = tok.value, lockType;
        tok = toks.next();
        if (!tok || eos(tok) || !isWord(tok)) {
          wtf(tok, 'Missing lock type');
        }
        lockType = uc(tok.value);
        switch (lockType) {
          case 'WRITE':
            next(eos, true);
            toks.back();
            break;
          case 'READ':
            if (tok = next(isWord)) {
              let val = uc(tok.value);
              lockType += '_' + val;
              if (val != 'LOCAL') {
                wtf(tok, 'Invalid lock type ' + lockType);
              }
            }
            break;

          default: wtf(tok, 'Invalid lock type ' + lockType);
        }
        stmt.tables.push([
          table,
          lockType,
        ]);
        return lastItem();
      }
    },
    SET_VARIABLES() {
      toks.back();
      stmt.variables = [];
      until(tok => {
        let name = '', {start} = tok;
        while (true) {
          name += lc(tok.value);
          if (next(isPeriod)) {
            name += '.';
            tok = next(isWord, true);
          } else break;
        }
        next(isAssign, true);
        stmt.variables.push({
          __proto__: AST.Variable.prototype,
          name,
          value: parseExpr(),
          start,
          end: toks.curr().end,
        });
        return lastItem();
      });
    },
    SET_NAMES() {
      // Inherit charset rules
      this.SET_CHARSET();

      let tok = eof(peek());
      if (eos(tok)) return;

      next(is(WORD, 'COLLATE'), true);
      tok = eof(toks.next());

      let val = getString(tok);
      if (val == null) wtf(tok);
      stmt.collation = val;
    },
    SET_CHARSET() {
      let tok = toks.next(),
          val = tok.value;

      if (isWord(tok)) {
        val = lc(val);
        if (val == 'default') {
          stmt.default = true;
          return;
        }
      } else if (!isString(tok)) {
        wtf(tok, 'Expected a word or string');
      }
      stmt.value = val;
    },
  };

  // Simplify stack traces by creating the syntax error early.
  let err = new SyntaxError();
  function wtf(tok, msg) {
    if (!msg) msg = 'Unexpected ' + inspect(tok);
    if (opts.debug) {
      err = new SyntaxError(msg);
      Error.captureStackTrace(err, wtf);
    } else err.message = msg;
    throw Object.assign(err, tok);
  }

  let tok, stmt; while (true) {
    tok = toks.next();
    if (!tok) return stmts;
    if (isWord(tok)) {
      stmt = parseStatement(tok);
      stmt.end = toks.curr().end;
      stmts.push(stmt);
    }
    else if (tok.type == VERSION) {
      version = tok.value;
    }
    else {
      eos(tok) || wtf(tok);
    }
  }

  //
  // Helpers
  //

  function parseStatement(tok) {

    stmt = {
      __proto__: AST.Statement.prototype,
      type: uc(tok.value),
      version,
      start: tok.start,
      end: null,
    };

    let what, words;
    switch (stmt.type) {
      case 'SET':
        tok = eof(toks.next());
        if (isWord(tok)) {
          switch (what = uc(tok.value)) {
            case 'CHARACTER':
              next(is(WORD, 'SET'), true);
              what += ' SET';
              /* fallthrough */
            case 'CHARSET':
              stmt.what = what;
              stmtTypes.SET_CHARSET();
              break;
            case 'NAMES':
              stmt.what = what;
              stmtTypes.SET_NAMES();
              break;

            default:
              stmtTypes.SET_VARIABLES();
          }
        }
        else if (isVariable(tok)) {
          stmtTypes.SET_VARIABLES();
        }
        else {
          wtf(tok, 'Expected a word or variable');
        }
        break;

      case 'UNLOCK':
        what = next(oneOf(WORD, stmtTypes.LOCK));
        if (!what) wtf(tok, 'Invalid UNLOCK statement');
        stmt.what = uc(what.value);
        break;

      case 'INSERT':
        next(is(WORD, 'INTO'), true);
        stmt.table = next(isWordOrIdent, true).value;
        /* fallthrough */

      default:
        words = stmtTypes[stmt.type];
        if (!words) wtf(tok, 'Unknown statement ' + stmt.type);

        what = find(oneOf(WORD, words));
        if (!what) wtf(tok, `Invalid ${stmt.type} statement`);

        stmt.what = uc(what.value);
        stmtTypes[stmt.type + '_' + stmt.what]();
    }

    tok = toks.next();
    if (tok && eos(tok)) return stmt;
    wtf(tok, 'Missing semicolon');
  }

  function parseExpr() {
    let tok = eof(toks.next());
    if (isVariable(tok)) {
      return {
        __proto__: AST.Variable.prototype,
        name: lc(tok.value),
        start: tok.start,
        end: tok.end,
      };
    }
    return {
      __proto__: AST.Literal.prototype,
      value: getValue(tok),
      start: tok.start,
      end: tok.end,
    };
  }

  // Check for a flag in a statement. (eg: "IF EXISTS")
  function flag(stmt, name) {
    let {start} = eof(toks.peek());
    if (~name.indexOf(' ')) {
      if (!until(words(name))) return;
      name = name.replace(/ /g, '_');
    }
    else if (!next(is(WORD, name))) {
      return;
    }
    stmt.attrs[name] = {
      __proto__: AST.Attribute.prototype,
      name: name.replace(/_/g, ' '),
      value: true,
      start,
      end: toks.curr().end,
    };
  }

  // Find a matching token in the current statement.
  function find(pred) {
    let i = 0; while (true) {
      let tok = eof(toks.peek(++i));
      if (eos(tok)) return null;
      if (pred(tok)) return tok;
    }
  }

  // Consume tokens until a value is returned by the predicate.
  function until(pred, ...args) {
    let tok, res;
    while (tok = next()) {
      res = pred(tok, ...args);
      if (res !== undefined) {
        if (res === false) toks.back();
        return res;
      }
    }
  }

  // Match a sequence of words.
  function words(str) {
    let i = 0, arr = uc(str).split(' ');
    return (tok) => {
      if (tok.type == WORD && uc(tok.value) == arr[i++]) {
        if (i == arr.length) return true;
      } else if (i == 0) { return false;
      } else wtf(tok);
    };
  }

  // Peek with a predicate. And skip version tokens.
  function peek(pred, offset = 1) {
    let dir = offset > 0 ? 1 : -1;
    let tok, i = dir;
    while (true) {
      if (tok = toks.peek(i)) {
        if (tok.type == VERSION) {
          offset += dir;
        }
        if (i != offset) {
          i += dir;
          continue;
        }
        if (!pred || pred(tok)) {
          return tok;
        }
      }
      return null;
    }
  }

  // Return the next token if it matches the predicate.
  // And skip version tokens.
  function next(pred, required) {
    let tok; while (true) {
      if (tok = toks.next()) {
        if (tok.type == VERSION) {
          version = tok.value;
          continue;
        }
        if (!pred || pred(tok)) {
          return tok;
        }
        if (required) wtf(tok);
        else toks.back();
      }
      else if (required) {
        wtf(null, 'Unexpected EOF');
      }
      return null;
    }
  }

  // Throw when no comma nor semicolon is next.
  // Return true if semicolon, else undefined.
  function lastItem() {
    if (peek(eos)) return true;
    if (!next(isComma)) {
      wtf(tok, 'Expected a comma or semicolon');
    }
  }

  // Throw on unexpected EOF.
  function eof(tok) {
    return tok || wtf(null, 'Unexpected EOF');
  }
};

function lc(str) {
  return str.toLowerCase();
}

function uc(str) {
  return str.toUpperCase();
}

function getValue(tok) {
  return isWord(tok) ? lc(tok.value)
    : isLiteral(tok) ? tok.value
    : undefined;
}

function getString(tok) {
  return isWord(tok) ? lc(tok.value)
    : isString(tok) ? tok.value
    : null;
}

function is(type, value) {
  let matchType = Array.isArray(type)
    ? (tok => type.indexOf(tok.type) != -1)
    : (tok => tok.type == type);

  if (arguments.length == 1) {
    return (tok, value) => matchType(tok) &&
      (arguments.length == 1 || uc(tok.value) === uc(value));
  }

  if (typeof value == 'function') {
    return (tok) => matchType(tok) && value(tok.value);
  }

  value = uc(value);
  return (tok) => matchType(tok) && uc(tok.value) === value;
}

function oneOf(type, arr) {
  if (Array.isArray(type)) {
    return (tok) => type.indexOf(uc(tok.value)) != -1;
  }
  return (tok) => tok.type == type && arr.indexOf(uc(tok.value)) != -1;
}

// For human-readable error messages
function inspect(tok) {
  switch (tok.type) {
    case WORD: return `word '${tok.value}'`;
    case IDENT: return `identifier '${tok.value}'`;
    case VARIABLE: return `variable '${tok.value}'`;
    case PUNCT:
      switch (tok.value) {
        case '(': return 'left paren';
        case ')': return 'right paren';
        case ',': return 'comma';
        case ';': return 'semicolon';
        case '=': return 'assignment';
        default: return 'punctuation';
      }
    default: return tok.type;
  }
}
