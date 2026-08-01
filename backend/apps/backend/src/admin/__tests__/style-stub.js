/**
 * Stand-in for a CSS import under Jest.
 *
 * Vite turns `import "./analytics.css"` into a side effect that injects a
 * stylesheet; Jest has no such loader and would fail parsing the file as
 * JavaScript. The rules themselves are asserted as text in
 * `styles.admin.spec.tsx`, so nothing is lost by stubbing the import here.
 */
module.exports = {};
