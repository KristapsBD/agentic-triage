import { redactSecrets } from './redaction';

describe('redactSecrets', () => {
  describe('bare token patterns', () => {
    it('redacts an OpenAI/Anthropic-style sk- key', () => {
      expect(redactSecrets('key is sk-abcdefghij1234567890 in the logs')).toBe(
        'key is [REDACTED] in the logs',
      );
    });

    it('leaves a too-short sk- candidate alone (below the 10-char minimum)', () => {
      const text = 'key is sk-short1 in the logs';
      expect(redactSecrets(text)).toBe(text);
    });

    it('redacts a Stripe-style sk_live_ key', () => {
      expect(redactSecrets('api key is sk_live_FAKE1234567890abcdef, keep it safe')).toBe(
        'api key is [REDACTED], keep it safe',
      );
    });

    it('redacts a Stripe-style sk_test_ key', () => {
      expect(redactSecrets('use sk_test_FAKE1234567890abcdef for staging')).toBe(
        'use [REDACTED] for staging',
      );
    });

    it('redacts an AWS access key ID', () => {
      expect(redactSecrets('AKIAABCDEFGHIJKLMNOP leaked in a commit')).toBe(
        '[REDACTED] leaked in a commit',
      );
    });

    it('leaves a malformed AWS-like key alone (wrong length/case)', () => {
      const text = 'AKIAshorttoolower leaked in a commit';
      expect(redactSecrets(text)).toBe(text);
    });

    it('redacts a GitHub PAT-style token for each prefix variant', () => {
      expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz here')).toBe(
        'token [REDACTED] here',
      );
      expect(redactSecrets('token gho_abcdefghijklmnopqrstuvwxyz here')).toBe(
        'token [REDACTED] here',
      );
      expect(redactSecrets('token ghu_abcdefghijklmnopqrstuvwxyz here')).toBe(
        'token [REDACTED] here',
      );
      expect(redactSecrets('token ghs_abcdefghijklmnopqrstuvwxyz here')).toBe(
        'token [REDACTED] here',
      );
      expect(redactSecrets('token ghr_abcdefghijklmnopqrstuvwxyz here')).toBe(
        'token [REDACTED] here',
      );
    });

    it('leaves a github-like token alone when it is below the 20-char minimum', () => {
      const text = 'token ghp_tooshort here';
      expect(redactSecrets(text)).toBe(text);
    });

    it('redacts a Bearer token', () => {
      expect(redactSecrets('Authorization: Bearer abcDEF123.456-token_value')).toBe(
        'Authorization: [REDACTED]',
      );
    });

    it('leaves a too-short Bearer candidate alone', () => {
      const text = 'Authorization: Bearer short';
      expect(redactSecrets(text)).toBe(text);
    });

    it('redacts multiple distinct bare tokens in the same text', () => {
      const text = 'sk-abcdefghij1234567890 and AKIAABCDEFGHIJKLMNOP both leaked';
      expect(redactSecrets(text)).toBe('[REDACTED] and [REDACTED] both leaked');
    });

    it('redacts repeated occurrences of the same bare token pattern', () => {
      const text = 'sk-abcdefghij1234567890 then again sk-zzzzzzzzzz1234567890';
      expect(redactSecrets(text)).toBe('[REDACTED] then again [REDACTED]');
    });
  });

  describe('labeled value pattern', () => {
    it('redacts a labeled password value while keeping the key readable', () => {
      expect(redactSecrets('password: hunter2SuperSecret')).toBe('password: [REDACTED]');
    });

    it('redacts password using = as the separator', () => {
      expect(redactSecrets('password=hunter2SuperSecret')).toBe('password=[REDACTED]');
    });

    it('redacts a quoted key:value pair, keeping the quoted key and closing quote intact', () => {
      expect(redactSecrets('"password":"hunter2SuperSecret"')).toBe('"password":"[REDACTED]"');
    });

    it('redacts each recognized label name', () => {
      expect(redactSecrets('passwd: abcdefgh')).toBe('passwd: [REDACTED]');
      expect(redactSecrets('pwd: abcdefgh')).toBe('pwd: [REDACTED]');
      expect(redactSecrets('api_key: abcdefgh')).toBe('api_key: [REDACTED]');
      expect(redactSecrets('api-key: abcdefgh')).toBe('api-key: [REDACTED]');
      expect(redactSecrets('apikey: abcdefgh')).toBe('apikey: [REDACTED]');
      expect(redactSecrets('secret: abcdefgh')).toBe('secret: [REDACTED]');
      expect(redactSecrets('access_key: abcdefgh')).toBe('access_key: [REDACTED]');
      expect(redactSecrets('access-key: abcdefgh')).toBe('access-key: [REDACTED]');
      expect(redactSecrets('auth_token: abcdefgh')).toBe('auth_token: [REDACTED]');
      expect(redactSecrets('auth-token: abcdefgh')).toBe('auth-token: [REDACTED]');
    });

    it('is case-insensitive on both the label and value', () => {
      expect(redactSecrets('PASSWORD: HunterSecret')).toBe('PASSWORD: [REDACTED]');
    });

    it('leaves a value shorter than the 4-char minimum untouched', () => {
      const text = 'password: abc';
      expect(redactSecrets(text)).toBe(text);
    });

    it('redacts a value exactly at the 4-char minimum', () => {
      expect(redactSecrets('password: abcd')).toBe('password: [REDACTED]');
    });

    it('stops the redacted value at whitespace, quote, comma, or closing brace', () => {
      expect(redactSecrets('password: abcdefgh and more text')).toBe(
        'password: [REDACTED] and more text',
      );
      expect(redactSecrets('{"password":"abcdefgh","other":"x"}')).toBe(
        '{"password":"[REDACTED]","other":"x"}',
      );
      expect(redactSecrets('{password: abcdefgh}')).toBe('{password: [REDACTED]}');
    });

    it('redacts multiple labeled values in the same text', () => {
      const text = 'password: firstSecret and api_key: secondSecret';
      expect(redactSecrets(text)).toBe('password: [REDACTED] and api_key: [REDACTED]');
    });

    it('does not touch a key-like word that is not one of the recognized labels', () => {
      const text = 'username: notASecretValue';
      expect(redactSecrets(text)).toBe(text);
    });
  });

  describe('email pattern', () => {
    it('redacts an email address', () => {
      const redacted = redactSecrets('contact me at jane.doe@example.com if this reproduces');
      expect(redacted).toBe('contact me at [REDACTED] if this reproduces');
    });

    it('redacts an email address with a subdomain and plus-tag', () => {
      expect(redactSecrets('reach jane+bugs@mail.example.co.uk please')).toBe(
        'reach [REDACTED] please',
      );
    });

    it('redacts multiple email addresses in the same text', () => {
      const text = 'cc jane@example.com and john@example.org on this';
      expect(redactSecrets(text)).toBe('cc [REDACTED] and [REDACTED] on this');
    });

    it('leaves a malformed email-like string untouched (no TLD)', () => {
      const text = 'ping user@localhost for details';
      expect(redactSecrets(text)).toBe(text);
    });
  });

  describe('combined and no-op behavior', () => {
    it('leaves ordinary prose untouched', () => {
      const text = 'The login button does nothing when tapped on iOS Safari.';
      expect(redactSecrets(text)).toBe(text);
    });

    it('leaves empty text untouched', () => {
      expect(redactSecrets('')).toBe('');
    });

    it('redacts a bare token, a labeled value, and an email all in one pass', () => {
      const text =
        'key sk-abcdefghij1234567890, password: hunter2Secret, contact jane.doe@example.com';
      expect(redactSecrets(text)).toBe(
        'key [REDACTED], password: [REDACTED], contact [REDACTED]',
      );
    });
  });
});
