# sql-ast v0.3.0

The current goal of `sql-ast` is to parse the output of `mysqldump` into an AST.
If anyone wants to expand the capability of this library, feel free to send some
pull requests!

```js
const {parse} = require('sql-ast');

parse(input); // => [object Array]
```

*Note:* The current feature set is very limited. Open an issue if you have want
something that isn't supported yet.

&nbsp;

### Whitespace

Tokens are *not* created for whitespace.

This includes spaces, tabs (`\t`), line breaks (`\n`), and carriage returns (`\r`).

### Comments

Tokens are *not* created for comments.

All three styles are supported: `/*`, `--`, and `#`.

One exception is `/*!`-style comments, which annotate the minimum MySQL version
required to run the statement(s) or apply the attribute(s) contained within.
Special `version` tokens are created for these comments.

&nbsp;

### Token types

- `word` is a character group matching `/^[a-z0-9_$]+$/i`
- `ident` is a character group wrapped with backtick quotes
- `punct` is a character matching `/^[(),.;=]$/`
- `string` is a character group wrapped with single or double quotes
- `number` is a character group matching `/^-?[0-9]+(\.[0-9]+)?(E-?[0-9]+)?$/`
- `variable` is a character group matching `/^@@?[$._a-z]+$/i`
- `version` is a `/*!`-style comment or its `*/` closer

Every token has these properties:
- `type: string`
- `value: string|number`
- `start: number`
- `end: number`

#### Notes
- The `value` of a `number` is a number literal.
- The `value` of a `ident` or `string` does not include the quotes.
- The `value` of a `version` tells you the minimum MySQL version required
  before any following tokens can be used. This remains in effect until another
  `version` token is found.
- When the `value` of a `version` token is:
  - `> 0` a minimum version of MySQL is required
  - `== 0` no minimum version, but MySQL is required
  - `== -1` MySQL is *not* required

&nbsp;

### AST Nodes

Every AST node extends the `Node` class and has `start` and `end` properties.

`Action` nodes are typically owned by statements that perform actions (eg: `ALTER`).

`Attribute` nodes are typically owned by statements, column definitions, and index
definitions. Some examples are `IF EXISTS` and `ENGINE=ISAM`.

`Column` and `Index` nodes are owned by `CREATE TABLE` statements.

`Literal` and `Variable` nodes are created for value expressions.

`Variable` nodes are also created when a `SET` statement sets a variable.
In this case, the node has a `value` property.

`Row` nodes are owned by `INSERT` and `REPLACE` statements.

`Statement` nodes only exist in the top-level array returned by `parse`.

#### Notes
- All node types are exported by the main module.
- They have no methods by default. Feel free to define methods as you see fit.
- More node types may be added in the future.
