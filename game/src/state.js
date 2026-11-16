// The whole match in one object. Every system reads and writes this and nothing
// else: there is no second copy of the round, the score or the bomb anywhere, so
// the HUD, the bots and the round machine can never disagree about what is happening.
export function createState() {
  return {
    phase: 'menu', // menu | buy | play | roundEnd | matchEnd
    round: 1,
    maxRounds: 15,
    winTarget: 8,
    score: { atk: 0, def: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    timer: 100,
    roundTime: 100,
    buyTime: 15,
    bomb: {
      state: 'idle', // idle | carried | planted | detonated | defused
      site: null, // 'A' | 'B'
      position: null, // THREE.Vector3 when planted
      fuse: 35,
      plantProgress: 0,
      defuseProgress: 0,
      planter: null,
      defuser: null,
    },
    streak: { atk: 0, def: 0 },
    winner: null, // 'atk' | 'def' | 'draw'
    roundWinner: null,
    roundReason: '',
    agents: [], // every living/dead agent, player first
    feed: [], // killfeed lines, newest first
    time: 0,
  };
}
