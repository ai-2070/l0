# L0 Testing Guide

## Overview

L0 uses [Vitest](https://vitest.dev/) as its testing framework. This guide covers setup, running tests, and writing new tests.

## Setup

### Install Dependencies

```bash
npm install
```

This will install:
- `vitest` - Test runner
- `@vitest/ui` - Interactive test UI
- `@vitest/coverage-v8` - Coverage reporting
- `zod` - Schema validation (used in structured output tests)

### Verify Installation

```bash
npm test
```

## Running Tests

### Run All Tests

```bash
npm test
```

### Watch Mode (Re-run on Changes)

```bash
npm run test:watch
```

### Interactive UI

```bash
npm run test:ui
```

Opens an interactive browser-based test UI at `http://localhost:51204`

### Coverage Report

```bash
npm run test:coverage
```

Generates coverage reports in:
- Terminal (text summary)
- `coverage/html/index.html` (detailed HTML report)
- `coverage/lcov.info` (for CI/CD tools)

## Test Structure

### Test Files

All test files are located in the `tests/` directory:

```
tests/
├── README.md           # This file
├── drift.test.ts       # Drift detection tests
├── formatting.test.ts  # Format utilities tests
├── guardrails.test.ts  # Guardrail engine tests
├── retry.test.ts       # Retry manager tests
├── runtime.test.ts     # Core runtime tests
└── zeroToken.test.ts   # Zero token detection tests
```

### Test File Naming

- Use `.test.ts` or `.spec.ts` suffix
- Name should match the module being tested
- Example: `retry.test.ts` tests `src/runtime/retry.ts`

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MyClass } from '../src/my-module';

describe('MyClass', () => {
  let instance: MyClass;

  beforeEach(() => {
    // Setup before each test
    instance = new MyClass();
  });

  describe('feature group', () => {
    it('should do something specific', () => {
      const result = instance.doSomething();
      expect(result).toBe(expectedValue);
    });

    it('should handle edge cases', () => {
      expect(() => instance.doSomething(invalidInput)).toThrow();
    });
  });
});
```

### Assertion Examples

```typescript
// Equality
expect(value).toBe(5);
expect(obj).toEqual({ foo: 'bar' });

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeDefined();
expect(value).toBeNull();

// Numbers
expect(value).toBeGreaterThan(10);
expect(value).toBeLessThan(100);
expect(value).toBeGreaterThanOrEqual(10);
expect(value).toBeLessThanOrEqual(100);

// Strings
expect(str).toContain('substring');
expect(str).toMatch(/regex/);

// Arrays
expect(arr).toHaveLength(3);
expect(arr).toContain('item');

// Exceptions
expect(() => throwError()).toThrow();
expect(() => throwError()).toThrow('specific message');
```

### Async Tests

```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});

it('should handle promises', () => {
  return promiseFunction().then(result => {
    expect(result).toBe('success');
  });
});
```

### Mocking

```typescript
import { vi } from 'vitest';

it('should mock functions', () => {
  const mockFn = vi.fn(() => 'mocked');
  const result = mockFn();
  
  expect(mockFn).toHaveBeenCalled();
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(result).toBe('mocked');
});

it('should mock modules', async () => {
  vi.mock('../src/my-module', () => ({
    myFunction: vi.fn(() => 'mocked'),
  }));
  
  const { myFunction } = await import('../src/my-module');
  expect(myFunction()).toBe('mocked');
});
```

## Test Coverage Goals

We aim for:
- **80%** line coverage
- **80%** function coverage
- **80%** branch coverage
- **80%** statement coverage

### Check Coverage

```bash
npm run test:coverage
```

### View Detailed Coverage

Open `coverage/html/index.html` in your browser to see:
- Line-by-line coverage
- Uncovered branches
- Function coverage details

## Testing Best Practices

### 1. Test Behavior, Not Implementation

❌ **Bad:**
```typescript
it('should call internal method', () => {
  const spy = vi.spyOn(instance, '_internalMethod');
  instance.publicMethod();
  expect(spy).toHaveBeenCalled();
});
```

✅ **Good:**
```typescript
it('should return correct result', () => {
  const result = instance.publicMethod();
  expect(result).toBe(expectedValue);
});
```

### 2. Use Descriptive Test Names

❌ **Bad:**
```typescript
it('works', () => { ... });
```

✅ **Good:**
```typescript
it('should retry 3 times on network error before failing', () => { ... });
```

### 3. One Assertion Per Test (When Possible)

❌ **Bad:**
```typescript
it('should do everything', () => {
  expect(result.foo).toBe('bar');
  expect(result.baz).toBe(42);
  expect(result.items).toHaveLength(3);
});
```

✅ **Good:**
```typescript
it('should set foo property', () => {
  expect(result.foo).toBe('bar');
});

it('should set baz property', () => {
  expect(result.baz).toBe(42);
});

it('should have 3 items', () => {
  expect(result.items).toHaveLength(3);
});
```

### 4. Test Edge Cases

Always test:
- Empty inputs
- Null/undefined
- Maximum/minimum values
- Boundary conditions
- Error conditions

### 5. Keep Tests Fast

- Avoid real network calls (mock them)
- Minimize file I/O
- Use small test data
- Target: < 10ms per test

## Continuous Integration

Tests run automatically on:
- Pull requests
- Main branch commits

CI configuration will fail if:
- Any tests fail
- Coverage drops below 80%

## Troubleshooting

### Tests Timing Out

Increase timeout in specific test:
```typescript
it('slow test', async () => {
  // Test code
}, 20000); // 20 second timeout
```

### Import Errors

Make sure module paths are correct:
```typescript
// Use relative paths from tests/
import { foo } from '../src/module';
```

### Type Errors

Ensure `tsconfig.json` includes test files:
```json
{
  "include": ["src/**/*", "tests/**/*"]
}
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest API Reference](https://vitest.dev/api/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

## Contributing

When adding new features:
1. Write tests first (TDD)
2. Ensure tests pass: `npm test`
3. Check coverage: `npm run test:coverage`
4. Aim for 80%+ coverage on new code

## Questions?

If you encounter issues with tests, please:
1. Check this README
2. Review existing tests for examples
3. Check Vitest documentation
4. Open an issue with details