// Distress trigger phrases (docs/GATE.md step 2, clarification 6). Deliberately narrow: bereavement, self-harm,
// abuse and medical emergencies go to a human; ordinary worry about a lost card does not. Pure: no I/O, no clock.
import { normalizeQuote, phrase } from './coaching-lexicon';

export interface DistressResult {
  distress: boolean;
  /** Category ids in lexicon order (never the caller's words). */
  cues: string[];
}

const PERSON =
  '(my |his |her |our )?(father|mother|dad|mom|mum|papa|mummy|husband|wife|son|daughter|brother|sister|grandfather|grandmother|he|she)';
/** Someone who can force, beat or threaten the caller — never "you" (the bank) or "the app". */
const PERSON_SUBJECT = `(${PERSON}|they|someone|somebody)`;
const PERSON_HI_ROMAN =
  '(papa|maa|mummy|pitaji|mataji|pati|patni|beta|beti|bhai|behen|dadi|dada|nani|nana|father|mother|husband|wife|son|daughter)';
const PERSON_HI = '(पापा|पिताजी|माँ|मां|मम्मी|पति|पत्नी|बेटा|बेटी|भाई|बहन)';

// Every Hinglish/Hindi pattern names a person or the caller ("mujhe"): "do din guzar gaye" (two days have
// passed), "machhar marta hai" or "hospital mein ATM hai" are everyday talk, not distress.
const CATEGORIES: readonly { id: string; patterns: readonly RegExp[] }[] = [
  {
    id: 'bereavement',
    patterns: [
      phrase('passed away'),
      phrase(`${PERSON} (has |had )?(died|expired)`),
      // Bare "passed" is also exams and payments; only these forms mean a death.
      phrase(`${PERSON} (has |had )?passed (on|recently)`),
      phrase(`${PERSON} is no more`),
      phrase('death certificate'),
      phrase('(fathers|mothers|husbands|wifes|sons|daughters|brothers|sisters) death'),
      phrase(`${PERSON_HI_ROMAN}( ji)? (guzar|gujar) (gaye|gayi|gaya|gai)`),
      phrase(`${PERSON_HI_ROMAN} (nahi|nahin) (rahe|rahi)`),
      phrase('(dehant|swargvas|nidhan)'),
      phrase('(देहांत|निधन|स्वर्गवास|मृत्यु)'),
      phrase(`${PERSON_HI}( जी)? गुजर (गए|गई|गया)`),
      phrase(`${PERSON_HI} (नहीं रहे|नहीं रही)`),
    ],
  },
  {
    id: 'self_harm',
    patterns: [
      phrase('(kill|hurt) myself'),
      phrase('end my life'),
      phrase('(suicide|want to die)'),
      phrase('(khudkushi|aatmhatya|atmahatya)'),
      phrase('marna (chahta|chahti)'),
      phrase('jaan de (dunga|dungi|doonga|doongi)'),
      phrase('(आत्महत्या|खुदकुशी)'),
      phrase('(मरना चाहता|मरना चाहती|जान दे दूंगा|जान दे दूंगी)'),
    ],
  },
  {
    id: 'abuse',
    patterns: [
      phrase(`${PERSON_SUBJECT} (is |are |was |were |has |had )?(forcing|forced) me`),
      phrase(
        `${PERSON_SUBJECT} (is |are |was |were )?(beats|beating|hits|hitting|threatens|threatening|threatened) me`,
      ),
      phrase('domestic violence'),
      phrase('(mujhse|mujhe|humse|mere saath) (zabardasti|jabardasti)'),
      phrase('(zabardasti|jabardasti) (karwa|karva|karta|karti|karte|kar) (raha|rahi|rahe|hai|hain)'),
      phrase('(mujhe|mujhko|hume|humein) (maarta|marta|maarti|marti|maarte|marte) (hai|hain)'),
      phrase('(dhamka|dhamki) (raha|rahi|de)'),
      phrase('(धमका|धमकी|मारपीट)'),
      phrase('(मुझसे|मुझे) जबरदस्ती'),
      phrase('मुझे (मारता|मारती|मारते) (है|हैं)'),
    ],
  },
  {
    id: 'medical_emergency',
    patterns: [
      phrase('(icu|intensive care|ambulance|emergency surgery|hospitalised|hospitalized)'),
      // A past event, not "I'll get a heart attack" (what a panicking caller says about a lost card).
      phrase('(had|has|got|suffered) (a )?(heart attack|stroke)'),
      phrase('heart attack (aaya|aya|hua|hui)'),
      phrase(`${PERSON} (is |was |has been )?(admitted )?(in|to|into) (the )?hospital`),
      phrase('admitted (in|to|into) (the )?hospital'),
      phrase(`${PERSON_HI_ROMAN}( ji)? (aspatal|hospital) (mein|me|main)`),
      phrase('(aspatal|hospital) (mein|me|main) (bharti|bhartee|admit)'),
      phrase('(आईसीयू|दिल का दौरा (पडा|आया))'),
      phrase(`${PERSON_HI}( जी)? अस्पताल में`),
      phrase('अस्पताल में भर्ती'),
    ],
  },
];

export function detectDistress(quotes: readonly string[]): DistressResult {
  const text = quotes.map(normalizeQuote).join(' \n ');
  const cues = CATEGORIES.filter((c) => c.patterns.some((p) => p.test(text))).map((c) => c.id);
  return { distress: cues.length > 0, cues };
}
