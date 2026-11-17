// The class beats, 2 to 3 minutes each, built from the real course catalog.

import type { CheckStep } from '../../vine/contract'
import type { ClassDef } from '../planner/catalog'
import type { SaveGame } from '../save'
import { beatPassed } from './state'
import { classById } from '../planner/catalog'
import { placeOfDept, type MapId, type Place } from '../roster/roster'
import type { BeatStep, CoreBeat } from './frames'

/* Where a class is in the school, looked up through the roster. A field is left out when no source
 * gives it. */
export type ClassPlacement = {
  /** The roster place, if a source has put this department somewhere. */
  place?: Place
  /* The painting the student would arrive at. It's left out while the place has no painting, so an
   * arrow is only drawn when there's somewhere real to point. */
  map?: MapId
  /** The location line the beat prints. It only names what a source backs up. */
  line: string
}

export function classPlacement(c: ClassDef, places?: readonly Place[]): ClassPlacement {
  const place = placeOfDept(c.dept, places)
  /* The line is written for the player. With no sourced place, it names the school and doesn't
   * claim a room. */
  if (!place) return { line: 'a classroom at Bonney Lake High School' }
  return {
    place,
    map: place.arrival,
    line: place.room ? `${place.name}, ${place.room}` : place.name,
  }
}

const T = 'The instructor'

function cordCheck(c: ClassDef): CheckStep {
  const isAp = c.tags.includes('ap')
  const isCte = c.tags.includes('cte')
  const isCapstone = c.tags.includes('lang-capstone')
  const isLang = c.tags.includes('lang')

  /* CTE is spelled out on every button that uses it. Nothing in a class beat explains the acronym,
   * and these buttons are where the student first sees it. */
  const AP = { text: 'AP Honors. Five passed AP classes earn it.', key: 'ap' }
  const CTE = { text: 'Career Readiness. It counts as a Career and Technical Education credit.', key: 'cte' }
  const SEAL = { text: 'The Seal of Biliteracy. Language credits add up toward it.', key: 'lang' }
  const BOTH = { text: 'Two at once. AP Honors and a Career and Technical Education credit.', key: 'both' }
  const CAP = { text: 'It can finish the four language credits for the Seal of Biliteracy.', key: 'cap' }
  const NONE = { text: 'No cord comes from this one. Some classes you take because you want to.', key: 'none' }

  const correctKey = isAp && isCte ? 'both' : isCapstone ? 'cap' : isAp ? 'ap' : isCte && isLang ? 'both-lang' : isCte ? 'cte' : isLang ? 'lang' : 'none'
  // Build exactly three options: one correct, and two wrong ones taken from the other cords.
  const pool = [AP, CTE, SEAL, BOTH, CAP, NONE]
  const correct =
    correctKey === 'both' ? BOTH
      : correctKey === 'cap' ? CAP
        : correctKey === 'ap' ? AP
          : correctKey === 'both-lang' ? { text: 'Two at once. A Career and Technical Education credit, and it counts toward your language credits.', key: 'both-lang' }
            : correctKey === 'cte' ? CTE
              : correctKey === 'lang' ? SEAL
                : NONE
  const distractors = pool.filter((o) => o.key !== correct.key && o.key !== 'both' && o.key !== 'cap').slice(0, 2)
  // A class that counts for two things makes each single-cord option half true, and the reply says
  // so.
  const dual = correctKey === 'both' || correctKey === 'both-lang'
  const options = [...distractors.map((o) => ({
    text: o.text,
    reply: dual && (o.key === 'ap' || o.key === 'cte' || o.key === 'lang')
      ? 'True, but only half of it. This class counts for two things.'
      /* A wrong reply turns down the pick without stating anything the catalog might contradict. */
      : 'Not quite. Check what this class counts toward.',
  })),
  { text: correct.text, correct: true, reply: 'Exactly. The counselor keeps count either way.' }]

  return {
    kind: 'choice', id: `${c.id}-cord`,
    prompt: `Which honor does ${c.name} count toward?`,
    options,
    objective: 'know what the class counts toward',
  }
}

function ladderCheck(c: ClassDef): CheckStep | null {
  if (!c.requires) return null
  const req = classById(c.requires)
  if (!req) return null
  return {
    kind: 'choice', id: `${c.id}-ladder`,
    prompt: `What do you need before you can take ${c.name}?`,
    options: [
      { text: 'Nothing. It is open to anyone', reply: `It builds on ${req.name}, so you take that one first.` },
      { text: `${req.name}, from an earlier year`, correct: true, reply: 'Right. That one comes first.' },
      { text: 'A signed permission slip', reply: `No slip needed. Just ${req.name} first.` },
    ],
    objective: 'know the prerequisite',
  }
}

/** Builds a class beat of 2 to 3 minutes, on the same frame as the core beats. */
export function classBeat(c: ClassDef, year: number): CoreBeat {
  const steps: BeatStep[] = [
    { kind: 'say', line: { speaker: T, text: `${c.name}. Take a seat.` } },
    {
      kind: 'say', line: {
        speaker: T,
        text: c.requires && classById(c.requires)
          ? `This class builds on ${classById(c.requires)!.name}, which you already took. That is why you can be here.`
          : `No class is required before this one. Anyone can take it.`,
      },
    },
    { kind: 'check', check: cordCheck(c) },
  ]
  const ladder = ladderCheck(c)
  if (ladder) steps.push({ kind: 'check', check: ladder })
  steps.push({ kind: 'say', line: { speaker: T, text: 'That is the class. Your grade goes on your transcript either way, so make the semester count.' } })

  return {
    id: `class:${c.id}`,
    year,
    title: c.name,
    place: classPlacement(c).line,
    kind: 'class',
    tags: c.tags,
    credit: 0.5,
    takeaways: [],
    steps,
  }
}

/** True if this class has been sat already, in any year, going by the ledger. */
export const classDone = (ledger: { id: string }[], classId: string): boolean =>
  ledger.some((e) => e.id === `class:${classId}`)

/** The class id the way the ledger spells it, so nobody builds the string by hand. */
export const classLedgerId = (classId: string): string => `class:${classId}`

/* True if the class was sat and passed, which is what the year gate checks. */
export const classPassed = (s: SaveGame | null, classId: string): boolean =>
  beatPassed(s, classLedgerId(classId))
