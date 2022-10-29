// A custom test framework because I hate test frameworks!

interface TestCase {
  name: string;
  func: TestFunc;
  success: boolean;
  logs: Log[];

  children: TestCase[];
}

interface Log {
  err: Error;
  isError: boolean;
}

export class TestContext {
  testCase: TestCase;

  constructor(testCase: TestCase) {
    this.testCase = testCase;
  }

  fail(message?: string) {
    this.testCase.success = false;
    if (message) {
      this.testCase.logs.push({
        err: new Error(message),
        isError: true,
      });
    }
  }

  test(name: string, func: TestFunc) {
    this.testCase.children.push({
      name: name,
      func: func,
      success: true,
      logs: [],
      children: [],
    });
  }

  log(message: string) {
    this.testCase.logs.push({
      err: new Error(message),
      isError: false,
    });
  }
}

type TestFunc = (t: TestContext) => void;

const tests: TestCase[] = [];

export function test(name: string, func: TestFunc) {
  tests.push({
    name: name,
    func: func,
    success: true,
    logs: [],
    children: [],
  });
}

function runTests(tests: TestCase[]): boolean {
  let success = true;
  for (const test of tests) {
    try {
      test.func(new TestContext(test));
    } catch (e) {
      console.error(e);
      test.success = false;
    }
  
    const subSuccess = runTests(test.children);
    if (!subSuccess) {
      test.success = false;
    }

    if (!test.success) {
      success = false;
    }
  }
  return success;
}

export function run() {
  const success = runTests(tests);
  
  function printTest(test: TestCase, indent: number) {
    const tab = "  ".repeat(indent);
    const emoji = test.success ? "✅" : "❌";
    console.log(tab + `${emoji} ${test.name}`);
    for (const log of test.logs) {
      if (log.isError) {
        console.error(log.err);
      } else {
        console.log(log.err.message);
      }
    }

    for (const child of test.children) {
      printTest(child, indent + 1);
    }
  }

  for (const test of tests) {
    printTest(test, 0);
  }

  process.exit(success ? 0 : 1);
}
