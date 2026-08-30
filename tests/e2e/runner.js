/**
 * OpenFamily E2E Test Suite Runner
 * 
 * Standalone, zero-dependency Node.js test runner executing Tiers 1 through 4.
 * Usage: `node tests/e2e/runner.js`
 */

import { createTier1Suite } from './tier1-feature-coverage.test.js';
import { createTier2Suite } from './tier2-boundary-corner.test.js';
import { createTier3Suite } from './tier3-cross-feature.test.js';
import { createTier4Suite } from './tier4-real-world-scenarios.test.js';
import { createTier5Suite } from './tier5-adversarial-m1.test.js';

async function runAllSuites() {
    console.log('===============================================================');
    console.log('  OpenFamily Universal Kiosk Mode - End-to-End Test Suite');
    console.log('  Specification: PROJECT.md / ORIGINAL_REQUEST.md');
    console.log('===============================================================\n');

    const suites = [
        createTier1Suite(),
        createTier2Suite(),
        createTier3Suite(),
        createTier4Suite(),
        createTier5Suite(),
    ];

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    const failures = [];
    const startTime = Date.now();

    for (const suite of suites) {
        console.log(`\n▶ Running Suite: ${suite.name}`);
        console.log('─'.repeat(63));

        const results = await suite.run();
        let suitePassed = 0;
        let suiteFailed = 0;

        for (const res of results) {
            totalTests++;
            if (res.passed) {
                totalPassed++;
                suitePassed++;
                console.log(`  ✔ [PASS] ${res.title} (${res.duration}ms)`);
            } else {
                totalFailed++;
                suiteFailed++;
                failures.push({ suite: suite.name, ...res });
                console.log(`  ✖ [FAIL] ${res.title} (${res.duration}ms)`);
                console.log(`     Error: ${res.error}`);
            }
        }

        console.log(`  Summary: ${suitePassed}/${results.length} passed (${suiteFailed} failed)`);
    }

    const totalDuration = Date.now() - startTime;

    console.log('\n===============================================================');
    console.log('  E2E TEST EXECUTION SUMMARY');
    console.log('===============================================================');
    console.log(`  Total Tests Run:     ${totalTests}`);
    console.log(`  Passed:              ${totalPassed}`);
    console.log(`  Failed:              ${totalFailed}`);
    console.log(`  Total Duration:      ${totalDuration}ms`);
    console.log('===============================================================');

    if (failures.length > 0) {
        console.log('\n  FAILURES LIST:');
        failures.forEach((f, idx) => {
            console.log(`\n  ${idx + 1}) [${f.suite}] ${f.title}`);
            console.log(`     Error: ${f.error}`);
            if (f.stack) {
                console.log(`     Stack: ${f.stack.split('\n').slice(1, 4).join('\n')}`);
            }
        });
        process.exit(1);
    } else {
        console.log('\n  🎉 ALL E2E TESTS PASSED SUCCESSFULLY! (100% Pass Rate)\n');
        process.exit(0);
    }
}

runAllSuites().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
