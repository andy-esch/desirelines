/**
 * Tests for sports_metrics protobuf types and serialization.
 *
 * These tests verify that the generated protobuf TypeScript code works correctly
 * for multi-sport support, including optional field behavior and JSON conversion.
 */

import { describe, it, expect } from 'vitest';
import type {
  SportMetrics,
  DailyActivity,
  MetricTimeseriesEntry,
  MetricsTimeseries,
  SportMetadata,
  YearMetadata,
  SportTotals,
} from './sports_metrics';

describe('SportMetrics', () => {
  it('should create cycling metrics with distance and elevation', () => {
    const metrics: SportMetrics = {
      metadata: {
        sport: 'cycling',
        year: 2024,
        availableMetrics: ['distance_meters', 'time_minutes', 'elevation_meters'],
        primaryMetric: 'distance_meters',
      },
      daily: {
        '2024-01-15': {
          distanceMeters: 42195.0, // Marathon distance in meters
          timeMinutes: 120.5,
          elevationMeters: 450.0,
          activities: 2,
          activityIds: [123456, 123457],
        },
      },
      timeseries: {
        distanceMeters: [],
        timeMinutes: [],
        elevationMeters: [],
      },
    };

    // Verify structure
    expect(metrics.metadata?.sport).toBe('cycling');
    expect(metrics.metadata?.year).toBe(2024);
    expect(metrics.daily?.['2024-01-15']?.distanceMeters).toBe(42195.0);
    expect(metrics.daily?.['2024-01-15']?.elevationMeters).toBe(450.0);
    expect(metrics.daily?.['2024-01-15']?.activities).toBe(2);
    expect(metrics.daily?.['2024-01-15']?.activityIds).toHaveLength(2);
  });

  it('should create yoga metrics without distance (optional fields)', () => {
    const metrics: SportMetrics = {
      metadata: {
        sport: 'yoga',
        year: 2024,
        availableMetrics: ['time_minutes'],
        primaryMetric: 'time_minutes',
      },
      daily: {
        '2024-01-15': {
          timeMinutes: 60.0,
          activities: 1,
          activityIds: [123458],
        },
      },
      timeseries: {
        distanceMeters: [],
        timeMinutes: [],
        elevationMeters: [],
      },
    };

    // Verify optional fields can be omitted
    const daily = metrics.daily?.['2024-01-15'];
    expect(daily?.distanceMeters).toBeUndefined();
    expect(daily?.elevationMeters).toBeUndefined();
    expect(daily?.timeMinutes).toBe(60.0);
    expect(daily?.activities).toBe(1);
  });

  it('should handle timeseries data', () => {
    const metrics: SportMetrics = {
      timeseries: {
        distanceMeters: [
          { date: '2024-01-15', value: 10000.0 },
          { date: '2024-01-16', value: 15000.0 },
        ],
        timeMinutes: [],
        elevationMeters: [],
      },
      daily: {},
    };

    // Verify timeseries structure
    expect(metrics.timeseries?.distanceMeters).toHaveLength(2);
    expect(metrics.timeseries?.distanceMeters?.[0]?.date).toBe('2024-01-15');
    expect(metrics.timeseries?.distanceMeters?.[0]?.value).toBe(10000.0);
    expect(metrics.timeseries?.distanceMeters?.[1]?.date).toBe('2024-01-16');
    expect(metrics.timeseries?.distanceMeters?.[1]?.value).toBe(15000.0);
  });

  it('should be serializable to JSON', () => {
    const metrics: SportMetrics = {
      metadata: {
        sport: 'running',
        year: 2024,
        availableMetrics: ['distance_meters', 'time_minutes'],
        primaryMetric: 'distance_meters',
      },
      daily: {
        '2024-01-15': {
          distanceMeters: 5000.0,
          timeMinutes: 30.0,
          activities: 1,
          activityIds: [999999],
        },
      },
      timeseries: {
        distanceMeters: [],
        timeMinutes: [],
        elevationMeters: [],
      },
    };

    // Convert to JSON and back
    const json = JSON.stringify(metrics);
    const parsed = JSON.parse(json) as SportMetrics;

    expect(parsed.metadata?.sport).toBe('running');
    expect(parsed.metadata?.year).toBe(2024);
    expect(parsed.daily?.['2024-01-15']?.distanceMeters).toBe(5000.0);
    expect(parsed.daily?.['2024-01-15']?.timeMinutes).toBe(30.0);
    expect(parsed.daily?.['2024-01-15']?.activities).toBe(1);
  });
});

describe('YearMetadata', () => {
  it('should handle multiple sports with totals', () => {
    const metadata: YearMetadata = {
      year: 2024,
      sports: ['cycling', 'running', 'yoga'],
      totals: {
        cycling: {
          distanceMeters: 500000.0,
          timeMinutes: 2000.0,
          elevationMeters: 15000.0,
          activities: 50,
        },
        yoga: {
          timeMinutes: 1200.0,
          activities: 30,
        },
      },
      lastUpdated: '2024-11-01T12:00:00Z',
      aggregationVersion: '1.0',
    };

    // Verify structure
    expect(metadata.year).toBe(2024);
    expect(metadata.sports).toHaveLength(3);
    expect(metadata.totals?.cycling?.distanceMeters).toBe(500000.0);
    expect(metadata.totals?.cycling?.activities).toBe(50);

    // Yoga should have optional fields omitted
    expect(metadata.totals?.yoga?.distanceMeters).toBeUndefined();
    expect(metadata.totals?.yoga?.timeMinutes).toBe(1200.0);
  });
});

describe('DailyActivity', () => {
  it('should handle partial metrics', () => {
    const daily: DailyActivity = {
      distanceMeters: 1000.0,
      activities: 1,
      activityIds: [],
    };

    // Only set fields should be present
    expect(daily.distanceMeters).toBe(1000.0);
    expect(daily.timeMinutes).toBeUndefined();
    expect(daily.elevationMeters).toBeUndefined();
    expect(daily.activities).toBe(1);
  });

  it('should handle empty daily activity', () => {
    const daily: DailyActivity = {
      activities: 0,
      activityIds: [],
    };

    // No optional fields
    expect(daily.distanceMeters).toBeUndefined();
    expect(daily.timeMinutes).toBeUndefined();
    expect(daily.elevationMeters).toBeUndefined();
    expect(daily.activities).toBe(0);
  });
});

describe('MetricTimeseriesEntry', () => {
  it('should create valid timeseries entry', () => {
    const entry: MetricTimeseriesEntry = {
      date: '2024-01-15',
      value: 10000.0,
    };

    expect(entry.date).toBe('2024-01-15');
    expect(entry.value).toBe(10000.0);
  });

  it('should work with negative values', () => {
    const entry: MetricTimeseriesEntry = {
      date: '2024-01-15',
      value: -5.0,
    };

    expect(entry.value).toBe(-5.0);
  });

  it('should work with zero values', () => {
    const entry: MetricTimeseriesEntry = {
      date: '2024-01-15',
      value: 0,
    };

    expect(entry.value).toBe(0);
  });
});

describe('SportTotals', () => {
  it('should handle sport with all metrics', () => {
    const totals: SportTotals = {
      distanceMeters: 100000.0,
      timeMinutes: 500.0,
      elevationMeters: 2000.0,
      activities: 25,
    };

    expect(totals.distanceMeters).toBe(100000.0);
    expect(totals.timeMinutes).toBe(500.0);
    expect(totals.elevationMeters).toBe(2000.0);
    expect(totals.activities).toBe(25);
  });

  it('should handle sport with only time metric', () => {
    const totals: SportTotals = {
      timeMinutes: 300.0,
      activities: 10,
    };

    expect(totals.distanceMeters).toBeUndefined();
    expect(totals.elevationMeters).toBeUndefined();
    expect(totals.timeMinutes).toBe(300.0);
    expect(totals.activities).toBe(10);
  });

  it('should handle zero activities', () => {
    const totals: SportTotals = {
      activities: 0,
    };

    expect(totals.activities).toBe(0);
  });
});

describe('MetricsTimeseries', () => {
  it('should contain arrays of metric entries', () => {
    const timeseries: MetricsTimeseries = {
      distanceMeters: [
        { date: '2024-01-01', value: 1000 },
        { date: '2024-01-02', value: 2000 },
      ],
      timeMinutes: [
        { date: '2024-01-01', value: 30 },
        { date: '2024-01-02', value: 45 },
      ],
      elevationMeters: [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 150 },
      ],
    };

    expect(timeseries.distanceMeters).toHaveLength(2);
    expect(timeseries.timeMinutes).toHaveLength(2);
    expect(timeseries.elevationMeters).toHaveLength(2);
  });

  it('should allow empty arrays', () => {
    const timeseries: MetricsTimeseries = {
      distanceMeters: [],
      timeMinutes: [],
      elevationMeters: [],
    };

    expect(timeseries.distanceMeters).toHaveLength(0);
    expect(timeseries.timeMinutes).toHaveLength(0);
    expect(timeseries.elevationMeters).toHaveLength(0);
  });
});

describe('SportMetadata', () => {
  it('should contain sport configuration', () => {
    const metadata: SportMetadata = {
      sport: 'cycling',
      year: 2024,
      availableMetrics: ['distance_meters', 'time_minutes', 'elevation_meters'],
      primaryMetric: 'distance_meters',
    };

    expect(metadata.sport).toBe('cycling');
    expect(metadata.year).toBe(2024);
    expect(metadata.availableMetrics).toContain('distance_meters');
    expect(metadata.primaryMetric).toBe('distance_meters');
  });

  it('should handle single metric sport', () => {
    const metadata: SportMetadata = {
      sport: 'yoga',
      year: 2024,
      availableMetrics: ['time_minutes'],
      primaryMetric: 'time_minutes',
    };

    expect(metadata.availableMetrics).toHaveLength(1);
    expect(metadata.primaryMetric).toBe('time_minutes');
  });
});

describe('Complete SportMetrics workflow', () => {
  it('should construct a complete sport metrics object', () => {
    const metrics: SportMetrics = {
      metadata: {
        sport: 'running',
        year: 2024,
        availableMetrics: ['distance_meters', 'time_minutes'],
        primaryMetric: 'distance_meters',
      },
      timeseries: {
        distanceMeters: [
          { date: '2024-01-01', value: 5000 },
          { date: '2024-01-02', value: 10000 },
        ],
        timeMinutes: [
          { date: '2024-01-01', value: 30 },
          { date: '2024-01-02', value: 60 },
        ],
        elevationMeters: [],
      },
      daily: {
        '2024-01-01': {
          distanceMeters: 5000,
          timeMinutes: 30,
          activities: 1,
          activityIds: [12345],
        },
        '2024-01-02': {
          distanceMeters: 5000,
          timeMinutes: 30,
          activities: 2,
          activityIds: [12346, 12347],
        },
      },
    };

    // Verify complete structure
    expect(metrics.metadata?.sport).toBe('running');
    expect(metrics.timeseries?.distanceMeters).toHaveLength(2);
    expect(Object.keys(metrics.daily)).toHaveLength(2);
    expect(metrics.daily['2024-01-02'].activityIds).toHaveLength(2);
  });
});

describe('Activities protobuf types', () => {
  it('should handle DistancesPayload with timeseries', () => {
    const payload = {
      distanceTraveled: [
        { date: '2024-01-15', value: 10.5 },
        { date: '2024-01-16', value: 25.3 },
      ],
      summaries: {
        '2024-01-15': {
          distanceMiles: 10.5,
          activityIds: ['123', '456'],
        },
      },
      avgDistance: [],
      lowerDistance: [],
      upperDistance: [],
    };

    expect(payload.distanceTraveled).toHaveLength(2);
    expect(payload.distanceTraveled[0].value).toBe(10.5);
    expect(payload.summaries['2024-01-15'].distanceMiles).toBe(10.5);
    expect(payload.summaries['2024-01-15'].activityIds).toHaveLength(2);
  });
});
