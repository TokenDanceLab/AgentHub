// real_tested=true
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64UrlEncode, computeCodeChallenge, generateCodeVerifier } from './pkce';

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('base64UrlEncode', () => {
  it('encodes the RFC 4648 "foobar" vectors without padding', () => {
    expect(base64UrlEncode(utf8Bytes('f'))).toBe('Zg');
    expect(base64UrlEncode(utf8Bytes('fo'))).toBe('Zm8');
    expect(base64UrlEncode(utf8Bytes('foo'))).toBe('Zm9v');
    expect(base64UrlEncode(utf8Bytes('foob'))).toBe('Zm9vYg');
    expect(base64UrlEncode(utf8Bytes('fooba'))).toBe('Zm9vYmE');
    expect(base64UrlEncode(utf8Bytes('foobar'))).toBe('Zm9vYmFy');
  });

  it('maps + and / to - and _ (base64url alphabet)', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64UrlEncode(new Uint8Array([0xff, 0xff]))).toBe('__8');
  });

  it('strips all trailing padding', () => {
    expect(base64UrlEncode(new Uint8Array([0xfb]))).toBe('-w');
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xef]))).toBe('--8');
  });

  it('handles an empty byte array', () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe('');
  });

  it('encodes multi-byte UTF-8 text', () => {
    expect(base64UrlEncode(utf8Bytes('中'))).toBe('5Lit');
  });

  it('produces a 43-char unpadded string for 32 random bytes', () => {
    const encoded = base64UrlEncode(new Uint8Array(32).fill(0x61));
    expect(encoded).toHaveLength(43);
    expect(encoded).not.toMatch(/=+$/);
  });
});

describe('generateCodeVerifier', () => {
  it('returns a 43-character verifier (RFC 7636 §4.1)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(43);
  });

  it('uses only the base64url unreserved alphabet', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('produces different verifiers on consecutive calls', () => {
    const first = generateCodeVerifier();
    const second = generateCodeVerifier();
    expect(first).not.toBe(second);
  });

  it('derives the verifier from crypto.getRandomValues output', () => {
    const fillBytes = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation((array: Uint8Array) => {
        array.fill(0xab);
        return array;
      });

    const expected = base64UrlEncode(new Uint8Array(32).fill(0xab));
    expect(generateCodeVerifier()).toBe(expected);
    expect(fillBytes).toHaveBeenCalledTimes(1);

    fillBytes.mockRestore();
  });
});

describe('computeCodeChallenge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the RFC 7636 Appendix-B S256 vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(computeCodeChallenge(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is deterministic for the same verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const first = await computeCodeChallenge(verifier);
    const second = await computeCodeChallenge(verifier);
    expect(first).toBe(second);
  });

  it('differs across verifiers', async () => {
    const challengeA = await computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    const challengeB = await computeCodeChallenge('another-verifier-value');
    expect(challengeA).not.toBe(challengeB);
  });

  it('computes the SHA-256 of the empty string (well-known vector)', async () => {
    await expect(computeCodeChallenge('')).resolves.toBe(
      '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
    );
  });

  it('matches the SHA-256 vector for a single-character verifier', async () => {
    await expect(computeCodeChallenge('x')).resolves.toBe(
      'LXEWQrcmsEQBYnyp-6wy9chTD7GQPMTbAiWHF5IaSIE',
    );
  });

  it('returns a 43-char base64url challenge for a 43-char verifier', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
