const TokenStream = require('./lib/token-stream');
const AST = require('./lib/taxonomy');

// End of statement
const eos = is('punct', ';');

// Punctuation
const isComma = is('punct', ',');
const isAssign = is('punct', '=');
const isLeftParen = is('punct', '(');
const isRightParen = is('punct', ')');

// Type checkers
const isWord = is('word');
const isIdent = is('ident');
const isPunct = is('punct');
const isNumber = is('number');
const isLiteral = is(['string', 'number']);
const isWordOrIdent = is(['word', 'ident']);
const isWordOrLiteral = is(['word', 'string', 'number']);

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

  // Statement parsers
  const stmtTypes = {
    CREATE: ['TABLE'],
    CREATE_TABLE() {
      stmt.attrs = {};
      flag(stmt, 'TEMPORARY');
      next(is('word', stmt.what), true);
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
            tok = toks.next();
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
                  let len = toks.next();
                  if (len.type == 'number') {
                    column[1] = len.value;
                  } else wtf(len, 'Expected a number');
                  next(isRightParen, true);
                }

                tok = toks.next();
                if (isRightParen(tok)) return true;
                if (!isComma(tok)) {
                  wtf(tok, 'Expected a comma or paren');
                }
              }
              else if (isComma(tok)) {
                let tok = toks.peek();
                if (!isWordOrIdent(tok)) {
                  wtf(tok, 'Unexpected ' + inspect(tok));
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
          wtf(tok, 'Unexpected ' + inspect(tok));
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
              if (isWord(toks.peek(), 'NULL')) {
                toks.next();
                value = null;
              } else {
                value = next(isLiteral, true).value;
              }
              break;
            case 'NOT':
              attr += '_' + uc(next(isWord, true).value);
              break;
          }

          attrs[attr] = {
            __proto__: AST.Attribute.prototype,
            name: attr.replace(/_/g, ' '),
            value,
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
        if (isWord(tok)) {
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
            value: next(isWordOrLiteral, true).value,
            start,
            end: toks.curr().end,
          };
        } else wtf(tok, 'Unexpected ' + inspect(tok));
      });
    },
    INSERT: ['VALUES'],
    INSERT_VALUES() {
      stmt.rows = [];
      while (next(isLeftParen)) {
        let values = [],
            start = toks.curr().start;

        next(isRightParen) || until(parseRow, values);
        next(isComma);

        stmt.rows.push({
          __proto__: AST.Row.prototype,
          values,
          start,
          end: toks.curr().end,
        });
      }
      function parseRow(tok, values) {
        if (isPunct(tok)) {
          wtf(tok, 'Unexpected ' + inspect(tok));
        }
        values.push(tok.value);
        tok = toks.next();
        if (isRightParen(tok)) return values;
        if (!isComma(tok)) {
          wtf(tok, 'Expected a comma or right paren');
        }
      }
    },
    ALTER: ['TABLE'],
    ALTER_TABLE() {
      next(is('word', stmt.what), true);
      stmt.name = next(isWordOrIdent, true).value;

      // Parse the actions.
      stmt.actions = [];
      until(tok => {
        if (!isWord(tok)) {
          wtf(tok, 'Unexpected ' + inspect(tok));
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
            action.what = next(is('word', 'KEYS'), true).value;
            break;

          default: wtf(tok, 'Unknown action type ' + action.type);
        }

        action.end = toks.curr().end;
        stmt.actions.push(action);

        if (tok = toks.next()) {
          if (eos(tok)) return toks.back();
          if (!isComma(tok)) {
            wtf(tok, 'Expected a comma or semicolon');
          }
        }
      });
    },
    DROP: ['TABLE'],
    DROP_TABLE() {
      stmt.attrs = {};
      flag(stmt, 'TEMPORARY');
      next(is('word', stmt.what), true);
      flag(stmt, 'IF EXISTS');
      stmt.names = [
        next(isWordOrIdent, true).value,
      ];
      let tok; while (tok = next(isWordOrIdent)) {
        stmt.names.push(tok.value);
      }
    },
    LOCK: ['TABLES'],
    LOCK_TABLES() {
      stmt.tables = [];
      let tok; while (tok = next(isWordOrIdent)) {
        let table = tok.value, lockType;
        tok = toks.next();
        if (eos(tok) || !isWord(tok)) wtf(tok, 'Missing lock type');
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
        next(isComma);
      }
    },
  };

  // Simplify stack traces by creating the syntax error early.
  let err = new SyntaxError();
  function wtf(tok, msg) {
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
    } else if (!eos(tok)) {
      break;
    }
  }

  next(tok => wtf(tok, 'Unexpected ' + inspect(tok)));
  return stmts;

  //
  // Helpers
  //

  function parseStatement(tok) {

    stmt = {
      __proto__: AST.Statement.prototype,
      type: uc(tok.value),
      start: tok.start,
      end: null,
    };

    let what, words;
    switch (stmt.type) {
      case 'UNLOCK':
        what = next(oneOf('word', stmtTypes.LOCK));
        if (!what) wtf(tok, 'Invalid UNLOCK statement');
        stmt.what = uc(what.value);
        break;

      case 'INSERT':
        next(is('word', 'INTO'), true);
        stmt.table = next(isWordOrIdent, true).value;
        /* fallthrough */

      default:
        words = stmtTypes[stmt.type];
        if (!words) wtf(tok, 'Unknown statement ' + stmt.type);

        what = find(oneOf('word', words));
        if (!what) wtf(tok, `Invalid ${stmt.type} statement`);

        stmt.what = uc(what.value);
        stmtTypes[stmt.type + '_' + stmt.what]();
    }
    tok = toks.next();
    if (tok && eos(tok)) return stmt;
    wtf(tok, 'Missing semicolon');
  }

  // Check for a flag in a statement. (eg: "IF EXISTS")
  function flag(stmt, name) {
    let {start} = toks.peek();
    if (~name.indexOf(' ')) {
      if (!until(words(name))) return;
      name = name.replace(/ /g, '_');
    }
    else if (!next(is('word', name))) {
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
    let tok, i = 0;
    while ((tok = toks.peek(++i)) && !eos(tok)) {
      if (pred(tok)) return tok;
    }
    return null;
  }

  // Consume tokens until a value is returned by the predicate.
  function until(pred, ...args) {
    let tok, res;
    while (tok = toks.next()) {
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
      if (tok.type == 'word' && uc(tok.value) == arr[i++]) {
        if (i == arr.length) return true;
      } else if (i == 0) { return false;
      } else wtf(tok, 'Unexpected ' + inspect(tok));
    };
  }

  // Return the next token if it matches the predicate.
  function next(pred, required) {
    let tok = toks.peek();
    if (tok) {
      if (pred(tok)) return toks.next();
      return !required ? null : wtf(tok, 'Unexpected ' + inspect(tok));
    }
    return !required ? null : wtf(null, 'Unexpected EOF');
  }
};

function lc(str) {
  return str.toLowerCase();
}

function uc(str) {
  return str.toUpperCase();
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
    case 'word': return `word '${tok.value}'`;
    case 'ident': return `identifier '${tok.value}'`;
    case 'punct':
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
