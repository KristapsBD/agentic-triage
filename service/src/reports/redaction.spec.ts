import { redactSecrets } from './redaction';

describe('redactSecrets', () => {
  it('redacts a bare secret key', () => {
    expect(redactSecrets('api key is sk_live_FAKE1234567890abcdef, keep it safe')).not.toContain(
      'sk_live_FAKE1234567890abcdef',
    );
  });

  it('redacts a labeled password value while keeping the key readable', () => {
    expect(redactSecrets('password: hunter2SuperSecret')).toBe('password: [REDACTED]');
  });

  // F4 audit finding: "PII" was claimed (Set C E5, PR #25) but only
  // credential patterns were implemented -- an email address landed
  // verbatim. Basic email redaction closes that gap.
  it('redacts an email address', () => {
    const redacted = redactSecrets('contact me at jane.doe@example.com if this reproduces');
    expect(redacted).not.toContain('jane.doe@example.com');
    expect(redacted).toContain('[REDACTED]');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'The login button does nothing when tapped on iOS Safari.';
    expect(redactSecrets(text)).toBe(text);
  });
});
