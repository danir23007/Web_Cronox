// Jest's CJS sandbox does not implement Node 22's synchronous require(ESM).
// Transform only allowlisted HTML parser dependencies; production uses Node.
const ts = require('typescript');
module.exports = {
  process(source, filename) {
    return { code: ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText };
  },
};
