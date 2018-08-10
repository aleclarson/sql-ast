# sql-ast v0.1.0

The current goal of `sql-ast` is to parse the output of `mysqldump` into an AST.
If anyone wants to expand the capability of this library, feel free to send some
pull requests!

```js
const {parse} = require('sql-ast');

parse(input); // => [object Array]
```

*Note:* The current feature set is very limited. Open an issue if you have want
something that isn't supported yet.
