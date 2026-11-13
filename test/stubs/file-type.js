// Jest stub for the ESM-only `file-type` package, which jest's CJS runtime
// cannot parse. Specs never exercise real MIME sniffing.
module.exports = {
  fileTypeFromBuffer: async () => undefined,
  fileTypeFromStream: async () => undefined,
  fileTypeFromFile: async () => undefined,
};
