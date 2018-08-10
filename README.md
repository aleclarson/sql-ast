# sql-ast v0.1.2

The current goal of `sql-ast` is to parse the output of `mysqldump` into an AST.
If anyone wants to expand the capability of this library, feel free to send some
pull requests!

```js
const {parse} = require('sql-ast');

parse(input); // => [object Array]
```

*Note:* The current feature set is very limited. Open an issue if you have want
something that isn't supported yet.

### Whitespace
Tokens are *not* created for whitespace, which includes spaces, tabs (`\t`),
line breaks (`\n`), and carriage returns (`\r`).

### Comments
Tokens are *not* created for comments. Both styles are supported (`/*` and `--`).

### Token types
- `word` is a character group matching `/^[a-z0-9_$]+$/i`
- `ident` is a character group wrapped with backtick quotes
- `punct` is a character matching `/^[(),;=]$/`
- `string` is a character group wrapped with single or double quotes
- `number` is a character group matching `/^-?[0-9]+(\.[0-9]+)?(E-?[0-9]+)?$/`

Every token has these properties:
- `type: string`
- `value: string|number`
- `start: number`
- `end: number`

#### Notes
- The `value` of `number` tokens is a number literal.
- The `value` of `ident` and `string` tokens does not include the quotes.

### AST Node types
- `Node` is the superclass of all node types
- `Statement`
- `Attribute`
- `Column`
- `Index`
- `Row`

Every node has these properties:
- `start: number`
- `end: number`

#### Notes
- All node types are exported by the main module.
- They have no methods by default. Feel free to define methods as you see fit.
- More node types may be added in the future.
