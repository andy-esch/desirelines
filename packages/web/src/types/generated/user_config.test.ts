/**
 * Tests for user_config protobuf types.
 *
 * Tests the generated UserConfig, Goal, Annotation, and Preferences types
 * to ensure they work correctly with the application.
 */

import { describe, it, expect } from 'vitest';
import type {
  UserConfig,
  Goal,
  Annotation,
  Preferences,
  ChartDefaults,
  Metadata,
} from './user_config';

describe('UserConfig', () => {
  it('should create config with goals', () => {
    const config: UserConfig = {
      userId: 'user123',
      schemaVersion: '1.0',
      lastUpdated: '2024-11-01T12:00:00Z',
      goals: {
        '2024': {
          goals: [
            {
              id: 'goal-1',
              value: 1000,
              label: 'Ride 1000 miles',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '',
            },
            {
              id: 'goal-2',
              value: 2000,
              label: 'Stretch goal',
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      },
      annotations: {},
    };

    expect(config.userId).toBe('user123');
    expect(config.goals?.['2024']?.goals).toHaveLength(2);
    expect(config.goals?.['2024']?.goals?.[0]?.value).toBe(1000);
  });

  it('should create config with annotations', () => {
    const config: UserConfig = {
      userId: 'user456',
      schemaVersion: '1.0',
      lastUpdated: '',
      goals: {},
      annotations: {
        '2024': {
          annotations: [
            {
              id: 'ann-1',
              startDate: '2024-07-14',
              endDate: '',
              label: 'Race Day',
              description: 'Big Sur Marathon',
              stravaActivityId: '123456',
              type: 1, // ANNOTATION_TYPE_EVENT
              createdAt: '',
              updatedAt: '',
            },
            {
              id: 'ann-2',
              startDate: '2024-01-01',
              endDate: '2024-01-31',
              label: 'Training Block',
              description: '',
              stravaActivityId: '',
              type: 2, // ANNOTATION_TYPE_PERIOD
              createdAt: '',
              updatedAt: '',
            },
            {
              id: 'ann-3',
              startDate: '2024-06-01',
              endDate: '',
              label: 'Recovery Week',
              description: '',
              stravaActivityId: '',
              type: 3, // ANNOTATION_TYPE_NOTE
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      },
    };

    expect(config.annotations?.['2024']?.annotations).toHaveLength(3);
    expect(config.annotations?.['2024']?.annotations?.[0]?.type).toBe(1);
    expect(config.annotations?.['2024']?.annotations?.[0]?.stravaActivityId).toBe('123456');
    expect(config.annotations?.['2024']?.annotations?.[1]?.endDate).toBe('2024-01-31');
  });

  it('should create config with preferences', () => {
    const config: UserConfig = {
      userId: 'user789',
      schemaVersion: '1.0',
      lastUpdated: '',
      goals: {},
      annotations: {},
      preferences: {
        theme: 'dark',
        defaultYear: 2024,
        chartDefaults: {
          showAverage: true,
          showGoals: false,
        },
      },
    };

    expect(config.preferences?.theme).toBe('dark');
    expect(config.preferences?.defaultYear).toBe(2024);
    expect(config.preferences?.chartDefaults?.showAverage).toBe(true);
    expect(config.preferences?.chartDefaults?.showGoals).toBe(false);
  });

  it('should create config with metadata', () => {
    const config: UserConfig = {
      userId: 'user999',
      schemaVersion: '1.0',
      lastUpdated: '',
      goals: {},
      annotations: {},
      metadata: {
        createdAt: '2024-01-01T00:00:00Z',
        lastSyncedDevice: 'chrome-desktop',
        configTypes: ['goals', 'annotations', 'preferences'],
      },
    };

    expect(config.metadata?.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(config.metadata?.lastSyncedDevice).toBe('chrome-desktop');
    expect(config.metadata?.configTypes).toHaveLength(3);
  });

  it('should handle complete config with all features', () => {
    const config: UserConfig = {
      userId: 'complete-user',
      schemaVersion: '1.0',
      lastUpdated: '2024-11-01T12:00:00Z',
      goals: {
        '2024': {
          goals: [{
            id: 'g1',
            value: 1500,
            label: 'Annual goal',
            createdAt: '',
            updatedAt: '',
          }],
        },
      },
      annotations: {
        '2024': {
          annotations: [{
            id: 'ann-1',
            startDate: '2024-06-01',
            endDate: '',
            label: 'Summer training',
            description: '',
            stravaActivityId: '',
            type: 2, // PERIOD
            createdAt: '',
            updatedAt: '',
          }],
        },
      },
      preferences: {
        theme: 'light',
        defaultYear: 2024,
      },
      metadata: {
        createdAt: '2024-01-01T00:00:00Z',
        lastSyncedDevice: '',
        configTypes: [],
      },
    };

    expect(config.goals).toBeDefined();
    expect(config.annotations).toBeDefined();
    expect(config.preferences).toBeDefined();
    expect(config.metadata).toBeDefined();
  });

  it('should serialize to JSON correctly', () => {
    const config: UserConfig = {
      userId: 'json-test',
      schemaVersion: '1.0',
      lastUpdated: '',
      goals: {
        '2024': {
          goals: [{
            id: 'g1',
            value: 1000,
            label: 'Test goal',
            createdAt: '',
            updatedAt: '',
          }],
        },
      },
      annotations: {},
    };

    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as UserConfig;

    expect(parsed.userId).toBe('json-test');
    expect(parsed.goals?.['2024']?.goals?.[0]?.value).toBe(1000);
  });
});

describe('Goal', () => {
  it('should create a valid goal', () => {
    const goal: Goal = {
      id: 'goal-123',
      value: 1000,
      label: 'Annual goal',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    expect(goal.id).toBe('goal-123');
    expect(goal.value).toBe(1000);
    expect(goal.label).toBe('Annual goal');
  });
});

describe('Annotation', () => {
  it('should create an event annotation', () => {
    const annotation: Annotation = {
      id: 'ann-1',
      startDate: '2024-07-14',
      endDate: '',
      label: 'Race Day',
      description: 'Big Sur Marathon',
      stravaActivityId: '123456',
      type: 1, // EVENT
      createdAt: '',
      updatedAt: '',
    };

    expect(annotation.type).toBe(1);
    expect(annotation.stravaActivityId).toBe('123456');
  });

  it('should create a period annotation with end date', () => {
    const annotation: Annotation = {
      id: 'ann-2',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      label: 'Training Block',
      description: 'Base building phase',
      stravaActivityId: '',
      type: 2, // PERIOD
      createdAt: '',
      updatedAt: '',
    };

    expect(annotation.type).toBe(2);
    expect(annotation.endDate).toBe('2024-01-31');
  });
});

describe('Preferences', () => {
  it('should create preferences with chart defaults', () => {
    const prefs: Preferences = {
      theme: 'dark',
      defaultYear: 2024,
      chartDefaults: {
        showAverage: true,
        showGoals: true,
      },
    };

    expect(prefs.theme).toBe('dark');
    expect(prefs.defaultYear).toBe(2024);
    expect(prefs.chartDefaults?.showAverage).toBe(true);
  });

  it('should handle optional chartDefaults', () => {
    const prefs: Preferences = {
      theme: 'light',
      defaultYear: 2023,
    };

    expect(prefs.chartDefaults).toBeUndefined();
  });
});

describe('ChartDefaults', () => {
  it('should configure chart display options', () => {
    const defaults: ChartDefaults = {
      showAverage: false,
      showGoals: true,
    };

    expect(defaults.showAverage).toBe(false);
    expect(defaults.showGoals).toBe(true);
  });
});

describe('Metadata', () => {
  it('should track config metadata', () => {
    const metadata: Metadata = {
      createdAt: '2024-01-01T00:00:00Z',
      lastSyncedDevice: 'chrome-desktop',
      configTypes: ['goals', 'preferences'],
    };

    expect(metadata.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(metadata.configTypes).toHaveLength(2);
  });
});
