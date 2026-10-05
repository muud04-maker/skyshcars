// Loads compiled rule modules from .check-build.
const path = require('node:path');
module.exports = (mod) => require(path.join(__dirname, '..', '..', '.check-build', 'src', 'lib', mod));
