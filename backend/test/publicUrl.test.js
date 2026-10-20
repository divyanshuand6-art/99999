import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicBaseUrl, makePublicShortUrl } from '../src/utils/publicUrl.js';

const ENV_KEYS = ['NODE_ENV', 'PORT', 'PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL'];
function withEnv(overrides, fn) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (Object.hasOwn(overrides, key)) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    } else if (key === 'PUBLIC_BASE_URL' || key === 'RENDER_EXTERNAL_URL') {
      delete process.env[key];
    }
  }
  try { return fn(); }
  finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('local development can use localhost when no public URL is configured', () => {
  withEnv({ NODE_ENV: 'development', PORT: '4000' }, () => {
    assert.equal(getPublicBaseUrl(), 'http://localhost:4000');
    assert.equal(makePublicShortUrl('abc12345'), 'http://localhost:4000/r/abc12345');
  });
});

test('production uses the configured public HTTPS origin and never localhost', () => {
  withEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://linkpulse-api.onrender.com/' }, () => {
    assert.equal(getPublicBaseUrl(), 'https://linkpulse-api.onrender.com');
    assert.equal(makePublicShortUrl('abc12345'), 'https://linkpulse-api.onrender.com/r/abc12345');
  });
});

test('production fails closed when no public base URL is configured', () => {
  withEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: undefined, RENDER_EXTERNAL_URL: undefined }, () => {
    assert.throws(() => getPublicBaseUrl(), /PUBLIC_BASE_URL must be set/);
  });
});

test('production rejects localhost, private IPs, and URL paths', () => {
  withEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://localhost:4000' }, () => {
    assert.throws(() => getPublicBaseUrl(), /public HTTPS domain/);
  });
  withEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://192.168.1.10' }, () => {
    assert.throws(() => getPublicBaseUrl(), /public HTTPS domain/);
  });
  withEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://links.example.com/app' }, () => {
    assert.throws(() => getPublicBaseUrl(), /without a path/);
  });
});
