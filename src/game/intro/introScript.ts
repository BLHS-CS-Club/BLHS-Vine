import type { Script } from '../cutscene/types'

// The opening on the beach, written as cutscene data. Thor wakes up and the tide brings in a
// bottle.

const SPAWN = { x: 58.2, y: 56.4 }             // Just above the tide line, so the waves show in frame.
const BOTTLE_D = 3                              // The shore column just east of the spawn.
// The bottle comes to rest at s = shoreAt(3)+1.22, about 111.05, which is tile (57.0, 54.0). Thor
// stops a little short of it.
const BOTTLE_AT = { x: 57.0, y: 54.0 }
const WALK_STOP = { x: 57.7, y: 54.9 }

export const introI1I2: Script = {
  id: 'intro',
  steps: [
    // ---- I-1 · waking up ----
    { t: 'fade', to: 1, ms: 0 },                               // Start on a black screen.
    { t: 'letterbox', on: true, ms: 0 },
    { t: 'vignette', to: 0.8, ms: 0 },                         // Start with an 80% vignette already on.
    { t: 'actorPlace', actor: 'thor', at: SPAWN, face: 'south' },
    { t: 'actorState', actor: 'thor', state: 'lie' },
    { t: 'camera', to: SPAWN, zoom: 2.3, ms: 0 },              // Close up on Thor asleep.
    { t: 'audio', cue: 'surf-in' },                            // The sound comes in before the picture.
    { t: 'wait', ms: 700 },
    { t: 'fade', to: 0, ms: 2800 },                            // Fade in, like eyes opening.
    { t: 'wait', ms: 1100 },                                   // A pause on the cove inside the vignette.
    { t: 'actorState', actor: 'thor', state: 'sit' },
    { t: 'fx', name: 'sandScatter' },
    { t: 'vignette', to: 0.45, ms: 1400 },
    { t: 'wait', ms: 1000 },
    { t: 'say', who: 'Thor', text: 'Ugh. Sand. A whole lot of sand.' },
    { t: 'say', who: 'Thor', text: 'Last thing I remember is water. So much water.' },
    { t: 'actorState', actor: 'thor', state: 'idle' },         // Thor stands up.
    { t: 'fx', name: 'sandScatter' },
    { t: 'vignette', to: 0, ms: 1600 },                        // Fade the vignette out to the map's own colors.
    { t: 'camera', to: SPAWN, zoom: 1.7, ms: 1600 },           // Zoom out to normal scene scale.
    { t: 'say', who: 'Thor', text: '...Where is this?' },

    // I-2, the bottle. Keep this part quick and impossible to miss.
    { t: 'wait', ms: 400 },                                    // A short pause on the cove.
    { t: 'stage', call: 'bottleWave', data: { d: BOTTLE_D } }, // The bottle rides in on the first wave.
    { t: 'wait', ms: 300 },
    { t: 'actorFace', actor: 'thor', dir: 'north' },           // Thor turns and spots the bottle.
    { t: 'camera', to: BOTTLE_AT, zoom: 2.1, ms: 800 },        // The camera looks at the bottle.
    { t: 'fx', name: 'glint', at: BOTTLE_AT },
    { t: 'caption', text: 'Something washed ashore.', ms: 1200 },
    { t: 'camera', to: SPAWN, zoom: 1.7, ms: 700 },            // Back to Thor for the player's turn.
    { t: 'stage', call: 'pointAt', data: BOTTLE_AT },          // Point the guide arrow at the bottle.
    { t: 'fx', name: 'glint', at: BOTTLE_AT },
    /* The first instruction in the game. It leads with clicking, since every student can do that. */
    { t: 'gate', kind: 'walkTo', target: WALK_STOP, radius: 0.9, prompt: 'Click the bottle to walk there. Arrow keys work too', idleAutoMs: 6000 },
    { t: 'stage', call: 'pointClear' },
    { t: 'actorFace', actor: 'thor', dir: 'north-west' },
    { t: 'camera', to: BOTTLE_AT, zoom: 2.6, ms: 2500 },       // Slowly zoom in on the bottle.
    { t: 'fx', name: 'glint', at: BOTTLE_AT },                 // Sunlight flashes off the glass.
    { t: 'wait', ms: 700 },
    { t: 'audio', cue: 'cork-pop' },
    { t: 'wait', ms: 500 },
    // The parchment unrolls and becomes the I-3 session. This ui gate hands control to React.
    { t: 'gate', kind: 'ui', id: 'i3-session' },
    // ---- return to the world (I-3 done: parchment rolled up, Thor pockets it) ----
    { t: 'stage', call: 'applyLook' },                         // Thor keeps the coat color the player picked.
    { t: 'stage', call: 'hideBottle' },
    { t: 'camera', to: WALK_STOP, zoom: 1.7, ms: 1200 },
    { t: 'cameraFollow', actor: 'thor' },

    // ---- I-4 · the walk to the port (the player walks, and the pier is the only way out) ----
    { t: 'say', who: 'Thor', text: 'That is my boat, down at the pier. Time to walk down and take it.' },
    { t: 'stage', call: 'showBoatName' },                      // The boat's new name shows at the berth.
    { t: 'stage', call: 'pointAt', data: { x: 73, y: 44.5 } }, // The guide arrow points at the pier first.
    { t: 'gate', kind: 'walkTo', target: { x: 73, y: 44.5 }, radius: 1.3, prompt: 'Walk to the pier', idleAutoMs: 14000 },
    { t: 'stage', call: 'pointAt', data: { ship: true } },     // Then it points at the ship.
    { t: 'gate', kind: 'walkTo', target: { x: 73, y: 33 }, radius: 1.4, prompt: 'Walk to your boat', idleAutoMs: 12000 },
    { t: 'stage', call: 'pointClear' },
    { t: 'stage', call: 'boardShip' },                         // Thor hops onto the deck.

    // ---- I-5 · setting sail (the one big button moment) ----
    { t: 'wait', ms: 600 },
    { t: 'gate', kind: 'ui', id: 'set-sail' },                 // The big carved Set Sail button.
    { t: 'audio', cue: 'sail-snap' },
    { t: 'stage', call: 'pilotTo' },                           // The ship sails ahead, turns starboard, and heads out.
    { t: 'wait', ms: 400 },
    { t: 'letterbox', on: false },
    // The script ends here and the scene switches maps: first the BLHS Islands loading painting,
    // then the island map. That part lives in IntroScene's onDone.
  ],
}
