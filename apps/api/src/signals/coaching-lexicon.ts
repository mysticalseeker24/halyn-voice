// Layer 1 of the coaching score (docs/GATE.md "Coaching score"): keywords in English, Hinglish and Hindi.
// Scam-pattern detection lives in code only, never in a Bolna prompt (docs/COMPLIANCE.md). Pure: no I/O, no clock.

export type CueStrength = 'strong' | 'weak';

export interface CoachingCue {
  id: string;
  strength: CueStrength;
  patterns: readonly RegExp[];
}

export interface CoachingResult {
  /** 0–1. ≥ 2 strong cues → ≥ 0.7; one strong cue stays below the 0.6 threshold. */
  score: number;
  /** Cue ids in lexicon order (never the caller's words). */
  cues: string[];
}

const WORD = '\\p{L}\\p{M}\\p{N}';
// Devanagari nukta: "गुज़र" and "गुजर" are the same word to a caller, so it is folded away on both sides.
const NUKTA = /़/g;
// Invisible format characters (zero-width space/joiners, soft hyphen, BOM) that STT and copy-paste leave inside
// words; left in, they split "safe account" into two unrelated tokens.
const FORMAT = /\p{Cf}/gu;
// Apostrophes of every shape, so "don’t", "don‘t" and "donʼt" all become "dont".
const APOSTROPHES = /['‘’ʼ`]/g;

/** Lower-case, width-folded, no invisible characters or punctuation, single spaces. Shared by both lexicons. */
export function normalizeQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(FORMAT, '')
    .replace(NUKTA, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Account words in both scripts (callers mix them: "सेफ account", "RBI खाता"), incl. the common "acount" slip.
const ACCOUNT = '(acc?oun?t|acc|khaa?ta|खाता|खाते|अकाउंट)';

/**
 * A whole-phrase pattern over normalised text: spaces match any whitespace, and the phrase may not be glued to
 * letters on either side. Works for Devanagari, where `\b` does not.
 */
export function phrase(source: string): RegExp {
  const body = source.normalize('NFKC').replace(NUKTA, '').replace(/ /g, '\\s+');
  return new RegExp(`(?<![${WORD}])(?:${body})(?![${WORD}])`, 'u');
}

export const COACHING_CUES: readonly CoachingCue[] = [
  {
    id: 'safe_account',
    strength: 'strong',
    patterns: [phrase(`(safe|secure|surakshit|suraksha|safety|सुरक्षित|सेफ) ${ACCOUNT}`)],
  },
  {
    id: 'verification_account',
    strength: 'strong',
    patterns: [phrase(`(verifi?cation|verify|verified|सत्यापन|वेरिफिकेशन) ${ACCOUNT}`)],
  },
  {
    id: 'regulator_account',
    strength: 'strong',
    patterns: [phrase(`(rbi|reserve bank|आरबीआई|रिजर्व बैंक)( ka| ke| ki| का| के| की)? ${ACCOUNT}`)],
  },
  {
    id: 'authority_instruction',
    strength: 'strong',
    patterns: [
      phrase(
        '(officer|police|cbi|customs|inspector|adhikari) (said|told|says|tells|asked|ne (bola|kaha|boli|kahi))',
      ),
      phrase('(पुलिस|अधिकारी|ऑफिसर|सीबीआई|कस्टम) ने (कहा|बोला|बताया)'),
    ],
  },
  {
    id: 'parcel_seized',
    strength: 'strong',
    patterns: [
      phrase('parcel( \\S+){0,4} (seized|held|stopped|blocked|pakda|pakdaa|jabt|zabt)'),
      phrase('पार्सल( \\S+){0,3} (जब्त|पकडा|रोका)'),
    ],
  },
  {
    id: 'digital_arrest',
    strength: 'strong',
    patterns: [phrase('digital arrest'), phrase('डिजिटल अरेस्ट')],
  },
  {
    id: 'legal_threat',
    strength: 'strong',
    patterns: [
      phrase('arrest warrant'),
      phrase('warrant (against|in your name|issued)'),
      phrase('money laundering'),
      phrase('(case|fir) (against|registered against|on) (you|me|your name)'),
      phrase('(aapke|apke|tumhare) naam (par|pe|pr) (case|fir|warrant)'),
      phrase('(giraftari|girftari)'),
      phrase('(गिरफ्तारी|मनी लॉन्ड्रिंग)'),
    ],
  },
  {
    // "Don't tell anyone" about the call — not the bank's own advice to keep an OTP or PIN to yourself.
    id: 'secrecy',
    strength: 'strong',
    patterns: [
      phrase(
        '(dont|do not|not to|never|should not|shouldnt|must not|mustnt) tell (anyone|anybody|any one|your family|family|the bank|your wife|your husband|your son|your daughter)(?! (your |the |my )?(otp|pin|password|cvv))',
      ),
      phrase('keep (it|this) (a )?secret'),
      // "kisi ko", "kisiko", "kisi se", optionally "bhi" — but not "OTP kisi ko mat batana", the bank's advice.
      phrase(
        '(?<!(otp|pin|password|cvv) )kisi(ko| ko| se)( bhi)? (mat|mt|na|nahi|nahin) (batana|batao|batayein|bataiye|bolna|bolo|kehna|kahna)(?! (apna |your |the )?(otp|pin|password|cvv))',
      ),
      phrase(
        '(?<!(ओटीपी|पिन|पासवर्ड) )किसी(को| को| से)( भी)? (मत|न|नहीं) (बताना|बताओ|बताएं|बताइए|बोलना|कहना)(?! (अपना )?(ओटीपी|पिन|पासवर्ड))',
      ),
    ],
  },
  {
    id: 'protect_money',
    strength: 'strong',
    patterns: [
      phrase('(protect|secure|save|safeguard) (your|my|the) (money|funds|savings|paisa)'),
      phrase('(paisa|paise) (safe|surakshit) (karne|rakhne)'),
      phrase('(पैसा|पैसे) (सुरक्षित|सेफ) (करने|रखने)'),
    ],
  },
  {
    id: 'remote_access',
    strength: 'strong',
    patterns: [
      phrase('(anydesk|any desk|teamviewer|team viewer|rustdesk|quicksupport|quick support|airdroid)'),
      phrase('screen (share|sharing)'),
      phrase('share (your |my |the )?screen'),
      phrase('स्क्रीन (शेयर|शेअर)'),
    ],
  },
  {
    id: 'stay_on_line',
    strength: 'strong',
    patterns: [
      phrase('stay on the (line|call|phone)'),
      phrase('(dont|do not|never) (hang up|disconnect|cut the call|end the call)'),
      phrase('(call|phone) (mat|na|nahi) (kaatna|katna|kaato|kato|rakhna)'),
      phrase('(कॉल|फोन) (मत|न) (काटना|काटें|काटो|रखना)'),
    ],
  },
  {
    id: 'share_otp',
    strength: 'strong',
    patterns: [
      phrase('(?<!(never|dont|do not|not|wont|will not) )(share|tell|give|read out|send) ((\\S+ ){0,3})?otp'),
      // …but "OTP share mat karna" ("don't share the OTP") is the bank's advice, not an instruction.
      phrase('otp (share|bata|batao|batana|de do|dena|bhej|bhejo)(?! (mat|mt|na|nahi|nahin))'),
      phrase('ओटीपी (बताओ|बताना|बता|दे|दो|शेयर|भेजो)(?! (मत|न|नहीं))'),
    ],
  },
  {
    id: 'urgency',
    strength: 'weak',
    patterns: [
      phrase('(urgent|urgently|immediately|right now|asap|quickly|jaldi|turant|abhi ke abhi)'),
      phrase('(तुरंत|जल्दी|फौरन)'),
    ],
  },
];

/** Score the caller's last few sentences. Each cue counts once, however often it is said. */
export function scoreCoaching(quotes: readonly string[]): CoachingResult {
  const text = quotes.map(normalizeQuote).join(' \n ');
  const fired = COACHING_CUES.filter((cue) => cue.patterns.some((p) => p.test(text)));
  const strong = fired.filter((c) => c.strength === 'strong').length;
  const weak = fired.length - strong;
  // Integer hundredths, so the score never carries float noise into comparisons with the threshold.
  const base = strong >= 2 ? 70 + 10 * (strong - 2) : 40 * strong;
  return { score: Math.min(100, base + 5 * weak) / 100, cues: fired.map((c) => c.id) };
}
