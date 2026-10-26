import { describe, expect, it } from 'vitest';
import { detectDistress } from './distress-lexicon';

// docs/GATE.md clarification 6: narrow on purpose — bereavement, self-harm, abuse, medical emergency.
describe('detectDistress', () => {
  it('flags scenario 9 (bereavement, close account)', () => {
    expect(detectDistress(['My father passed away, I need to close his account'])).toEqual({
      distress: true,
      cues: ['bereavement'],
    });
  });

  it.each([
    ['bereavement', 'My mother died last week'],
    ['bereavement', 'He is no more, I need his statement'],
    ['bereavement', 'my husband expired in March'],
    ['bereavement', 'my father passed on last month'],
    ['bereavement', 'she has passed recently'],
    ['bereavement', 'I have his death certificate'],
    ['bereavement', 'Papa guzar gaye'],
    ['bereavement', 'meri maa nahi rahi'],
    ['bereavement', 'पिताजी का देहांत हो गया'],
    ['bereavement', 'मेरे पापा गुज़र गए'],
    ['bereavement', 'उनका निधन हो गया'],
    ['self_harm', 'I want to end my life'],
    ['self_harm', 'main khudkushi kar lunga'],
    ['self_harm', 'आत्महत्या'],
    ['abuse', 'My husband is forcing me to send the money'],
    ['abuse', 'woh zabardasti karwa raha hai'],
    ['abuse', 'वह मुझे धमका रहा है'],
    ['medical_emergency', 'My son is in the ICU'],
    ['medical_emergency', 'She had a heart attack'],
    ['medical_emergency', 'Papa aspatal mein hain'],
    ['medical_emergency', 'माँ अस्पताल में है'],
  ])('flags %s in "%s"', (cue, quote) => {
    const result = detectDistress([quote]);
    expect(result.distress).toBe(true);
    expect(result.cues).toContain(cue);
  });

  it.each([
    'I lost my card and I am panicking',
    'mera card chori ho gaya, bahut darr lag raha hai',
    'मेरा कार्ड खो गया, मुझे डर लग रहा है',
    'My card expired',
    'My son passed the exam, I want to send him a gift',
    'She passed the payment yesterday',
    'My phone died during the call',
    'I accidentally paid twice',
    'Please freeze my card quickly',
  ])('does not flag ordinary worry: "%s"', (quote) => {
    expect(detectDistress([quote])).toEqual({ distress: false, cues: [] });
  });

  it('reports each category once', () => {
    expect(detectDistress(['My father passed away', 'my mother died too']).cues).toEqual(['bereavement']);
  });

  it('handles no quotes', () => {
    expect(detectDistress([])).toEqual({ distress: false, cues: [] });
  });
});
