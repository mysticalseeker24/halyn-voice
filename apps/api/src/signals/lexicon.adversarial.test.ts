import { describe, expect, it } from 'vitest';
import { normalizeQuote, scoreCoaching } from './coaching-lexicon';
import { detectDistress } from './distress-lexicon';

// Adversarial cases for the keyword layer. Both directions matter: a missed coaching cue lets a coached transfer
// reach a step-up the victim will approve; a false distress hit holds an ordinary call (even a card freeze).

const ZWSP = '​';
const ZWJ = '‍';
const ZWNJ = '‌';
const SOFT_HYPHEN = '­';
const NBSP = ' ';

describe('normalizeQuote survives what speech-to-text and copy-paste leave behind', () => {
  it.each([
    ['zero-width space inside a phrase', `safe${ZWSP} account`],
    ['zero-width space inside a word', `sa${ZWSP}fe account`],
    ['zero-width joiner', `safe${ZWJ} account`],
    ['zero-width non-joiner', `safe ${ZWNJ}account`],
    ['soft hyphen', `safe acc${SOFT_HYPHEN}ount`],
    ['no-break space', `safe${NBSP}account`],
    ['full-width letters', 'ｓａｆｅ ａｃｃｏｕｎｔ'],
    ['upper case and extra spaces', '  SAFE     ACCOUNT  '],
    ['punctuation splitting the phrase', 'safe, account'],
    ['a line break', 'safe\naccount'],
  ])('%s still reads as "safe account"', (_, text) => {
    expect(normalizeQuote(text)).toBe('safe account');
  });

  it.each([
    ['curly apostrophe', 'don’t'],
    ['left single quote', 'don‘t'],
    ['modifier apostrophe', 'donʼt'],
    ['full-width apostrophe', 'don＇t'],
  ])('%s is folded like a plain apostrophe', (_, text) => {
    expect(normalizeQuote(text)).toBe('dont');
  });

  it('strips zero-width characters from Devanagari without breaking the words', () => {
    expect(normalizeQuote(`किसी${ZWJ} को मत बताना`)).toBe('किसी को मत बताना');
  });
});

describe('coaching cues: spelling and script variants', () => {
  it.each([
    ['secrecy', 'kisiko mat batana'],
    ['secrecy', 'kisi ko bhi mat bolna'],
    ['secrecy', 'kisi se mat kehna'],
    ['secrecy', 'किसी को भी मत बताना'],
    ['secrecy', 'किसी से मत कहना'],
    ['secrecy', `Do${ZWSP}n’t tell anyone about this call`],
    ['secrecy', 'Don‘t tell anyone about this call'],
    ['safe_account', 'transfer it to the safe acount'],
    ['safe_account', `paisa safe ${ZWNJ}account mein daalo`],
    ['safe_account', 'सेफ account में भेजो'],
    ['safe_account', 'safe खाते में डालो'],
    ['verification_account', 'verifcation account mein bhejo'],
    ['verification_account', 'वेरिफिकेशन account'],
    ['regulator_account', 'RBI खाता number'],
    ['regulator_account', 'आरबीआई account'],
    ['stay_on_line', 'Don’t hang up'],
  ])('detects %s in "%s"', (cue, quote) => {
    expect(scoreCoaching([quote]).cues).toContain(cue);
  });

  it('a coached call written across scripts and STT noise still reaches the hold threshold', () => {
    const quotes = [`Officer ne kaha ki paisa सेफ account mein daalo`, `kisiko${ZWSP} mat batana`];
    expect(scoreCoaching(quotes).score).toBeGreaterThanOrEqual(0.6);
  });
});

describe('coaching cues: benign sentences that share words with cues', () => {
  it.each([
    'Is my safe deposit locker still active?',
    'The officer at the branch helped me yesterday',
    "I'll tell my family about the new card",
    'Urgent: please freeze my card',
    'My account is safe, right?',
    'I verified my account last week',
    'The RBI rules say the bank must refund me',
    'Do not share your OTP, the bank never asks for it',
    'Mujhe apna OTP kisi ko nahi batana hai',
    'I got a parcel delivered today',
    'I want to protect my card, please block it',
    'Please share the statement on email',
  ])('stays below the hold threshold: "%s"', (quote) => {
    expect(scoreCoaching([quote]).score).toBeLessThan(0.6);
  });

  it.each([
    'Please freeze my card',
    'Mera card block kar do',
    'मेरा कार्ड ब्लॉक कर दो',
    'I want to waive the late fee',
    'EMI ki date badal do',
  ])('ordinary requests score 0: "%s"', (quote) => {
    expect(scoreCoaching([quote])).toEqual({ score: 0, cues: [] });
  });
});

describe('coaching performance', () => {
  it('scores 5 × 300 characters of dense cue text well inside the 10 ms Worker CPU budget', () => {
    const chunk = 'safe account kisi ko mat batana officer said parcel seized digital arrest otp bata do ';
    const quote = chunk.repeat(5).slice(0, 300);
    const quotes = Array.from({ length: 5 }, () => quote);
    scoreCoaching(quotes); // warm up the regexes
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) scoreCoaching(quotes);
    const perCall = (performance.now() - start) / runs;
    expect(perCall).toBeLessThan(2);
  });

  it('does not backtrack badly on long runs of one letter or one word', () => {
    for (const filler of ['a'.repeat(299), 'otp '.repeat(75), 'kisi ko '.repeat(37)]) {
      const quotes = Array.from({ length: 5 }, () => filler.slice(0, 300));
      scoreCoaching(quotes); // warm up (first use compiles the regexes)
      detectDistress(quotes);
      const runs = 20;
      const start = performance.now();
      for (let i = 0; i < runs; i++) {
        scoreCoaching(quotes);
        detectDistress(quotes);
      }
      expect((performance.now() - start) / runs).toBeLessThan(2);
    }
  });
});

// Clarification 6: bereavement, self-harm, abuse or coercion at home, medical emergency. Nothing else.
describe('distress: the narrow categories still fire', () => {
  it.each([
    ['abuse', 'My husband forced me to call the bank'],
    ['abuse', 'Someone is forcing me to send money'],
    ['abuse', 'they are threatening me'],
    ['abuse', 'pati mujhe maarta hai'],
    ['abuse', 'वह मुझे मारता है'],
    ['abuse', 'mujhse zabardasti karwa raha hai'],
    ['medical_emergency', 'My father is in the hospital'],
    ['medical_emergency', 'my wife was admitted to hospital last night'],
    ['medical_emergency', 'papa hospital mein bharti hain'],
    ['medical_emergency', 'माँ अस्पताल में भर्ती है'],
    ['medical_emergency', 'He had a heart attack this morning'],
    ['medical_emergency', 'papa ko heart attack aaya'],
    ['bereavement', 'Papa ji guzar gaye'],
    ['bereavement', `my father passed${ZWSP} away`],
  ])('flags %s in "%s"', (cue, quote) => {
    expect(detectDistress([quote]).cues).toContain(cue);
  });
});

describe('distress: lost-card panic and everyday phrases stay out', () => {
  it.each([
    'Card aaye hue do din guzar gaye, abhi tak activate nahi hua',
    'Bahut time guzar gaya, refund nahi aaya',
    'समय गुजर गया, पैसा नहीं आया',
    'The app forced me to update before I could pay',
    'You forced me to wait an hour on hold',
    'Is mausam mein machhar bahut marta hai',
    'I work in the hospital, my salary comes to this account',
    'The ATM in the hospital ate my card',
    'Hospital mein ATM hai, wahan se paise nikale',
    'अस्पताल के पास वाले ATM ने कार्ड रख लिया',
    'Mujhe heart attack aa jayega, mera card chori ho gaya',
    "I'm going to have a heart attack, someone stole my card",
    'Bank ne zabardasti insurance de diya',
    'The price hike really hits me hard',
    'I am so scared, my card was stolen, please block it',
  ])('does not flag "%s"', (quote) => {
    expect(detectDistress([quote])).toEqual({ distress: false, cues: [] });
  });
});
