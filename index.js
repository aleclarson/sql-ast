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
  return genArray(toks.next, toks);
};

exports.parse =
function parse(input, opts = {}) {
  const toks = new TokenStream(input);
  const stmts = [];

  // Statement parsers
  const stmtTypes = {
    CREATE: ['TABLE'],
    CREATE_TABLE: () => {
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
        if (isRightParen(tok)) return tok;

        if (isWord(tok)) {
          let val = uc(tok.value);
          let isPrimary = val == 'PRIMARY';
          let isUnique = isPrimary || val == 'UNIQUE';
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
                if (isRightParen(tok)) return tok;
                if (!isComma(tok)) {
                  wtf(tok, 'Expected a comma or paren');
                }
              }
              else if (isComma(tok)) {
                let tok = toks.peek();
                if (!isWordOrIdent(tok)) {
                  wtf(tok, 'Unexpected token ' + uc(tok.type));
                }
              }
            });

            next(isComma);
            stmt.indexes.push({
              __proto__: AST.Index.prototype,
              name,
              columns,
            });
            return;
          }
          if (isUnique) {
            wtf(tok, 'Missing word KEY');
          }
        }
        else if (!isIdent(tok)) {
          wtf(tok, 'Unexpected token ' + uc(tok.type));
        }

        let name = tok.value;
        let dataType = lc(next(isWord, true).value);

        // Skip the display width
        if (next(isLeftParen)) {
          next(isNumber, true);
          next(isRightParen, true);
        }

        let attrs = {};
        while (tok = next(isWord)) {
          let attr = uc(tok.value), val = true;
          switch (attr) {
            case 'COLLATE':
              val = next(isWord, true).value;
              break;
            case 'DEFAULT':
              if (isWord(toks.peek(), 'NULL')) {
                toks.next();
                val = null;
              } else {
                val = next(isLiteral, true).value;
              }
              break;
            case 'NOT':
              attr += '_' + uc(next(isWord, true).value);
              break;
          }
          attrs[attr] = val;
        }

        next(isComma);
        stmt.columns.push({
          __proto__: AST.Column.prototype,
          name,
          dataType,
          attrs,
        });
      });

      // Parse table options.
      until(tok => {
        if (eos(tok)) return false;
        if (isWord(tok)) {
          let attr = uc(tok.value);
          while (tok = next(isWord)) {
            attr += '_' + uc(tok.value);
          }
          next(isAssign, true);
          stmt.attrs[attr] = next(isWordOrLiteral, true).value;
        } else wtf(tok, 'Unexpected token ' + uc(tok.type));
      });
    },
    INSERT_VALUES: () => {
      let row, parseRow = (tok) => {
        if (isPunct(tok)) {
          wtf(tok, 'Unexpected punctuation ' + tok.value);
        }
        row.push(tok.value);
        tok = toks.next();
        if (isRightParen(tok)) return tok;
        if (!isComma(tok)) {
          wtf(tok, 'Expected a comma or right paren');
        }
      };
      stmt.rows = [];
      while (next(isLeftParen)) {
        row = [];
        next(isRightParen) || until(parseRow);
        stmt.rows.push(row);
        next(isComma);
      }
    },
    DROP: ['TABLE'],
    DROP_TABLE: () => {
      stmt.attrs = {};
      flag(stmt, 'TEMPORARY');
      next(is('word', stmt.what), true);
      flag(stmt, 'IF EXISTS');
      stmt.names = [];
      let tok; while (tok = next(isWordOrIdent)) {
        stmt.names.push(tok.value);
      }
    },
    LOCK: ['TABLES'],
    LOCK_TABLES: () => {
      stmt.tables = [];
      let tok; while (tok = next(isWordOrIdent)) {
        let table = tok.value, lockType;
        tok = toks.next();
        if (eos(tok) || !isWord(tok)) wtf(tok, 'Missing lock type');
        lockType = uc(tok.value);
        switch (lockType) {
          case 'WRITE':
            toks.back(next(eos, true));
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
      stmt.end = toks.cursor;
      stmts.push(stmt);
    } else if (!eos(tok)) {
      break;
    }
  }

  next(tok => wtf(tok, 'Unexpected token ' + uc(tok.type)));
  return stmts;

  //
  // Helpers
  //

  function parseStatement(tok) {
    stmt = {
      __proto__: AST.Statement.prototype,
      type: uc(tok.value),
      start: tok.offset,
      end: null,
    };
    let what;
    switch (stmt.type) {
      case 'CREATE':
        what = find(oneOf('word', stmtTypes.CREATE));
        if (!what) wtf(tok, 'Invalid CREATE statement');
        stmt.what = uc(what.value);
        stmtTypes['CREATE_' + stmt.what]();
        break;
      case 'INSERT':
        next(is('word', 'INTO'), true);
        stmt.table = next(isWordOrIdent, true).value;
        next(is('word', 'VALUES'), true);
        stmtTypes.INSERT_VALUES();
        break;
      case 'DROP':
        what = find(oneOf('word', stmtTypes.DROP));
        if (!what) wtf(tok, 'Invalid DROP statement');
        stmt.what = uc(what.value);
        stmtTypes['DROP_' + stmt.what]();
        break;
      case 'LOCK':
        what = next(oneOf('word', stmtTypes.LOCK));
        if (!what) wtf(tok, 'Invalid LOCK statement');
        stmt.what = uc(what.value);
        stmtTypes['LOCK_' + stmt.what]();
        break;
      case 'UNLOCK':
        what = next(oneOf('word', stmtTypes.LOCK));
        if (!what) wtf(tok, 'Invalid UNLOCK statement');
        stmt.what = uc(what.value);
        break;

      default: wtf(tok, 'Unsupported statement ' + stmt.type);
    }
    tok = toks.next();
    if (tok && eos(tok)) return stmt;
    wtf(tok, 'Missing semicolon');
  }

  // Check for a flag in a statement. (eg: "IF EXISTS")
  function flag(stmt, name) {
    if (~name.indexOf(' ')) {
      if (!until(words(name))) return;
      name = name.replace(/ /g, '_');
    }
    else if (!next(is('word', name))) {
      return;
    }
    stmt.attrs[name] = true;
  }

  // Find a matching token in the current statement.
  function find(pred) {
    let tok, i = -1;
    while ((tok = toks.peek(++i)) && !eos(tok)) {
      if (pred(tok)) return tok;
    }
    return null;
  }

  // Consume tokens until a value is returned by the predicate.
  function until(pred) {
    let tok, res;
    while (tok = toks.next()) {
      res = pred(tok);
      if (res !== undefined) {
        if (res === false) toks.back(tok);
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
      } else if (i == 0) return false;
      wtf(tok, 'Unexpected token ' + uc(tok.type));
    };
  }

  // Return the next token if it matches the predicate.
  function next(pred, required) {
    let tok = toks.peek();
    if (tok) {
      if (pred(tok)) return toks.next();
      return !required ? null : wtf(tok, 'Unexpected token ' + uc(tok.type));
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

function genArray(fn, ctx) {
  let val, arr = [];
  while (val = fn.call(ctx)) arr.push(val);
  return arr;
}
