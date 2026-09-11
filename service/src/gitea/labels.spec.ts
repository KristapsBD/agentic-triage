import {
  ALL_TRIAGE_SERVICE_LABELS,
  COMPONENTS,
  DEFAULT_LABEL_COLOR,
  FEATURE_REQUEST,
  LABEL_COLORS,
  NEEDS_INFO,
  NEEDS_TRIAGE,
  SEVERITIES,
} from './labels';

describe('labels', () => {
  it('defines the canonical component labels', () => {
    expect(COMPONENTS).toEqual([
      'frontend',
      'backend',
      'api',
      'auth',
      'database',
      'infra',
      'docs',
      'unknown',
    ]);
  });

  it('defines the canonical severity labels', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('defines the canonical workflow label strings', () => {
    expect(NEEDS_TRIAGE).toBe('needs-triage');
    expect(NEEDS_INFO).toBe('needs-info');
    expect(FEATURE_REQUEST).toBe('feature-request');
  });

  it('aggregates every triage-service label exactly once, in order', () => {
    expect(ALL_TRIAGE_SERVICE_LABELS).toEqual([
      ...COMPONENTS,
      ...SEVERITIES,
      NEEDS_TRIAGE,
      NEEDS_INFO,
      FEATURE_REQUEST,
    ]);
  });

  it('maps every workflow and severity label to its exact color', () => {
    expect(LABEL_COLORS).toEqual({
      [NEEDS_TRIAGE]: '#fbca04',
      [NEEDS_INFO]: '#d4c5f9',
      [FEATURE_REQUEST]: '#0e8a16',
      critical: '#b60205',
      high: '#d93f0b',
      medium: '#fbca04',
      low: '#c2e0c6',
    });
  });

  it('falls back to a distinct default color for labels with no explicit mapping', () => {
    expect(DEFAULT_LABEL_COLOR).toBe('#ededed');
    expect(LABEL_COLORS[DEFAULT_LABEL_COLOR]).toBeUndefined();
  });
});
