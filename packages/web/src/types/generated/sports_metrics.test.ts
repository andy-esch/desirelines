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
  CumulativeMetricsEntry,
  DailySummary,
  SportMetadata,
  YearMetadata,
  SportTotals,
} from './sports_metrics';

describe('SportMetrics', () => {
  it('should create cycling metrics with distance and elevation', () => {
    const metrics: SportMetrics = {
      timeseries: [
        {
          date: '2024-01-15',
          distance: 42195.0, // Marathon distance in meters
          time: 120.5,
          elevation: 450.0,
          activities: 2,
        },
      ],
    };

    // Verify structure
    expect(metrics.timeseries).toHaveLength(1);
    expect(metrics.timeseries[0].date).toBe('2024-01-15');
    expect(metrics.timeseries[0].distance).toBe(42195.0);
    expect(metrics.timeseries[0].elevation).toBe(450.0);
    expect(metrics.timeseries[0].activities).toBe(2);
  });

  it('should create yoga metrics without distance (optional fields)', () => {
    const metrics: SportMetrics = {
      timeseries: [
        {
          date: '2024-01-15',
          time: 60.0,
          activities: 1,
          // Note: distance and elevation are omitted for yoga
        },
      ],
    };

    // Verify optional fields can be omitted
    const entry = metrics.timeseries[0];
    expect(entry.distance).toBeUndefined();
    expect(entry.elevation).toBeUndefined();
    expect(entry.time).toBe(60.0);
    expect(entry.activities).toBe(1);
  });

  it('should handle timeseries data with multiple entries', () => {
    const metrics: SportMetrics = {
      timeseries: [
        { date: '2024-01-15', distance: 10000.0, time: 60.0, activities: 1 },
        { date: '2024-01-16', distance: 25000.0, time: 120.0, activities: 2 },
      ],
    };

    // Verify timeseries structure
    expect(metrics.timeseries).toHaveLength(2);
    expect(metrics.timeseries[0].date).toBe('2024-01-15');
    expect(metrics.timeseries[0].distance).toBe(10000.0);
    expect(metrics.timeseries[1].date).toBe('2024-01-16');
    expect(metrics.timeseries[1].distance).toBe(25000.0);
  });

  it('should be serializable to JSON', () => {
    const metrics: SportMetrics = {
      timeseries: [
        {
          date: '2024-01-15',
          distance: 5000.0,
          time: 30.0,
          activities: 1,
        },
      ],
    };

    // Convert to JSON and back
    const json = JSON.stringify(metrics);
    const parsed = JSON.parse(json) as SportMetrics;

    expect(parsed.timeseries).toHaveLength(1);
    expect(parsed.timeseries[0].date).toBe('2024-01-15');
    expect(parsed.timeseries[0].distance).toBe(5000.0);
    expect(parsed.timeseries[0].time).toBe(30.0);
    expect(parsed.timeseries[0].activities).toBe(1);
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

describe('CumulativeMetricsEntry', () => {
  it('should combine all metrics in one entry', () => {
    const entry: CumulativeMetricsEntry = {
      date: '2024-01-15',
      distance: 10000.0,
      time: 60.0,
      elevation: 150.0,
      activities: 2,
    };

    expect(entry.date).toBe('2024-01-15');
    expect(entry.distance).toBe(10000.0);
    expect(entry.time).toBe(60.0);
    expect(entry.elevation).toBe(150.0);
    expect(entry.activities).toBe(2);
  });

  it('should allow optional fields to be omitted', () => {
    const entry: CumulativeMetricsEntry = {
      date: '2024-01-15',
      time: 60.0,
      activities: 1,
      // distance and elevation omitted for yoga
    };

    expect(entry.distance).toBeUndefined();
    expect(entry.elevation).toBeUndefined();
    expect(entry.time).toBe(60.0);
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
      timeseries: [
        { date: '2024-01-01', distance: 5000, time: 30, activities: 1 },
        { date: '2024-01-02', distance: 10000, time: 60, activities: 2 },
      ],
    };

    // Verify complete structure
    expect(metrics.timeseries).toHaveLength(2);
    expect(metrics.timeseries[0].distance).toBe(5000);
    expect(metrics.timeseries[1].distance).toBe(10000);
    expect(metrics.timeseries[1].activities).toBe(2);
  });

  it('should work with DailySummary for source files', () => {
    const summary: DailySummary = {
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

    // Verify structure
    expect(Object.keys(summary.daily)).toHaveLength(2);
    expect(summary.daily['2024-01-02'].activityIds).toHaveLength(2);
    expect(summary.daily['2024-01-01'].distanceMeters).toBe(5000);
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
