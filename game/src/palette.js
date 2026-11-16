// Emberline's look plan, in one place. A dusk freight yard: indigo sky, warm sand,
// terracotta walls, teal for the player's side and amber for lights and warnings.
// Every colour in the game and the HUD comes from these names, so the scene stays
// in one palette instead of drifting into a rainbow.
export const PALETTE = {
  sky: '#1d2436',
  fog: '#2a2f45',
  ground: '#a97e50',
  sand: '#c9a06a',
  wall: '#7a5a3c',
  dark: '#4a3826',
  crate: '#8a6a42',
  container: '#b0562f',
  containerB: '#3f6b6a',
  ink: '#f2e8d5',
  muted: '#8b93a7',
  accent: '#2fb3a3',
  amber: '#f0a830',
  danger: '#e0543e',
  ally: '#2fb3a3',
  enemy: '#e0543e',
};

export function paletteColor(name) {
  return PALETTE[name];
}
