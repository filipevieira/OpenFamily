/**
 * OpenFamily E2E Test Suite - Assertions & Testing Utilities
 * Built-in zero-dependency testing helpers for Node.js
 */

export class AssertionError extends Error {
    constructor(message, actual, expected) {
        super(message);
        this.name = 'AssertionError';
        this.actual = actual;
        this.expected = expected;
    }
}

export const assert = {
    ok(value, message = 'Expected value to be truthy') {
        if (!value) {
            throw new AssertionError(message, value, true);
        }
    },
    strictEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new AssertionError(
                message || `Expected ${JSON.stringify(actual)} to strictly equal ${JSON.stringify(expected)}`,
                actual,
                expected
            );
        }
    },
    notStrictEqual(actual, expected, message) {
        if (actual === expected) {
            throw new AssertionError(
                message || `Expected ${JSON.stringify(actual)} to NOT equal ${JSON.stringify(expected)}`,
                actual,
                expected
            );
        }
    },
    deepEqual(actual, expected, message) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) {
            throw new AssertionError(
                message || `Deep equality mismatch:\nActual:   ${a}\nExpected: ${e}`,
                actual,
                expected
            );
        }
    },
    includes(haystack, needle, message) {
        if (typeof haystack === 'string') {
            if (!haystack.includes(needle)) {
                throw new AssertionError(
                    message || `Expected string "${haystack}" to include "${needle}"`,
                    haystack,
                    needle
                );
            }
        } else if (Array.isArray(haystack)) {
            if (!haystack.includes(needle)) {
                throw new AssertionError(
                    message || `Expected array to include ${JSON.stringify(needle)}`,
                    haystack,
                    needle
                );
            }
        } else {
            throw new AssertionError('Haystack must be string or array', typeof haystack, 'string|array');
        }
    },
    notIncludes(haystack, needle, message) {
        if (typeof haystack === 'string' && haystack.includes(needle)) {
            throw new AssertionError(
                message || `Expected string to NOT include "${needle}"`,
                haystack,
                needle
            );
        } else if (Array.isArray(haystack) && haystack.includes(needle)) {
            throw new AssertionError(
                message || `Expected array to NOT include ${JSON.stringify(needle)}`,
                haystack,
                needle
            );
        }
    },
    match(str, regex, message) {
        if (!regex.test(str)) {
            throw new AssertionError(
                message || `Expected "${str}" to match ${regex}`,
                str,
                regex.toString()
            );
        }
    },
    throws(fn, message) {
        let threw = false;
        try {
            fn();
        } catch (e) {
            threw = true;
        }
        if (!threw) {
            throw new AssertionError(message || 'Expected function to throw an error', false, true);
        }
    },
    async rejects(asyncFn, message) {
        let threw = false;
        try {
            await asyncFn();
        } catch (e) {
            threw = true;
        }
        if (!threw) {
            throw new AssertionError(message || 'Expected async function to reject', false, true);
        }
    },
    greaterThanOrEqual(actual, min, message) {
        if (actual < min) {
            throw new AssertionError(
                message || `Expected ${actual} to be >= ${min}`,
                actual,
                min
            );
        }
    },
    lessThanOrEqual(actual, max, message) {
        if (actual > max) {
            throw new AssertionError(
                message || `Expected ${actual} to be <= ${max}`,
                actual,
                max
            );
        }
    }
};

export class TestSuite {
    constructor(name) {
        this.name = name;
        this.tests = [];
        this.results = [];
    }

    test(title, fn) {
        this.tests.push({ title, fn });
    }

    async run() {
        this.results = [];
        for (const t of this.tests) {
            const start = Date.now();
            try {
                await t.fn();
                const duration = Date.now() - start;
                this.results.push({ title: t.title, passed: true, duration });
            } catch (err) {
                const duration = Date.now() - start;
                this.results.push({
                    title: t.title,
                    passed: false,
                    duration,
                    error: err.message,
                    stack: err.stack,
                    actual: err.actual,
                    expected: err.expected
                });
            }
        }
        return this.results;
    }
}
