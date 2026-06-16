const path = require("path");
const Module = require("module");

const workspaceNodeModules = path.resolve(__dirname, "..", "..", "transgest-backend", "node_modules");
const nodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
if (!nodePath.includes(workspaceNodeModules)) {
  process.env.NODE_PATH = [workspaceNodeModules, ...nodePath].join(path.delimiter);
  Module._initPaths();
}
if (!module.paths.includes(workspaceNodeModules)) {
  module.paths.push(workspaceNodeModules);
}
if (!Module.globalPaths.includes(workspaceNodeModules)) {
  Module.globalPaths.push(workspaceNodeModules);
}
