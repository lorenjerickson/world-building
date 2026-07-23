import type { EncounterMaterialPalette } from './types';

export const PHASE0_MATERIAL_PALETTE: EncounterMaterialPalette = {
  version: 'core/1',
  materials: [
    { id: 'dirt', version: 1, kind: 'solid', physicalTileSizeInInches: 24, fallbackColor: '#75543a' },
    { id: 'grass', version: 1, kind: 'solid', physicalTileSizeInInches: 24, fallbackColor: '#5f7f3b' },
    { id: 'road', version: 1, kind: 'solid', physicalTileSizeInInches: 36, fallbackColor: '#9a835f' },
    { id: 'stone', version: 1, kind: 'solid', physicalTileSizeInInches: 24, fallbackColor: '#777b7d' },
    { id: 'water', version: 1, kind: 'water', physicalTileSizeInInches: 48, fallbackColor: '#2f89ad' },
    { id: 'wood', version: 1, kind: 'solid', physicalTileSizeInInches: 18, fallbackColor: '#805a37' },
  ],
};
