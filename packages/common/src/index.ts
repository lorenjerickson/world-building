export * from './types';
export * from './canonical';
export * from './geometry';
export * from './subdivision';
export * from './chunking';
export * from './projection';
export * from './picking';
export * from './materials';
export {
  buildTraitShape,
  resolveTraitShapeTerminal,
  traitSatisfiesCollection,
  traitShapeChildren,
} from './trait-shape';
export type {
  BuildTraitShapeInput,
  TraitGrantDataType,
  TraitShape,
  TraitShapeDefinition,
  TraitShapeDiagnostic,
  TraitShapeGrant,
  TraitShapeNode,
} from './trait-shape';
