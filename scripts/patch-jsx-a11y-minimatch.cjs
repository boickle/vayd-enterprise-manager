#!/usr/bin/env node
/**
 * Patches eslint-plugin-jsx-a11y to work with minimatch v10 (default export shape changed).
 * Run after npm install when using overrides to force minimatch ^10.2.1.
 */
const fs = require('fs');
const path = require('path');

const pluginPath = path.join(__dirname, '../node_modules/eslint-plugin-jsx-a11y');
const files = [
  'lib/util/mayContainChildComponent.js',
  'lib/util/mayHaveAccessibleLabel.js',
];

const requireLine = /var _minimatch = _interopRequireDefault\(require\("minimatch"\)\);/;
const compatLine = 'var _minimatch = _interopRequireDefault(require("minimatch"));\nvar _minimatchFn = typeof _minimatch.default === \'function\' ? _minimatch.default : (_minimatch.default && _minimatch.default.minimatch) || _minimatch.minimatch || _minimatch.default;';
const usagePattern = /\(0, _minimatch\["default"\]\)/g;
// Match existing compat block so we can re-apply updated patch
const existingCompatBlock = /var _minimatch = _interopRequireDefault\(require\("minimatch"\)\);\nvar _minimatchFn = [^;]+;/;

if (!fs.existsSync(pluginPath)) {
  process.exit(0);
}

for (const file of files) {
  const filePath = path.join(pluginPath, file);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('_minimatchFn')) {
    content = content.replace(existingCompatBlock, compatLine);
  } else if (requireLine.test(content)) {
    content = content.replace(requireLine, compatLine);
  } else {
    continue;
  }
  content = content.replace(usagePattern, '_minimatchFn');
  fs.writeFileSync(filePath, content);
}
