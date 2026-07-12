import {
  deriveTimeOfDayBucket,
  isAfternoonSample,
  isDiurnalSampleAccepted,
  isEveningSample,
  isMorningSample,
  isNoonSample,
  localMinutesOfDay,
} from './diurnal-windows';

describe('diurnal window acceptance (Req 8.3)', () => {
  describe('morning CAR — within 30 min of waking', () => {
    it('accepts 0..30 minutes after wake', () => {
      expect(isMorningSample(0)).toBe(true);
      expect(isMorningSample(15)).toBe(true);
      expect(isMorningSample(30)).toBe(true);
    });
    it('rejects later than 30 min or negative', () => {
      expect(isMorningSample(31)).toBe(false);
      expect(isMorningSample(-1)).toBe(false);
    });
  });

  describe('noon window 11:00–13:00', () => {
    it('accepts the inclusive bounds and interior', () => {
      expect(isNoonSample(11 * 60)).toBe(true);
      expect(isNoonSample(12 * 60)).toBe(true);
      expect(isNoonSample(13 * 60)).toBe(true);
    });
    it('rejects just outside the window', () => {
      expect(isNoonSample(11 * 60 - 1)).toBe(false);
      expect(isNoonSample(13 * 60 + 1)).toBe(false);
    });
  });

  describe('afternoon window 15:00–17:00', () => {
    it('accepts bounds and interior', () => {
      expect(isAfternoonSample(15 * 60)).toBe(true);
      expect(isAfternoonSample(16 * 60)).toBe(true);
      expect(isAfternoonSample(17 * 60)).toBe(true);
    });
    it('rejects outside', () => {
      expect(isAfternoonSample(14 * 60 + 59)).toBe(false);
      expect(isAfternoonSample(17 * 60 + 1)).toBe(false);
    });
  });

  describe('evening window 22:00–00:00', () => {
    it('accepts 22:00 through 23:59 and exactly midnight', () => {
      expect(isEveningSample(22 * 60)).toBe(true);
      expect(isEveningSample(23 * 60 + 59)).toBe(true);
      expect(isEveningSample(0)).toBe(true); // 00:00
    });
    it('rejects before 22:00 (and non-midnight early times)', () => {
      expect(isEveningSample(21 * 60 + 59)).toBe(false);
      expect(isEveningSample(1)).toBe(false);
    });
  });

  describe('isDiurnalSampleAccepted dispatch', () => {
    it('routes each bucket to its window', () => {
      expect(isDiurnalSampleAccepted({ bucket: 'morning', minutesSinceWake: 20 })).toBe(true);
      expect(isDiurnalSampleAccepted({ bucket: 'morning', minutesSinceWake: 45 })).toBe(false);
      expect(isDiurnalSampleAccepted({ bucket: 'noon', localMinutesOfDay: 12 * 60 })).toBe(true);
      expect(isDiurnalSampleAccepted({ bucket: 'afternoon', localMinutesOfDay: 16 * 60 })).toBe(true);
      expect(isDiurnalSampleAccepted({ bucket: 'evening', localMinutesOfDay: 23 * 60 })).toBe(true);
      expect(isDiurnalSampleAccepted({ bucket: 'evening', localMinutesOfDay: 18 * 60 })).toBe(false);
    });
    it('rejects morning without minutesSinceWake and time buckets without a clock', () => {
      expect(isDiurnalSampleAccepted({ bucket: 'morning' })).toBe(false);
      expect(isDiurnalSampleAccepted({ bucket: 'noon' })).toBe(false);
    });
  });
});

describe('localMinutesOfDay', () => {
  it('converts a UTC ISO timestamp with an offset', () => {
    // 2024-01-01T12:30:00Z with -60 min offset → 11:30 local → 690.
    expect(localMinutesOfDay('2024-01-01T12:30:00Z', -60)).toBe(11 * 60 + 30);
  });
  it('wraps across midnight for negative offsets', () => {
    // 00:30Z with -60 → 23:30 previous day → 1410.
    expect(localMinutesOfDay('2024-01-01T00:30:00Z', -60)).toBe(23 * 60 + 30);
  });
  it('returns null for an unparseable timestamp', () => {
    expect(localMinutesOfDay('not-a-date')).toBeNull();
  });
});

describe('deriveTimeOfDayBucket (total, for reference selection Req 8.5)', () => {
  it('partitions the day into the four buckets', () => {
    expect(deriveTimeOfDayBucket(8 * 60)).toBe('morning');
    expect(deriveTimeOfDayBucket(12 * 60)).toBe('noon');
    expect(deriveTimeOfDayBucket(18 * 60)).toBe('afternoon');
    expect(deriveTimeOfDayBucket(23 * 60)).toBe('evening');
    expect(deriveTimeOfDayBucket(2 * 60)).toBe('evening'); // pre-dawn
  });
});
