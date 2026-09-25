import {
  isSkipReply,
  normalizeOrderFields,
  parseCustomFieldValues,
  queueAiOrderFields,
} from './order-fields';

describe('order-fields', () => {
  describe('normalizeOrderFields', () => {
    it('drops blank/duplicate labels and generates unique keys', () => {
      const out = normalizeOrderFields([
        { label: 'Colour', type: 'text' },
        { label: '  ' },
        { label: 'colour' },
        { label: 'Delivery Date', visibleToAi: true, optional: true },
      ]);
      expect(out.map((f) => f.label)).toEqual(['Colour', 'Delivery Date']);
      expect(out.map((f) => f.key)).toEqual(['colour', 'delivery_date']);
      expect(out[1]).toMatchObject({ visibleToAi: true, optional: true });
    });

    it('downgrades a select field without choices to text', () => {
      const [f] = normalizeOrderFields([{ label: 'Size', type: 'select', choices: [' ', ''] }]);
      expect(f.type).toBe('text');
      expect(f.choices).toEqual([]);
    });

    it('keeps choices only for select fields', () => {
      const [a, b] = normalizeOrderFields([
        { label: 'Size', type: 'select', choices: ['S', ' M ', ''] },
        { label: 'Note', type: 'text', choices: ['x'] },
      ]);
      expect(a.choices).toEqual(['S', 'M']);
      expect(b.choices).toEqual([]);
    });

    it('returns [] for non-array input', () => {
      expect(normalizeOrderFields(null)).toEqual([]);
      expect(normalizeOrderFields({ label: 'x' })).toEqual([]);
    });
  });

  describe('queueAiOrderFields', () => {
    const page = {
      orderFieldsJson: JSON.stringify([
        { label: 'Colour', visibleToAi: true },
        { label: 'Internal', visibleToAi: false },
        { label: 'Gift Note', visibleToAi: true, optional: true },
      ]),
    };

    it('queues only AI-visible, unanswered fields and points at the first', () => {
      const draft: any = { currentStep: 'address', customFieldValues: { colour: 'Red' } };
      expect(queueAiOrderFields(draft, page)).toBe(true);
      expect(draft.pendingCustomFields.map((f: any) => f.label)).toEqual(['Gift Note']);
      expect(draft.currentStep).toBe('cf:Gift Note');
      expect(draft.pendingCustomFields[0].optional).toBe(true);
    });

    it('runs only once per draft', () => {
      const draft: any = { currentStep: 'address' };
      expect(queueAiOrderFields(draft, page)).toBe(true);
      draft.pendingCustomFields = [];
      draft.currentStep = 'confirm';
      expect(queueAiOrderFields(draft, page)).toBe(false);
      expect(draft.currentStep).toBe('confirm');
    });

    it('is a no-op for pages without order fields', () => {
      const draft: any = { currentStep: 'address' };
      expect(queueAiOrderFields(draft, { orderFieldsJson: null })).toBe(false);
      expect(draft.currentStep).toBe('address');
    });
  });

  it('isSkipReply recognises Bangla and English "no"', () => {
    for (const t of ['না', 'nai', 'Skip', ' no ', 'লাগবে না']) expect(isSkipReply(t)).toBe(true);
    for (const t of ['Red', 'নীল', 'no thanks red']) expect(isSkipReply(t)).toBe(false);
  });

  it('parseCustomFieldValues tolerates bad JSON', () => {
    expect(parseCustomFieldValues('{"Size":"M"}')).toEqual({ Size: 'M' });
    expect(parseCustomFieldValues('not json')).toEqual({});
    expect(parseCustomFieldValues('[1,2]')).toEqual({});
  });
});
