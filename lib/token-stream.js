const WORD = /^[a-z0-9_$]+$/i;
const PUNCT = '(),;=';
const QUOTE = `"'`;
const DIGIT = /^[0-9]/;
const NUMBER = /^-?[0-9]+(\.[0-9]+)?(E-?[0-9]+)?$/;
const NUMERAL = '-0123456789.E';
const SPACES = '\t \r';
const SPACE = ' ';
const SLASH = '/';
const STAR = '*';
const DASH = '-';
const TICK = '`';
const LINE = '\n';
const ESC = '\\';
const NIL = '';

class TokenStream {
  constructor(input) {
    this.input = input;
    this.cursor = 0; // input position
    this.array = []; // append-only token array
    this.index = -1; // current token index
    this.line = 1;
    this.column = 0;
    this.err = new SyntaxError();
  }
  eof() {
    return !this.input.charAt(this.cursor);
  }
  // Get current token.
  curr() {
    if (this.index < 0) return null;
    return this.array[this.index];
  }
  // Go forwards in the stream.
  next() {
    let tok = this.array[++this.index];
    if (!tok) this.array.push(tok = this._next());
    return tok;
  }
  // Go backwards in the stream.
  back() {
    if (this.index == 0) return null;
    return this.array[--this.index];
  }
  // Look ahead or behind in the stream.
  peek(offset = 1) {
    let i = this.index + offset;
    let tok, toks = this.array;
    while (i >= toks.length) {
      if (tok = this._next()) toks.push(tok);
      else return null;
    }
    return tok || toks[i];
  }
  // Read the token after the cursor.
  _next() {
    // Ignore whitespace
    let ch, i = -1;
    while (true) {
      ch = this._peek(++i);
      if (ch == NIL) return null;
      if (ch == LINE) {
        this.line++;
        this.column = 0;
        continue;
      }
      if (~SPACES.indexOf(ch)) {
        this.column++;
      } else {
        this.cursor += i;
        break;
      }
    }
    if (ch == DASH) {
      if (this._peek(1) == DASH) {
        this._readComment();
        return this._next();
      }
      let val = ch + this._peek(1);
      if (NUMBER.test(val)) {
        return this._readNumber(val);
      }
    }
    else if (ch == SLASH) {
      if (this._peek(1) == STAR) {
        this._readComment(true);
        return this._next();
      }
    }
    else if (ch == TICK) {
      return this._readIdent();
    }
    else if (~QUOTE.indexOf(ch)) {
      return this._readString(ch);
    }
    else if (~PUNCT.indexOf(ch)) {
      let tok = this._token('punct', ch);
      tok.end = this._hop(1);
      return tok;
    }
    else if (WORD.test(ch)) {
      if (!DIGIT.test(ch)) {
        return this._readWord(ch);
      }
      let val = ch, i = 0;
      while (true) {
        ch = this._peek(++i);
        if (ch && WORD.test(ch)) {
          val += ch;
          if (NUMERAL.indexOf(ch) == -1) {
            return this._readWord(val);
          }
        } else {
          if (ch && ~NUMERAL.indexOf(ch)) val += ch;
          return this._readNumber(val);
        }
      }
    }
    this._wtf(this._token(), 'Unexpected character ' + ch);
  }
  // Move the cursor.
  _hop(offset) {
    this.cursor += offset;
    this.column += offset;

    // Sanity check
    if (this.column < 0) throw Error('Invalid hop');
    return this.cursor;
  }
  // Advance the cursor until \n or EOF.
  _shift() {
    let ch = this.input.charAt(this.cursor);
    if (ch != NIL && ch != LINE) {
      this._hop(1);
      return ~SPACES.indexOf(ch) ? SPACE : ch;
    }
  }
  // Look around the cursor.
  _peek(offset) {
    return this.input.charAt(this.cursor + offset);
  }
  // Check if a char is escaped. Escaped escapes are detected.
  _isEscaped(offset) {
    let i = offset - 1;
    while (this._peek(i) == ESC) i--;
    return (i - offset) % 2 == 0;
  }
  // Create a token.
  _token(type, value) {
    return {
      type,
      value,
      line: this.line,
      column: this.column,
      start: this.cursor,
      end: undefined,
    };
  }
  // Throw a syntax error.
  _wtf(tok, msg) {
    this.err.message = msg;
    throw Object.assign(this.err, tok);
  }
  _readWord(val) {
    let tok = this._token('word', val);
    this._hop(val.length);
    while (true) {
      let ch = this._shift();
      if (!ch) {
        tok.end = this.cursor;
        return tok;
      }
      if (WORD.test(ch)) {
        tok.value += ch;
      } else {
        tok.end = this._hop(-1);
        return tok;
      }
    }
  }
  _readIdent() {
    let tok = this._token('ident', '');
    this._hop(1);
    let ch; while (true) {
      if (ch = this._shift()) {
        if (ch == TICK) {
          tok.end = this.cursor;
          return tok;
        }
        tok.value += ch;
      } else {
        this._wtf(tok, 'Malformed identifier');
      }
    }
  }
  _readString(QUOTE) {
    let tok = this._token('string', '');
    this._hop(1);
    let ch; while (true) {
      if (ch = this._shift()) {
        if (ch == QUOTE && !this._isEscaped(-1)) {
          tok.end = this.cursor;
          return tok;
        }
        tok.value += ch;
      } else {
        this._wtf(tok, 'Malformed string');
      }
    }
  }
  _readNumber(val) {
    let tok = this._token('number');
    this._hop(val.length);
    let ch; while (ch = this._shift()) {
      if (~NUMERAL.indexOf(ch)) {
        val += ch;
      } else {
        this._hop(-1);
        break;
      }
    }
    if (!NUMBER.test(val)) {
      this._wtf(tok, 'Malformed number');
    }
    tok.value = Number(val);
    tok.end = this.cursor;
    return tok;
  }
  _readComment(multi) {
    this._hop(2);
    if (multi) {
      while (true) {
        let ch = this._shift();
        if (!ch) {
          if (this._peek(0) == LINE) {
            this.cursor++;
            this.line++;
            this.column = 0;
          } else return;
        }
        else if (ch == STAR && this._peek(0) == SLASH) {
          return this._hop(1);
        }
      }
    } else {
      while (this._shift());
    }
  }
}

module.exports = TokenStream;
