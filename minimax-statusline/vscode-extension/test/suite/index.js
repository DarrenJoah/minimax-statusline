const path = require('path');
const Mocha = require('mocha');
const { glob } = require('glob');

// Create the mocha test
const mocha = new Mocha({
    ui: 'tdd',
    color: true
});

const testsRoot = path.resolve(__dirname, '..');

// Add files to the test suite
glob('**/**.test.js', { cwd: testsRoot })
    .then((specs) => {
        // Add files to the test suite
        specs.forEach(spec => mocha.addFile(path.resolve(testsRoot, spec)));

        try {
            // Run the mocha test
            mocha.run(failures => {
                if (failures > 0) {
                    console.error(`${failures} test(s) failed.`);
                    process.exit(1);
                } else {
                    console.error('All tests passed!');
                    process.exit(0);
                }
            });
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })
    .catch(err => {
        console.error('Error loading test files:', err);
        process.exit(1);
    });
