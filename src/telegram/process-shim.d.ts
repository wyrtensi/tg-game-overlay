// The npm package "process" (a browser polyfill for the ambient Node
// `process` global) ships no type declarations. We only ever assign its
// default export to `globalThis.process` and never inspect it ourselves, so
// an ambient `any` module is enough here.
declare module "process";
