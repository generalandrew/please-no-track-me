// The engine's public surface. Pure and dependency-free: the same modules run in the
// extension, in the tests, and in the CI corpus runner. Nothing here touches a browser API.

export { makeRng } from './rng.js';
export { derivePersona, constrainChannels } from './persona.js';
export {
  classifyUrl, classifyParam, isStripOnly,
  splitUrl, joinUrl, parseQuery, serializeQuery, hostMatches, protectedNames,
} from './classify.js';
export { substituteEntry, stripInterior, shapePreserve } from './substitute.js';
