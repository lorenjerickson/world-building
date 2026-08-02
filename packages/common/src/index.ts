export * from './types';
export * from './canonical';
export * from './geometry';
export * from './subdivision';
export * from './chunking';
export * from './projection';
export * from './picking';
export * from './materials';
export * from './units';
export {
  buildTraitShape,
  resolveTraitShapeTerminal,
  selectTraitDefinitionScope,
  traitSatisfiesCollection,
  traitShapeChildren,
  traitShapeTerminalPaths,
} from './trait-shape';
export type {
  BuildTraitShapeInput,
  TraitGrantDataType,
  TraitMediaType,
  TraitShape,
  TraitShapeDefinition,
  TraitShapeDiagnostic,
  TraitShapeGrant,
  TraitShapeNode,
  TraitShapeTerminalPath,
} from './trait-shape';
