import { resolveApiBase } from './serverConfig';

describe('isolated staging server', () => {
  const originalEnvironment = process.env.REACT_APP_ENVIRONMENT;
  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.REACT_APP_ENVIRONMENT;
    else process.env.REACT_APP_ENVIRONMENT = originalEnvironment;
    localStorage.clear();
  });
  test('ignores a stored production backend in the staging bundle', () => {
    process.env.REACT_APP_ENVIRONMENT = 'staging';
    localStorage.setItem('transgest_api_url', 'https://api.transgest.app');
    expect(resolveApiBase()).toBe(window.location.origin);
  });
  test('ignores another external backend in the staging bundle', () => {
    process.env.REACT_APP_ENVIRONMENT = 'staging';
    localStorage.setItem('transgest_api_url', 'https://another-server.example.invalid');
    expect(resolveApiBase()).toBe(window.location.origin);
  });
  test('retains the existing configurable backend outside staging', () => {
    delete process.env.REACT_APP_ENVIRONMENT;
    localStorage.setItem('transgest_api_url', 'https://local-company.example.invalid');
    expect(resolveApiBase()).toBe('https://local-company.example.invalid');
  });
});
